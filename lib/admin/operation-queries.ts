import type { Prisma } from "@/generated/prisma/client";

// An audited technical review excludes only an uncorrelated orphan. A payment
// or incident needing financial review remains visible even if a review exists.
export const adminPaymentReviewEventWhere = {
  outcome: "REQUIRES_REVIEW",
  OR: [
    { paymentId: null, refundAttemptId: null, incidentId: null, technicalReview: { is: null } },
    { payment: { is: { status: "REQUIRES_REVIEW" } } },
    { incident: { is: { requiresOperatorReview: true, status: { not: "RESOLVED" } } } },
  ],
} satisfies Prisma.ProviderEventWhereInput;

export const adminUncorrelatedPaymentReviewEventWhere = {
  outcome: "REQUIRES_REVIEW",
  paymentId: null,
  refundAttemptId: null,
  incidentId: null,
  technicalReview: { is: null },
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
