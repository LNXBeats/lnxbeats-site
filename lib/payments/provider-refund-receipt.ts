import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

type Transaction = Prisma.TransactionClient;

export type ShopRefundApplicationCorrelation = "MATCH" | "MISSING" | "MISMATCH";

type DeferredShopRefundIdentity = Readonly<{
  provider: "STRIPE" | "PAYPAL";
  paymentId: string;
  refundAttemptId: string;
  providerRefundId: string;
  amountCents: number;
  currency: string;
}>;

type DeferredReceipt = Readonly<{
  id: string;
  providerEventId: string;
  providerRefundId: string;
  amountCents: number;
  currency: string;
  providerStatus: "PENDING" | "SUCCEEDED" | "FAILED";
}>;

export function deferredShopRefundLifecycleKey(
  paymentId: string,
  provider: "STRIPE" | "PAYPAL",
  providerEventId: string,
) {
  return `shop-refund-deferred:${createHash("sha256")
    .update(`${paymentId}:${provider}:${providerEventId}`)
    .digest("hex")}`;
}

async function unresolvedDeferredReceipts(
  transaction: Transaction,
  input: DeferredShopRefundIdentity,
): Promise<DeferredReceipt[]> {
  const candidates = await transaction.providerEvent.findMany({
    where: {
      provider: input.provider,
      paymentId: input.paymentId,
      refundAttemptId: input.refundAttemptId,
      outcome: "REQUIRES_REVIEW",
      incidentId: null,
    },
    select: { id: true, providerEventId: true, objectId: true },
  });
  const deferred: DeferredReceipt[] = [];
  for (const candidate of candidates) {
    const marker = await transaction.shopOrderLifecycleEvent.findUnique({
      where: {
        idempotencyKey: deferredShopRefundLifecycleKey(
          input.paymentId,
          input.provider,
          candidate.providerEventId,
        ),
      },
      select: { metadata: true },
    });
    const metadata = marker?.metadata !== null
      && typeof marker?.metadata === "object"
      && !Array.isArray(marker.metadata)
      ? marker.metadata as Record<string, unknown>
      : null;
    const providerStatus = metadata?.providerStatus;
    if (
      metadata?.category !== "DEFERRED_PROVIDER_REFUND_CORRELATION"
      || metadata.refundAttemptId !== input.refundAttemptId
      || metadata.provider !== input.provider
      || metadata.providerEventId !== candidate.providerEventId
      || typeof metadata.providerRefundId !== "string"
      || metadata.providerRefundId !== candidate.objectId
      || typeof metadata.amountCents !== "number"
      || typeof metadata.currency !== "string"
      || !["PENDING", "SUCCEEDED", "FAILED"].includes(String(providerStatus))
    ) continue;
    deferred.push({
      ...candidate,
      providerRefundId: metadata.providerRefundId,
      amountCents: metadata.amountCents,
      currency: metadata.currency,
      providerStatus: providerStatus as DeferredReceipt["providerStatus"],
    });
  }
  return deferred;
}

export async function hasUnresolvedDeferredShopRefundProviderEvent(
  transaction: Transaction,
  input: DeferredShopRefundIdentity,
) {
  return (await unresolvedDeferredReceipts(transaction, input)).length > 0;
}

/**
 * A signed webhook can arrive before the provider API response exposes its
 * refund id. If the webhook lacked the application correlation reference, it
 * is retained as a linked review receipt without poisoning the whole Shop
 * order. Once API/retrieve evidence proves that exact provider refund id, this
 * closes only that precise receipt; the normal payment audit records the proof.
 */
export function resolveDeferredShopRefundProviderEvents(
  transaction: Transaction,
  input: Readonly<{
    provider: "STRIPE" | "PAYPAL";
    paymentId: string;
    refundAttemptId: string;
    providerRefundId: string;
    status: "PENDING" | "SUCCEEDED" | "FAILED";
    amountCents: number;
    currency: string;
  }>,
) {
  return resolveDeferredShopRefundProviderEventsInTransaction(transaction, input);
}

async function resolveDeferredShopRefundProviderEventsInTransaction(
  transaction: Transaction,
  input: DeferredShopRefundIdentity & Readonly<{ status: "PENDING" | "SUCCEEDED" | "FAILED" }>,
) {
  const candidates = await unresolvedDeferredReceipts(transaction, input);
  const identityConflicts = candidates.filter((candidate) =>
    candidate.providerRefundId !== input.providerRefundId
    || candidate.amountCents !== input.amountCents
    || candidate.currency !== input.currency);
  const matching = candidates.filter((candidate) =>
    candidate.providerRefundId === input.providerRefundId
    && candidate.amountCents === input.amountCents
    && candidate.currency === input.currency);
  let resolved = 0;
  let requiresReview = false;
  for (const candidate of matching) {
    // A trusted API/retrieve PENDING binding is sufficient to close only the
    // exact matching deferred PENDING receipt. It must not erase a terminal
    // signed receipt. Terminal evidence may advance PENDING, while conflicting
    // terminal truths remain under durable review.
    const compatibleStatus = input.status === "PENDING"
      ? candidate.providerStatus === "PENDING"
      : input.status === "SUCCEEDED"
        ? candidate.providerStatus === "PENDING" || candidate.providerStatus === "SUCCEEDED"
        : candidate.providerStatus === "PENDING" || candidate.providerStatus === "FAILED";
    if (!compatibleStatus) {
      requiresReview = true;
      continue;
    }
    const updated = await transaction.providerEvent.updateMany({
      where: { id: candidate.id, outcome: "REQUIRES_REVIEW" },
      data: { outcome: "PROCESSED" },
    });
    resolved += updated.count;
  }
  if (resolved > 0) {
    const audited = await transaction.paymentAuditEvent.findFirst({
      where: {
        refundAttemptId: input.refundAttemptId,
        action: "RECONCILIATION_CHECKED",
        result: "SUCCEEDED",
      },
      select: { id: true },
    });
    if (!audited) await transaction.paymentAuditEvent.create({
      data: {
        paymentId: input.paymentId,
        refundAttemptId: input.refundAttemptId,
        provider: input.provider,
        action: "RECONCILIATION_CHECKED",
        amountCents: input.amountCents,
        result: "SUCCEEDED",
      },
    });
  }
  return {
    count: resolved,
    requiresReview: requiresReview || identityConflicts.length > 0,
    unresolvedCount: candidates.length - resolved,
  };
}
