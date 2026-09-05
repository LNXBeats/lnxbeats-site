import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ShopRefundApplicationCorrelation } from "@/lib/payments/provider-refund-receipt";
import { lockShopOrderForMutation, lockShopRefundCapacity } from "@/lib/shop/order-coordination";
import { lockShopRefundAttemptForMutation } from "@/lib/shop/refund-coordination";

type Transaction = Prisma.TransactionClient;

export type ShopRefundSourceInvoice = Readonly<{
  id: string;
  paymentId: string;
  shopOrderId: string | null;
  currency: string;
  totalCents: number;
}>;

export type ShopRefundPaymentForInvoice = Readonly<{
  id: string;
  shopOrderId: string | null;
  currency: string;
  amountCents: number;
  invoice: ShopRefundSourceInvoice | null;
}>;

export function hasCompatibleShopRefundSourceInvoice(
  payment: ShopRefundPaymentForInvoice,
  shopOrderId: string,
) {
  const invoice = payment.invoice;
  return Boolean(
    invoice
    && payment.shopOrderId === shopOrderId
    && invoice.paymentId === payment.id
    && invoice.shopOrderId === shopOrderId
    && invoice.currency === payment.currency
    && invoice.totalCents === payment.amountCents,
  );
}

export type ShopRefundFinalizationEvidence = Readonly<{
  provider: "STRIPE" | "PAYPAL";
  providerRefundId: string;
  providerPaymentId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  amountCents: number;
  currency: "EUR";
  occurredAt?: Date;
  applicationCorrelation: ShopRefundApplicationCorrelation;
}>;

async function inReviewTransaction<T>(
  client: PrismaClient,
  operation: (transaction: Transaction) => Promise<T>,
) {
  let lastError: unknown;
  for (let retry = 0; retry < 3; retry += 1) {
    try {
      return await client.$transaction(operation, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== "object" || !("code" in error) || (error.code !== "P2034" && error.code !== "P2002")) {
        throw error;
      }
    }
  }
  throw lastError;
}

/**
 * Persists provider truth after the accounting transaction has rolled back.
 * The confirmed amount is intentionally untouched: a review attempt keeps its
 * capacity reserved until reconciliation finishes the local accounting.
 */
export async function persistShopRefundFinalizationReview(
  client: PrismaClient,
  attemptId: string,
  evidence: ShopRefundFinalizationEvidence,
) {
  return inReviewTransaction(client, async (transaction) => {
    const identity = await transaction.refundAttempt.findUnique({
      where: { id: attemptId },
      select: {
        shopCustomerRequestId: true,
        paymentId: true,
        payment: { select: { shopOrderId: true } },
      },
    });
    if (!identity) throw new Error("SHOP_REFUND_ATTEMPT_NOT_FOUND");

    // Customer cancellations share the same order boundary as every
    // fulfillment transition. Other refund workflows keep their existing
    // attempt-specific boundary.
    if (identity.payment.shopOrderId) {
      if (!await lockShopOrderForMutation(transaction, identity.payment.shopOrderId)) {
        throw new Error("SHOP_ORDER_NOT_FOUND");
      }
    }
    if (identity.shopCustomerRequestId) {
      await lockShopRefundCapacity(transaction, identity.paymentId);
    } else {
      await lockShopRefundAttemptForMutation(transaction, attemptId);
      await lockShopRefundCapacity(transaction, identity.paymentId);
    }

    const attempt = await transaction.refundAttempt.findUnique({
      where: { id: attemptId },
      include: { payment: { select: { providerPaymentId: true } } },
    });
    if (!attempt) throw new Error("SHOP_REFUND_ATTEMPT_NOT_FOUND");
    const providerEvidenceMatches = evidence.providerRefundId.trim().length > 0
      && evidence.providerPaymentId.trim().length > 0
      && Number.isSafeInteger(evidence.amountCents)
      && evidence.amountCents > 0
      && evidence.provider === attempt.provider
      && evidence.providerPaymentId === attempt.payment.providerPaymentId
      && evidence.amountCents === attempt.amountCents
      && evidence.currency === attempt.currency
      && (attempt.providerRefundId === null || attempt.providerRefundId === evidence.providerRefundId);
    const evidenceMatches = evidence.applicationCorrelation === "MATCH"
      && providerEvidenceMatches;
    if (
      attempt.status === "SUCCEEDED"
      && evidenceMatches
      && attempt.providerRefundId === evidence.providerRefundId
      && evidence.status !== "FAILED"
    ) return "SUCCEEDED" as const;
    if (
      attempt.status === "FAILED"
      && evidenceMatches
      && evidence.status === "FAILED"
    ) {
      if (!attempt.providerRefundId) await transaction.refundAttempt.update({
        where: { id: attempt.id },
        data: { providerRefundId: evidence.providerRefundId },
      });
      return "FAILED" as const;
    }

    const terminalConflict = attempt.status === "SUCCEEDED" || attempt.status === "FAILED";
    const failureCode = !providerEvidenceMatches
      ? "REFUND_EVIDENCE_MISMATCH"
      : evidence.applicationCorrelation !== "MATCH"
        ? "REFUND_APPLICATION_CORRELATION_REQUIRED"
        : terminalConflict
          ? "REFUND_STATUS_CONFLICT"
          : evidence.status === "FAILED"
            ? "PROVIDER_FAILED_LOCAL_FINALIZATION_FAILED"
            : "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED";

    await transaction.refundAttempt.update({
      where: { id: attempt.id },
      data: {
        ...(providerEvidenceMatches ? {
          providerRefundId: evidence.providerRefundId,
          ...(evidence.status === "SUCCEEDED" && evidence.occurredAt
            ? { confirmedAt: evidence.occurredAt }
            : {}),
        } : {}),
        ...(attempt.status === "SUCCEEDED" ? {} : { status: "REQUIRES_REVIEW" as const }),
        failureCode,
      },
    });
    await transaction.payment.update({
      where: { id: attempt.paymentId },
      data: { status: "REFUND_PENDING" },
    });
    const auditExists = await transaction.paymentAuditEvent.findFirst({
      where: { refundAttemptId: attempt.id, action: "REFUND_RECONCILIATION_REQUIRED" },
      select: { id: true },
    });
    if (!auditExists) {
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
    if (attempt.shopReturnRequestId) {
      await transaction.shopReturnRequest.update({
        where: { id: attempt.shopReturnRequestId },
        data: { refundStatus: "REQUIRES_REVIEW" },
      });
      await transaction.shopReturnAuditEvent.upsert({
        where: { idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-review:local-finalization:v1` },
        update: {},
        create: {
          shopReturnRequestId: attempt.shopReturnRequestId,
          action: "REFUND_REQUIRES_REVIEW",
          idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-review:local-finalization:v1`,
        },
      });
    }
    return "REQUIRES_REVIEW" as const;
  });
}
