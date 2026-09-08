import { getOrderDeletionEligibility } from "@/lib/admin/order-machine";

export type AdminCleanupClassification = "DELETE_SAFE" | "ARCHIVE_REQUIRED" | "KEEP_ACTION_REQUIRED";

type CleanupDecision = Readonly<{
  classification: AdminCleanupClassification;
  reason: string;
}>;

export type MusicCleanupSnapshot = Readonly<{
  status: string;
  customerEmail: string;
  serviceStartedAt: Date | null;
  deliveredAt: Date | null;
  events: readonly { toStatus: string }[];
  assets: readonly { role: "REFERENCE" | "DELIVERY" | "DOCUMENT" | "CONTRACT" }[];
  commercialLicenses: readonly { status?: string; paymentStatus?: string }[];
  rightsRequests: readonly { status?: string }[];
  payments: readonly {
    status?: string;
    amountCents?: number;
    refundedAmountCents?: number;
    refundAttempts?: readonly { status?: string }[];
    incidents?: readonly { status?: string; requiresOperatorReview?: boolean }[];
  }[];
  invoices: readonly unknown[];
  notifications: readonly { status?: string }[];
  withdrawalRequests: readonly { status?: string }[];
}>;

function hasExplicitFixtureIdentity(email: string) {
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith("@example.invalid") || normalized.endsWith("@lnx.test");
}

export function classifyMusicOrderCleanup(snapshot: MusicCleanupSnapshot): CleanupDecision {
  const baseEligibility = getOrderDeletionEligibility({
    status: snapshot.status as Parameters<typeof getOrderDeletionEligibility>[0]["status"],
    serviceStartedAt: snapshot.serviceStartedAt,
    deliveredAt: snapshot.deliveredAt,
    events: snapshot.events as Parameters<typeof getOrderDeletionEligibility>[0]["events"],
    assets: snapshot.assets,
    commercialLicenses: snapshot.commercialLicenses,
    rightsRequests: snapshot.rightsRequests,
    payments: snapshot.payments,
  });
  const extraRetention = snapshot.invoices.length || snapshot.notifications.length || snapshot.withdrawalRequests.length;
  const hasStoredAsset = snapshot.assets.length > 0;
  const hasOpenFinancialAction = snapshot.payments.some((payment) => {
    if (["PENDING", "REFUND_PENDING", "REQUIRES_REVIEW"].includes(payment.status ?? "")) return true;
    if (payment.refundAttempts?.some((attempt) => ["PROCESSING", "PENDING", "REQUIRES_REVIEW"].includes(attempt.status ?? ""))) return true;
    if (payment.incidents?.some((incident) => incident.requiresOperatorReview && incident.status !== "RESOLVED")) return true;
    if (["REFUSED", "CANCELLED", "REFUNDED"].includes(snapshot.status)) {
      return ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status ?? "")
        || (payment.status === "REFUNDED"
          && typeof payment.amountCents === "number"
          && (payment.refundedAmountCents ?? 0) < payment.amountCents);
    }
    return false;
  });
  const hasOpenNotificationAction = snapshot.notifications.some((notification) => [
    "PROCESSING", "FAILED_RETRYABLE", "FAILED_FINAL", "BOUNCED", "COMPLAINED", "SUPPRESSED",
  ].includes(notification.status ?? ""));
  const hasOpenWithdrawal = snapshot.withdrawalRequests.some((request) => !["REJECTED", "CANCELLED"].includes(request.status ?? ""));
  const hasOngoingRights = snapshot.rightsRequests.some((request) => !["REJECTED", "CANCELLED"].includes(request.status ?? ""))
    || snapshot.commercialLicenses.some((license) => !["REJECTED", "CANCELLED"].includes(license.status ?? ""));
  if (hasOpenFinancialAction || hasOpenNotificationAction || hasOpenWithdrawal || hasOngoingRights) {
    return {
      classification: "KEEP_ACTION_REQUIRED",
      reason: "Une action financière, contractuelle, de rétractation ou de notification reste ouverte.",
    };
  }
  if (baseEligibility.eligible && !extraRetention && !hasStoredAsset && hasExplicitFixtureIdentity(snapshot.customerEmail)) {
    return {
      classification: "DELETE_SAFE",
      reason: "Fixture explicitement non délivrable, sans paiement, fichier, document, notification, droit ni historique à conserver.",
    };
  }
  if (["DELIVERED", "REFUSED", "CANCELLED", "REFUNDED"].includes(snapshot.status)) {
    return {
      classification: "ARCHIVE_REQUIRED",
      reason: "Dossier terminé ou porteur d’un historique à conserver ; seule sa sortie des vues courantes est autorisée.",
    };
  }
  return {
    classification: "KEEP_ACTION_REQUIRED",
    reason: baseEligibility.eligible
      ? "Aucune preuve explicite de fixture : une validation humaine est requise avant toute suppression."
      : baseEligibility.reason,
  };
}

export function classifyShopOrderCleanup(snapshot: Readonly<{
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  paymentReviewAt: Date | null;
  openCustomerRequests: number;
  openFinancialReviews: number;
  openOperationalActions: number;
  financialPayments: readonly {
    status: string;
    amountCents: number;
    refundedAmountCents: number;
  }[];
}>): CleanupDecision {
  if (snapshot.paymentReviewAt || snapshot.openCustomerRequests || snapshot.openFinancialReviews || snapshot.openOperationalActions) {
    return { classification: "KEEP_ACTION_REQUIRED", reason: "Une demande ou revue financière, logistique, SAV ou de notification reste ouverte." };
  }
  const unresolvedPayment = snapshot.financialPayments.some((payment) =>
    ["CREATED", "PENDING", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REQUIRES_REVIEW"].includes(payment.status)
    || (payment.status === "REFUNDED"
      && (payment.amountCents <= 0 || payment.refundedAmountCents !== payment.amountCents)),
  );
  const terminalWithoutSettledPayment = ["CANCELLED", "EXPIRED"].includes(snapshot.status)
    && (snapshot.paymentStatus === "PAID"
      || snapshot.financialPayments.some((payment) => payment.status === "SUCCEEDED"));
  if (unresolvedPayment || terminalWithoutSettledPayment) {
    return {
      classification: "KEEP_ACTION_REQUIRED",
      reason: "L’état terminal de la commande n’est pas cohérent avec les preuves financières persistées.",
    };
  }
  if (snapshot.status === "CANCELLED" || snapshot.status === "EXPIRED" || snapshot.fulfillmentStatus === "SHIPPED") {
    return {
      classification: "ARCHIVE_REQUIRED",
      reason: "Une ShopOrder conserve toujours son historique de stock, paiement et documents ; aucun hard delete n’est permis.",
    };
  }
  return { classification: "KEEP_ACTION_REQUIRED", reason: "La commande Boutique appartient encore au workflow opérationnel." };
}

export function classifyRightsRequestCleanup(status: string): CleanupDecision {
  if (["REJECTED", "CANCELLED"].includes(status)) {
    return {
      classification: "ARCHIVE_REQUIRED",
      reason: "Le dossier contractuel est terminé mais ses versions, preuves et audits doivent rester conservés.",
    };
  }
  return {
    classification: "KEEP_ACTION_REQUIRED",
    reason: status === "ACTIVE"
      ? "Le contrat est actif et reste hors du nettoyage des essais."
      : "Le dossier contractuel n’est pas terminé.",
  };
}
