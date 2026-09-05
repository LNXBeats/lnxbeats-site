import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { issueCreditNoteForRefund } from "@/lib/billing/service";
import {
  resolveDeferredShopRefundProviderEvents,
  type ShopRefundApplicationCorrelation,
} from "@/lib/payments/provider-refund-receipt";
import { enqueueShopCustomerRequestNotification } from "@/lib/notifications/service";
import {
  findShopReturnDispositionBarrier,
  findUnresolvedShopShippingIntent,
  hasValidShopCancellationInventoryReservations,
  lockShopOrderForMutation,
  lockShopProductStockForMutation,
  lockShopRefundCapacity,
} from "@/lib/shop/order-coordination";
import { hasCompatibleShopRefundSourceInvoice } from "@/lib/shop/refund-accounting-safety";

type Transaction = Prisma.TransactionClient;

const recoverableCancellationReviewForSuccess = new Set([
  "AMBIGUOUS_PROVIDER_ACCEPTANCE",
  "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED",
  "PROVIDER_EVENT_CORRELATION_DEFERRED",
  "REFUND_APPLICATION_CORRELATION_REQUIRED",
]);
const recoverableCancellationReviewForFailure = new Set([
  "AMBIGUOUS_PROVIDER_ACCEPTANCE",
  "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED",
  "PROVIDER_FAILED_LOCAL_FINALIZATION_FAILED",
  "PROVIDER_EVENT_CORRELATION_DEFERRED",
  "REFUND_APPLICATION_CORRELATION_REQUIRED",
]);

export type ShopCustomerCancellationEvidence = Readonly<{
  provider: "STRIPE" | "PAYPAL";
  providerRefundId: string;
  providerPaymentId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  amountCents: number;
  currency: "EUR";
  occurredAt: Date;
  applicationCorrelation: ShopRefundApplicationCorrelation;
}>;

export type ShopCustomerCancellationFinalizationStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "REQUIRES_REVIEW";

export class ShopCustomerCancellationFinalizationError extends Error {
  constructor(
    readonly code: "ATTEMPT_NOT_FOUND" | "ATTEMPT_NOT_CANCELLATION" | "ORDER_NOT_FOUND",
  ) {
    super(code);
    this.name = "ShopCustomerCancellationFinalizationError";
  }
}

async function inTransaction<T>(
  client: PrismaClient,
  operation: (transaction: Transaction) => Promise<T>,
) {
  let lastError: unknown;
  for (let retry = 0; retry < 3; retry += 1) {
    try {
      return await client.$transaction(operation, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code !== "P2034" && code !== "P2002") throw error;
    }
  }
  throw lastError;
}

async function reconciliationAudit(
  transaction: Transaction,
  attempt: Readonly<{ id: string; paymentId: string; provider: "STRIPE" | "PAYPAL"; amountCents: number }>,
) {
  const existing = await transaction.paymentAuditEvent.findFirst({
    where: {
      refundAttemptId: attempt.id,
      action: "REFUND_RECONCILIATION_REQUIRED",
    },
    select: { id: true },
  });
  if (!existing) {
    await transaction.paymentAuditEvent.create({
      data: {
        paymentId: attempt.paymentId,
        refundAttemptId: attempt.id,
        provider: attempt.provider,
        action: "REFUND_RECONCILIATION_REQUIRED",
        amountCents: attempt.amountCents,
        result: "REQUIRES_REVIEW",
      },
    });
  }
}

async function requireReview(
  transaction: Transaction,
  attempt: Readonly<{
    id: string;
    paymentId: string;
    provider: "STRIPE" | "PAYPAL";
    amountCents: number;
    status: string;
    providerRefundId: string | null;
    confirmedAt: Date | null;
    failureCode: string | null;
  }>,
  failureCode: string,
  evidence?: ShopCustomerCancellationEvidence,
): Promise<"REQUIRES_REVIEW"> {
  if (attempt.status === "SUCCEEDED") {
    // Preserve confirmed provider truth while making incomplete local effects
    // durably visible. A succeeded financial attempt must never be regressed.
    await transaction.refundAttempt.update({
      where: { id: attempt.id },
      data: { failureCode },
    });
    await reconciliationAudit(transaction, attempt);
  } else {
    const nonRecoverableReviewCode = attempt.status === "REQUIRES_REVIEW"
      && attempt.failureCode !== null
      && !recoverableCancellationReviewForFailure.has(attempt.failureCode)
      && !recoverableCancellationReviewForSuccess.has(attempt.failureCode);
    const durableFailureCode = nonRecoverableReviewCode
      ? attempt.failureCode!
      : attempt.confirmedAt
      && (
        attempt.failureCode === "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED"
        || attempt.failureCode === "PROVIDER_EVENT_CORRELATION_DEFERRED"
      )
      ? attempt.failureCode
      : failureCode;
    await transaction.refundAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "REQUIRES_REVIEW",
        failureCode: durableFailureCode,
        ...(
          evidence
          && evidence.providerRefundId
          && (attempt.providerRefundId === null || attempt.providerRefundId === evidence.providerRefundId)
            ? {
                providerRefundId: evidence.providerRefundId,
                ...(evidence.status === "SUCCEEDED" ? { confirmedAt: evidence.occurredAt } : {}),
              }
            : {}
        ),
      },
    });
    await transaction.payment.update({
      where: { id: attempt.paymentId },
      data: { status: "REFUND_PENDING" },
    });
    await reconciliationAudit(transaction, attempt);
  }
  return "REQUIRES_REVIEW";
}

async function paymentAudit(
  transaction: Transaction,
  attempt: Readonly<{ id: string; paymentId: string; provider: "STRIPE" | "PAYPAL"; amountCents: number }>,
  action: "REFUND_PROVIDER_ACCEPTED" | "REFUND_CONFIRMED" | "REFUND_FAILED",
  result: "PENDING" | "SUCCEEDED" | "FAILED",
) {
  const existing = await transaction.paymentAuditEvent.findFirst({
    where: { refundAttemptId: attempt.id, action },
    select: { id: true },
  });
  if (!existing) {
    await transaction.paymentAuditEvent.create({
      data: {
        paymentId: attempt.paymentId,
        refundAttemptId: attempt.id,
        provider: attempt.provider,
        action,
        amountCents: attempt.amountCents,
        result,
      },
    });
  }
}

/**
 * Common API/retrieve/webhook finalizer. The caller supplies a transaction;
 * the function always acquires the shared ShopOrder lock and re-reads every
 * mutable fact before applying provider evidence.
 */
export async function applyShopCustomerCancellationEvidenceInTransaction(
  transaction: Transaction,
  attemptId: string,
  evidence: ShopCustomerCancellationEvidence,
): Promise<ShopCustomerCancellationFinalizationStatus> {
  const identity = await transaction.refundAttempt.findUnique({
    where: { id: attemptId },
    select: {
      paymentId: true,
      shopCustomerRequestId: true,
      payment: { select: { shopOrderId: true } },
      shopCustomerRequest: { select: { shopOrderId: true, type: true } },
    },
  });
  if (!identity) throw new ShopCustomerCancellationFinalizationError("ATTEMPT_NOT_FOUND");
  if (
    !identity.shopCustomerRequestId
    || identity.shopCustomerRequest?.type !== "PAID_ORDER_CANCELLATION"
    || !identity.payment.shopOrderId
    || identity.payment.shopOrderId !== identity.shopCustomerRequest.shopOrderId
  ) throw new ShopCustomerCancellationFinalizationError("ATTEMPT_NOT_CANCELLATION");

  const shopOrderId = identity.payment.shopOrderId;
  if (!await lockShopOrderForMutation(transaction, shopOrderId)) {
    throw new ShopCustomerCancellationFinalizationError("ORDER_NOT_FOUND");
  }
  await lockShopRefundCapacity(transaction, identity.paymentId);

  const attempt = await transaction.refundAttempt.findUnique({
    where: { id: attemptId },
    include: {
      payment: { include: { invoice: true } },
      shopCustomerRequest: {
        include: {
          shopOrder: {
            include: {
              items: { include: { reservation: true } },
            },
          },
        },
      },
    },
  });
  if (!attempt) throw new ShopCustomerCancellationFinalizationError("ATTEMPT_NOT_FOUND");
  const request = attempt.shopCustomerRequest;
  if (
    !request
    || request.type !== "PAID_ORDER_CANCELLATION"
    || request.shopOrderId !== shopOrderId
    || attempt.payment.shopOrderId !== shopOrderId
  ) throw new ShopCustomerCancellationFinalizationError("ATTEMPT_NOT_CANCELLATION");

  const providerEvidenceMatches = evidence.providerRefundId.trim().length > 0
    && evidence.providerPaymentId.trim().length > 0
    && Number.isSafeInteger(evidence.amountCents)
    && evidence.amountCents > 0
    && !Number.isNaN(evidence.occurredAt.getTime())
    && evidence.provider === attempt.provider
    && evidence.providerPaymentId === attempt.payment.providerPaymentId
    && evidence.amountCents === attempt.amountCents
    && evidence.currency === attempt.currency
    && (attempt.providerRefundId === null || attempt.providerRefundId === evidence.providerRefundId);
  const evidenceMatches = evidence.applicationCorrelation === "MATCH"
    && providerEvidenceMatches;
  if (!evidenceMatches) {
    return requireReview(
      transaction,
      attempt,
      providerEvidenceMatches
        ? "REFUND_APPLICATION_CORRELATION_REQUIRED"
        : "REFUND_EVIDENCE_MISMATCH",
      providerEvidenceMatches ? evidence : undefined,
    );
  }

  const deferredResolution = await resolveDeferredShopRefundProviderEvents(transaction, {
    provider: attempt.provider,
    paymentId: attempt.paymentId,
    refundAttemptId: attempt.id,
    providerRefundId: evidence.providerRefundId,
    status: evidence.status,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
  });
  if (deferredResolution.requiresReview) {
    return requireReview(transaction, attempt, "REFUND_STATUS_CONFLICT", evidence);
  }

  const alreadyCompleted = attempt.status === "SUCCEEDED"
    && request.status === "COMPLETED"
    && request.shopOrder.status === "CANCELLED"
    && request.shopOrder.paymentStatus === "CANCELLED"
    && request.shopOrder.fulfillmentStatus === "CANCELLED";
  if (alreadyCompleted) {
    return evidence.status === "FAILED"
      ? requireReview(transaction, attempt, "REFUND_STATUS_CONFLICT", evidence)
      : "SUCCEEDED";
  }

  if (attempt.status === "SUCCEEDED") {
    return requireReview(transaction, attempt, "SUCCEEDED_REFUND_NOT_FINALIZED", evidence);
  }

  if (evidence.status === "PENDING") {
    if (attempt.status === "FAILED" || attempt.confirmedAt) {
      return requireReview(transaction, attempt, "REFUND_STATUS_CONFLICT", evidence);
    }
    if (attempt.status === "REQUIRES_REVIEW") {
      if (
        (attempt.failureCode === "PROVIDER_EVENT_CORRELATION_DEFERRED"
          || attempt.failureCode === "REFUND_APPLICATION_CORRELATION_REQUIRED")
        && !attempt.confirmedAt
      ) {
        await transaction.refundAttempt.update({
          where: { id: attempt.id },
          data: {
            providerRefundId: evidence.providerRefundId,
            status: "PENDING",
            failureCode: null,
          },
        });
        await transaction.payment.update({
          where: { id: attempt.paymentId },
          data: { status: "REFUND_PENDING" },
        });
        await paymentAudit(transaction, attempt, "REFUND_PROVIDER_ACCEPTED", "PENDING");
        return "PENDING";
      }
      if (!attempt.providerRefundId) {
        await transaction.refundAttempt.update({
          where: { id: attempt.id },
          data: { providerRefundId: evidence.providerRefundId },
        });
      }
      return "REQUIRES_REVIEW";
    }
    if (attempt.status !== "PENDING" || attempt.providerRefundId === null) {
      await transaction.refundAttempt.update({
        where: { id: attempt.id },
        data: {
          providerRefundId: evidence.providerRefundId,
          status: "PENDING",
          failureCode: null,
        },
      });
      await transaction.payment.update({
        where: { id: attempt.paymentId },
        data: { status: "REFUND_PENDING" },
      });
      await paymentAudit(transaction, attempt, "REFUND_PROVIDER_ACCEPTED", "PENDING");
    }
    return "PENDING";
  }

  if (evidence.status === "FAILED") {
    if (attempt.confirmedAt) {
      return requireReview(transaction, attempt, "REFUND_STATUS_CONFLICT", evidence);
    }
    if (
      attempt.status === "REQUIRES_REVIEW"
      && !recoverableCancellationReviewForFailure.has(attempt.failureCode ?? "")
    ) {
      return requireReview(transaction, attempt, "REFUND_STATUS_CONFLICT", evidence);
    }
    if (attempt.status !== "FAILED" || attempt.providerRefundId === null) {
      await transaction.refundAttempt.update({
        where: { id: attempt.id },
        data: {
          providerRefundId: evidence.providerRefundId,
          status: "FAILED",
          failureCode: "PROVIDER_REFUND_FAILED",
          confirmedAt: null,
        },
      });
      await transaction.payment.update({
        where: { id: attempt.paymentId },
        data: { status: "SUCCEEDED" },
      });
      await paymentAudit(transaction, attempt, "REFUND_FAILED", "FAILED");
    }
    return "FAILED";
  }

  if (attempt.status === "FAILED") {
    return requireReview(transaction, attempt, "REFUND_STATUS_CONFLICT", evidence);
  }
  if (
    attempt.status === "REQUIRES_REVIEW"
    && !recoverableCancellationReviewForSuccess.has(attempt.failureCode ?? "")
  ) {
    return requireReview(transaction, attempt, "REFUND_STATUS_CONFLICT", evidence);
  }

  const order = request.shopOrder;
  if (await findShopReturnDispositionBarrier(transaction, order.id)) {
    return requireReview(
      transaction,
      attempt,
      "SHOP_CANCELLATION_RETURN_DISPOSITION_CONFLICT_AFTER_REFUND",
      evidence,
    );
  }
  if (!hasValidShopCancellationInventoryReservations(order.items)) {
    return requireReview(
      transaction,
      attempt,
      "SHOP_CANCELLATION_INVENTORY_RESERVATION_INVALID_AFTER_REFUND",
      evidence,
    );
  }
  const shippingIntent = await findUnresolvedShopShippingIntent(transaction, order.id);
  const fulfillmentContradiction = order.status !== "OPEN"
    || order.paymentStatus !== "PAID"
    || order.paymentReviewAt !== null
    || order.fulfillmentStatus === "SHIPPED"
    || order.shippedAt !== null
    || order.trackingRevision !== 0
    || order.shippingCarrier !== null
    || order.trackingNumber !== null
    || order.trackingUrl !== null
    || order.trackingSource !== null
    || order.trackingRecordedAt !== null
    || shippingIntent !== null;
  if (fulfillmentContradiction) {
    return requireReview(
      transaction,
      attempt,
      "SHOP_CANCELLATION_FULFILLMENT_CONFLICT_AFTER_REFUND",
      evidence,
    );
  }
  if (
    request.status !== "APPROVED"
    || attempt.payment.status !== "REFUND_PENDING"
    || attempt.payment.currency !== "EUR"
    || attempt.payment.refundedAmountCents !== 0
    || attempt.amountCents !== attempt.payment.amountCents
    || attempt.amountCents !== order.totalCents
    || !hasCompatibleShopRefundSourceInvoice(attempt.payment, order.id)
  ) {
    return requireReview(transaction, attempt, "SHOP_CANCELLATION_FINALIZATION_PRECONDITION_FAILED", evidence);
  }

  const restockableItems = order.items
    .filter((item) => item.inventoryTracked)
    .sort((left, right) => left.productId.localeCompare(right.productId));
  for (const item of restockableItems) {
    await lockShopProductStockForMutation(transaction, item.productId);
  }

  await transaction.refundAttempt.update({
    where: { id: attempt.id },
    data: {
      providerRefundId: evidence.providerRefundId,
      status: "SUCCEEDED",
      failureCode: null,
      confirmedAt: evidence.occurredAt,
    },
  });
  await transaction.payment.update({
    where: { id: attempt.paymentId },
    data: {
      status: "REFUNDED",
      refundedAmountCents: attempt.amountCents,
      refundedAt: evidence.occurredAt,
    },
  });
  await paymentAudit(transaction, attempt, "REFUND_CONFIRMED", "SUCCEEDED");

  for (const item of restockableItems) {
    const key = `shop-customer-request:${request.id}:product:${item.productId}:restock:v1`;
    if (await transaction.productStockAdjustment.findUnique({ where: { idempotencyKey: key } })) continue;
    const product = await transaction.product.findUnique({
      where: { id: item.productId },
      select: { stock: true, trackInventory: true },
    });
    if (!product?.trackInventory || product.stock === null) {
      throw new Error("SHOP_CANCELLATION_RESTOCK_PRECONDITION_FAILED");
    }
    // The shared product lock serializes Shop restocks; the atomic increment
    // and returned row remain the authoritative snapshot for the audit row.
    const updatedProduct = await transaction.product.update({
      where: { id: item.productId },
      data: { stock: { increment: item.quantity }, lockVersion: { increment: 1 } },
      select: { stock: true },
    });
    if (updatedProduct.stock === null) throw new Error("SHOP_CANCELLATION_RESTOCK_PRECONDITION_FAILED");
    const stockAfter = updatedProduct.stock;
    await transaction.productStockAdjustment.create({
      data: {
        productId: item.productId,
        delta: item.quantity,
        stockBefore: stockAfter - item.quantity,
        stockAfter,
        reason: `Annulation client avant expédition ${request.requestNumber}`,
        actorAdminId: request.decidedByUserId,
        shopCustomerRequestId: request.id,
        idempotencyKey: key,
      },
    });
  }

  await transaction.shopOrder.update({
    where: { id: order.id },
    data: {
      status: "CANCELLED",
      paymentStatus: "CANCELLED",
      fulfillmentStatus: "CANCELLED",
      cancelledAt: evidence.occurredAt,
      preparingAt: null,
      readyToShipAt: null,
      shippedAt: null,
      shippingCarrier: null,
      trackingNumber: null,
      trackingUrl: null,
      trackingSource: null,
      trackingRecordedAt: null,
      trackingRevision: 0,
    },
  });
  await transaction.shopOrderEvent.create({
    data: {
      shopOrderId: order.id,
      actorUserId: request.decidedByUserId,
      type: "SHOP_ORDER_CANCELLED",
      metadata: {
        source: "CUSTOMER_REQUEST",
        requestNumber: request.requestNumber,
        refundAttemptId: attempt.id,
      },
      occurredAt: evidence.occurredAt,
    },
  });
  await issueCreditNoteForRefund(transaction, {
    refundAttemptId: attempt.id,
    reasonCode: "WITHDRAWAL",
    reasonText: `Annulation demandée par le client avant expédition — ${request.requestNumber}`,
  });
  await transaction.shopOrderCustomerRequest.update({
    where: { id: request.id },
    data: { status: "COMPLETED", completedAt: evidence.occurredAt },
  });
  await enqueueShopCustomerRequestNotification(transaction, {
    shopOrderId: order.id,
    requestId: request.id,
    requestNumber: request.requestNumber,
    kind: "CUSTOMER_SHOP_CANCELLATION_APPROVED",
  });
  return "SUCCEEDED";
}

export function applyShopCustomerCancellationEvidence(
  client: PrismaClient,
  attemptId: string,
  evidence: ShopCustomerCancellationEvidence,
) {
  return inTransaction(client, (transaction) =>
    applyShopCustomerCancellationEvidenceInTransaction(transaction, attemptId, evidence));
}
