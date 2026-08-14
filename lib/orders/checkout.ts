import type { SerializedOrder } from "@/lib/orders/types";

const confirmedOrderStatuses = new Set<SerializedOrder["status"]>([
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

export type ClientPaymentState = "draft" | "ready" | "confirming" | "confirmed" | "failed" | "expired" | "review" | "cancelled";

export function clientPaymentState(order: Pick<SerializedOrder, "status" | "payments">): ClientPaymentState {
  if (confirmedOrderStatuses.has(order.status)) return "confirmed";
  if (order.status === "CANCELLED") return "cancelled";
  if (order.status === "DRAFT") return "draft";
  const payment = order.payments[0];
  if (!payment) return "ready";
  if (["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)) return "confirmed";
  if (payment.status === "REQUIRES_REVIEW") return "review";
  if (payment.status === "FAILED") return "failed";
  if (payment.status === "EXPIRED" || payment.status === "CANCELED") return "expired";
  return "confirming";
}

export function clientOrderAction(order: Pick<SerializedOrder, "status" | "payments">) {
  const state = clientPaymentState(order);
  if (state === "draft") return "Compléter le brief";
  if (state === "ready") return "Payer la commande";
  if (state === "confirming") return "Attendre la confirmation";
  if (state === "failed") return "Réessayer le paiement";
  if (state === "expired") return "Relancer le paiement";
  if (state === "review") return "Attendre la vérification";
  if (state === "cancelled") return "Aucune action attendue";
  if (order.status === "DELIVERED") return "Télécharger ma création";
  if (order.status === "FIRST_VERSION_READY") return "Consulter la proposition";
  return "Suivre la création";
}

export function clientPaymentPresentation(order: Pick<SerializedOrder, "status" | "payments">) {
  const state = clientPaymentState(order);
  if (state === "draft") return "Paiement non commencé";
  if (state === "ready") return "Prêt à payer";
  if (state === "confirming") return "Confirmation en cours";
  if (state === "confirmed") return "Paiement confirmé";
  if (state === "failed") return "Paiement refusé — nouvelle tentative possible";
  if (state === "expired") return "Session expirée — nouvelle tentative possible";
  if (state === "review") return "Paiement en cours de vérification";
  return "Commande annulée";
}

export function orderCanStillBeEdited(order: Pick<SerializedOrder, "status" | "payments">) {
  if (order.status === "DRAFT") return true;
  if (order.status !== "AWAITING_PAYMENT") return false;
  return order.payments.every((payment) => ["EXPIRED", "CANCELED"].includes(payment.status));
}
