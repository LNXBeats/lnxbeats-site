export function formatShopMoney(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function effectiveShopOrderStatus(
  order: Readonly<{
    status: "OPEN" | "EXPIRED" | "CANCELLED";
    paymentStatus: "AWAITING_PAYMENT" | "PAID" | "CANCELLED";
    reservationExpiresAt: Date;
  }>,
  now = new Date(),
) {
  if (
    order.status === "OPEN"
    && order.paymentStatus === "AWAITING_PAYMENT"
    && order.reservationExpiresAt.getTime() <= now.getTime()
  ) return "EXPIRED" as const;
  return order.status;
}

export function shopReservationIsActive(
  reservationExpiresAt: Date,
  now = new Date(),
) {
  return reservationExpiresAt.getTime() > now.getTime();
}

export function shopOrderPaymentState(order: Readonly<{
  paymentStatus: "AWAITING_PAYMENT" | "PAID" | "CANCELLED";
  paymentReviewAt: Date | null;
  payments: readonly Readonly<{ status: string }>[];
}>) {
  if (order.paymentReviewAt) return "review" as const;
  if (order.paymentStatus === "PAID") return "confirmed" as const;
  if (order.payments.some(({ status }) => status === "REQUIRES_REVIEW")) return "review" as const;
  if (order.payments.some(({ status }) => status === "PENDING" || status === "CREATED")) return "confirming" as const;
  if (order.payments.some(({ status }) => status === "FAILED")) return "failed" as const;
  if (order.payments.some(({ status }) => status === "EXPIRED")) return "expired" as const;
  return "ready" as const;
}

export function canResumeShopPaypalCapture(
  payments: readonly Readonly<{
    provider: string;
    providerCheckoutId: string | null;
    status: string;
  }>[],
  providerOrderId: string | undefined,
) {
  return Boolean(
    providerOrderId
    && /^[A-Za-z0-9_-]{6,255}$/.test(providerOrderId)
    && payments.some((payment) => payment.provider === "PAYPAL"
      && payment.providerCheckoutId === providerOrderId
      && (payment.status === "CREATED" || payment.status === "PENDING")),
  );
}

const SHOP_PAYMENT_STATUS_LABELS: Readonly<Record<string, string>> = {
  CREATED: "Créée",
  PENDING: "En cours",
  SUCCEEDED: "Confirmée",
  FAILED: "Échouée",
  EXPIRED: "Expirée",
  CANCELED: "Annulée",
  REFUND_PENDING: "Remboursement en cours",
  PARTIALLY_REFUNDED: "Partiellement remboursée",
  REFUNDED: "Remboursée",
  REQUIRES_REVIEW: "À vérifier",
};

const SHOP_PAYMENT_INCIDENT_LABELS: Readonly<Record<string, string>> = {
  SHOP_PAYMENT_EVIDENCE_MISMATCH: "Preuve financière incohérente — vérification requise",
  SHOP_PAYMENT_ALREADY_CAPTURED: "Second encaissement détecté — vérification requise",
  SHOP_RESERVATION_EXPIRED_AFTER_CAPTURE: "Paiement reçu après expiration de la réservation",
  SHOP_STOCK_UNAVAILABLE_AFTER_CAPTURE: "Stock indisponible après encaissement",
  SHOP_PAYMENT_TERMINAL_CAPTURE: "Paiement reçu sur une tentative clôturée",
  SHOP_TERMS_SNAPSHOT_MISSING_AFTER_CAPTURE: "Conditions de vente non snapshotées — vérification requise",
  SHOP_PROVIDER_FINANCIAL_EVENT_REVIEW: "Événement financier fournisseur — vérification requise",
  SHOP_ORDER_PAID_BY_OTHER_PROVIDER: "Commande réglée avec un autre moyen de paiement",
  STRIPE_SHOP_PAYMENT_FAILED: "Paiement Stripe refusé",
  STRIPE_SHOP_PAYMENT_INTENT_FAILED: "Paiement Stripe refusé",
  STRIPE_SHOP_CHECKOUT_EXPIRED: "Session Stripe expirée",
  PAYPAL_SHOP_CAPTURE_DECLINED: "Paiement PayPal refusé",
};

export function shopPaymentIncidentLabel(code: string | null) {
  return code
    ? SHOP_PAYMENT_INCIDENT_LABELS[code] ?? "Anomalie financière à examiner"
    : null;
}

export function shopPaymentAttemptPresentation(payment: Readonly<{
  provider: string;
  status: string;
  failureCode: string | null;
  paidAt: Date | null;
  createdAt: Date;
}>) {
  return {
    providerLabel: payment.provider === "STRIPE"
      ? "Carte bancaire / Apple Pay"
      : payment.provider === "PAYPAL"
        ? "PayPal"
        : "Moyen inconnu",
    statusLabel: SHOP_PAYMENT_STATUS_LABELS[payment.status] ?? "À examiner",
    incidentLabel: shopPaymentIncidentLabel(payment.failureCode),
    dateLabel: payment.paidAt ? "Encaissement enregistré" : "Tentative créée",
    date: payment.paidAt ?? payment.createdAt,
  } as const;
}

export function shopFulfillmentLabel(status: "PENDING" | "PREPARING" | "READY_TO_SHIP" | "SHIPPED" | "CANCELLED") {
  return ({
    PENDING: "En attente de préparation",
    PREPARING: "En préparation",
    READY_TO_SHIP: "Prête à expédier",
    SHIPPED: "Expédiée",
    CANCELLED: "Annulée",
  } as const)[status];
}

export function shopShippingMethodLabel(method: string | null) {
  if (method === "STANDARD_TRACKED_SIGNATURE") return "Expédition suivie avec remise contre signature";
  return method ? "Mode d’expédition snapshoté" : "Mode d’expédition non renseigné";
}

export function shopTrackingSourceLabel(source: "MANUAL" | "PROVIDER" | null) {
  return source === "MANUAL" ? "Saisie manuelle" : source === "PROVIDER" ? "Transporteur connecté" : "Non renseignée";
}
