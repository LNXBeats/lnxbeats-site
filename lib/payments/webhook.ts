import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import type { PaymentMethod } from "@/lib/payments/types";
import { enqueuePaymentConfirmedNotifications } from "@/lib/notifications/service";

export const STRIPE_CHECKOUT_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
] as const;
export const STRIPE_PAYMENT_INTENT_FAILURE_EVENT = "payment_intent.payment_failed" as const;

export type StripeCheckoutWebhookEventType =
  (typeof STRIPE_CHECKOUT_WEBHOOK_EVENTS)[number];

export type VerifiedStripeWebhookEvent = Readonly<{
  id: string;
  type: string;
  livemode: boolean;
  created: number;
  data: Readonly<{ object: unknown }>;
  paymentIntentEvidence?: StripePaymentIntentEvidence;
}>;

export type StripePaymentIntentEvidence = Readonly<{
  id: string;
  amountCents: number;
  currency: string;
  livemode: boolean;
  status: "succeeded";
  paymentId: string;
  orderId: string;
  pricingVersion: string;
  paymentMethod: PaymentMethod;
}>;

type ProviderEventOutcome = "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW";

export type StripeWebhookProcessingResult = Readonly<{
  outcome: ProviderEventOutcome;
  duplicate: boolean;
}>;

type EventReceipt = Readonly<{
  eventId: string;
  type: string;
  livemode: boolean;
  objectId: string | null;
  processedAt: Date;
}>;

export type NormalizedStripeCheckoutEvent = EventReceipt & Readonly<{
  type: StripeCheckoutWebhookEventType;
  paymentId: string;
  orderId: string;
  clientReferenceId: string;
  pricingVersion: string;
  amountTotal: number;
  currency: string;
  paymentStatus: string;
  checkoutStatus: string | null;
  sessionLivemode: boolean;
  paymentIntentId: string | null;
  paymentIntentEvidence: StripePaymentIntentEvidence | null;
  occurredAt: Date;
}>;

export type NormalizedStripePaymentIntentFailureEvent = EventReceipt & Readonly<{
  type: typeof STRIPE_PAYMENT_INTENT_FAILURE_EVENT;
  paymentId: string;
  orderId: string;
  pricingVersion: string;
  paymentIntentId: string;
  amountTotal: number;
  currency: string;
  paymentIntentStatus: "requires_payment_method";
  occurredAt: Date;
}>;

export interface PaymentWebhookRepository {
  record(
    receipt: EventReceipt,
    outcome: "IGNORED" | "REQUIRES_REVIEW",
  ): Promise<StripeWebhookProcessingResult>;
  reconcile(
    event: NormalizedStripeCheckoutEvent,
  ): Promise<StripeWebhookProcessingResult>;
  reconcileFailure(
    event: NormalizedStripePaymentIntentFailureEvent,
  ): Promise<StripeWebhookProcessingResult>;
}

export type PaymentReconciliationSnapshot = Readonly<{
  id: string;
  orderId: string;
  provider: string;
  mode: "TEST" | "LIVE";
  status:
    | "CREATED"
    | "PENDING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELED"
    | "EXPIRED"
    | "REFUND_PENDING"
    | "PARTIALLY_REFUNDED"
    | "REFUNDED"
    | "REQUIRES_REVIEW";
  amountCents: number;
  currency: string;
  pricingVersion: string;
  providerCheckoutId: string | null;
  providerPaymentId: string | null;
  paymentMethod: PaymentMethod | null;
  failureCode: string | null;
  paidAt: Date | null;
  failedAt: Date | null;
  orderStatus: string;
  orderHasOtherSuccessfulPayment: boolean;
  orderHasOtherActivePayment: boolean;
  providerIdentifiersBelongToOtherPayment: boolean;
}>;

type PaymentUpdate = Readonly<{
  status?: PaymentReconciliationSnapshot["status"];
  providerCheckoutId?: string;
  providerPaymentId?: string;
  paymentMethod?: PaymentMethod;
  failureCode?: string | null;
  paidAt?: Date;
  failedAt?: Date;
  expiredAt?: Date;
}>;

export type PaymentReconciliationPlan = Readonly<{
  outcome: "PROCESSED" | "REQUIRES_REVIEW";
  paymentUpdate: PaymentUpdate;
  confirmOrder: boolean;
  mismatch?: PaymentWebhookMismatch;
}>;

export type PaymentWebhookMismatch =
  | "WEBHOOK_PROVIDER_MISMATCH"
  | "WEBHOOK_MODE_MISMATCH"
  | "WEBHOOK_PAYMENT_ID_MISMATCH"
  | "WEBHOOK_ORDER_ID_MISMATCH"
  | "WEBHOOK_CHECKOUT_ID_MISMATCH"
  | "WEBHOOK_PAYMENT_INTENT_MISMATCH"
  | "WEBHOOK_PAYMENT_INTENT_EVIDENCE_MISMATCH"
  | "WEBHOOK_PAYMENT_METHOD_MISMATCH"
  | "WEBHOOK_PROVIDER_ID_CONFLICT"
  | "WEBHOOK_AMOUNT_MISMATCH"
  | "WEBHOOK_CURRENCY_MISMATCH"
  | "WEBHOOK_PRICING_VERSION_MISMATCH"
  | "WEBHOOK_ORDER_ALREADY_PAID"
  | "WEBHOOK_OTHER_ACTIVE_ATTEMPT"
  | "WEBHOOK_PAYMENT_STATUS_MISMATCH"
  | "WEBHOOK_CHECKOUT_STATUS_MISMATCH"
  | "WEBHOOK_ORDER_STATUS_MISMATCH";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const succeededPaymentStatuses = new Set<PaymentReconciliationSnapshot["status"]>([
  "SUCCEEDED",
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);
const activePaymentStatuses = new Set<PaymentReconciliationSnapshot["status"]>([
  "CREATED",
  "PENDING",
  "REQUIRES_REVIEW",
]);
const alreadyConfirmedOrderStatuses = new Set([
  "PAYMENT_CONFIRMED",
  "RECEIVED",
  "SUBMITTED",
  "REVIEWING",
  "ACCEPTED",
  "IN_PROGRESS",
  "FIRST_VERSION_READY",
  "REVISION_REQUESTED",
  "FINALIZING",
  "DELIVERED",
  "REFUSED",
  "REFUND_PENDING",
  "REFUNDED",
]);

class StripeWebhookEventError extends Error {
  constructor() {
    super("The verified Stripe event is malformed.");
    this.name = "StripeWebhookEventError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
    ? value
    : null;
}

function checkoutObjectId(value: unknown) {
  return boundedString(record(value)?.id, 255);
}

function paymentIntentId(value: unknown) {
  if (typeof value === "string") return boundedString(value, 255);
  return boundedString(record(value)?.id, 255);
}

function eventReceipt(event: VerifiedStripeWebhookEvent): EventReceipt {
  const eventId = boundedString(event.id, 255);
  const type = boundedString(event.type, 160);
  if (
    !eventId
    || !type
    || typeof event.livemode !== "boolean"
    || !Number.isSafeInteger(event.created)
    || event.created <= 0
  ) {
    throw new StripeWebhookEventError();
  }
  return {
    eventId,
    type,
    livemode: event.livemode,
    objectId: checkoutObjectId(event.data?.object),
    processedAt: new Date(),
  };
}

function isSupportedEventType(type: string): type is StripeCheckoutWebhookEventType {
  return STRIPE_CHECKOUT_WEBHOOK_EVENTS.includes(type as StripeCheckoutWebhookEventType);
}

type NormalizationResult =
  | Readonly<{ ok: true; event: NormalizedStripeCheckoutEvent }>
  | Readonly<{ ok: false; receipt: EventReceipt }>;

function normalizeCheckoutEvent(
  event: VerifiedStripeWebhookEvent,
  receipt: EventReceipt,
): NormalizationResult {
  const session = record(event.data.object);
  const metadata = record(session?.metadata);
  const paymentId = boundedString(metadata?.paymentId, 255);
  const orderId = boundedString(metadata?.orderId, 255);
  const clientReferenceId = boundedString(session?.client_reference_id, 255);
  const pricingVersion = boundedString(metadata?.pricingVersion, 32);
  const paymentStatus = boundedString(session?.payment_status, 64);
  const currency = boundedString(session?.currency, 3);
  const amountTotal = session?.amount_total;
  if (
    !session
    || session.object !== "checkout.session"
    || !receipt.objectId
    || session.mode !== "payment"
    || session.livemode !== receipt.livemode
    || !paymentId
    || !uuid.test(paymentId)
    || !orderId
    || !uuid.test(orderId)
    || !clientReferenceId
    || !pricingVersion
    || !paymentStatus
    || !currency
    || !Number.isSafeInteger(amountTotal)
    || (amountTotal as number) <= 0
  ) {
    return { ok: false, receipt };
  }

  return {
    ok: true,
    event: {
      ...receipt,
      type: event.type as StripeCheckoutWebhookEventType,
      paymentId,
      orderId,
      clientReferenceId,
      pricingVersion,
      amountTotal: amountTotal as number,
      currency: currency.toUpperCase(),
      paymentStatus,
      checkoutStatus: typeof session.status === "string" ? session.status : null,
      sessionLivemode: receipt.livemode,
      paymentIntentId: paymentIntentId(session.payment_intent),
      paymentIntentEvidence: event.paymentIntentEvidence ?? null,
      occurredAt: new Date(event.created * 1_000),
    },
  };
}

function normalizePaymentIntentFailureEvent(
  event: VerifiedStripeWebhookEvent,
  receipt: EventReceipt,
): NormalizedStripePaymentIntentFailureEvent | null {
  const intent = record(event.data.object);
  const metadata = record(intent?.metadata);
  const paymentId = boundedString(metadata?.paymentId, 255);
  const orderId = boundedString(metadata?.orderId, 255);
  const pricingVersion = boundedString(metadata?.pricingVersion, 32);
  const currency = boundedString(intent?.currency, 3);
  const amountTotal = intent?.amount;
  if (
    !intent
    || intent.object !== "payment_intent"
    || !receipt.objectId
    || intent.livemode !== receipt.livemode
    || intent.status !== "requires_payment_method"
    || !paymentId
    || !uuid.test(paymentId)
    || !orderId
    || !uuid.test(orderId)
    || !pricingVersion
    || !currency
    || !Number.isSafeInteger(amountTotal)
    || (amountTotal as number) <= 0
  ) return null;

  return {
    ...receipt,
    type: STRIPE_PAYMENT_INTENT_FAILURE_EVENT,
    paymentId,
    orderId,
    pricingVersion,
    paymentIntentId: receipt.objectId,
    amountTotal: amountTotal as number,
    currency: currency.toUpperCase(),
    paymentIntentStatus: "requires_payment_method",
    occurredAt: new Date(event.created * 1_000),
  };
}

function reviewPlan(
  current: PaymentReconciliationSnapshot,
  mismatch: PaymentWebhookMismatch,
): PaymentReconciliationPlan {
  const mayMarkForReview = !succeededPaymentStatuses.has(current.status)
    && (
      activePaymentStatuses.has(current.status)
      || !current.orderHasOtherActivePayment
    );
  return {
    outcome: "REQUIRES_REVIEW",
    paymentUpdate: mayMarkForReview
      ? { status: "REQUIRES_REVIEW", failureCode: mismatch }
      : succeededPaymentStatuses.has(current.status)
        ? {}
        : { failureCode: mismatch },
    confirmOrder: false,
    mismatch,
  };
}

function firstMismatch(
  current: PaymentReconciliationSnapshot,
  event: NormalizedStripeCheckoutEvent,
): PaymentWebhookMismatch | null {
  if (current.provider !== "STRIPE") return "WEBHOOK_PROVIDER_MISMATCH";
  if (
    (current.mode === "LIVE") !== event.livemode
    || event.sessionLivemode !== event.livemode
  ) return "WEBHOOK_MODE_MISMATCH";
  if (current.id !== event.paymentId) return "WEBHOOK_PAYMENT_ID_MISMATCH";
  if (
    current.orderId !== event.orderId
    || current.orderId !== event.clientReferenceId
  ) return "WEBHOOK_ORDER_ID_MISMATCH";
  if (
    current.providerCheckoutId
    && current.providerCheckoutId !== event.objectId
  ) return "WEBHOOK_CHECKOUT_ID_MISMATCH";
  if (
    current.providerPaymentId
    && current.providerPaymentId !== event.paymentIntentId
  ) return "WEBHOOK_PAYMENT_INTENT_MISMATCH";
  const successful = event.type === "checkout.session.async_payment_succeeded"
    || (event.type === "checkout.session.completed" && event.paymentStatus === "paid");
  if (successful) {
    const evidence = event.paymentIntentEvidence;
    if (
      !evidence
      || !event.paymentIntentId
      || evidence.id !== event.paymentIntentId
      || evidence.amountCents !== event.amountTotal
      || evidence.currency !== event.currency
      || evidence.livemode !== event.livemode
      || evidence.status !== "succeeded"
      || evidence.paymentId !== event.paymentId
      || evidence.orderId !== event.orderId
      || evidence.pricingVersion !== event.pricingVersion
    ) return "WEBHOOK_PAYMENT_INTENT_EVIDENCE_MISMATCH";
    if (current.paymentMethod && current.paymentMethod !== evidence.paymentMethod) {
      return "WEBHOOK_PAYMENT_METHOD_MISMATCH";
    }
  }
  if (current.providerIdentifiersBelongToOtherPayment) {
    return "WEBHOOK_PROVIDER_ID_CONFLICT";
  }
  if (current.amountCents !== event.amountTotal) return "WEBHOOK_AMOUNT_MISMATCH";
  if (current.currency !== event.currency) return "WEBHOOK_CURRENCY_MISMATCH";
  if (current.pricingVersion !== event.pricingVersion) {
    return "WEBHOOK_PRICING_VERSION_MISMATCH";
  }
  if (
    event.type === "checkout.session.completed"
    && event.checkoutStatus !== "complete"
  ) return "WEBHOOK_CHECKOUT_STATUS_MISMATCH";
  if (
    event.type === "checkout.session.expired"
    && event.checkoutStatus !== "expired"
  ) return "WEBHOOK_CHECKOUT_STATUS_MISMATCH";
  if (
    (event.type === "checkout.session.async_payment_succeeded"
      || event.type === "checkout.session.async_payment_failed")
    && event.checkoutStatus !== "complete"
  ) return "WEBHOOK_CHECKOUT_STATUS_MISMATCH";
  if (
    (event.type === "checkout.session.async_payment_succeeded"
      && event.paymentStatus !== "paid")
    || (event.type === "checkout.session.async_payment_failed"
      && event.paymentStatus !== "unpaid")
    || (event.type === "checkout.session.expired"
      && event.paymentStatus !== "unpaid")
    || (event.type === "checkout.session.completed"
      && event.paymentStatus !== "paid"
      && event.paymentStatus !== "unpaid")
  ) return "WEBHOOK_PAYMENT_STATUS_MISMATCH";
  if (
    (event.type === "checkout.session.async_payment_succeeded"
      || (event.type === "checkout.session.completed" && event.paymentStatus === "paid"))
    && !event.paymentIntentId
  ) return "WEBHOOK_PAYMENT_INTENT_MISMATCH";
  return null;
}

export function planStripeCheckoutReconciliation(
  current: PaymentReconciliationSnapshot,
  event: NormalizedStripeCheckoutEvent,
): PaymentReconciliationPlan {
  const mismatch = firstMismatch(current, event);
  if (mismatch) return reviewPlan(current, mismatch);

  const successful = event.type === "checkout.session.async_payment_succeeded"
    || (event.type === "checkout.session.completed" && event.paymentStatus === "paid");

  if (successful && current.orderHasOtherSuccessfulPayment) {
    return reviewPlan(current, "WEBHOOK_ORDER_ALREADY_PAID");
  }
  if (
    successful
    && current.status !== "REQUIRES_REVIEW"
    && current.orderStatus !== "AWAITING_PAYMENT"
    && !alreadyConfirmedOrderStatuses.has(current.orderStatus)
  ) {
    return reviewPlan(current, "WEBHOOK_ORDER_STATUS_MISMATCH");
  }
  if (
    successful
    && current.orderStatus === "AWAITING_PAYMENT"
    && (current.status === "REFUND_PENDING"
      || current.status === "PARTIALLY_REFUNDED"
      || current.status === "REFUNDED")
  ) {
    return reviewPlan(current, "WEBHOOK_ORDER_STATUS_MISMATCH");
  }

  const identityUpdate: PaymentUpdate = {
    ...(!current.providerCheckoutId && event.objectId
      ? { providerCheckoutId: event.objectId }
      : {}),
    ...(!current.providerPaymentId && event.paymentIntentId
      ? { providerPaymentId: event.paymentIntentId }
      : {}),
    ...(successful && event.paymentIntentEvidence
      ? { paymentMethod: event.paymentIntentEvidence.paymentMethod }
      : {}),
  };

  if (current.status === "REQUIRES_REVIEW") {
    return {
      outcome: "REQUIRES_REVIEW",
      paymentUpdate: identityUpdate,
      confirmOrder: false,
    };
  }

  if (successful) {
    const paidAt = current.paidAt ?? event.occurredAt;
    return {
      outcome: "PROCESSED",
      paymentUpdate: succeededPaymentStatuses.has(current.status)
        ? identityUpdate
        : {
          ...identityUpdate,
          status: "SUCCEEDED",
          paidAt,
          failureCode: null,
        },
      confirmOrder: current.orderStatus === "AWAITING_PAYMENT",
    };
  }

  if (
    event.type === "checkout.session.completed"
    && event.paymentStatus === "unpaid"
  ) {
    return {
      outcome: "PROCESSED",
      paymentUpdate: current.status === "CREATED"
        ? { ...identityUpdate, status: "PENDING" }
        : identityUpdate,
      confirmOrder: false,
    };
  }

  if (event.type === "checkout.session.async_payment_failed") {
    const retryableCardFailure = current.status === "FAILED"
      && current.failureCode === "STRIPE_PAYMENT_ATTEMPT_FAILED";
    return {
      outcome: "PROCESSED",
      paymentUpdate: current.status === "CREATED" || current.status === "PENDING" || retryableCardFailure
        ? {
          ...identityUpdate,
          status: "FAILED",
          failedAt: current.failedAt ?? event.occurredAt,
          failureCode: "STRIPE_ASYNC_PAYMENT_FAILED",
        }
        : identityUpdate,
      confirmOrder: false,
    };
  }

  const retryableCardFailure = current.status === "FAILED"
    && current.failureCode === "STRIPE_PAYMENT_ATTEMPT_FAILED";
  return {
    outcome: "PROCESSED",
    paymentUpdate: current.status === "CREATED" || current.status === "PENDING" || retryableCardFailure
      ? { ...identityUpdate, status: "EXPIRED", expiredAt: event.occurredAt }
      : identityUpdate,
    confirmOrder: false,
  };
}

export function planStripePaymentIntentFailure(
  current: PaymentReconciliationSnapshot,
  event: NormalizedStripePaymentIntentFailureEvent,
): PaymentReconciliationPlan {
  let mismatch: PaymentWebhookMismatch | null = null;
  if (current.provider !== "STRIPE") mismatch = "WEBHOOK_PROVIDER_MISMATCH";
  else if ((current.mode === "LIVE") !== event.livemode) mismatch = "WEBHOOK_MODE_MISMATCH";
  else if (current.id !== event.paymentId) mismatch = "WEBHOOK_PAYMENT_ID_MISMATCH";
  else if (current.orderId !== event.orderId) mismatch = "WEBHOOK_ORDER_ID_MISMATCH";
  else if (!current.providerCheckoutId) mismatch = "WEBHOOK_CHECKOUT_ID_MISMATCH";
  else if (current.providerPaymentId && current.providerPaymentId !== event.paymentIntentId) {
    mismatch = "WEBHOOK_PAYMENT_INTENT_MISMATCH";
  } else if (current.providerIdentifiersBelongToOtherPayment) {
    mismatch = "WEBHOOK_PROVIDER_ID_CONFLICT";
  } else if (current.amountCents !== event.amountTotal) mismatch = "WEBHOOK_AMOUNT_MISMATCH";
  else if (current.currency !== event.currency) mismatch = "WEBHOOK_CURRENCY_MISMATCH";
  else if (current.pricingVersion !== event.pricingVersion) {
    mismatch = "WEBHOOK_PRICING_VERSION_MISMATCH";
  } else if (current.orderHasOtherSuccessfulPayment) mismatch = "WEBHOOK_ORDER_ALREADY_PAID";
  else if (current.orderHasOtherActivePayment) mismatch = "WEBHOOK_OTHER_ACTIVE_ATTEMPT";
  if (mismatch) return reviewPlan(current, mismatch);

  const identityUpdate: PaymentUpdate = {
    ...(!current.providerPaymentId
      ? { providerPaymentId: event.paymentIntentId }
      : {}),
  };
  if (current.status === "REQUIRES_REVIEW") {
    return { outcome: "REQUIRES_REVIEW", paymentUpdate: identityUpdate, confirmOrder: false };
  }
  if (succeededPaymentStatuses.has(current.status)) {
    return { outcome: "PROCESSED", paymentUpdate: identityUpdate, confirmOrder: false };
  }
  if (
    current.status === "CREATED"
    || current.status === "PENDING"
    || (current.status === "FAILED" && current.failureCode === "STRIPE_PAYMENT_ATTEMPT_FAILED")
  ) {
    return {
      outcome: "PROCESSED",
      paymentUpdate: {
        ...identityUpdate,
        status: "FAILED",
        failureCode: "STRIPE_PAYMENT_ATTEMPT_FAILED",
        failedAt: current.failedAt ?? event.occurredAt,
      },
      confirmOrder: false,
    };
  }
  return { outcome: "PROCESSED", paymentUpdate: identityUpdate, confirmOrder: false };
}

export async function processVerifiedStripeWebhookEvent(
  event: VerifiedStripeWebhookEvent,
  repository: PaymentWebhookRepository = databasePaymentWebhookRepository,
): Promise<StripeWebhookProcessingResult> {
  const receipt = eventReceipt(event);

  if (
    !isSupportedEventType(receipt.type)
    && receipt.type !== STRIPE_PAYMENT_INTENT_FAILURE_EVENT
  ) {
    return repository.record(receipt, "IGNORED");
  }
  if (receipt.type === STRIPE_PAYMENT_INTENT_FAILURE_EVENT) {
    const failure = normalizePaymentIntentFailureEvent(event, receipt);
    return failure
      ? repository.reconcileFailure(failure)
      : repository.record(receipt, "REQUIRES_REVIEW");
  }

  const normalized = normalizeCheckoutEvent(event, receipt);
  if (!normalized.ok) {
    return repository.record(receipt, "REQUIRES_REVIEW");
  }
  return repository.reconcile(normalized.event);
}

export async function findProcessedStripeWebhookEvent(
  eventId: string,
): Promise<StripeWebhookProcessingResult | null> {
  if (!eventId || eventId.length > 255) return null;
  assertDatabaseConfigured();
  const receipt = await prisma.providerEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: "STRIPE",
        providerEventId: eventId,
      },
    },
    select: { outcome: true },
  });
  return receipt ? { outcome: receipt.outcome, duplicate: true } : null;
}

type Transaction = Prisma.TransactionClient;

async function withWebhookTransaction<T>(
  operation: (transaction: Transaction) => Promise<T>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      if (
        !error
        || typeof error !== "object"
        || !("code" in error)
        || (error.code !== "P2034" && error.code !== "P2002")
      ) throw error;
    }
  }
  throw lastError;
}

async function lock(transaction: Transaction, key: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
}

async function duplicateReceipt(transaction: Transaction, eventId: string) {
  return transaction.providerEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: "STRIPE",
        providerEventId: eventId,
      },
    },
    select: { outcome: true },
  });
}

async function createReceipt(
  transaction: Transaction,
  receipt: EventReceipt,
  outcome: ProviderEventOutcome,
  paymentId?: string,
) {
  await transaction.providerEvent.create({
    data: {
      provider: "STRIPE",
      providerEventId: receipt.eventId,
      type: receipt.type,
      livemode: receipt.livemode,
      objectId: receipt.objectId,
      outcome,
      processedAt: receipt.processedAt,
      ...(paymentId ? { paymentId } : {}),
    },
    select: { id: true },
  });
  return { outcome, duplicate: false } as const;
}

const databasePaymentWebhookRepository: PaymentWebhookRepository = {
  async record(receipt, outcome) {
    assertDatabaseConfigured();
    return withWebhookTransaction(async (transaction) => {
      await lock(transaction, `payments:webhook:event:${receipt.eventId}`);
      const duplicate = await duplicateReceipt(transaction, receipt.eventId);
      if (duplicate) return { outcome: duplicate.outcome, duplicate: true };
      return createReceipt(transaction, receipt, outcome);
    });
  },

  async reconcile(event) {
    assertDatabaseConfigured();
    return withWebhookTransaction(async (transaction) => {
      await lock(transaction, `payments:webhook:event:${event.eventId}`);
      const duplicate = await duplicateReceipt(transaction, event.eventId);
      if (duplicate) return { outcome: duplicate.outcome, duplicate: true };

      // Lock the attempt first so a concurrent Session persistence cannot
      // change its provider identifiers underneath reconciliation. Then use
      // the database-owned order number (never webhook metadata) to share the
      // exact lock used by Checkout reservation. This closes the race between
      // a late success and creation of a new active attempt for the same order.
      await lock(transaction, `payments:attempt:${event.paymentId}`);
      const paymentOwner = await transaction.payment.findUnique({
        where: { id: event.paymentId, mode: event.livemode ? "LIVE" : "TEST" },
        select: {
          orderId: true,
          shopOrderId: true,
          order: { select: { orderNumber: true } },
        },
      });
      if (!paymentOwner || paymentOwner.shopOrderId || !paymentOwner.orderId || !paymentOwner.order) {
        return createReceipt(transaction, event, "REQUIRES_REVIEW");
      }
      await lock(transaction, `payments:order:${paymentOwner.order.orderNumber}`);

      const payment = await transaction.payment.findUnique({
        where: { id: event.paymentId, mode: event.livemode ? "LIVE" : "TEST" },
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
          failureCode: true,
          paidAt: true,
          failedAt: true,
          order: { select: { status: true } },
        },
      });
      if (!payment || payment.shopOrderId || !payment.orderId || !payment.order) {
        return createReceipt(transaction, event, "REQUIRES_REVIEW", payment?.id);
      }

      const otherSuccessfulPayment = await transaction.payment.findFirst({
        where: {
          orderId: payment.orderId,
          id: { not: payment.id },
          status: {
            in: ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"],
          },
        },
        select: { id: true },
      });
      const otherActivePayment = await transaction.payment.findFirst({
        where: {
          orderId: payment.orderId,
          id: { not: payment.id },
          OR: [
            { status: { in: ["CREATED", "PENDING", "REQUIRES_REVIEW"] } },
            { status: "FAILED", failureCode: "STRIPE_PAYMENT_ATTEMPT_FAILED" },
          ],
        },
        select: { id: true },
      });
      const providerIdentifierConflict = await transaction.payment.findFirst({
        where: {
          id: { not: payment.id },
          provider: "STRIPE",
          OR: [
            { providerCheckoutId: event.objectId },
            ...(event.paymentIntentId
              ? [{ providerPaymentId: event.paymentIntentId }]
              : []),
          ],
        },
        select: { id: true },
      });

      const plan = planStripeCheckoutReconciliation({
        id: payment.id,
        orderId: payment.orderId,
        provider: payment.provider,
        mode: payment.mode,
        status: payment.status,
        amountCents: payment.amountCents,
        currency: payment.currency,
        pricingVersion: payment.pricingVersion,
        providerCheckoutId: payment.providerCheckoutId,
        providerPaymentId: payment.providerPaymentId,
        paymentMethod: payment.paymentMethod,
        failureCode: payment.failureCode,
        paidAt: payment.paidAt,
        failedAt: payment.failedAt,
        orderStatus: payment.order.status,
        orderHasOtherSuccessfulPayment: otherSuccessfulPayment !== null,
        orderHasOtherActivePayment: otherActivePayment !== null,
        providerIdentifiersBelongToOtherPayment: providerIdentifierConflict !== null,
      }, event);
      if (Object.keys(plan.paymentUpdate).length > 0) {
        await transaction.payment.update({
          where: { id: payment.id },
          data: plan.paymentUpdate,
          select: { id: true },
        });
      }

      if (plan.confirmOrder) {
        const confirmed = await transaction.order.updateMany({
          where: { id: payment.orderId, status: "AWAITING_PAYMENT" },
          data: { status: "PAYMENT_CONFIRMED" },
        });
        if (confirmed.count !== 1) {
          // Roll back Payment + receipt atomically. Stripe will retry and the
          // next reconciliation will see the now-current Order status.
          throw new Error("The Order changed while its payment was confirmed.");
        }
        await transaction.payment.updateMany({
          where: {
            orderId: payment.orderId,
            id: { not: payment.id },
            OR: [
              { status: { in: ["CREATED", "PENDING"] } },
              { status: "FAILED", failureCode: "STRIPE_PAYMENT_ATTEMPT_FAILED" },
            ],
          },
          data: {
            status: "CANCELED",
            canceledAt: new Date(),
            failureCode: "ORDER_PAID_BY_OTHER_PROVIDER",
          },
        });
        await transaction.orderEvent.create({
          data: {
            orderId: payment.orderId,
            fromStatus: "AWAITING_PAYMENT",
            toStatus: "PAYMENT_CONFIRMED",
            note: "Paiement confirmé par Stripe.",
            visibility: "CLIENT",
          },
          select: { id: true },
        });
        await enqueuePaymentConfirmedNotifications(transaction, payment.orderId);
      }

      return createReceipt(transaction, event, plan.outcome, payment.id);
    });
  },

  async reconcileFailure(event) {
    assertDatabaseConfigured();
    return withWebhookTransaction(async (transaction) => {
      await lock(transaction, `payments:webhook:event:${event.eventId}`);
      const duplicate = await duplicateReceipt(transaction, event.eventId);
      if (duplicate) return { outcome: duplicate.outcome, duplicate: true };

      await lock(transaction, `payments:attempt:${event.paymentId}`);
      const paymentOwner = await transaction.payment.findUnique({
        where: { id: event.paymentId, mode: event.livemode ? "LIVE" : "TEST" },
        select: {
          orderId: true,
          shopOrderId: true,
          order: { select: { orderNumber: true } },
        },
      });
      if (!paymentOwner || paymentOwner.shopOrderId || !paymentOwner.orderId || !paymentOwner.order) {
        return createReceipt(transaction, event, "REQUIRES_REVIEW");
      }
      await lock(transaction, `payments:order:${paymentOwner.order.orderNumber}`);

      const payment = await transaction.payment.findUnique({
        where: { id: event.paymentId, mode: event.livemode ? "LIVE" : "TEST" },
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
          failureCode: true,
          paidAt: true,
          failedAt: true,
          order: { select: { status: true } },
        },
      });
      if (!payment || payment.shopOrderId || !payment.orderId || !payment.order) {
        return createReceipt(transaction, event, "REQUIRES_REVIEW", payment?.id);
      }

      const otherSuccessfulPayment = await transaction.payment.findFirst({
        where: {
          orderId: payment.orderId,
          id: { not: payment.id },
          status: {
            in: ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"],
          },
        },
        select: { id: true },
      });
      const otherActivePayment = await transaction.payment.findFirst({
        where: {
          orderId: payment.orderId,
          id: { not: payment.id },
          OR: [
            { status: { in: ["CREATED", "PENDING", "REQUIRES_REVIEW"] } },
            { status: "FAILED", failureCode: "STRIPE_PAYMENT_ATTEMPT_FAILED" },
          ],
        },
        select: { id: true },
      });
      const providerIdentifierConflict = await transaction.payment.findFirst({
        where: {
          id: { not: payment.id },
          provider: "STRIPE",
          providerPaymentId: event.paymentIntentId,
        },
        select: { id: true },
      });

      const plan = planStripePaymentIntentFailure({
        id: payment.id,
        orderId: payment.orderId,
        provider: payment.provider,
        mode: payment.mode,
        status: payment.status,
        amountCents: payment.amountCents,
        currency: payment.currency,
        pricingVersion: payment.pricingVersion,
        providerCheckoutId: payment.providerCheckoutId,
        providerPaymentId: payment.providerPaymentId,
        paymentMethod: payment.paymentMethod,
        failureCode: payment.failureCode,
        paidAt: payment.paidAt,
        failedAt: payment.failedAt,
        orderStatus: payment.order.status,
        orderHasOtherSuccessfulPayment: otherSuccessfulPayment !== null,
        orderHasOtherActivePayment: otherActivePayment !== null,
        providerIdentifiersBelongToOtherPayment: providerIdentifierConflict !== null,
      }, event);
      if (Object.keys(plan.paymentUpdate).length > 0) {
        await transaction.payment.update({
          where: { id: payment.id },
          data: plan.paymentUpdate,
          select: { id: true },
        });
      }

      return createReceipt(transaction, event, plan.outcome, payment.id);
    });
  },
};
