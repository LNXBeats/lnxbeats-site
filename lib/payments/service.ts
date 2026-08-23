import "server-only";

import { randomUUID } from "node:crypto";

import { type Prisma, type PrismaClient } from "@/generated/prisma/client";

import type { OrderActor } from "@/lib/orders/domain";
import {
  checkoutLineItemsFromOrderSnapshot,
  PaymentDomainError,
  validateOrderPaymentSnapshot,
} from "@/lib/payments/domain";
import {
  createStripeCheckoutGateway,
  createStripeCheckoutLifecycleGateway,
  StripeCheckoutClientError,
  type HostedCheckoutRequest,
  type HostedCheckoutSession,
  type StripeCheckoutGateway,
  type StripeCheckoutLifecycleGateway,
} from "@/lib/payments/stripe-client";
import type { OrderPaymentSnapshot, PaymentProvider, PersistedPaymentMode } from "@/lib/payments/types";
import { logPaymentEvent } from "@/lib/payments/observability";
import { assertPaymentsRuntimeEnvironment } from "@/lib/payments/runtime";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

const checkoutRateLimit = { max: 10, windowMs: 10 * 60_000 } as const;
const payableOrderNumber = /^LNX-[0-9]{4}-[0-9]{6}$/;
export const paidPaymentStatuses = [
  "SUCCEEDED",
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

type Transaction = Prisma.TransactionClient;

export type ReservedCheckoutAttempt = Readonly<{
  orderId: string;
  orderNumber: string;
  paymentId: string;
  idempotencyKey: string;
  providerCheckoutId?: string;
  snapshot: OrderPaymentSnapshot;
}>;

export interface PaymentCheckoutRepository {
  enforceRateLimit(actorId: string): Promise<void>;
  reserveAttempt(actorId: string, orderNumber: string): Promise<ReservedCheckoutAttempt>;
  recordSession(paymentId: string, session: HostedCheckoutSession): Promise<void>;
}

export type CheckoutServiceDependencies = Readonly<{
  repository: PaymentCheckoutRepository;
  gateway: StripeCheckoutGateway;
  baseUrl: string;
}>;

export type StripeCheckoutResult = Readonly<{
  checkoutUrl: string;
}>;

export class PaymentServiceError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 429 | 503,
    readonly code:
      | "PAYMENT_ACCESS_DENIED"
      | "INVALID_ORDER_NUMBER"
      | "ORDER_NOT_PAYABLE"
      | "PAYMENT_ALREADY_COMPLETED"
      | "PAYMENT_SNAPSHOT_CONFLICT"
      | "PAYMENT_SESSION_EXPIRATION_FAILED"
      | "RATE_LIMITED"
      | "PAYMENT_UNAVAILABLE",
    message = "Le paiement ne peut pas être préparé.",
  ) {
    super(message);
    this.name = "PaymentServiceError";
  }
}

type ActiveCheckoutForEdit = Readonly<{
  orderId: string;
  stripePaymentId?: string;
  stripeCheckoutId?: string;
  paypalAttemptsCanceled: boolean;
}>;

export interface PaymentEditRepository {
  findActiveCheckout(actor: OrderActor, orderNumber: string): Promise<ActiveCheckoutForEdit>;
  findCancelledCheckout(orderNumber: string): Promise<ActiveCheckoutForEdit>;
  markCheckoutExpired(orderId: string, paymentId?: string): Promise<void>;
  markCheckoutReview(orderId: string, paymentId: string): Promise<void>;
}

export type PaymentEditDependencies = Readonly<{
  repository: PaymentEditRepository;
  gateway: StripeCheckoutLifecycleGateway;
  assertQaRuntime(): Promise<void>;
}>;

export async function inLockedPaymentTransaction<T>(
  client: PrismaClient,
  operation: (transaction: Transaction) => Promise<T>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // Each operation takes its scoped advisory lock as its first statement.
      // READ COMMITTED is intentional: after waiting for another client, the
      // following SELECT must observe the row that client just committed.
      return await client.$transaction(operation, {
        isolationLevel: "ReadCommitted",
      });
    } catch (error) {
      lastError = error;
      const errorCode = error
        && typeof error === "object"
        && "code" in error
        && typeof error.code === "string"
        ? error.code
        : null;
      // The advisory lock is the serialization primitive. A bounded retry is
      // still required for a write conflict or a defensive database unique
      // constraint hit (for example, a writer that did not take the lock).
      // Every other database failure fails closed immediately.
      if (errorCode !== "P2034" && errorCode !== "P2002") {
        throw error;
      }
    }
  }
  throw lastError;
}

export async function lockPaymentTransaction(transaction: Transaction, key: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
}

export async function enforcePaymentRateLimit(client: PrismaClient, actorId: string) {
  assertDatabaseConfigured();
  const key = `payments:checkout:${actorId}`;
  const now = BigInt(Date.now());

  const allowed = await inLockedPaymentTransaction(client, async (transaction) => {
    await lockPaymentTransaction(transaction, key);
    const current = await transaction.rateLimit.findUnique({ where: { key } });
    if (!current) {
      await transaction.rateLimit.create({
        data: { key, count: 1, lastRequest: now },
      });
      return true;
    }
    if (now - current.lastRequest >= BigInt(checkoutRateLimit.windowMs)) {
      await transaction.rateLimit.update({
        where: { key },
        data: { count: 1, lastRequest: now },
      });
      return true;
    }
    if (current.count >= checkoutRateLimit.max) return false;
    await transaction.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 } },
    });
    return true;
  });

  if (!allowed) {
    throw new PaymentServiceError(
      429,
      "RATE_LIMITED",
      "Trop de demandes de paiement ont été reçues. Réessayez plus tard.",
    );
  }
}

function paymentSnapshot(order: {
  coverIncluded: boolean;
  priorityProcessing: boolean;
  basePriceCents: number;
  coverPriceCents: number;
  priorityPriceCents: number;
  totalCents: number;
  currency: string;
  pricingVersion: string;
}): OrderPaymentSnapshot {
  return {
    coverIncluded: order.coverIncluded,
    priorityProcessing: order.priorityProcessing,
    basePriceCents: order.basePriceCents,
    coverPriceCents: order.coverPriceCents,
    priorityPriceCents: order.priorityPriceCents,
    totalCents: order.totalCents,
    currency: order.currency,
    pricingVersion: order.pricingVersion,
  };
}

export async function reserveProviderPaymentAttempt(
  client: PrismaClient,
  actorId: string,
  orderNumber: string,
  provider: PaymentProvider,
  mode: PersistedPaymentMode = "TEST",
) {
  assertDatabaseConfigured();
  return inLockedPaymentTransaction(client, async (transaction) => {
    await lockPaymentTransaction(transaction, `payments:order:${orderNumber}`);
    const order = await transaction.order.findFirst({
      where: {
        orderNumber,
        userId: actorId,
        usage: "PERSONAL",
        contractRequired: false,
      },
      select: {
        id: true,
        orderNumber: true,
        coverIncluded: true,
        priorityProcessing: true,
        basePriceCents: true,
        coverPriceCents: true,
        priorityPriceCents: true,
        totalCents: true,
        currency: true,
        pricingVersion: true,
        status: true,
      },
    });
    if (!order) {
      throw new PaymentServiceError(404, "ORDER_NOT_PAYABLE");
    }

    const completed = await transaction.payment.findFirst({
      where: {
        orderId: order.id,
        status: { in: [...paidPaymentStatuses] },
      },
      select: { id: true },
    });
    if (completed) {
      throw new PaymentServiceError(409, "PAYMENT_ALREADY_COMPLETED");
    }
    if (order.status !== "AWAITING_PAYMENT") {
      throw new PaymentServiceError(409, "ORDER_NOT_PAYABLE");
    }

    const snapshot = paymentSnapshot(order);
    const pricing = validateOrderPaymentSnapshot(snapshot);
    if (!pricing.ok) {
      throw new PaymentServiceError(409, "ORDER_NOT_PAYABLE");
    }

    const active = await transaction.payment.findFirst({
      where: {
        orderId: order.id,
        provider,
        OR: [
          { status: { in: ["CREATED", "PENDING", "REQUIRES_REVIEW"] } },
          {
            status: "FAILED",
            failureCode: "STRIPE_PAYMENT_ATTEMPT_FAILED",
            providerCheckoutId: { not: null },
          },
        ],
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
        status: true,
        failureCode: true,
      },
    });

    if (active) {
      if (active.status === "REQUIRES_REVIEW") {
        throw new PaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
      }
      if (
        active.mode !== mode
        || active.amountCents !== pricing.amountCents
        || active.currency !== pricing.currency
        || active.pricingVersion !== pricing.pricingVersion
      ) {
        throw new PaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
      }
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        paymentId: active.id,
        idempotencyKey: active.idempotencyKey,
        ...(active.providerCheckoutId ? { providerCheckoutId: active.providerCheckoutId } : {}),
        snapshot,
      } satisfies ReservedCheckoutAttempt;
    }

    const paymentId = randomUUID();
    const idempotencyKey = provider === "STRIPE"
      ? `checkout-session:${paymentId}`
      : `paypal-order:${paymentId}`;
    await transaction.payment.create({
      data: {
        id: paymentId,
        orderId: order.id,
        provider,
        mode,
        status: "CREATED",
        amountCents: pricing.amountCents,
        currency: pricing.currency,
        pricingVersion: pricing.pricingVersion,
        idempotencyKey,
      },
      select: { id: true },
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentId,
      idempotencyKey,
      snapshot,
    } satisfies ReservedCheckoutAttempt;
  });
}

export async function recordProviderCheckoutSession(
  client: PrismaClient,
  paymentId: string,
  session: HostedCheckoutSession,
  provider: PaymentProvider,
) {
  assertDatabaseConfigured();
  await inLockedPaymentTransaction(client, async (transaction) => {
    await lockPaymentTransaction(transaction, `payments:attempt:${paymentId}`);
    const current = await transaction.payment.findUnique({
      where: { id: paymentId },
      select: {
        provider: true,
        status: true,
        providerCheckoutId: true,
        providerPaymentId: true,
      },
    });
    if (!current || current.provider !== provider) {
      throw new PaymentServiceError(503, "PAYMENT_UNAVAILABLE");
    }
    if (
      (current.providerCheckoutId && current.providerCheckoutId !== session.id)
      || (
        current.providerPaymentId
        && session.paymentIntentId
        && current.providerPaymentId !== session.paymentIntentId
      )
    ) {
      throw new PaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
    }

    const mayAdvanceToPending = current.status === "CREATED" || current.status === "PENDING";
    await transaction.payment.update({
      where: { id: paymentId },
      data: {
        providerCheckoutId: session.id,
        ...(session.paymentIntentId
          ? { providerPaymentId: session.paymentIntentId }
          : {}),
        ...(session.expiresAt
          ? { checkoutExpiresAt: new Date(session.expiresAt * 1_000) }
          : {}),
        ...(mayAdvanceToPending ? { status: "PENDING" as const } : {}),
      },
      select: { id: true },
    });
  });
}

export function createPaymentDatabaseCheckoutRepository(
  client: PrismaClient,
  provider: PaymentProvider = "STRIPE",
  mode: PersistedPaymentMode = "TEST",
): PaymentCheckoutRepository {
  return {
    enforceRateLimit: (actorId) => enforcePaymentRateLimit(client, actorId),
    reserveAttempt: (actorId, orderNumber) => reserveProviderPaymentAttempt(client, actorId, orderNumber, provider, mode),
    recordSession: (paymentId, session) => recordProviderCheckoutSession(client, paymentId, session, provider),
  };
}

export const paymentDatabaseCheckoutRepository = createPaymentDatabaseCheckoutRepository(prisma);

export function createPaymentDatabaseEditRepository(client: PrismaClient): PaymentEditRepository {
  async function findCheckout(orderNumber: string, actor?: OrderActor, requiredStatus: "AWAITING_PAYMENT" | "CANCELLED" = "AWAITING_PAYMENT") {
    return inLockedPaymentTransaction(client, async (transaction) => {
      await lockPaymentTransaction(transaction, `payments:order:${orderNumber}`);
      const order = await transaction.order.findFirst({
        where: {
          orderNumber,
          ...(actor && actor.role !== "ADMIN" ? { userId: actor.id } : {}),
          status: requiredStatus,
        },
        select: { id: true },
      });
      if (!order) throw new PaymentServiceError(404, "ORDER_NOT_PAYABLE");
      const completed = await transaction.payment.findFirst({
        where: { orderId: order.id, status: { in: [...paidPaymentStatuses, "REQUIRES_REVIEW"] } },
        select: { id: true },
      });
      if (completed) throw new PaymentServiceError(409, "PAYMENT_ALREADY_COMPLETED");
      const active = await transaction.payment.findMany({
        where: {
          orderId: order.id,
          OR: [
            { status: { in: ["CREATED", "PENDING"] } },
            { status: "FAILED", failureCode: "STRIPE_PAYMENT_ATTEMPT_FAILED", providerCheckoutId: { not: null } },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, provider: true, providerCheckoutId: true },
      });
      const uninitialized = active.filter((payment) => !payment.providerCheckoutId).map(({ id }) => id);
      if (uninitialized.length > 0) {
        await transaction.payment.updateMany({
          where: { id: { in: uninitialized } },
          data: { status: "CANCELED", canceledAt: new Date(), failureCode: null },
        });
      }
      const initialized = active.filter((payment) => payment.providerCheckoutId);
      const stripe = initialized.find((payment) => payment.provider === "STRIPE");
      const paypalPaymentIds = initialized
        .filter((payment) => payment.provider === "PAYPAL")
        .map(({ id }) => id);
      if (paypalPaymentIds.length > 0) {
        await transaction.payment.updateMany({
          where: {
            id: { in: paypalPaymentIds },
            orderId: order.id,
            provider: "PAYPAL",
            status: { in: ["CREATED", "PENDING"] },
          },
          data: {
            status: "CANCELED",
            canceledAt: new Date(),
            failureCode: "ORDER_CHANGED_OR_CANCELED",
          },
        });
      }
      return {
        orderId: order.id,
        ...(stripe ? {
          stripePaymentId: stripe.id,
          stripeCheckoutId: stripe.providerCheckoutId ?? undefined,
        } : {}),
        paypalAttemptsCanceled: active.some((payment) => payment.provider === "PAYPAL"),
      };
    });
  }
  return {
    findActiveCheckout: (actor, orderNumber) => findCheckout(orderNumber, actor),
    findCancelledCheckout: (orderNumber) => findCheckout(orderNumber, undefined, "CANCELLED"),
    async markCheckoutExpired(orderId, paymentId) {
      if (!paymentId) return;
      await inLockedPaymentTransaction(client, async (transaction) => {
        await lockPaymentTransaction(transaction, `payments:attempt:${paymentId}`);
        const payment = await transaction.payment.findUnique({
          where: { id: paymentId },
          select: { orderId: true, status: true },
        });
        if (!payment || payment.orderId !== orderId) throw new PaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
        if ([...paidPaymentStatuses, "REQUIRES_REVIEW"].includes(payment.status as typeof paidPaymentStatuses[number] | "REQUIRES_REVIEW")) {
          throw new PaymentServiceError(409, "PAYMENT_ALREADY_COMPLETED");
        }
        if (payment.status === "EXPIRED") return;
        await transaction.payment.update({
          where: { id: paymentId },
          data: { status: "EXPIRED", expiredAt: new Date(), failureCode: null },
        });
      });
    },
    async markCheckoutReview(orderId, paymentId) {
      await inLockedPaymentTransaction(client, async (transaction) => {
        await lockPaymentTransaction(transaction, `payments:attempt:${paymentId}`);
        const payment = await transaction.payment.findUnique({ where: { id: paymentId }, select: { orderId: true, status: true } });
        if (!payment || payment.orderId !== orderId || [...paidPaymentStatuses].includes(payment.status as typeof paidPaymentStatuses[number])) return;
        await transaction.payment.update({
          where: { id: paymentId },
          data: { status: "REQUIRES_REVIEW", failureCode: "WEBHOOK_CANCEL_EXPIRATION_FAILED" },
        });
      });
    },
  };
}

export const paymentDatabaseEditRepository = createPaymentDatabaseEditRepository(prisma);

export async function prepareOrderForEditing(
  actor: OrderActor,
  orderNumber: string,
  dependencies: PaymentEditDependencies = {
    repository: paymentDatabaseEditRepository,
    gateway: createStripeCheckoutLifecycleGateway(),
    assertQaRuntime: async () => {
      await assertPaymentsRuntimeEnvironment();
    },
  },
) {
  if (!payableOrderNumber.test(orderNumber)) throw new PaymentServiceError(400, "INVALID_ORDER_NUMBER");
  const active = await dependencies.repository.findActiveCheckout(actor, orderNumber);
  if (!active.stripeCheckoutId || !active.stripePaymentId) return { editable: true as const };
  try {
    await dependencies.assertQaRuntime();
    await dependencies.gateway.expireHostedCheckout(active.stripeCheckoutId, `expire-checkout-session:${active.stripePaymentId}`);
    await dependencies.repository.markCheckoutExpired(active.orderId, active.stripePaymentId);
    return { editable: true as const };
  } catch (error) {
    if (error instanceof PaymentServiceError) throw error;
    throw new PaymentServiceError(503, "PAYMENT_SESSION_EXPIRATION_FAILED", "La session de paiement ne peut pas encore être fermée.");
  }
}

export async function expireCheckoutAfterCancellation(
  orderNumber: string,
  dependencies: PaymentEditDependencies = {
    repository: paymentDatabaseEditRepository,
    gateway: createStripeCheckoutLifecycleGateway(),
    assertQaRuntime: async () => {
      await assertPaymentsRuntimeEnvironment();
    },
  },
) {
  const active = await dependencies.repository.findCancelledCheckout(orderNumber);
  if (!active.stripeCheckoutId || !active.stripePaymentId) {
    return { expired: active.paypalAttemptsCanceled } as const;
  }
  try {
    await dependencies.assertQaRuntime();
    await dependencies.gateway.expireHostedCheckout(active.stripeCheckoutId, `cancel-checkout-session:${active.stripePaymentId}`);
    await dependencies.repository.markCheckoutExpired(active.orderId, active.stripePaymentId);
    return { expired: true as const };
  } catch {
    await dependencies.repository.markCheckoutReview(active.orderId, active.stripePaymentId);
    throw new PaymentServiceError(503, "PAYMENT_SESSION_EXPIRATION_FAILED", "La commande est annulée, mais la session Stripe doit être vérifiée.");
  }
}

type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

export function paymentReturnUrls(
  orderNumber: string,
  environment: PaymentEnvironment = process.env,
) {
  const configuredBaseUrl = environment.APP_CANONICAL_URL ?? environment.AUTH_URL ?? environment.SITE_URL;
  if (!configuredBaseUrl) {
    throw new PaymentServiceError(503, "PAYMENT_UNAVAILABLE");
  }

  let origin: string;
  try {
    const parsed = new URL(configuredBaseUrl);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username
      || parsed.password
      || (parsed.protocol === "http:" && !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname))
    ) {
      throw new Error("Invalid payment origin.");
    }
    origin = parsed.origin;
  } catch {
    throw new PaymentServiceError(503, "PAYMENT_UNAVAILABLE");
  }

  const orderPath = `/commande/${encodeURIComponent(orderNumber)}/confirmation`;
  const success = new URL(orderPath, origin);
  success.search = "?paiement=retour&session_id={CHECKOUT_SESSION_ID}";
  const cancel = new URL(orderPath, origin);
  cancel.search = "?paiement=annule";
  return { successUrl: success.toString(), cancelUrl: cancel.toString() } as const;
}

async function defaultDependencies(orderNumber: string): Promise<CheckoutServiceDependencies> {
  const configuration = await assertPaymentsRuntimeEnvironment();
  const urls = paymentReturnUrls(orderNumber);
  return {
    repository: createPaymentDatabaseCheckoutRepository(
      prisma,
      "STRIPE",
      configuration.stripe.enabled && configuration.stripe.mode === "live" ? "LIVE" : "TEST",
    ),
    gateway: createStripeCheckoutGateway(),
    baseUrl: new URL(urls.successUrl).origin,
  };
}

export async function createStripeCheckoutForOrder(
  actor: OrderActor,
  orderNumber: string,
  dependencies?: CheckoutServiceDependencies,
): Promise<StripeCheckoutResult> {
  if (actor.status !== "ACTIVE" || actor.emailVerified !== true) {
    throw new PaymentServiceError(403, "PAYMENT_ACCESS_DENIED");
  }
  if (!payableOrderNumber.test(orderNumber)) {
    throw new PaymentServiceError(400, "INVALID_ORDER_NUMBER");
  }

  try {
    const resolvedDependencies = dependencies ?? await defaultDependencies(orderNumber);
    await resolvedDependencies.repository.enforceRateLimit(actor.id);
    const attempt = await resolvedDependencies.repository.reserveAttempt(
      actor.id,
      orderNumber,
    );
    const returnUrls = paymentReturnUrls(orderNumber, {
      AUTH_URL: resolvedDependencies.baseUrl,
    });
    const checkoutRequest: HostedCheckoutRequest = {
      orderId: attempt.orderId,
      paymentId: attempt.paymentId,
      pricingVersion: attempt.snapshot.pricingVersion,
      lineItems: checkoutLineItemsFromOrderSnapshot(attempt.snapshot),
      customerEmail: actor.email,
      successUrl: returnUrls.successUrl,
      cancelUrl: returnUrls.cancelUrl,
    };

    // The remote request intentionally happens after the local reservation
    // transaction has completed. A retry reuses the persisted Stripe key.
    const session = attempt.providerCheckoutId
      ? await resolvedDependencies.gateway.retrieveHostedCheckout(attempt.providerCheckoutId)
      : await resolvedDependencies.gateway.createHostedCheckout(
          checkoutRequest,
          attempt.idempotencyKey,
        );
    await resolvedDependencies.repository.recordSession(attempt.paymentId, session);
    logPaymentEvent("payment.session.created", {
      paymentId: attempt.paymentId,
      orderId: attempt.orderId,
    });
    return { checkoutUrl: session.url };
  } catch (error) {
    if (error instanceof PaymentServiceError) throw error;
    if (error instanceof PaymentDomainError) {
      throw new PaymentServiceError(409, "ORDER_NOT_PAYABLE");
    }
    if (error instanceof StripeCheckoutClientError) {
      logPaymentEvent("payment.session.failed");
      throw new PaymentServiceError(503, "PAYMENT_UNAVAILABLE");
    }
    throw new PaymentServiceError(503, "PAYMENT_UNAVAILABLE");
  }
}
