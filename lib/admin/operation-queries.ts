import type { Prisma } from "@/generated/prisma/client";

// `outcome` is the only durable resolution marker for a receipt that could not
// be correlated to any local financial record. Keep such receipts visible while
// they remain REQUIRES_REVIEW; reconciliation can remove them from this view by
// explicitly advancing the outcome to PROCESSED or IGNORED.
export const adminPaymentReviewEventWhere = {
  outcome: "REQUIRES_REVIEW",
  OR: [
    { paymentId: null, refundAttemptId: null, incidentId: null },
    { payment: { is: { status: "REQUIRES_REVIEW" } } },
    { incident: { is: { requiresOperatorReview: true, status: { not: "RESOLVED" } } } },
  ],
} satisfies Prisma.ProviderEventWhereInput;

export const adminUncorrelatedPaymentReviewEventWhere = {
  outcome: "REQUIRES_REVIEW",
  paymentId: null,
  refundAttemptId: null,
  incidentId: null,
} satisfies Prisma.ProviderEventWhereInput;

export function adminNotificationAttentionWhere(now: Date): Prisma.OrderNotificationWhereInput {
  return {
    OR: [
      { status: "FAILED_RETRYABLE", attempts: { lt: 5 } },
      { status: { in: ["FAILED_FINAL", "BOUNCED", "COMPLAINED", "SUPPRESSED"] } },
      {
        status: "PROCESSING",
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
    ],
  };
}
