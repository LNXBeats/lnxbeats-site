import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

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
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shop-refund-finalization:${attemptId}`})) IS NULL AS locked`;
    const attempt = await transaction.refundAttempt.findUnique({
      where: { id: attemptId },
      include: { payment: { select: { providerPaymentId: true } } },
    });
    if (!attempt) throw new Error("SHOP_REFUND_ATTEMPT_NOT_FOUND");
    if (attempt.status === "SUCCEEDED") return "SUCCEEDED" as const;

    const evidenceMatches = evidence.provider === attempt.provider
      && evidence.providerPaymentId === attempt.payment.providerPaymentId
      && evidence.amountCents === attempt.amountCents
      && evidence.currency === attempt.currency
      && (attempt.providerRefundId === null || attempt.providerRefundId === evidence.providerRefundId);
    const failureCode = evidenceMatches
      ? "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED"
      : "REFUND_EVIDENCE_MISMATCH";

    await transaction.refundAttempt.update({
      where: { id: attempt.id },
      data: {
        ...(evidenceMatches ? { providerRefundId: evidence.providerRefundId } : {}),
        status: "REQUIRES_REVIEW",
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
