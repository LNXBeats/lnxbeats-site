import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

import { enqueueOrderNotification } from "@/lib/notifications/service";
import { issueCreditNoteForRefund } from "@/lib/billing/service";
import {
  paypalCentsFromAmount,
  paypalRefundApplicationReference,
  paypalRefundEvidence,
} from "@/lib/payments/paypal-client";
import {
  deferredShopRefundLifecycleKey,
} from "@/lib/payments/provider-refund-receipt";
import { paymentStatusAfterRefund, refundableAmount, type RefundProviderEvidence } from "@/lib/payments/refund";
import type { VerifiedPaypalWebhookEvent } from "@/lib/payments/paypal-webhook";
import type { StripeWebhookProcessingResult, VerifiedStripeWebhookEvent } from "@/lib/payments/webhook";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  applyShopReturnRefundEvidenceInTransaction,
  type ShopRefundEvidence,
} from "@/lib/shop/after-sales-service";
import {
  applyShopCustomerCancellationEvidenceInTransaction,
  type ShopCustomerCancellationEvidence,
} from "@/lib/shop/refund-finalization-service";
import { lockShopOrderForMutation, lockShopRefundCapacity } from "@/lib/shop/order-coordination";
import { persistShopRefundFinalizationReview } from "@/lib/shop/refund-accounting-safety";
import { lockShopRefundAttemptForMutation } from "@/lib/shop/refund-coordination";

type Transaction = Prisma.TransactionClient;
type Provider = "STRIPE" | "PAYPAL";
type RefundEventEvidence = RefundProviderEvidence & Readonly<{
  eventId: string;
  eventType: string;
  stripeApplicationMetadata?: Readonly<{
    present: boolean;
    paymentId: string | null;
    refundAttemptId: string | null;
  }>;
  paypalApplicationReference?: Readonly<{
    present: boolean;
    value: string | null;
  }>;
}>;

function prevalidatedShopRefundEvidence(input: RefundEventEvidence): ShopRefundEvidence {
  // Only call this after correlateExpectedShopRefund has validated the signed
  // provider event against the exact authorized attempt (or after a durable
  // API/retrieve binding under the shared mutation lock).
  return { ...input, applicationCorrelation: "MATCH" };
}
type IncidentInput = Readonly<{
  provider: Provider;
  eventId: string;
  eventType: string;
  providerPaymentId: string;
  providerIncidentId: string;
  incidentType: "REVERSAL" | "DISPUTE" | "CHARGEBACK";
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED";
  amountCents?: number;
  currency?: "EUR";
  outcome?: "BUYER_FAVOUR" | "SELLER_FAVOUR" | "REVERSED" | "RESTORED" | "ACCEPTED" | "DENIED" | "OTHER";
  occurredAt: Date;
  livemode: boolean;
}>;

const activeRefundStatuses = ["PROCESSING", "PENDING", "REQUIRES_REVIEW"] as const;
const winningPaymentStatuses = ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
const paypalFinancialEvents = new Set([
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.REFUND.PENDING",
  "PAYMENT.REFUND.FAILED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
]);
const stripeRefundEvents = new Set(["refund.created", "refund.updated", "refund.failed"]);
const stripeIncidentEvents = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
]);
const SHOP_FINANCIAL_REVIEW_CODE = "SHOP_PROVIDER_FINANCIAL_EVENT_REVIEW" as const;
const internalId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function bounded(value: unknown, max = 255) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function eventDate(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return new Date(value * 1_000);
  if (typeof value !== "string" || value.length > 80) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

class CorrelatedShopRefundFinalizationError extends Error {
  override readonly name = "CorrelatedShopRefundFinalizationError";

  constructor(
    readonly attemptId: string,
    override readonly cause: unknown,
  ) {
    super("Correlated Shop refund finalization failed.", { cause });
  }
}

function transactionFailureCode(error: unknown) {
  const cause = error instanceof CorrelatedShopRefundFinalizationError
    ? error.cause
    : error;
  return cause && typeof cause === "object" && "code" in cause ? cause.code : null;
}

async function withEventTransaction<T>(operation: (transaction: Transaction) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      const code = transactionFailureCode(error);
      if (code !== "P2034" && code !== "P2002") throw error;
    }
  }
  throw lastError;
}

async function lock(transaction: Transaction, key: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
}

async function duplicate(transaction: Transaction, provider: Provider, eventId: string) {
  return transaction.providerEvent.findUnique({
    where: { provider_providerEventId: { provider, providerEventId: eventId } },
    select: { outcome: true },
  });
}

function result(outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW", duplicateEvent = false): StripeWebhookProcessingResult {
  return { outcome, duplicate: duplicateEvent };
}

async function createReceipt(transaction: Transaction, input: Readonly<{
  provider: Provider;
  eventId: string;
  type: string;
  objectId?: string;
  outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW";
  paymentId?: string;
  refundAttemptId?: string;
  incidentId?: string;
  occurredAt: Date;
  livemode: boolean;
}>) {
  await transaction.providerEvent.create({
    data: {
      provider: input.provider,
      providerEventId: input.eventId,
      type: input.type.slice(0, 160),
      livemode: input.livemode,
      objectId: input.objectId?.slice(0, 255),
      outcome: input.outcome,
      processedAt: input.occurredAt,
      ...(input.paymentId ? { paymentId: input.paymentId } : {}),
      ...(input.refundAttemptId ? { refundAttemptId: input.refundAttemptId } : {}),
      ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    },
  });
  return result(input.outcome);
}

function shopFinancialLifecycleKey(paymentId: string, provider: Provider, eventId: string) {
  const digest = createHash("sha256").update(`${provider}:${eventId}`).digest("hex");
  return `shop-payment:${paymentId}:financial-review:${digest}`;
}

/**
 * Unmatched, incoherent or non-refund Shop financial events remain durable
 * review evidence and close fulfillment behind the shared order lock. Expected
 * customer-cancellation refunds take the correlated finalization path below.
 */
async function recordShopFinancialReview(
  transaction: Transaction,
  input: Readonly<{
    provider: Provider;
    eventId: string;
    type: string;
    objectId?: string;
    paymentId: string;
    shopOrderId: string;
    refundAttemptId?: string;
    occurredAt: Date;
    livemode: boolean;
  }>,
) {
  if (!await lockShopOrderForMutation(transaction, input.shopOrderId)) {
    return createReceipt(transaction, {
      provider: input.provider,
      eventId: input.eventId,
      type: input.type,
      objectId: input.objectId,
      outcome: "REQUIRES_REVIEW",
      paymentId: input.paymentId,
      refundAttemptId: input.refundAttemptId,
      occurredAt: input.occurredAt,
      livemode: input.livemode,
    });
  }
  const order = await transaction.shopOrder.findUniqueOrThrow({
    where: { id: input.shopOrderId },
    select: { paymentReviewAt: true, paymentReviewCode: true },
  });
  // Persist the signed receipt before the review mutation. Both writes remain
  // atomic; a later failure rolls the receipt back with the transaction.
  const receipt = await createReceipt(transaction, {
    provider: input.provider,
    eventId: input.eventId,
    type: input.type,
    objectId: input.objectId,
    outcome: "REQUIRES_REVIEW",
    paymentId: input.paymentId,
    refundAttemptId: input.refundAttemptId,
    occurredAt: input.occurredAt,
    livemode: input.livemode,
  });
  await transaction.shopOrder.update({
    where: { id: input.shopOrderId },
    data: {
      paymentReviewAt: order.paymentReviewAt ?? input.occurredAt,
      paymentReviewCode: order.paymentReviewCode ?? SHOP_FINANCIAL_REVIEW_CODE,
    },
    select: { id: true },
  });
  await transaction.shopOrderLifecycleEvent.upsert({
    where: {
      idempotencyKey: shopFinancialLifecycleKey(input.paymentId, input.provider, input.eventId),
    },
    create: {
      shopOrderId: input.shopOrderId,
      paymentId: input.paymentId,
      type: "SHOP_PAYMENT_REQUIRES_REVIEW",
      idempotencyKey: shopFinancialLifecycleKey(input.paymentId, input.provider, input.eventId),
      metadata: {
        provider: input.provider,
        reviewCode: SHOP_FINANCIAL_REVIEW_CODE,
        category: "PROVIDER_FINANCIAL_EVENT",
        ...(input.refundAttemptId ? { refundAttemptId: input.refundAttemptId } : {}),
      },
      occurredAt: input.occurredAt,
    },
    update: {},
    select: { id: true },
  });
  return receipt;
}

async function recordReview(input: Readonly<{
  provider: Provider;
  eventId: string;
  type: string;
  providerPaymentId?: string;
  objectId?: string;
  refundAttemptId?: string;
  occurredAt: Date;
  livemode: boolean;
}>) {
  assertDatabaseConfigured();
  return withEventTransaction(async (transaction) => {
    await lock(transaction, `payments:webhook:event:${input.provider}:${input.eventId}`);
    const seen = await duplicate(transaction, input.provider, input.eventId);
    if (seen) return result(seen.outcome, true);
    const payment = input.providerPaymentId
      ? await transaction.payment.findUnique({
          where: {
            provider_providerPaymentId: { provider: input.provider, providerPaymentId: input.providerPaymentId },
            mode: input.livemode ? "LIVE" : "TEST",
          },
          select: { id: true, orderId: true, shopOrderId: true },
        })
      : null;
    if (payment?.shopOrderId && !payment.orderId) {
      return recordShopFinancialReview(transaction, {
        provider: input.provider,
        eventId: input.eventId,
        type: input.type,
        objectId: input.objectId,
        paymentId: payment.id,
        shopOrderId: payment.shopOrderId,
        refundAttemptId: input.refundAttemptId,
        occurredAt: input.occurredAt,
        livemode: input.livemode,
      });
    }
    return createReceipt(transaction, {
      provider: input.provider,
      eventId: input.eventId,
      type: input.type,
      objectId: input.objectId,
      outcome: "REQUIRES_REVIEW",
      paymentId: payment?.id,
      refundAttemptId: input.refundAttemptId,
      occurredAt: input.occurredAt,
      livemode: input.livemode,
    });
  });
}

/**
 * A correlated provider success whose local finalization rolled back already
 * has a durable RefundAttempt barrier. Record the signed evidence without
 * setting the unrelated Shop payment-review gate, so explicit reconciliation
 * can retry accounting while fulfillment remains blocked by that attempt.
 */
async function recordCorrelatedShopRefundEvidence(
  input: RefundEventEvidence & Readonly<{ livemode: boolean }>,
  refundAttemptId: string,
  outcome: "PROCESSED" | "REQUIRES_REVIEW",
) {
  return withEventTransaction(async (transaction) => {
    await lock(transaction, `payments:webhook:event:${input.provider}:${input.eventId}`);
    const seen = await duplicate(transaction, input.provider, input.eventId);
    if (seen) return result(seen.outcome, true);
    const payment = await transaction.payment.findUnique({
      where: {
        provider_providerPaymentId: {
          provider: input.provider,
          providerPaymentId: input.providerPaymentId,
        },
        mode: input.livemode ? "LIVE" : "TEST",
      },
      select: { id: true },
    });
    return createReceipt(transaction, {
      provider: input.provider,
      eventId: input.eventId,
      type: input.eventType,
      objectId: input.providerRefundId,
      outcome,
      paymentId: payment?.id,
      refundAttemptId,
      occurredAt: input.occurredAt,
      livemode: input.livemode,
    });
  });
}

type ShopRefundAttemptCandidate = Readonly<{
  id: string;
  paymentId: string;
  provider: Provider;
  source: "ADMIN" | "PROVIDER";
  amountCents: number;
  currency: string;
  requestedByUserId: string | null;
  shopCustomerRequestId: string | null;
  shopReturnRequestId: string | null;
  providerRefundId: string | null;
  providerIdempotencyKey: string;
  failureCode: string | null;
  status: "PROCESSING" | "PENDING" | "SUCCEEDED" | "FAILED" | "REQUIRES_REVIEW";
  shopCustomerRequest: Readonly<{
    shopOrderId: string;
    type: string;
    status: string;
    decidedByUserId: string | null;
    decidedAt: Date | null;
  }> | null;
  shopReturnRequest: Readonly<{
    shopOrderId: string;
    status: string;
    refundStatus: string;
    totalRefundCents: number;
    reviewedByUserId: string | null;
    authorizedAt: Date | null;
    refundRequestedAt: Date | null;
  }> | null;
}>;

type ShopRefundCorrelation =
  | Readonly<{ outcome: "MATCH"; attemptId: string; operation: "CANCELLATION" | "RETURN" }>
  | Readonly<{ outcome: "DEFER"; attemptId: string; operation: "CANCELLATION" | "RETURN" }>
  | Readonly<{ outcome: "REVIEW"; refundAttemptId?: string }>;

const shopRefundAttemptInclude = {
  shopCustomerRequest: {
    select: {
      shopOrderId: true,
      type: true,
      status: true,
      decidedByUserId: true,
      decidedAt: true,
    },
  },
  shopReturnRequest: {
    select: {
      shopOrderId: true,
      status: true,
      refundStatus: true,
      totalRefundCents: true,
      reviewedByUserId: true,
      authorizedAt: true,
      refundRequestedAt: true,
    },
  },
} as const;

function authorizedShopRefundBase(
  attempt: ShopRefundAttemptCandidate,
  payment: Readonly<{
    id: string;
    shopOrderId: string | null;
    provider: Provider;
    providerPaymentId: string | null;
    amountCents: number;
    currency: string;
  }>,
  evidence: RefundEventEvidence,
) {
  return attempt.paymentId === payment.id
    && attempt.provider === evidence.provider
    && attempt.provider === payment.provider
    && attempt.source === "ADMIN"
    && attempt.requestedByUserId !== null
    && attempt.currency === evidence.currency
    && attempt.currency === payment.currency
    && attempt.amountCents === evidence.amountCents
    && attempt.amountCents > 0
    && attempt.amountCents <= payment.amountCents
    && evidence.providerPaymentId === payment.providerPaymentId
    && (attempt.providerRefundId === null || attempt.providerRefundId === evidence.providerRefundId);
}

function authorizedShopRefundOperation(
  attempt: ShopRefundAttemptCandidate,
  payment: Parameters<typeof authorizedShopRefundBase>[1],
  evidence: RefundEventEvidence,
) {
  if (!authorizedShopRefundBase(attempt, payment, evidence)) return null;
  const cancellation = attempt.shopCustomerRequest;
  if (
    attempt.shopCustomerRequestId !== null
    && attempt.shopReturnRequestId === null
    && cancellation !== null
    && attempt.amountCents === payment.amountCents
    && cancellation.shopOrderId === payment.shopOrderId
    && cancellation.type === "PAID_ORDER_CANCELLATION"
    && (cancellation.status === "APPROVED" || cancellation.status === "COMPLETED")
    && cancellation.decidedByUserId !== null
    && cancellation.decidedByUserId === attempt.requestedByUserId
    && cancellation.decidedAt !== null
  ) return "CANCELLATION" as const;

  const shopReturn = attempt.shopReturnRequest;
  if (
    attempt.shopReturnRequestId !== null
    && attempt.shopCustomerRequestId === null
    && shopReturn !== null
    && shopReturn.shopOrderId === payment.shopOrderId
    && ["REFUND_PENDING", "REFUNDED", "CLOSED"].includes(shopReturn.status)
    && ["PENDING", "REQUIRES_REVIEW", "SUCCEEDED", "FAILED"].includes(shopReturn.refundStatus)
    && shopReturn.totalRefundCents === attempt.amountCents
    && shopReturn.reviewedByUserId !== null
    && shopReturn.authorizedAt !== null
    && shopReturn.refundRequestedAt !== null
  ) return "RETURN" as const;
  return null;
}

function stripeMetadataMatches(
  evidence: RefundEventEvidence,
  paymentId: string,
  attemptId: string,
) {
  const metadata = evidence.stripeApplicationMetadata;
  return !metadata?.present
    || metadata.paymentId === paymentId && metadata.refundAttemptId === attemptId;
}

function paypalReferenceMatches(
  evidence: RefundEventEvidence,
  providerIdempotencyKey: string,
) {
  const reference = evidence.paypalApplicationReference;
  return !reference?.present
    || reference.value === paypalRefundApplicationReference(providerIdempotencyKey);
}

async function correlateExpectedShopRefund(
  transaction: Transaction,
  payment: Readonly<{
    id: string;
    shopOrderId: string | null;
    provider: Provider;
    providerPaymentId: string | null;
    amountCents: number;
    currency: string;
  }>,
  evidence: RefundEventEvidence,
): Promise<ShopRefundCorrelation> {
  if (!payment.shopOrderId) return { outcome: "REVIEW" };
  const exact = await transaction.refundAttempt.findUnique({
    where: {
      provider_providerRefundId: {
        provider: evidence.provider,
        providerRefundId: evidence.providerRefundId,
      },
    },
    include: shopRefundAttemptInclude,
  });
  if (exact) {
    const linkedAttemptId = exact.paymentId === payment.id ? exact.id : undefined;
    const operation = authorizedShopRefundOperation(exact, payment, evidence);
    const applicationProofPresent = evidence.provider === "STRIPE"
      ? evidence.stripeApplicationMetadata?.present === true
      : evidence.paypalApplicationReference?.present === true;
    if (operation && !applicationProofPresent) {
      const trustedBinding = await transaction.paymentAuditEvent.findFirst({
        where: {
          refundAttemptId: exact.id,
          action: { in: ["REFUND_PROVIDER_ACCEPTED", "REFUND_CONFIRMED", "REFUND_FAILED"] },
        },
        select: { id: true },
      });
      if (!trustedBinding && activeRefundStatuses.includes(
        exact.status as typeof activeRefundStatuses[number],
      )) {
        return { outcome: "DEFER", attemptId: exact.id, operation };
      }
      if (!trustedBinding) {
        return { outcome: "REVIEW", ...(linkedAttemptId ? { refundAttemptId: linkedAttemptId } : {}) };
      }
    }
    return operation
      && stripeMetadataMatches(evidence, payment.id, exact.id)
      && paypalReferenceMatches(evidence, exact.providerIdempotencyKey)
      ? { outcome: "MATCH", attemptId: exact.id, operation }
      : { outcome: "REVIEW", ...(linkedAttemptId ? { refundAttemptId: linkedAttemptId } : {}) };
  }

  const findActiveCandidates = () => transaction.refundAttempt.findMany({
    where: {
      paymentId: payment.id,
      provider: evidence.provider,
      source: "ADMIN",
      providerRefundId: null,
      status: { in: [...activeRefundStatuses] },
      requestedByUserId: { not: null },
    },
    include: shopRefundAttemptInclude,
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  });

  if (evidence.provider === "STRIPE") {
    const metadata = evidence.stripeApplicationMetadata;
    if (!metadata?.present) {
      const candidates = await findActiveCandidates();
      const eligible = candidates.flatMap((candidate) => {
        const operation = authorizedShopRefundOperation(candidate, payment, evidence);
        return operation ? [{ candidate, operation }] : [];
      });
      return eligible.length === 1
        ? {
            outcome: "DEFER",
            attemptId: eligible[0]!.candidate.id,
            operation: eligible[0]!.operation,
          }
        : { outcome: "REVIEW" };
    }
    if (
      !metadata.paymentId
      || !metadata.refundAttemptId
      || !internalId.test(metadata.paymentId)
      || !internalId.test(metadata.refundAttemptId)
      || metadata.paymentId !== payment.id
    ) return { outcome: "REVIEW" };
    const candidate = await transaction.refundAttempt.findUnique({
      where: { id: metadata.refundAttemptId },
      include: shopRefundAttemptInclude,
    });
    const operation = candidate
      ? authorizedShopRefundOperation(candidate, payment, evidence)
      : null;
    if (!candidate || !operation) {
      return {
        outcome: "REVIEW",
        ...(candidate?.paymentId === payment.id ? { refundAttemptId: candidate.id } : {}),
      };
    }
    return { outcome: "MATCH", attemptId: candidate.id, operation };
  }

  const reference = evidence.paypalApplicationReference;
  const candidates = reference?.present
    ? await transaction.refundAttempt.findMany({
        where: {
          paymentId: payment.id,
          provider: evidence.provider,
          source: "ADMIN",
          providerRefundId: null,
          requestedByUserId: { not: null },
        },
        include: shopRefundAttemptInclude,
        orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
      })
    : await findActiveCandidates();
  const eligible = candidates.flatMap((candidate) => {
    const operation = authorizedShopRefundOperation(candidate, payment, evidence);
    return operation ? [{ candidate, operation }] : [];
  });
  if (!reference?.present) {
    return eligible.length === 1
      ? {
          outcome: "DEFER",
          attemptId: eligible[0]!.candidate.id,
          operation: eligible[0]!.operation,
        }
      : { outcome: "REVIEW" };
  }
  if (!reference.value) return { outcome: "REVIEW" };
  const referenced = eligible.filter(({ candidate }) =>
    paypalRefundApplicationReference(candidate.providerIdempotencyKey) === reference.value);
  return referenced.length === 1
    ? {
        outcome: "MATCH",
        attemptId: referenced[0]!.candidate.id,
        operation: referenced[0]!.operation,
      }
    : { outcome: "REVIEW" };
}

async function recordDeferredShopRefundEvidence(
  transaction: Transaction,
  input: RefundEventEvidence & Readonly<{ livemode: boolean }>,
  payment: Readonly<{ id: string; shopOrderId: string }>,
  refundAttemptId: string,
  operation: "CANCELLATION" | "RETURN",
) {
  await lockShopOrderForMutation(transaction, payment.shopOrderId);
  if (operation === "RETURN") {
    await lockShopRefundAttemptForMutation(transaction, refundAttemptId);
  }
  await lockShopRefundCapacity(transaction, payment.id);
  const currentPayment = await transaction.payment.findUniqueOrThrow({
    where: { id: payment.id },
    select: {
      id: true,
      shopOrderId: true,
      provider: true,
      providerPaymentId: true,
      amountCents: true,
      currency: true,
    },
  });
  const attempt = await transaction.refundAttempt.findUniqueOrThrow({
    where: { id: refundAttemptId },
    include: shopRefundAttemptInclude,
  });
  if (attempt.status === "SUCCEEDED" || attempt.status === "FAILED") {
    const terminalEvidenceMatches = attempt.providerRefundId === input.providerRefundId
      && (
        attempt.status === "SUCCEEDED" && input.status !== "FAILED"
        || attempt.status === "FAILED" && input.status === "FAILED"
      );
    if (terminalEvidenceMatches) {
      return createReceipt(transaction, {
        provider: input.provider,
        eventId: input.eventId,
        type: input.eventType,
        objectId: input.providerRefundId,
        outcome: "PROCESSED",
        paymentId: payment.id,
        refundAttemptId,
        occurredAt: input.occurredAt,
        livemode: input.livemode,
      });
    }

    // Correlation was computed before this lock. If the provider/API path made
    // the attempt terminal while the webhook waited, contradictory signed
    // evidence must restore a durable shipping/refund barrier rather than
    // leaving a certainly-failed attempt expeditable.
    await transaction.refundAttempt.update({
      where: { id: refundAttemptId },
      data: attempt.status === "FAILED"
        ? {
            status: "REQUIRES_REVIEW",
            failureCode: "REFUND_STATUS_CONFLICT",
            ...(attempt.providerRefundId === input.providerRefundId && input.status === "SUCCEEDED"
              ? { confirmedAt: input.occurredAt }
              : {}),
          }
        : { failureCode: "REFUND_STATUS_CONFLICT" },
    });
    await transaction.payment.update({
      where: { id: payment.id },
      data: { status: "REFUND_PENDING" },
    });
    const audited = await transaction.paymentAuditEvent.findFirst({
      where: { refundAttemptId, action: "REFUND_RECONCILIATION_REQUIRED" },
      select: { id: true },
    });
    if (!audited) await transaction.paymentAuditEvent.create({ data: {
      paymentId: payment.id,
      refundAttemptId,
      provider: attempt.provider,
      action: "REFUND_RECONCILIATION_REQUIRED",
      amountCents: attempt.amountCents,
      result: "REQUIRES_REVIEW",
    } });
    if (operation === "RETURN" && attempt.shopReturnRequestId) {
      await transaction.shopReturnRequest.update({
        where: { id: attempt.shopReturnRequestId },
        data: { refundStatus: "REQUIRES_REVIEW" },
      });
      await transaction.shopReturnAuditEvent.upsert({
        where: { idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-review:status-conflict:v1` },
        update: {},
        create: {
          shopReturnRequestId: attempt.shopReturnRequestId,
          action: "REFUND_REQUIRES_REVIEW",
          idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-review:status-conflict:v1`,
        },
      });
    }
    return recordShopFinancialReview(transaction, {
      provider: input.provider,
      eventId: input.eventId,
      type: input.eventType,
      objectId: input.providerRefundId,
      paymentId: payment.id,
      shopOrderId: payment.shopOrderId,
      refundAttemptId,
      occurredAt: input.occurredAt,
      livemode: input.livemode,
    });
  }
  if (attempt.providerRefundId && attempt.providerRefundId !== input.providerRefundId) {
    return recordShopFinancialReview(transaction, {
      provider: input.provider,
      eventId: input.eventId,
      type: input.eventType,
      objectId: input.providerRefundId,
      paymentId: payment.id,
      shopOrderId: payment.shopOrderId,
      refundAttemptId,
      occurredAt: input.occurredAt,
      livemode: input.livemode,
    });
  }
  const candidates = await transaction.refundAttempt.findMany({
    where: {
      paymentId: currentPayment.id,
      provider: input.provider,
      source: "ADMIN",
      requestedByUserId: { not: null },
      status: { in: [...activeRefundStatuses] },
      OR: [
        { providerRefundId: null },
        { providerRefundId: input.providerRefundId },
      ],
    },
    include: shopRefundAttemptInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const authorized = candidates.flatMap((candidate) => {
    const currentOperation = authorizedShopRefundOperation(candidate, currentPayment, input);
    return currentOperation ? [{ candidate, operation: currentOperation }] : [];
  });
  if (
    authorized.length !== 1
    || authorized[0]!.candidate.id !== refundAttemptId
    || authorized[0]!.operation !== operation
  ) {
    return recordShopFinancialReview(transaction, {
      provider: input.provider,
      eventId: input.eventId,
      type: input.eventType,
      objectId: input.providerRefundId,
      paymentId: payment.id,
      shopOrderId: payment.shopOrderId,
      occurredAt: input.occurredAt,
      livemode: input.livemode,
    });
  }
  const trustedProviderBinding = attempt.status === "PENDING"
    && attempt.failureCode === null
    && attempt.providerRefundId === input.providerRefundId
    && await transaction.paymentAuditEvent.findFirst({
      where: { refundAttemptId, action: "REFUND_PROVIDER_ACCEPTED" },
      select: { id: true },
    });
  if (trustedProviderBinding) {
    try {
      const evidence = prevalidatedShopRefundEvidence(input);
      const finalization = operation === "CANCELLATION"
        ? await applyShopCustomerCancellationEvidenceInTransaction(
            transaction,
            refundAttemptId,
            evidence satisfies ShopCustomerCancellationEvidence,
          )
        : (await applyShopReturnRefundEvidenceInTransaction(
            transaction,
            refundAttemptId,
            evidence,
          )).status;
      return await createReceipt(transaction, {
        provider: input.provider,
        eventId: input.eventId,
        type: input.eventType,
        objectId: input.providerRefundId,
        outcome: finalization === "REQUIRES_REVIEW" ? "REQUIRES_REVIEW" : "PROCESSED",
        paymentId: payment.id,
        refundAttemptId,
        occurredAt: input.occurredAt,
        livemode: input.livemode,
      });
    } catch (error) {
      throw new CorrelatedShopRefundFinalizationError(refundAttemptId, error);
    }
  }
  if (
    attempt.status !== "REQUIRES_REVIEW"
    || attempt.failureCode === null
  ) {
    await transaction.refundAttempt.update({
      where: { id: refundAttemptId },
      data: {
        status: "REQUIRES_REVIEW",
        failureCode: attempt.failureCode ?? "PROVIDER_EVENT_CORRELATION_DEFERRED",
      },
    });
  }
  await transaction.payment.update({
    where: { id: payment.id },
    data: { status: "REFUND_PENDING" },
  });
  const audited = await transaction.paymentAuditEvent.findFirst({
    where: { refundAttemptId, action: "REFUND_RECONCILIATION_REQUIRED" },
    select: { id: true },
  });
  if (!audited) await transaction.paymentAuditEvent.create({ data: {
    paymentId: payment.id,
    refundAttemptId,
    provider: attempt.provider,
    action: "REFUND_RECONCILIATION_REQUIRED",
    amountCents: attempt.amountCents,
    result: "REQUIRES_REVIEW",
  } });
  if (operation === "RETURN" && attempt.shopReturnRequestId) {
    await transaction.shopReturnRequest.update({
      where: { id: attempt.shopReturnRequestId },
      data: { refundStatus: "REQUIRES_REVIEW" },
    });
    await transaction.shopReturnAuditEvent.upsert({
      where: { idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-review:deferred-event:v1` },
      update: {},
      create: {
        shopReturnRequestId: attempt.shopReturnRequestId,
        action: "REFUND_REQUIRES_REVIEW",
        idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-review:deferred-event:v1`,
      },
    });
  }
  await transaction.shopOrderLifecycleEvent.upsert({
    where: {
      idempotencyKey: deferredShopRefundLifecycleKey(
        payment.id,
        input.provider,
        input.eventId,
      ),
    },
    update: {},
    create: {
      shopOrderId: payment.shopOrderId,
      paymentId: payment.id,
      type: "SHOP_PAYMENT_REQUIRES_REVIEW",
      idempotencyKey: deferredShopRefundLifecycleKey(
        payment.id,
        input.provider,
        input.eventId,
      ),
      metadata: {
        category: "DEFERRED_PROVIDER_REFUND_CORRELATION",
        refundAttemptId,
        provider: input.provider,
        providerEventId: input.eventId,
        providerRefundId: input.providerRefundId,
        providerStatus: input.status,
        amountCents: input.amountCents,
        currency: input.currency,
      },
      occurredAt: input.occurredAt,
    },
  });
  return createReceipt(transaction, {
    provider: input.provider,
    eventId: input.eventId,
    type: input.eventType,
    objectId: input.providerRefundId,
    outcome: "REQUIRES_REVIEW",
    paymentId: payment.id,
    refundAttemptId,
    occurredAt: input.occurredAt,
    livemode: input.livemode,
  });
}

async function processRefundEvent(input: RefundEventEvidence & Readonly<{ livemode: boolean }>) {
  assertDatabaseConfigured();
  try {
    return await withEventTransaction(async (transaction) => {
      await lock(transaction, `payments:webhook:event:${input.provider}:${input.eventId}`);
      const seen = await duplicate(transaction, input.provider, input.eventId);
      if (seen) return result(seen.outcome, true);
      const payment = await transaction.payment.findUnique({
        where: {
          provider_providerPaymentId: { provider: input.provider, providerPaymentId: input.providerPaymentId },
          mode: input.livemode ? "LIVE" : "TEST",
        },
        include: { order: true, invoice: { select: { id: true } } },
      });
      if (payment?.shopOrderId && !payment.orderId) {
        const correlation = await correlateExpectedShopRefund(transaction, payment, input);
        if (correlation.outcome === "REVIEW") {
          return recordShopFinancialReview(transaction, {
            provider: input.provider,
            eventId: input.eventId,
            type: input.eventType,
            objectId: input.providerRefundId,
            paymentId: payment.id,
            shopOrderId: payment.shopOrderId,
            refundAttemptId: correlation.refundAttemptId,
            occurredAt: input.occurredAt,
            livemode: input.livemode,
          });
        }
        if (correlation.outcome === "DEFER") {
          return recordDeferredShopRefundEvidence(
            transaction,
            input,
            { id: payment.id, shopOrderId: payment.shopOrderId },
            correlation.attemptId,
            correlation.operation,
          );
        }
        try {
          const evidence = prevalidatedShopRefundEvidence(input);
          const finalization = correlation.operation === "CANCELLATION"
            ? await applyShopCustomerCancellationEvidenceInTransaction(
                transaction,
                correlation.attemptId,
                evidence satisfies ShopCustomerCancellationEvidence,
              )
            : (await applyShopReturnRefundEvidenceInTransaction(
                transaction,
                correlation.attemptId,
                evidence,
              )).status;
          if (finalization === "REQUIRES_REVIEW") {
            const reviewedAttempt = await transaction.refundAttempt.findUniqueOrThrow({
              where: { id: correlation.attemptId },
              select: { failureCode: true },
            });
            const correlatedPendingEvidenceProcessed = input.status === "PENDING"
              && (
                reviewedAttempt.failureCode === "AMBIGUOUS_PROVIDER_ACCEPTANCE"
                || reviewedAttempt.failureCode === "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED"
              );
            return await createReceipt(transaction, {
              provider: input.provider,
              eventId: input.eventId,
              type: input.eventType,
              objectId: input.providerRefundId,
              outcome: correlatedPendingEvidenceProcessed ? "PROCESSED" : "REQUIRES_REVIEW",
              paymentId: payment.id,
              refundAttemptId: correlation.attemptId,
              occurredAt: input.occurredAt,
              livemode: input.livemode,
            });
          }
          return await createReceipt(transaction, {
            provider: input.provider,
            eventId: input.eventId,
            type: input.eventType,
            objectId: input.providerRefundId,
            outcome: "PROCESSED",
            paymentId: payment.id,
            refundAttemptId: correlation.attemptId,
            occurredAt: input.occurredAt,
            livemode: input.livemode,
          });
        } catch (error) {
          throw new CorrelatedShopRefundFinalizationError(correlation.attemptId, error);
        }
      }
    if (
      !payment
      || payment.shopOrderId
      || !payment.orderId
      || !payment.order
      || !winningPaymentStatuses.includes(payment.status as typeof winningPaymentStatuses[number])
    ) {
      return createReceipt(transaction, {
        provider: input.provider, eventId: input.eventId, type: input.eventType,
        objectId: input.providerRefundId, outcome: "REQUIRES_REVIEW",
        paymentId: payment?.id, occurredAt: input.occurredAt, livemode: input.livemode,
      });
    }
    await lock(transaction, `payments:order:${payment.order.orderNumber}`);
    if (!payment.invoice && input.status !== "FAILED") {
      return createReceipt(transaction, {
        provider: input.provider, eventId: input.eventId, type: input.eventType,
        objectId: input.providerRefundId, outcome: "REQUIRES_REVIEW",
        paymentId: payment.id, occurredAt: input.occurredAt, livemode: input.livemode,
      });
    }
    let attempt = await transaction.refundAttempt.findUnique({
      where: { provider_providerRefundId: { provider: input.provider, providerRefundId: input.providerRefundId } },
    });
    if (!attempt) {
      const candidates = await transaction.refundAttempt.findMany({
        where: {
          paymentId: payment.id,
          provider: input.provider,
          providerRefundId: null,
          amountCents: input.amountCents,
          status: { in: [...activeRefundStatuses] },
        },
        take: 2,
      });
      if (candidates.length === 1) attempt = candidates[0]!;
    }
    if (!attempt) {
      const reserved = await transaction.refundAttempt.aggregate({
        where: { paymentId: payment.id, status: { in: [...activeRefundStatuses] } },
        _sum: { amountCents: true },
      });
      const available = refundableAmount({
        paidCents: payment.amountCents,
        confirmedRefundedCents: payment.refundedAmountCents,
        reservedRefundCents: reserved._sum.amountCents ?? 0,
      });
      if (input.amountCents > available) {
        return createReceipt(transaction, {
          provider: input.provider, eventId: input.eventId, type: input.eventType,
          objectId: input.providerRefundId, outcome: "REQUIRES_REVIEW",
          paymentId: payment.id, occurredAt: input.occurredAt, livemode: input.livemode,
        });
      }
      attempt = await transaction.refundAttempt.create({
        data: {
          paymentId: payment.id,
          provider: input.provider,
          source: "PROVIDER",
          amountCents: input.amountCents,
          currency: "EUR",
          localIdempotencyKey: `provider-event:${input.provider.toLowerCase()}:${input.eventId}`,
          providerRefundId: input.providerRefundId,
          providerIdempotencyKey: `provider-refund:${input.provider.toLowerCase()}:${input.providerRefundId}`,
          status: "PROCESSING",
          attempts: 0,
        },
      });
      await transaction.orderEvent.create({
        data: {
          orderId: payment.orderId,
          fromStatus: null,
          toStatus: payment.order.status,
          note: "Remboursement fournisseur détecté.",
          visibility: "INTERNAL",
        },
      });
    }
    if (attempt.paymentId !== payment.id || attempt.currency !== input.currency || attempt.amountCents !== input.amountCents) {
      return createReceipt(transaction, {
        provider: input.provider, eventId: input.eventId, type: input.eventType,
        objectId: input.providerRefundId, outcome: "REQUIRES_REVIEW",
        paymentId: payment.id, refundAttemptId: attempt.id, occurredAt: input.occurredAt, livemode: input.livemode,
      });
    }
    const wasSucceeded = attempt.status === "SUCCEEDED";
    if (!wasSucceeded) {
      await transaction.refundAttempt.update({
        where: { id: attempt.id },
        data: {
          providerRefundId: input.providerRefundId,
          status: input.status,
          failureCode: input.status === "FAILED" ? "PROVIDER_REFUND_FAILED" : null,
          confirmedAt: input.status === "SUCCEEDED" ? input.occurredAt : null,
        },
      });
    }
    const confirmed = await transaction.refundAttempt.aggregate({
      where: { paymentId: payment.id, status: "SUCCEEDED" },
      _sum: { amountCents: true },
    });
    const confirmedCents = confirmed._sum.amountCents ?? 0;
    const unresolved = await transaction.refundAttempt.count({
      where: { paymentId: payment.id, status: { in: [...activeRefundStatuses] } },
    });
    const nextPaymentStatus = paymentStatusAfterRefund({
      amountCents: payment.amountCents,
      confirmedRefundedCents: confirmedCents,
      hasUnresolvedRefund: unresolved > 0,
    });
    await transaction.payment.update({
      where: { id: payment.id },
      data: {
        status: nextPaymentStatus,
        refundedAmountCents: confirmedCents,
        refundedAt: confirmedCents > 0 ? input.occurredAt : null,
      },
    });
    const action = input.status === "SUCCEEDED" ? "REFUND_CONFIRMED" : input.status === "FAILED" ? "REFUND_FAILED" : "REFUND_PROVIDER_ACCEPTED";
    if (!wasSucceeded || input.status !== "SUCCEEDED") {
      await transaction.paymentAuditEvent.create({
        data: {
          paymentId: payment.id, refundAttemptId: attempt.id, provider: input.provider,
          action, amountCents: input.amountCents,
          result: input.status === "SUCCEEDED" ? "SUCCEEDED" : input.status === "FAILED" ? "FAILED" : "PENDING",
        },
      });
    }
    if (input.status === "SUCCEEDED" && !wasSucceeded) {
      await issueCreditNoteForRefund(transaction, { refundAttemptId: attempt.id });
      const total = confirmedCents === payment.amountCents;
      await transaction.orderEvent.create({
        data: {
          orderId: payment.orderId, fromStatus: null, toStatus: payment.order.status,
          note: total ? "Remboursement total confirmé." : "Remboursement partiel confirmé.",
          visibility: "INTERNAL",
        },
      });
      await enqueueOrderNotification(transaction, {
        orderId: payment.orderId,
        kind: total ? "CUSTOMER_REFUND_COMPLETED" : "CUSTOMER_PARTIAL_REFUND",
        recipient: payment.order.customerEmail,
        idempotencyKey: `payment:${payment.id}:refund:${attempt.id}:confirmed`,
        resource: {
          type: "ORDER", id: payment.orderId, reference: payment.order.orderNumber,
          refundAmountCents: attempt.amountCents,
        },
      });
    }
    return createReceipt(transaction, {
      provider: input.provider, eventId: input.eventId, type: input.eventType,
      objectId: input.providerRefundId, outcome: "PROCESSED",
      paymentId: payment.id, refundAttemptId: attempt.id, occurredAt: input.occurredAt, livemode: input.livemode,
    });
    });
  } catch (error) {
    if (!(error instanceof CorrelatedShopRefundFinalizationError)) {
      throw error;
    }
    const persistedStatus = await persistShopRefundFinalizationReview(
      prisma,
      error.attemptId,
      prevalidatedShopRefundEvidence(input),
    );
    const persisted = await prisma.refundAttempt.findUnique({
      where: { id: error.attemptId },
      select: { failureCode: true },
    });
    const locallyPersistedEvidence = persistedStatus === "SUCCEEDED"
      || persistedStatus === "FAILED"
      || persisted?.failureCode === "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED"
      || persisted?.failureCode === "PROVIDER_FAILED_LOCAL_FINALIZATION_FAILED";
    return recordCorrelatedShopRefundEvidence(
      input,
      error.attemptId,
      locallyPersistedEvidence ? "PROCESSED" : "REQUIRES_REVIEW",
    );
  }
}

async function processIncident(input: IncidentInput) {
  assertDatabaseConfigured();
  return withEventTransaction(async (transaction) => {
    await lock(transaction, `payments:webhook:event:${input.provider}:${input.eventId}`);
    const seen = await duplicate(transaction, input.provider, input.eventId);
    if (seen) return result(seen.outcome, true);
    const payment = await transaction.payment.findUnique({
      where: {
        provider_providerPaymentId: { provider: input.provider, providerPaymentId: input.providerPaymentId },
        mode: input.livemode ? "LIVE" : "TEST",
      },
      include: { order: true },
    });
    if (payment?.shopOrderId && !payment.orderId) {
      return recordShopFinancialReview(transaction, {
        provider: input.provider,
        eventId: input.eventId,
        type: input.eventType,
        objectId: input.providerIncidentId,
        paymentId: payment.id,
        shopOrderId: payment.shopOrderId,
        occurredAt: input.occurredAt,
        livemode: input.livemode,
      });
    }
    if (
      !payment
      || payment.shopOrderId
      || !payment.orderId
      || !payment.order
      || !winningPaymentStatuses.includes(payment.status as typeof winningPaymentStatuses[number])
    ) {
      return createReceipt(transaction, {
        provider: input.provider, eventId: input.eventId, type: input.eventType,
        objectId: input.providerIncidentId, outcome: "REQUIRES_REVIEW",
        paymentId: payment?.id, occurredAt: input.occurredAt, livemode: input.livemode,
      });
    }
    await lock(transaction, `payments:order:${payment.order.orderNumber}`);
    const existing = await transaction.paymentIncident.findUnique({
      where: {
        provider_type_providerIncidentId: {
          provider: input.provider,
          type: input.incidentType,
          providerIncidentId: input.providerIncidentId,
        },
      },
    });
    if (existing && existing.paymentId !== payment.id) {
      return createReceipt(transaction, {
        provider: input.provider,
        eventId: input.eventId,
        type: input.eventType,
        objectId: input.providerIncidentId,
        outcome: "REQUIRES_REVIEW",
        paymentId: payment.id,
        occurredAt: input.occurredAt,
        livemode: input.livemode,
      });
    }
    const status = existing?.status === "RESOLVED" ? "RESOLVED" : input.status;
    const incident = existing
      ? await transaction.paymentIncident.update({
          where: { id: existing.id },
          data: {
            status,
            ...(input.amountCents ? { amountCents: input.amountCents, currency: input.currency } : {}),
            ...(status === "RESOLVED" ? {
              outcome: existing.outcome ?? input.outcome ?? "OTHER",
              resolvedAt: existing.resolvedAt ?? input.occurredAt,
            } : {}),
            requiresOperatorReview: true,
          },
        })
      : await transaction.paymentIncident.create({
          data: {
            paymentId: payment.id,
            provider: input.provider,
            type: input.incidentType,
            providerIncidentId: input.providerIncidentId,
            status: input.status,
            ...(input.amountCents ? { amountCents: input.amountCents, currency: input.currency } : {}),
            ...(input.status === "RESOLVED" ? { outcome: input.outcome ?? "OTHER", resolvedAt: input.occurredAt } : {}),
            openedAt: input.occurredAt,
            requiresOperatorReview: true,
          },
        });
    await transaction.paymentAuditEvent.create({
      data: {
        paymentId: payment.id, incidentId: incident.id, provider: input.provider,
        action: input.status === "RESOLVED" ? "INCIDENT_RESOLVED" : existing ? "INCIDENT_UPDATED" : "INCIDENT_OPENED",
        amountCents: input.amountCents,
        result: "REQUIRES_REVIEW",
      },
    });
    await transaction.orderEvent.create({
      data: {
        orderId: payment.orderId, fromStatus: null, toStatus: payment.order.status,
        note: "Incident de paiement nécessitant une revue.", visibility: "INTERNAL",
      },
    });
    await enqueueOrderNotification(transaction, {
      orderId: payment.orderId,
      kind: "OWNER_PAYMENT_INCIDENT",
      recipient: process.env.EMAIL_OWNER_RECIPIENT?.trim().toLowerCase() || null,
      idempotencyKey: `payment:${payment.id}:incident:${incident.id}:owner`,
      resource: { type: "ORDER", id: payment.orderId, reference: payment.order.orderNumber },
    });
    return createReceipt(transaction, {
      provider: input.provider, eventId: input.eventId, type: input.eventType,
      objectId: input.providerIncidentId, outcome: "PROCESSED",
      paymentId: payment.id, incidentId: incident.id, occurredAt: input.occurredAt, livemode: input.livemode,
    });
  });
}

export function normalizeStripeRefundEvent(event: VerifiedStripeWebhookEvent): RefundEventEvidence | null {
  if (!stripeRefundEvents.has(event.type)) return null;
  const refund = record(event.data.object);
  const paymentIntent = bounded(record(refund?.payment_intent)?.id) ?? bounded(refund?.payment_intent);
  const metadata = record(refund?.metadata);
  const metadataPresent = metadata !== null
    && (Object.hasOwn(metadata, "paymentId") || Object.hasOwn(metadata, "refundAttemptId"));
  const status = refund?.status === "failed" || refund?.status === "canceled"
    ? "FAILED"
    : refund?.status === "succeeded"
      ? "SUCCEEDED"
      : refund?.status === "pending" || refund?.status === "requires_action"
        ? "PENDING"
        : null;
  const occurredAt = eventDate(event.created);
  if (
    refund?.object !== "refund" || !bounded(refund.id) || !paymentIntent || !status || !occurredAt
    || (event.type === "refund.failed" && status !== "FAILED")
    || !Number.isSafeInteger(refund.amount) || Number(refund.amount) <= 0 || refund.currency !== "eur"
  ) return null;
  return {
    provider: "STRIPE", providerRefundId: String(refund.id), providerPaymentId: paymentIntent,
    status, amountCents: Number(refund.amount), currency: "EUR", occurredAt,
    eventId: event.id, eventType: event.type,
    stripeApplicationMetadata: {
      present: metadataPresent,
      paymentId: bounded(metadata?.paymentId),
      refundAttemptId: bounded(metadata?.refundAttemptId),
    },
  };
}

export function captureIdFromRefundResource(
  resource: Record<string, unknown>,
  environment: "sandbox" | "live" = "sandbox",
) {
  const link = array(resource.links)
    .map(record)
    .find((candidate) => candidate?.rel === "up" && candidate?.method === "GET");
  const href = bounded(link?.href, 2_048);
  if (!href) return null;
  try {
    const url = new URL(href);
    const allowedHosts = environment === "live"
      ? ["api-m.paypal.com", "api.paypal.com"]
      : ["api-m.sandbox.paypal.com", "api.sandbox.paypal.com"];
    if (
      url.protocol !== "https:"
      || !allowedHosts.includes(url.hostname)
      || url.username
      || url.password
    ) return null;
    const match = url.pathname.match(/^\/v2\/payments\/captures\/([^/]+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function stripeFinancialProviderPaymentId(event: VerifiedStripeWebhookEvent) {
  const object = record(event.data.object);
  return bounded(record(object?.payment_intent)?.id) ?? bounded(object?.payment_intent);
}

export function paypalFinancialProviderPaymentId(
  event: VerifiedPaypalWebhookEvent,
  environment: "sandbox" | "live" = "sandbox",
) {
  const resource = record(event.resource);
  if (!resource) return null;
  if (event.event_type === "PAYMENT.CAPTURE.REFUNDED"
    || event.event_type === "PAYMENT.REFUND.PENDING"
    || event.event_type === "PAYMENT.REFUND.FAILED") {
    return captureIdFromRefundResource(resource, environment);
  }
  if (event.event_type === "PAYMENT.CAPTURE.REVERSED") return bounded(resource.id);
  if (event.event_type.startsWith("CUSTOMER.DISPUTE.")) {
    const disputedTransaction = record(array(resource.disputed_transactions)[0]);
    const transactionInfo = record(
      disputedTransaction?.seller_transaction_id
        ? disputedTransaction
        : disputedTransaction?.transaction_info,
    );
    return bounded(transactionInfo?.seller_transaction_id);
  }
  return null;
}

export function normalizePaypalRefundEvent(
  event: VerifiedPaypalWebhookEvent,
  environment: "sandbox" | "live" = "sandbox",
): RefundEventEvidence | null {
  if (
    event.event_type !== "PAYMENT.CAPTURE.REFUNDED"
    && event.event_type !== "PAYMENT.REFUND.PENDING"
    && event.event_type !== "PAYMENT.REFUND.FAILED"
  ) return null;
  try {
    const resource = record(event.resource);
    const evidence = paypalRefundEvidence(event.resource, environment);
    const expectedStatus = event.event_type === "PAYMENT.CAPTURE.REFUNDED"
      ? "SUCCEEDED"
      : event.event_type === "PAYMENT.REFUND.FAILED"
        ? "FAILED"
        : "PENDING";
    if (evidence.status !== expectedStatus) return null;
    return {
      provider: "PAYPAL", providerRefundId: evidence.providerRefundId,
      providerPaymentId: evidence.captureId,
      status: expectedStatus,
      amountCents: evidence.amountCents, currency: "EUR", occurredAt: eventDate(event.create_time) ?? evidence.occurredAt,
      eventId: event.id, eventType: event.event_type,
      paypalApplicationReference: {
        present: resource ? Object.prototype.hasOwnProperty.call(resource, "invoice_id") : false,
        value: evidence.applicationReference ?? null,
      },
    };
  } catch {
    return null;
  }
}

export function normalizePaypalIncidentEvent(
  event: VerifiedPaypalWebhookEvent,
  livemode = false,
): IncidentInput | null {
  const resource = record(event.resource);
  const occurredAt = eventDate(event.create_time);
  if (!resource || !occurredAt) return null;
  if (event.event_type === "PAYMENT.CAPTURE.REVERSED") {
    const captureId = bounded(resource.id);
    const amount = record(resource.amount);
    if (!captureId) return null;
    let amountCents: number | undefined;
    try { amountCents = amount?.currency_code === "EUR" ? paypalCentsFromAmount(amount.value) : undefined; } catch { amountCents = undefined; }
    return {
      provider: "PAYPAL", eventId: event.id, eventType: event.event_type,
      providerPaymentId: captureId, providerIncidentId: `reversal:${captureId}`,
      incidentType: "REVERSAL", status: "RESOLVED", outcome: "REVERSED",
      ...(amountCents ? { amountCents, currency: "EUR" } : {}), occurredAt, livemode,
    };
  }
  if (!event.event_type.startsWith("CUSTOMER.DISPUTE.")) return null;
  const providerIncidentId = bounded(resource.dispute_id) ?? bounded(resource.id);
  const transaction = record(array(resource.disputed_transactions)[0]);
  const transactionInfo = record(transaction?.seller_transaction_id ? transaction : transaction?.transaction_info);
  const providerPaymentId = bounded(transactionInfo?.seller_transaction_id);
  const amount = record(resource.dispute_amount);
  if (!providerIncidentId || !providerPaymentId) return null;
  let amountCents: number | undefined;
  try { amountCents = amount?.currency_code === "EUR" ? paypalCentsFromAmount(amount.value) : undefined; } catch { amountCents = undefined; }
  const rawStatus = resource.status;
  const status = event.event_type === "CUSTOMER.DISPUTE.RESOLVED" || rawStatus === "RESOLVED"
    ? "RESOLVED"
    : rawStatus === "UNDER_REVIEW"
      ? "UNDER_REVIEW"
      : "OPEN";
  const outcomeCode = bounded(record(resource.dispute_outcome)?.outcome_code);
  const outcome = outcomeCode === "RESOLVED_BUYER_FAVOUR"
    ? "BUYER_FAVOUR"
    : outcomeCode === "RESOLVED_SELLER_FAVOUR" || outcomeCode === "RESOLVED_WITH_PAYOUT"
      ? "SELLER_FAVOUR"
      : outcomeCode === "ACCEPTED"
        ? "ACCEPTED"
        : outcomeCode === "DENIED"
          ? "DENIED"
          : status === "RESOLVED" ? "OTHER" : undefined;
  return {
    provider: "PAYPAL", eventId: event.id, eventType: event.event_type,
    providerPaymentId, providerIncidentId,
    incidentType: resource.dispute_life_cycle_stage === "CHARGEBACK" ? "CHARGEBACK" : "DISPUTE",
    status, ...(amountCents ? { amountCents, currency: "EUR" } : {}), ...(outcome ? { outcome } : {}), occurredAt, livemode,
  };
}

export function normalizeStripeIncidentEvent(event: VerifiedStripeWebhookEvent): IncidentInput | null {
  if (!stripeIncidentEvents.has(event.type)) return null;
  const dispute = record(event.data.object);
  const providerIncidentId = bounded(dispute?.id);
  const paymentIntent = bounded(record(dispute?.payment_intent)?.id) ?? bounded(dispute?.payment_intent);
  const occurredAt = eventDate(event.created);
  if (dispute?.object !== "dispute" || !providerIncidentId || !paymentIntent || !occurredAt) return null;
  const status = event.type === "charge.dispute.closed" ? "RESOLVED" : event.type === "charge.dispute.created" ? "OPEN" : "UNDER_REVIEW";
  const outcome = status === "RESOLVED"
    ? dispute.status === "won" ? "SELLER_FAVOUR" : dispute.status === "lost" ? "BUYER_FAVOUR" : "OTHER"
    : undefined;
  const amountCents = Number.isSafeInteger(dispute.amount) && Number(dispute.amount) > 0 && dispute.currency === "eur"
    ? Number(dispute.amount) : undefined;
  return {
    provider: "STRIPE", eventId: event.id, eventType: event.type,
    providerPaymentId: paymentIntent, providerIncidentId, incidentType: "DISPUTE",
    status, ...(amountCents ? { amountCents, currency: "EUR" } : {}), ...(outcome ? { outcome } : {}), occurredAt,
    livemode: event.livemode,
  };
}

export function isStripeFinancialEvent(type: string) {
  return stripeRefundEvents.has(type) || stripeIncidentEvents.has(type);
}

export async function processVerifiedStripeFinancialEvent(event: VerifiedStripeWebhookEvent) {
  const refund = normalizeStripeRefundEvent(event);
  if (refund) return processRefundEvent({ ...refund, livemode: event.livemode });
  const incident = normalizeStripeIncidentEvent(event);
  if (incident) return processIncident(incident);
  return recordReview({
    provider: "STRIPE", eventId: event.id, type: event.type,
    providerPaymentId: stripeFinancialProviderPaymentId(event) ?? undefined,
    objectId: bounded(record(event.data.object)?.id) ?? undefined,
    occurredAt: eventDate(event.created) ?? new Date(),
    livemode: event.livemode,
  });
}

export function isPaypalFinancialEvent(type: string) {
  return paypalFinancialEvents.has(type);
}

export async function processVerifiedPaypalFinancialEvent(
  event: VerifiedPaypalWebhookEvent,
  environment: "sandbox" | "live" = "sandbox",
) {
  const livemode = environment === "live";
  const refund = normalizePaypalRefundEvent(event, environment);
  if (refund) return processRefundEvent({ ...refund, livemode });
  const incident = normalizePaypalIncidentEvent(event, livemode);
  if (incident) return processIncident(incident);
  const resource = record(event.resource);
  const captureId = paypalFinancialProviderPaymentId(event, environment);
  return recordReview({
    provider: "PAYPAL", eventId: event.id, type: event.event_type,
    providerPaymentId: captureId ?? undefined,
    objectId: bounded(resource?.id) ?? undefined,
    occurredAt: eventDate(event.create_time) ?? new Date(),
    livemode,
  });
}
