import type { PaymentMethod, PaymentStatus } from "@/lib/payments/types";

export const paymentStatusPresentation: Record<PaymentStatus, string> = {
  CREATED: "Paiement en préparation",
  PENDING: "Paiement en attente de confirmation",
  SUCCEEDED: "Paiement confirmé",
  FAILED: "Paiement échoué",
  CANCELED: "Paiement annulé",
  EXPIRED: "Session de paiement expirée",
  REFUND_PENDING: "Remboursement en cours",
  PARTIALLY_REFUNDED: "Paiement partiellement remboursé",
  REFUNDED: "Paiement remboursé",
  REQUIRES_REVIEW: "Paiement à vérifier",
};

export const paymentMethodPresentation: Record<PaymentMethod, string> = {
  CARD: "Carte",
  PAYPAL: "PayPal",
  WERO: "Wero",
  OTHER: "Autre moyen",
};
