import type { OrderVisibilityGuardSnapshot } from "@/lib/admin/order-visibility";

/** Presentation only: never authorizes a transition, refund or visibility action. */
export function getOrderDetailAttention(order: OrderVisibilityGuardSnapshot) {
  const finance = order.payments.some((payment) =>
    payment.incidents.length > 0 || payment.events.length > 0
    || ["CREATED", "PENDING", "REQUIRES_REVIEW", "REFUND_PENDING"].includes(payment.status)
    || payment.refundAttempts.some((attempt) => ["PENDING", "PROCESSING", "REQUIRES_REVIEW"].includes(attempt.status))
    || (["REFUSED", "CANCELLED", "REFUNDED"].includes(order.status)
      && ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status)));
  const withdrawal = order.withdrawalRequests.some((request) =>
    !["REJECTED", "CANCELLED"].includes(request.status) || request.refundStatus === "REFUND_REQUIRED");
  const rights = order.rightsRequests.some((request) =>
    !["REJECTED", "CANCELLED", "WITHDRAWN", "ACTIVE", "TERMINATED"].includes(request.status));
  const notifications = order.notifications.some((notification) =>
    !["SENT", "DELIVERED", "CANCELED"].includes(notification.status));
  return { finance: finance || withdrawal, withdrawal, rights, notifications };
}
