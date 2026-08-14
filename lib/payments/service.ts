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
  StripeCheckoutClientError,
  type HostedCheckoutRequest,
  type HostedCheckoutSession,
  type StripeCheckoutGateway,
} from "@/lib/payments/stripe-client";
import type { OrderPaymentSnapshot } from "@/lib/payments/types";
import { logPaymentEvent } from "@/lib/payments/observability";
import { loadAndAssertPaymentQaRuntimeEnvironment } from "@/lib/payments/qa-guard";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

const checkoutRateLimit = { max: 10, windowMs: 10 * 60_000 } as const;
const payableOrderNumber = /^LNX-[0-9]{4}-[0-9]{6}$/;
const paidPaymentStatuses = [
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
      | "RATE_LIMITED"
      | "PAYMENT_UNAVAILABLE",
    message = "Le paiement ne peut pas être préparé.",
  ) {
    super(message);
    this.name = "PaymentServiceError";
  }
}

async function inLockedTransaction<T>(
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

async function lock(transaction: Transaction, key: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
}

async function enforcePaymentRateLimit(client: PrismaClient, actorId: string) {
  assertDatabaseConfigured();
  const key = `payments:checkout:${actorId}`;
  const now = BigInt(Date.now());

  const allowed = await inLockedTransaction(client, async (transaction) => {
    await lock(transaction, key);
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

async function reservePaymentAttempt(client: PrismaClient, actorId: string, orderNumber: string) {
  assertDatabaseConfigured();
  return inLockedTransaction(client, async (transaction) => {
    await lock(transaction, `payments:order:${orderNumber}`);
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
        provider: "STRIPE",
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
        provider: "STRIPE",
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
        active.mode !== "TEST"
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
    const idempotencyKey = `checkout-session:${paymentId}`;
    await transaction.payment.create({
      data: {
        id: paymentId,
        orderId: order.id,
        provider: "STRIPE",
        mode: "TEST",
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

async function recordHostedCheckoutSession(
  client: PrismaClient,
  paymentId: string,
  session: HostedCheckoutSession,
) {
  assertDatabaseConfigured();
  await inLockedTransaction(client, async (transaction) => {
    await lock(transaction, `payments:attempt:${paymentId}`);
    const current = await transaction.payment.findUnique({
      where: { id: paymentId },
      select: {
        status: true,
        providerCheckoutId: true,
        providerPaymentId: true,
      },
    });
    if (!current) {
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
        checkoutExpiresAt: new Date(session.expiresAt * 1_000),
        ...(mayAdvanceToPending ? { status: "PENDING" as const } : {}),
      },
      select: { id: true },
    });
  });
}

export function createPaymentDatabaseCheckoutRepository(
  client: PrismaClient,
): PaymentCheckoutRepository {
  return {
    enforceRateLimit: (actorId) => enforcePaymentRateLimit(client, actorId),
    reserveAttempt: (actorId, orderNumber) => reservePaymentAttempt(client, actorId, orderNumber),
    recordSession: (paymentId, session) => recordHostedCheckoutSession(client, paymentId, session),
  };
}

export const paymentDatabaseCheckoutRepository = createPaymentDatabaseCheckoutRepository(prisma);

type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

export function paymentReturnUrls(
  orderNumber: string,
  environment: PaymentEnvironment = process.env,
) {
  const configuredBaseUrl = environment.AUTH_URL ?? environment.SITE_URL;
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

  const orderPath = `/compte/commandes/${encodeURIComponent(orderNumber)}`;
  const success = new URL(orderPath, origin);
  success.search = "?paiement=retour&session_id={CHECKOUT_SESSION_ID}";
  const cancel = new URL(orderPath, origin);
  cancel.search = "?paiement=annule";
  return { successUrl: success.toString(), cancelUrl: cancel.toString() } as const;
}

async function defaultDependencies(orderNumber: string): Promise<CheckoutServiceDependencies> {
  await loadAndAssertPaymentQaRuntimeEnvironment();
  const urls = paymentReturnUrls(orderNumber);
  return {
    repository: paymentDatabaseCheckoutRepository,
    gateway: createStripeCheckoutGateway(),
    baseUrl: new URL(urls.successUrl).origin,
  };
}

export async function createStripeCheckoutForOrder(
  actor: OrderActor,
  orderNumber: string,
  dependencies?: CheckoutServiceDependencies,
): Promise<StripeCheckoutResult> {
  if (
    actor.role !== "ADMIN"
    || actor.status !== "ACTIVE"
    || actor.emailVerified !== true
  ) {
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
