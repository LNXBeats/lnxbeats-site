import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { enqueueShopPaymentConfirmedNotifications } from "@/lib/notifications/service";
import {
  enforcePaymentRateLimit,
  inLockedPaymentTransaction,
  lockPaymentTransaction,
  paidPaymentStatuses,
  PaymentServiceError,
} from "@/lib/payments/service";
import type { PaymentProvider, PersistedPaymentMode } from "@/lib/payments/types";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { requireAcceptedShopTermsForOrder } from "@/lib/shop/legal";
import { planShopPaymentReconciliation } from "@/lib/shop/payment-domain";
import { ShopPaymentServiceError } from "@/lib/shop/payment-errors";
import type {
  ReservedShopPaymentAttempt,
  ShopPaymentFinalizationResult,
  ShopPaymentProviderEvent,
} from "@/lib/shop/payment-types";
import { SHOP_PAYMENT_PRICING_VERSION } from "@/lib/shop/payment-types";
import type {
  ShopPaymentCaptureRepository,
  ShopPaymentCheckoutRepository,
} from "@/lib/shop/payment-service";

type Transaction = Prisma.TransactionClient;
type ShopPaymentDatabaseRepository = ShopPaymentCheckoutRepository & ShopPaymentCaptureRepository & Readonly<{
  recordUnmatched(input: Readonly<{
    provider: PaymentProvider;
    eventId: string;
    type: string;
    livemode: boolean;
    objectId?: string;
    occurredAt: Date;
  }>): Promise<ShopPaymentFinalizationResult>;
}>;

const SHOP_ORDER_NUMBER = /^LNX-SHOP-[0-9]{4}-[0-9]{6,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_CODES = {
  mismatch: "SHOP_PAYMENT_EVIDENCE_MISMATCH",
  winner: "SHOP_PAYMENT_ALREADY_CAPTURED",
  expired: "SHOP_RESERVATION_EXPIRED_AFTER_CAPTURE",
  stock: "SHOP_STOCK_UNAVAILABLE_AFTER_CAPTURE",
  terminal: "SHOP_PAYMENT_TERMINAL_CAPTURE",
  terms: "SHOP_TERMS_SNAPSHOT_MISSING_AFTER_CAPTURE",
} as const;

function providerCheckoutKey(provider: PaymentProvider, paymentId: string) {
  return `shop:${provider.toLowerCase()}:checkout:${paymentId}`;
}

function lifecycleKey(paymentId: string, suffix: string) {
  return `shop-payment:${paymentId}:${suffix}`;
}

async function lockShopOrderRow(transaction: Transaction, shopOrderId: string) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "shop_orders"
    WHERE "id" = ${shopOrderId}::uuid
    FOR UPDATE
  `;
  return rows.length === 1;
}

async function lifecycleEvent(
  transaction: Transaction,
  input: Readonly<{
    shopOrderId: string;
    paymentId?: string;
    type:
      | "SHOP_TERMS_ACCEPTED"
      | "SHOP_PAYMENT_PROCESSING"
      | "SHOP_PAYMENT_CONFIRMED"
      | "SHOP_PAYMENT_FAILED"
      | "SHOP_PAYMENT_REQUIRES_REVIEW";
    idempotencyKey: string;
    actorUserId?: string;
    metadata?: Prisma.InputJsonValue;
    occurredAt?: Date;
  }>,
) {
  const event = await transaction.shopOrderLifecycleEvent.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      shopOrderId: input.shopOrderId,
      ...(input.paymentId ? { paymentId: input.paymentId } : {}),
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      metadata: input.metadata ?? {},
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    },
    update: {},
    select: { shopOrderId: true, paymentId: true, type: true },
  });
  if (
    event.shopOrderId !== input.shopOrderId
    || event.paymentId !== (input.paymentId ?? null)
    || event.type !== input.type
  ) throw new ShopPaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
}

function isValidShopSnapshot(order: {
  totalCents: number;
  shippingCents: number;
  currency: string;
  items: ReadonlyArray<{
    productId: string;
    productTitle: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
}) {
  let valid = true;
  const lineTotal = order.items.reduce((sum, item) => {
    if (
      !Number.isSafeInteger(item.quantity)
      || item.quantity <= 0
      || !Number.isSafeInteger(item.unitPriceCents)
      || item.unitPriceCents <= 0
      || !Number.isSafeInteger(item.lineTotalCents)
      || item.lineTotalCents !== item.unitPriceCents * item.quantity
    ) valid = false;
    return sum + item.lineTotalCents;
  }, 0);
  return valid && !(
    order.currency !== "EUR"
    || order.items.length === 0
    || !Number.isSafeInteger(order.shippingCents)
    || order.shippingCents < 0
    || !Number.isSafeInteger(order.totalCents)
    || order.totalCents <= 0
    || lineTotal + order.shippingCents !== order.totalCents
  );
}

function validateShopSnapshot(order: Parameters<typeof isValidShopSnapshot>[0]) {
  if (!isValidShopSnapshot(order)) throw new ShopPaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
}

function activeReservationsValid(
  order: {
    reservationExpiresAt: Date;
    items: ReadonlyArray<{
      inventoryTracked: boolean;
      reservation: null | { status: string; expiresAt: Date };
    }>;
  },
  now: Date,
) {
  return order.reservationExpiresAt > now
    && order.items.every((item) => !item.inventoryTracked || (
      item.reservation?.status === "ACTIVE"
      && item.reservation.expiresAt > now
    ));
}

async function createProviderReceipt(
  transaction: Transaction,
  event: ShopPaymentProviderEvent,
  outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW",
  paymentId?: string,
) {
  await transaction.providerEvent.create({
    data: {
      provider: event.provider,
      providerEventId: event.eventId,
      type: event.type.slice(0, 160),
      livemode: event.livemode,
      objectId: (event.providerPaymentId ?? event.providerCheckoutId ?? event.paymentId).slice(0, 255),
      outcome,
      ...(paymentId ? { paymentId } : {}),
      processedAt: event.occurredAt,
    },
    select: { id: true },
  });
}

async function recordReview(
  transaction: Transaction,
  input: Readonly<{
    event: ShopPaymentProviderEvent;
    shopOrderId: string;
    paymentId: string;
    reviewCode: string;
    captured: boolean;
    persistAsWinner?: boolean;
    persistProviderPaymentId?: boolean;
    persistPaymentMethod?: boolean;
  }>,
) {
  // The verified provider receipt is inserted before every domain mutation.
  // It remains atomic with those writes because the surrounding transaction
  // rolls the receipt back if any later invariant fails.
  await createProviderReceipt(transaction, input.event, "REQUIRES_REVIEW", input.paymentId);
  const persistAsWinner = input.persistAsWinner ?? input.captured;
  let capturedSiblingAlreadyUnderReview = false;
  if (!persistAsWinner) {
    // The partial unique index admits a single CREATED/PENDING/REQUIRES_REVIEW
    // attempt per ShopOrder/provider. A delayed success may target an older
    // FAILED/EXPIRED attempt after a retry has become PENDING. Close only the
    // un-captured sibling first, under the already-held ShopOrder lock, so the
    // durable review cannot fail with P2002. Never overwrite a sibling carrying
    // paidAt: its provider evidence must remain immutable.
    await transaction.payment.updateMany({
      where: {
        shopOrderId: input.shopOrderId,
        provider: input.event.provider,
        id: { not: input.paymentId },
        status: { in: ["CREATED", "PENDING", "REQUIRES_REVIEW"] },
        paidAt: null,
      },
      data: {
        status: "CANCELED",
        canceledAt: input.event.occurredAt,
        failureCode: "SHOP_PAYMENT_SUPERSEDED_BY_REVIEW",
      },
    });
    capturedSiblingAlreadyUnderReview = Boolean(await transaction.payment.findFirst({
      where: {
        shopOrderId: input.shopOrderId,
        provider: input.event.provider,
        id: { not: input.paymentId },
        status: "REQUIRES_REVIEW",
        paidAt: { not: null },
      },
      select: { id: true },
    }));
  }
  await transaction.payment.update({
    where: { id: input.paymentId },
    data: persistAsWinner
      ? {
        status: "SUCCEEDED",
        providerPaymentId: input.event.providerPaymentId,
        paymentMethod: input.event.paymentMethod,
        paidAt: input.event.occurredAt,
        failureCode: input.reviewCode,
      }
      : {
        // If a captured sibling already owns the provider's single review slot,
        // keep this attempt terminal while retaining its paid proof. The linked
        // ProviderEvent, ShopOrder review and lifecycle row remain authoritative.
        ...(!capturedSiblingAlreadyUnderReview ? { status: "REQUIRES_REVIEW" as const } : {}),
        ...(input.persistProviderPaymentId !== false && input.event.providerPaymentId
          ? { providerPaymentId: input.event.providerPaymentId }
          : {}),
        ...(input.persistPaymentMethod !== false && input.event.paymentMethod
          ? { paymentMethod: input.event.paymentMethod }
          : {}),
        ...(input.captured ? { paidAt: input.event.occurredAt } : {}),
        failureCode: input.reviewCode,
      },
    select: { id: true },
  });
  await transaction.shopOrder.update({
    where: { id: input.shopOrderId },
    data: {
      paymentReviewAt: input.event.occurredAt,
      paymentReviewCode: input.reviewCode,
    },
    select: { id: true },
  });
  await lifecycleEvent(transaction, {
    shopOrderId: input.shopOrderId,
    paymentId: input.paymentId,
    type: "SHOP_PAYMENT_REQUIRES_REVIEW",
    idempotencyKey: lifecycleKey(input.paymentId, `review:${input.reviewCode}`),
    metadata: {
      provider: input.event.provider,
      reviewCode: input.reviewCode,
      captured: input.captured,
    },
    occurredAt: input.event.occurredAt,
  });
  return {
    outcome: "REQUIRES_REVIEW",
    duplicate: false,
    shopOrderPaid: false,
    stockConfirmed: false,
    reviewCode: input.reviewCode,
  } as const satisfies ShopPaymentFinalizationResult;
}

async function stockCanBeConfirmed(
  transaction: Transaction,
  items: ReadonlyArray<{
    inventoryTracked: boolean;
    productId: string;
    quantity: number;
  }>,
) {
  const tracked = items.filter((item) => item.inventoryTracked).sort((left, right) => left.productId.localeCompare(right.productId));
  for (const item of tracked) {
    await lockPaymentTransaction(transaction, `shop-product:${item.productId}`);
  }
  for (const item of tracked) {
    const product = await transaction.product.findUnique({
      where: { id: item.productId },
      select: { trackInventory: true, stock: true },
    });
    if (!product?.trackInventory || product.stock === null || product.stock < item.quantity) return false;
  }
  return true;
}

async function confirmStock(
  transaction: Transaction,
  order: {
    id: string;
    orderNumber: string;
    items: ReadonlyArray<{
      inventoryTracked: boolean;
      productId: string;
      quantity: number;
      reservation: null | { id: string };
    }>;
  },
  occurredAt: Date,
) {
  const tracked = order.items.filter((item) => item.inventoryTracked);
  for (const item of tracked) {
    const changed = await transaction.product.updateMany({
      where: { id: item.productId, trackInventory: true, stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity }, lockVersion: { increment: 1 } },
    });
    if (changed.count !== 1 || !item.reservation) throw new Error("Shop stock changed during payment confirmation.");
    const product = await transaction.product.findUniqueOrThrow({
      where: { id: item.productId },
      select: { stock: true },
    });
    const stockAfter = product.stock;
    if (stockAfter === null) throw new Error("Tracked Shop stock is unavailable.");
    await transaction.productStockAdjustment.create({
      data: {
        productId: item.productId,
        stockBefore: stockAfter + item.quantity,
        stockAfter,
        delta: -item.quantity,
        reason: `Paiement confirmé de la commande ${order.orderNumber}`,
      },
    });
    const reservation = await transaction.stockReservation.updateMany({
      where: { id: item.reservation.id, status: "ACTIVE" },
      data: { status: "CONFIRMED", confirmedAt: occurredAt },
    });
    if (reservation.count !== 1) throw new Error("Shop reservation changed during payment confirmation.");
    await transaction.shopOrderEvent.create({
      data: {
        shopOrderId: order.id,
        stockReservationId: item.reservation.id,
        type: "STOCK_CONFIRMED",
        metadata: { productId: item.productId, quantity: item.quantity },
        occurredAt,
      },
      select: { id: true },
    });
  }
  return tracked.length > 0;
}

export function createShopPaymentDatabaseRepository(
  client: PrismaClient = prisma,
  expectedMode?: PersistedPaymentMode,
): ShopPaymentDatabaseRepository {
  return {
    enforceRateLimit(actorId) {
      return enforcePaymentRateLimit(client, actorId).catch((error: unknown) => {
        if (error instanceof PaymentServiceError && error.code === "RATE_LIMITED") {
          throw new ShopPaymentServiceError(429, "RATE_LIMITED");
        }
        throw error;
      });
    },

    async reserveAttempt(actorId, orderNumber, provider, mode, termsAccepted) {
      assertDatabaseConfigured();
      if (!UUID.test(actorId) || !SHOP_ORDER_NUMBER.test(orderNumber) || (expectedMode && expectedMode !== mode)) {
        throw new ShopPaymentServiceError(400, "ORDER_NOT_PAYABLE");
      }
      const now = new Date();
      return inLockedPaymentTransaction(client, async (transaction) => {
        await lockPaymentTransaction(transaction, `shop-payments:order:${orderNumber}`);
        const row = await transaction.shopOrder.findFirst({
          where: { orderNumber, userId: actorId },
          select: { id: true },
        });
        if (!row || !await lockShopOrderRow(transaction, row.id)) {
          throw new ShopPaymentServiceError(404, "ORDER_NOT_PAYABLE");
        }
        const order = await transaction.shopOrder.findUniqueOrThrow({
          where: { id: row.id },
          include: {
            items: {
              orderBy: [{ position: "asc" }, { productId: "asc" }],
              include: { reservation: true },
            },
          },
        });
        let terms: ReturnType<typeof requireAcceptedShopTermsForOrder>;
        try {
          terms = requireAcceptedShopTermsForOrder(termsAccepted, order, process.env, now);
        } catch {
          throw new ShopPaymentServiceError(409, "TERMS_NOT_ACCEPTED");
        }
        validateShopSnapshot(order);
        if (
          order.status !== "OPEN"
          || order.paymentStatus !== "AWAITING_PAYMENT"
          || order.paymentReviewAt
        ) throw new ShopPaymentServiceError(409, "ORDER_NOT_PAYABLE");
        if (!activeReservationsValid(order, now)) {
          throw new ShopPaymentServiceError(409, "RESERVATION_EXPIRED");
        }
        const winner = await transaction.payment.findFirst({
          where: { shopOrderId: order.id, status: { in: [...paidPaymentStatuses] } },
          select: { id: true },
        });
        if (winner) throw new ShopPaymentServiceError(409, "PAYMENT_ALREADY_COMPLETED");

        if (!order.termsVersion && !order.termsHashSha256 && !order.termsAcceptedAt) {
          await transaction.shopOrder.update({
            where: { id: order.id },
            data: terms,
            select: { id: true },
          });
        }
        await lifecycleEvent(transaction, {
          shopOrderId: order.id,
          type: "SHOP_TERMS_ACCEPTED",
          actorUserId: actorId,
          idempotencyKey: `shop-order:${order.id}:terms:${terms.termsVersion}`,
          metadata: {
            termsVersion: terms.termsVersion,
            termsHashSha256: terms.termsHashSha256,
          },
          occurredAt: terms.termsAcceptedAt,
        });

        const active = await transaction.payment.findFirst({
          where: {
            shopOrderId: order.id,
            provider,
            status: { in: ["CREATED", "PENDING"] },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            mode: true,
            amountCents: true,
            currency: true,
            pricingVersion: true,
            idempotencyKey: true,
            providerCheckoutId: true,
          },
        });
        if (active && (
          active.mode !== mode
          || active.amountCents !== order.totalCents
          || active.currency !== order.currency
          || active.pricingVersion !== SHOP_PAYMENT_PRICING_VERSION
        )) throw new ShopPaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");

        const paymentId = active?.id ?? randomUUID();
        const idempotencyKey = active?.idempotencyKey ?? providerCheckoutKey(provider, paymentId);
        if (!active) {
          await transaction.payment.create({
            data: {
              id: paymentId,
              shopOrderId: order.id,
              provider,
              mode,
              status: "CREATED",
              amountCents: order.totalCents,
              currency: "EUR",
              pricingVersion: SHOP_PAYMENT_PRICING_VERSION,
              idempotencyKey,
            },
            select: { id: true },
          });
          await lifecycleEvent(transaction, {
            shopOrderId: order.id,
            paymentId,
            type: "SHOP_PAYMENT_PROCESSING",
            idempotencyKey: lifecycleKey(paymentId, "processing"),
            metadata: { provider },
            occurredAt: now,
          });
        }
        return {
          shopOrderId: order.id,
          orderNumber: order.orderNumber,
          paymentId,
          provider,
          mode,
          idempotencyKey,
          ...(active?.providerCheckoutId ? { providerCheckoutId: active.providerCheckoutId } : {}),
          amountCents: order.totalCents,
          shippingCents: order.shippingCents,
          currency: "EUR",
          pricingVersion: SHOP_PAYMENT_PRICING_VERSION,
          reservationExpiresAt: order.reservationExpiresAt,
          lines: order.items.map((item) => ({
            productId: item.productId,
            title: item.productTitle,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            lineTotalCents: item.lineTotalCents,
          })),
        } satisfies ReservedShopPaymentAttempt;
      });
    },

    async recordSession(paymentId, provider, session) {
      assertDatabaseConfigured();
      await inLockedPaymentTransaction(client, async (transaction) => {
        await lockPaymentTransaction(transaction, `shop-payments:attempt:${paymentId}`);
        const payment = await transaction.payment.findUnique({
          where: { id: paymentId },
          select: {
            orderId: true,
            shopOrderId: true,
            provider: true,
            status: true,
            providerCheckoutId: true,
            providerPaymentId: true,
            paymentMethod: true,
            paidAt: true,
          },
        });
        if (!payment?.shopOrderId || payment.orderId || payment.provider !== provider) {
          throw new ShopPaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
        }
        if (
          (payment.providerCheckoutId && payment.providerCheckoutId !== session.id)
          || (payment.providerPaymentId && session.paymentIntentId && payment.providerPaymentId !== session.paymentIntentId)
        ) throw new ShopPaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
        await transaction.payment.update({
          where: { id: paymentId },
          data: {
            providerCheckoutId: session.id,
            ...(session.paymentIntentId ? { providerPaymentId: session.paymentIntentId } : {}),
            ...(session.expiresAt ? { checkoutExpiresAt: new Date(session.expiresAt * 1_000) } : {}),
            ...(["CREATED", "PENDING"].includes(payment.status) ? { status: "PENDING" as const } : {}),
          },
          select: { id: true },
        });
      });
    },

    async reservePaypalCapture(actorId, orderNumber, providerOrderId, mode) {
      assertDatabaseConfigured();
      if (
        !UUID.test(actorId)
        || !SHOP_ORDER_NUMBER.test(orderNumber)
        || !providerOrderId
        || providerOrderId.length > 255
        || (expectedMode && expectedMode !== mode)
      ) throw new ShopPaymentServiceError(400, "ORDER_NOT_PAYABLE");
      return inLockedPaymentTransaction(client, async (transaction) => {
        await lockPaymentTransaction(transaction, `shop-payments:order:${orderNumber}`);
        const row = await transaction.shopOrder.findFirst({
          where: { orderNumber, userId: actorId },
          select: { id: true },
        });
        if (!row || !await lockShopOrderRow(transaction, row.id)) {
          throw new ShopPaymentServiceError(404, "ORDER_NOT_PAYABLE");
        }
        const order = await transaction.shopOrder.findUniqueOrThrow({
          where: { id: row.id },
          include: { items: { include: { reservation: true } } },
        });
        if (
          order.status !== "OPEN"
          || order.paymentStatus !== "AWAITING_PAYMENT"
          || order.paymentReviewAt !== null
          || !activeReservationsValid(order, new Date())
        ) throw new ShopPaymentServiceError(409, "RESERVATION_EXPIRED");
        const winner = await transaction.payment.findFirst({
          where: {
            shopOrderId: order.id,
            OR: [
              { status: { in: [...paidPaymentStatuses] } },
              { paidAt: { not: null } },
            ],
          },
          select: { id: true },
        });
        if (winner) throw new ShopPaymentServiceError(409, "PAYMENT_ALREADY_COMPLETED");
        const payment = await transaction.payment.findFirst({
          where: {
            shopOrderId: order.id,
            provider: "PAYPAL",
            mode,
            providerCheckoutId: providerOrderId,
            status: { in: ["CREATED", "PENDING"] },
          },
          select: {
            id: true,
            shopOrderId: true,
            providerCheckoutId: true,
            amountCents: true,
            currency: true,
            pricingVersion: true,
          },
        });
        if (
          !payment?.shopOrderId
          || !payment.providerCheckoutId
          || payment.amountCents !== order.totalCents
          || payment.currency !== "EUR"
          || payment.pricingVersion !== SHOP_PAYMENT_PRICING_VERSION
        ) throw new ShopPaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
        return {
          paymentId: payment.id,
          shopOrderId: payment.shopOrderId,
          orderNumber,
          providerOrderId: payment.providerCheckoutId,
          captureIdempotencyKey: `shop:paypal:capture:${payment.id}`,
          amountCents: payment.amountCents,
          currency: "EUR",
          pricingVersion: SHOP_PAYMENT_PRICING_VERSION,
        };
      });
    },

    async recordUnmatched(input) {
      assertDatabaseConfigured();
      if (
        !input.eventId
        || input.eventId.length > 255
        || !input.type
        || input.type.length > 160
        || Number.isNaN(input.occurredAt.getTime())
      ) throw new ShopPaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
      return inLockedPaymentTransaction(client, async (transaction) => {
        await lockPaymentTransaction(transaction, `shop-payments:event:${input.provider}:${input.eventId}`);
        const duplicate = await transaction.providerEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider: input.provider,
              providerEventId: input.eventId,
            },
          },
          select: { outcome: true, paymentId: true },
        });
        if (duplicate) {
          return {
            outcome: duplicate.outcome,
            duplicate: true,
            shopOrderPaid: false,
            stockConfirmed: false,
            ...(duplicate.paymentId ? { winningPaymentId: duplicate.paymentId } : {}),
          } satisfies ShopPaymentFinalizationResult;
        }
        await transaction.providerEvent.create({
          data: {
            provider: input.provider,
            providerEventId: input.eventId,
            type: input.type,
            livemode: input.livemode,
            objectId: input.objectId?.slice(0, 255) ?? null,
            outcome: "REQUIRES_REVIEW",
            processedAt: input.occurredAt,
          },
          select: { id: true },
        });
        return {
          outcome: "REQUIRES_REVIEW",
          duplicate: false,
          shopOrderPaid: false,
          stockConfirmed: false,
          reviewCode: REVIEW_CODES.mismatch,
        } satisfies ShopPaymentFinalizationResult;
      });
    },

    async reconcile(event, now = new Date()) {
      assertDatabaseConfigured();
      if (
        !event.eventId
        || event.eventId.length > 255
        || !event.type
        || event.type.length > 160
        || !UUID.test(event.paymentId)
        || (event.providerCheckoutId !== undefined && (
          !event.providerCheckoutId
          || event.providerCheckoutId.length > 255
        ))
        || (event.providerPaymentId !== undefined && (
          !event.providerPaymentId
          || event.providerPaymentId.length > 255
        ))
        || (!event.providerCheckoutId && !event.providerPaymentId)
        || Number.isNaN(event.occurredAt.getTime())
      ) throw new ShopPaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
      return inLockedPaymentTransaction(client, async (transaction) => {
        await lockPaymentTransaction(transaction, `shop-payments:event:${event.provider}:${event.eventId}`);
        const duplicate = await transaction.providerEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider: event.provider,
              providerEventId: event.eventId,
            },
          },
          select: { outcome: true, paymentId: true },
        });
        if (duplicate) {
          return {
            outcome: duplicate.outcome,
            duplicate: true,
            shopOrderPaid: false,
            stockConfirmed: false,
            ...(duplicate.paymentId ? { winningPaymentId: duplicate.paymentId } : {}),
          } satisfies ShopPaymentFinalizationResult;
        }
        await lockPaymentTransaction(transaction, `shop-payments:attempt:${event.paymentId}`);
        const owner = await transaction.payment.findUnique({
          where: { id: event.paymentId },
          select: { shopOrderId: true },
        });
        if (!owner?.shopOrderId) {
          await createProviderReceipt(transaction, event, "REQUIRES_REVIEW");
          return {
            outcome: "REQUIRES_REVIEW",
            duplicate: false,
            shopOrderPaid: false,
            stockConfirmed: false,
            reviewCode: REVIEW_CODES.mismatch,
          };
        }
        await lockPaymentTransaction(transaction, `shop-payments:order:${owner.shopOrderId}`);
        if (!await lockShopOrderRow(transaction, owner.shopOrderId)) {
          await createProviderReceipt(transaction, event, "REQUIRES_REVIEW", event.paymentId);
          return {
            outcome: "REQUIRES_REVIEW",
            duplicate: false,
            shopOrderPaid: false,
            stockConfirmed: false,
            reviewCode: REVIEW_CODES.mismatch,
          };
        }
        const payment = await transaction.payment.findUniqueOrThrow({
          where: { id: event.paymentId },
          select: {
            id: true,
            orderId: true,
            shopOrderId: true,
            provider: true,
            mode: true,
            status: true,
            amountCents: true,
            currency: true,
            pricingVersion: true,
            providerCheckoutId: true,
            providerPaymentId: true,
            paymentMethod: true,
            paidAt: true,
          },
        });
        const order = await transaction.shopOrder.findUniqueOrThrow({
          where: { id: owner.shopOrderId },
          include: {
            items: {
              orderBy: [{ productId: "asc" }],
              include: { reservation: true },
            },
          },
        });
        const providerCheckoutBelongsToAnother = event.providerCheckoutId
          ? await transaction.payment.findFirst({
            where: {
              id: { not: payment.id },
              provider: event.provider,
              providerCheckoutId: event.providerCheckoutId,
            },
            select: { id: true },
          })
          : null;
        const providerPaymentBelongsToAnother = event.providerPaymentId
          ? await transaction.payment.findFirst({
            where: {
              id: { not: payment.id },
              provider: event.provider,
              providerPaymentId: event.providerPaymentId,
            },
            select: { id: true },
          })
          : null;
        const otherWinner = event.status === "SUCCEEDED"
          ? await transaction.payment.findFirst({
            where: {
              shopOrderId: order.id,
              id: { not: payment.id },
              OR: [
                { status: { in: [...paidPaymentStatuses] } },
                { paidAt: { not: null } },
              ],
            },
            select: { id: true },
          })
          : null;
        const plan = planShopPaymentReconciliation({
          payment,
          shopOrder: order,
          event,
          providerIdentifiersBelongToAnotherPayment: Boolean(
            providerCheckoutBelongsToAnother || providerPaymentBelongsToAnother,
          ),
          shopOrderSnapshotValid: isValidShopSnapshot(order),
          ...(otherWinner ? { otherWinningPaymentId: otherWinner.id } : {}),
          reservationValid: activeReservationsValid(order, now),
        });

        if (plan.action === "REVIEW_EVIDENCE") {
          return recordReview(transaction, {
            event,
            shopOrderId: order.id,
            paymentId: payment.id,
            reviewCode: plan.reviewCode,
            captured: plan.captured,
            persistAsWinner: false,
            persistProviderPaymentId: !providerPaymentBelongsToAnother
              && (!payment.providerPaymentId || payment.providerPaymentId === event.providerPaymentId),
            persistPaymentMethod: !payment.paymentMethod
              || payment.paymentMethod === event.paymentMethod,
          });
        }
        if (plan.action === "RECORD_PENDING") {
          await createProviderReceipt(transaction, event, "PROCESSED", payment.id);
          if (payment.status === "CREATED" || payment.status === "PENDING") {
            await transaction.payment.update({
              where: { id: payment.id },
              data: {
                status: "PENDING",
                ...(event.providerPaymentId ? { providerPaymentId: event.providerPaymentId } : {}),
              },
              select: { id: true },
            });
          }
          return {
            outcome: "PROCESSED",
            duplicate: false,
            shopOrderPaid: false,
            stockConfirmed: false,
          };
        }

        if (plan.action === "IGNORE_TERMINAL_FAILURE") {
          await createProviderReceipt(transaction, event, "IGNORED", payment.id);
          return {
            outcome: "IGNORED",
            duplicate: false,
            shopOrderPaid: order.paymentStatus === "PAID",
            stockConfirmed: false,
            winningPaymentId: payment.id,
          };
        }
        if (plan.action === "RECORD_FAILURE") {
          await createProviderReceipt(transaction, event, "PROCESSED", payment.id);
          if (payment.status === "CREATED" || payment.status === "PENDING") {
            await transaction.payment.update({
              where: { id: payment.id },
              data: event.status === "EXPIRED"
                ? {
                  status: "EXPIRED",
                  expiredAt: event.occurredAt,
                  failureCode: event.failureCode ?? "SHOP_CHECKOUT_EXPIRED",
                }
                : {
                  status: "FAILED",
                  failedAt: event.occurredAt,
                  failureCode: event.failureCode ?? "SHOP_PAYMENT_FAILED",
                  ...(event.providerPaymentId ? { providerPaymentId: event.providerPaymentId } : {}),
                },
              select: { id: true },
            });
            await lifecycleEvent(transaction, {
              shopOrderId: order.id,
              paymentId: payment.id,
              type: "SHOP_PAYMENT_FAILED",
              idempotencyKey: lifecycleKey(payment.id, "failed"),
              metadata: { provider: event.provider, status: event.status },
              occurredAt: event.occurredAt,
            });
          }
          return {
            outcome: "PROCESSED",
            duplicate: false,
            shopOrderPaid: false,
            stockConfirmed: false,
          };
        }

        if (plan.action === "REVIEW_OTHER_WINNER") {
          const result = await recordReview(transaction, {
            event,
            shopOrderId: order.id,
            paymentId: payment.id,
            reviewCode: plan.reviewCode,
            captured: plan.captured,
            persistAsWinner: false,
          });
          return { ...result, winningPaymentId: plan.winningPaymentId };
        }
        if (plan.action === "REVIEW_OPEN") {
          return recordReview(transaction, {
            event,
            shopOrderId: order.id,
            paymentId: payment.id,
            reviewCode: plan.reviewCode,
            captured: true,
            persistAsWinner: false,
          });
        }
        if (plan.action === "REPLAY_SUCCESS") {
          await createProviderReceipt(transaction, event, plan.requiresReview ? "REQUIRES_REVIEW" : "PROCESSED", payment.id);
          return {
            outcome: plan.requiresReview ? "REQUIRES_REVIEW" : "PROCESSED",
            duplicate: false,
            shopOrderPaid: order.paymentStatus === "PAID",
            stockConfirmed: false,
            winningPaymentId: payment.id,
            ...(plan.requiresReview ? { reviewCode: plan.reviewCode } : {}),
          };
        }
        if (plan.action === "REVIEW_TERMINAL" || plan.action === "REVIEW_EXPIRED") {
          return recordReview(transaction, {
            event,
            shopOrderId: order.id,
            paymentId: payment.id,
            reviewCode: plan.reviewCode,
            captured: plan.captured,
          });
        }
        if (!order.termsVersion || !order.termsHashSha256 || !order.termsAcceptedAt) {
          return recordReview(transaction, {
            event,
            shopOrderId: order.id,
            paymentId: payment.id,
            reviewCode: REVIEW_CODES.terms,
            captured: true,
          });
        }
        if (!await stockCanBeConfirmed(transaction, order.items)) {
          return recordReview(transaction, {
            event,
            shopOrderId: order.id,
            paymentId: payment.id,
            reviewCode: REVIEW_CODES.stock,
            captured: true,
          });
        }

        await createProviderReceipt(transaction, event, "PROCESSED", payment.id);
        await transaction.payment.update({
          where: { id: payment.id },
          data: {
            status: "SUCCEEDED",
            providerPaymentId: event.providerPaymentId,
            paymentMethod: event.paymentMethod,
            paidAt: event.occurredAt,
            failureCode: null,
          },
          select: { id: true },
        });
        await transaction.payment.updateMany({
          where: {
            shopOrderId: order.id,
            id: { not: payment.id },
            status: { in: ["CREATED", "PENDING"] },
          },
          data: {
            status: "CANCELED",
            canceledAt: event.occurredAt,
            failureCode: "SHOP_ORDER_PAID_BY_OTHER_PROVIDER",
          },
        });
        const stockConfirmed = await confirmStock(transaction, order, event.occurredAt);
        const confirmed = await transaction.shopOrder.updateMany({
          where: {
            id: order.id,
            status: "OPEN",
            paymentStatus: "AWAITING_PAYMENT",
            paymentReviewAt: null,
          },
          data: {
            paymentStatus: "PAID",
            paidAt: event.occurredAt,
            paymentReviewCode: null,
          },
        });
        if (confirmed.count !== 1) throw new Error("ShopOrder changed during payment confirmation.");
        await lifecycleEvent(transaction, {
          shopOrderId: order.id,
          paymentId: payment.id,
          type: "SHOP_PAYMENT_CONFIRMED",
          idempotencyKey: lifecycleKey(payment.id, "confirmed"),
          metadata: { provider: payment.provider },
          occurredAt: event.occurredAt,
        });
        await enqueueShopPaymentConfirmedNotifications(transaction, {
          shopOrderId: order.id,
          paymentProvider: payment.provider,
          termsVersion: order.termsVersion,
        });
        return {
          outcome: "PROCESSED",
          duplicate: false,
          shopOrderPaid: true,
          stockConfirmed,
          winningPaymentId: payment.id,
        };
      });
    },
  };
}

export const shopPaymentDatabaseRepository = createShopPaymentDatabaseRepository();
