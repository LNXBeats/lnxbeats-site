import type { KnownOrderStatus } from "@/lib/orders/status";

export const orderCurrentViewHiddenReasons = ["TEST", "DUPLICATE", "OTHER"] as const;
export type OrderCurrentViewHiddenReason = (typeof orderCurrentViewHiddenReasons)[number];

export const orderCurrentViewHiddenReasonLabels: Readonly<Record<OrderCurrentViewHiddenReason, string>> = {
  TEST: "Test",
  DUPLICATE: "Doublon",
  OTHER: "Autre",
};

const terminalStatuses = new Set<KnownOrderStatus>(["DELIVERED", "REFUSED", "CANCELLED", "REFUNDED"]);
const blockingPaymentStatuses = new Set(["CREATED", "PENDING", "REQUIRES_REVIEW", "REFUND_PENDING"]);
const blockingRefundStatuses = new Set(["PENDING", "PROCESSING", "REQUIRES_REVIEW"]);
const settledRightsStatuses = new Set(["REJECTED", "CANCELLED", "WITHDRAWN", "ACTIVE", "TERMINATED"]);
const blockingNotificationStatuses = new Set([
  "PENDING",
  "PROCESSING",
  "FAILED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "BOUNCED",
  "COMPLAINED",
  "SUPPRESSED",
]);

export type OrderVisibilityGuardSnapshot = Readonly<{
  status: KnownOrderStatus;
  payments: readonly Readonly<{
    status: string;
    incidents: readonly unknown[];
    events: readonly unknown[];
    refundAttempts: readonly Readonly<{ status: string }>[];
  }>[];
  rightsRequests: readonly Readonly<{ status: string }>[];
  withdrawalRequests: readonly Readonly<{ status: string; refundStatus: string }>[];
  notifications: readonly Readonly<{ status: string }>[];
}>;

export type OrderVisibilityEligibility = Readonly<{
  allowed: boolean;
  code: string | null;
  reason: string | null;
}>;

function blocked(code: string, reason: string): OrderVisibilityEligibility {
  return { allowed: false, code, reason };
}

/**
 * Fail-closed presentation guard. It never infers that an order is a test from
 * its title, customer or reference: the Admin must explicitly choose a reason.
 */
export function evaluateOrderCurrentViewVisibility(
  snapshot: OrderVisibilityGuardSnapshot,
): OrderVisibilityEligibility {
  if (!terminalStatuses.has(snapshot.status)) {
    return blocked("ORDER_NOT_TERMINAL", "La commande possède encore une étape métier ouverte.");
  }
  if (snapshot.payments.some((payment) => payment.incidents.length > 0)) {
    return blocked("FINANCIAL_INCIDENT", "Un incident financier requiert encore une décision.");
  }
  if (snapshot.payments.some((payment) => payment.events.length > 0 || blockingPaymentStatuses.has(payment.status))) {
    return blocked("PAYMENT_REVIEW", "Un paiement ou remboursement doit encore être rapproché.");
  }
  if (snapshot.payments.some((payment) => payment.refundAttempts.some((attempt) => blockingRefundStatuses.has(attempt.status)))) {
    return blocked("REFUND_REVIEW", "Un remboursement est en cours ou nécessite une réconciliation.");
  }
  if (["REFUSED", "CANCELLED"].includes(snapshot.status)
    && snapshot.payments.some((payment) => ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status))) {
    return blocked("REFUND_DECISION", "Un remboursement doit encore être décidé.");
  }
  if (snapshot.status === "REFUNDED"
    && snapshot.payments.some((payment) => ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status))) {
    return blocked("REFUND_STATE_CONTRADICTION", "L’état financier remboursé doit être réconcilié.");
  }
  if (snapshot.withdrawalRequests.some((request) => !["REJECTED", "CANCELLED"].includes(request.status)
    || request.refundStatus === "REFUND_REQUIRED")) {
    return blocked("WITHDRAWAL_OPEN", "Une rétractation ou son remboursement reste ouvert.");
  }
  if (snapshot.rightsRequests.some((request) => !settledRightsStatuses.has(request.status))) {
    return blocked("RIGHTS_REVIEW", "Une décision contractuelle reste ouverte.");
  }
  if (snapshot.notifications.some((notification) => blockingNotificationStatuses.has(notification.status))) {
    return blocked("NOTIFICATION_BLOCKING", "Une notification liée à la commande reste à traiter.");
  }
  return { allowed: true, code: null, reason: null };
}

export function parseOrderCurrentViewHiddenReason(value: unknown): OrderCurrentViewHiddenReason {
  if (typeof value === "string" && orderCurrentViewHiddenReasons.includes(value as OrderCurrentViewHiddenReason)) {
    return value as OrderCurrentViewHiddenReason;
  }
  throw new Error("Motif de masquage invalide.");
}

export function normalizeOrderCurrentViewHiddenNote(value: unknown) {
  if (typeof value !== "string") return null;
  const note = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (note.length > 240) throw new Error("Le commentaire est limité à 240 caractères.");
  return note || null;
}
