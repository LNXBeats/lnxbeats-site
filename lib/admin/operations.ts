import type { KnownOrderStatus } from "@/lib/orders/status";

export const adminOrderFilters = ["attention", "active", "pending", "completed", "archives", "all"] as const;
export type AdminOrderFilter = (typeof adminOrderFilters)[number];

export const adminShopOrderFilters = [
  "attention",
  "active",
  "pending",
  "completed",
  "archives",
  "all",
] as const;
export type AdminShopOrderFilter = (typeof adminShopOrderFilters)[number];

export type AdminActionPriority = "CRITICAL" | "HIGH" | "NORMAL";
export type AdminActionDomain =
  | "COMMANDER"
  | "SHOP_ORDER"
  | "RIGHTS"
  | "NOTIFICATION"
  | "SHOP_RETURN"
  | "FINANCIAL_EVENT";

export type AdminActionItem = Readonly<{
  key: string;
  domain: AdminActionDomain;
  reasonCode: string;
  priority: AdminActionPriority;
  occurredAt: Date;
  reference: string;
  label: string;
  href: string;
}>;

export const commanderAttentionStatuses = [
  "PAYMENT_CONFIRMED",
  "RECEIVED",
  "SUBMITTED",
  "REVIEWING",
  "REVISION_REQUESTED",
  "FIRST_VERSION_READY",
  "REFUND_PENDING",
] as const satisfies readonly KnownOrderStatus[];

export const commanderActiveStatuses = [
  "ACCEPTED",
  "IN_PROGRESS",
  "FIRST_VERSION_READY",
  "REVISION_REQUESTED",
  "FINALIZING",
] as const satisfies readonly KnownOrderStatus[];

export const commanderPendingStatuses = ["DRAFT", "AWAITING_PAYMENT"] as const satisfies readonly KnownOrderStatus[];
export const commanderCompletedStatuses = ["DELIVERED", "REFUSED", "CANCELLED", "REFUNDED"] as const satisfies readonly KnownOrderStatus[];

export const rightsAdminAttentionStatuses = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "PREAUTHORIZATION_GENERATED",
  "CONTRACT_PREPARATION",
  "CLIENT_ACCEPTED",
  "ADMIN_VALIDATED",
] as const;

export type OperationClassification = Readonly<{
  reasonCode: string;
  priority: AdminActionPriority;
  label: string;
}>;

export type CommanderOperationSnapshot = Readonly<{
  status: KnownOrderStatus;
  archived?: boolean;
  hasPaymentReview?: boolean;
  hasUnresolvedFinancialIncident?: boolean;
  hasRefundPending?: boolean;
  hasRefundDue?: boolean;
  hasRefundContradiction?: boolean;
  hasRightsReview?: boolean;
}>;

export function classifyCommanderOperation(snapshot: CommanderOperationSnapshot): OperationClassification | null {
  if (snapshot.hasUnresolvedFinancialIncident) {
    return { reasonCode: "FINANCIAL_INCIDENT", priority: "CRITICAL", label: "Incident financier à examiner" };
  }
  if (snapshot.hasPaymentReview) {
    return { reasonCode: "PAYMENT_REVIEW", priority: "CRITICAL", label: "Paiement à vérifier" };
  }
  if (snapshot.hasRefundPending) {
    return { reasonCode: "REFUND_RECONCILIATION", priority: "CRITICAL", label: "Remboursement à réconcilier" };
  }
  if (snapshot.status === "REFUND_PENDING") {
    return { reasonCode: "REFUND_RECONCILIATION", priority: "CRITICAL", label: "Remboursement à réconcilier" };
  }
  if (snapshot.hasRefundContradiction) {
    return { reasonCode: "REFUND_STATE_CONTRADICTION", priority: "CRITICAL", label: "État de remboursement incohérent" };
  }
  if (snapshot.hasRefundDue) {
    return { reasonCode: "REFUND_DECISION", priority: "HIGH", label: "Remboursement à décider" };
  }
  if (snapshot.hasRightsReview) {
    return { reasonCode: "RIGHTS_REVIEW", priority: "HIGH", label: "Droits à examiner" };
  }
  if ((commanderAttentionStatuses as readonly KnownOrderStatus[]).includes(snapshot.status)) {
    return { reasonCode: `ORDER_${snapshot.status}`, priority: "NORMAL", label: "Étape de commande à traiter" };
  }
  return null;
}

export function commanderOrderMatchesFilter(snapshot: CommanderOperationSnapshot, filter: AdminOrderFilter) {
  if (filter === "archives") return snapshot.archived === true;
  if (filter === "attention") return classifyCommanderOperation(snapshot) !== null;
  if (snapshot.archived) return false;
  if (filter === "all") return true;
  if (filter === "active") return (commanderActiveStatuses as readonly KnownOrderStatus[]).includes(snapshot.status);
  if (filter === "pending") return (commanderPendingStatuses as readonly KnownOrderStatus[]).includes(snapshot.status);
  return (commanderCompletedStatuses as readonly KnownOrderStatus[]).includes(snapshot.status);
}

export type ShopOrderOperationSnapshot = Readonly<{
  status: "OPEN" | "EXPIRED" | "CANCELLED";
  paymentStatus: "AWAITING_PAYMENT" | "PAID" | "CANCELLED";
  fulfillmentStatus: "PENDING" | "PREPARING" | "READY_TO_SHIP" | "SHIPPED" | "CANCELLED";
  paymentReviewAt: Date | null;
  archived?: boolean;
  hasCustomerRequest?: boolean;
  hasRefundReview?: boolean;
  hasShippingReview?: boolean;
}>;

export function classifyShopOrderOperation(snapshot: ShopOrderOperationSnapshot): OperationClassification | null {
  if (snapshot.paymentReviewAt) {
    return { reasonCode: "SHOP_PAYMENT_REVIEW", priority: "CRITICAL", label: "Paiement Boutique à vérifier" };
  }
  if (snapshot.hasRefundReview) {
    return { reasonCode: "SHOP_REFUND_REVIEW", priority: "CRITICAL", label: "Remboursement Boutique à réconcilier" };
  }
  if (snapshot.hasShippingReview) {
    return { reasonCode: "SHOP_SHIPPING_REVIEW", priority: "HIGH", label: "Expédition Boutique à vérifier" };
  }
  if (snapshot.hasCustomerRequest) {
    return { reasonCode: "SHOP_CUSTOMER_REQUEST", priority: "HIGH", label: "Demande client à examiner" };
  }
  if (snapshot.status !== "OPEN" || snapshot.paymentStatus !== "PAID") return null;
  if (snapshot.fulfillmentStatus === "PENDING") {
    return { reasonCode: "SHOP_PREPARATION", priority: "NORMAL", label: "Préparation à démarrer" };
  }
  if (snapshot.fulfillmentStatus === "PREPARING") {
    return { reasonCode: "SHOP_READY", priority: "NORMAL", label: "Préparation à finaliser" };
  }
  if (snapshot.fulfillmentStatus === "READY_TO_SHIP") {
    return { reasonCode: "SHOP_SHIPMENT", priority: "NORMAL", label: "Expédition à enregistrer" };
  }
  return null;
}

export function shopOrderMatchesFilter(snapshot: ShopOrderOperationSnapshot, filter: AdminShopOrderFilter) {
  if (filter === "archives") return snapshot.archived === true;
  if (filter === "attention") return classifyShopOrderOperation(snapshot) !== null;
  if (snapshot.archived) return false;
  if (filter === "all") return true;
  if (filter === "active") {
    return snapshot.status === "OPEN"
      && snapshot.paymentStatus === "PAID"
      && !snapshot.paymentReviewAt
      && ["PENDING", "PREPARING", "READY_TO_SHIP"].includes(snapshot.fulfillmentStatus);
  }
  if (filter === "pending") {
    return snapshot.status === "OPEN" && snapshot.paymentStatus === "AWAITING_PAYMENT";
  }
  return snapshot.fulfillmentStatus === "SHIPPED"
    || snapshot.status === "EXPIRED"
    || snapshot.status === "CANCELLED";
}

export type FinancialEventOperationSnapshot = Readonly<{
  outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW";
  paymentId: string | null;
  refundAttemptId: string | null;
  incidentId: string | null;
}>;

export function classifyUncorrelatedFinancialEventOperation(
  snapshot: FinancialEventOperationSnapshot,
): OperationClassification | null {
  if (snapshot.outcome !== "REQUIRES_REVIEW") return null;
  if (snapshot.paymentId || snapshot.refundAttemptId || snapshot.incidentId) return null;
  return {
    reasonCode: "UNCORRELATED_FINANCIAL_EVENT",
    priority: "CRITICAL",
    label: "Événement financier non rapproché",
  };
}

export type NotificationOperationSnapshot = Readonly<{
  status: "PENDING" | "PROCESSING" | "SENT" | "DELIVERED" | "FAILED" | "FAILED_RETRYABLE" | "FAILED_FINAL" | "BOUNCED" | "COMPLAINED" | "SUPPRESSED" | "CANCELED";
  attempts: number;
  suppressionActive: boolean;
  leaseExpiresAt: Date | null;
}>;

export function classifyNotificationOperation(snapshot: NotificationOperationSnapshot, now = new Date()): OperationClassification | null {
  if (snapshot.status === "PROCESSING" && (!snapshot.leaseExpiresAt || snapshot.leaseExpiresAt <= now)) {
    return { reasonCode: "NOTIFICATION_EXPIRED_LEASE", priority: "CRITICAL", label: "Traitement email interrompu" };
  }
  if (snapshot.status === "FAILED_RETRYABLE" && !snapshot.suppressionActive && snapshot.attempts < 5) {
    return { reasonCode: "NOTIFICATION_RETRY", priority: "HIGH", label: "Notification à relancer" };
  }
  if (["FAILED_FINAL", "BOUNCED", "COMPLAINED", "SUPPRESSED"].includes(snapshot.status)) {
    return { reasonCode: "NOTIFICATION_DELIVERY_REVIEW", priority: "HIGH", label: "Distribution email à examiner" };
  }
  return null;
}

export function classifyRightsOperation(status: string): OperationClassification | null {
  return (rightsAdminAttentionStatuses as readonly string[]).includes(status)
    ? { reasonCode: `RIGHTS_${status}`, priority: status === "CLIENT_ACCEPTED" ? "HIGH" : "NORMAL", label: "Dossier de droits à traiter" }
    : null;
}

export type ShopReturnOperationSnapshot = Readonly<{
  status: string;
  refundStatus: string;
  hasRefundAttempt: boolean;
  refundAttemptStatus?: string | null;
  hasRestockRemaining: boolean;
}>;

export function classifyShopReturnOperation(snapshot: ShopReturnOperationSnapshot): OperationClassification | null {
  if (snapshot.refundStatus === "REQUIRES_REVIEW") {
    return { reasonCode: "SAV_REFUND_REVIEW", priority: "CRITICAL", label: "Remboursement SAV à vérifier" };
  }
  if (["PROCESSING", "PENDING", "REQUIRES_REVIEW"].includes(snapshot.refundAttemptStatus ?? "")) {
    return { reasonCode: "SAV_REFUND_RECONCILIATION", priority: "CRITICAL", label: "Remboursement SAV à réconcilier" };
  }
  if (snapshot.status === "REQUESTED" || snapshot.status === "UNDER_REVIEW") {
    return { reasonCode: "SAV_REVIEW", priority: "HIGH", label: "Dossier SAV à examiner" };
  }
  if (snapshot.status === "AWAITING_RETURN") {
    return { reasonCode: "SAV_RETURN_RECEIPT", priority: "NORMAL", label: "Retour physique à réceptionner" };
  }
  if (snapshot.status === "RETURN_RECEIVED") {
    return { reasonCode: "SAV_INSPECTION", priority: "NORMAL", label: "Retour à inspecter" };
  }
  if ((snapshot.status === "APPROVED" || snapshot.status === "INSPECTED") && !snapshot.hasRefundAttempt) {
    return { reasonCode: "SAV_REFUND", priority: "HIGH", label: "Remboursement SAV à décider" };
  }
  if (snapshot.hasRestockRemaining) {
    return { reasonCode: "SAV_RESTOCK", priority: "NORMAL", label: "Décision de remise en stock à finaliser" };
  }
  return null;
}

const priorityRank: Readonly<Record<AdminActionPriority, number>> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
};

export function compareOperationClassifications(
  left: OperationClassification | null,
  right: OperationClassification | null,
) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return priorityRank[left.priority] - priorityRank[right.priority]
    || left.reasonCode.localeCompare(right.reasonCode);
}

export function sortAdminActionItems(items: readonly AdminActionItem[]) {
  return [...items].sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority]
    || left.occurredAt.getTime() - right.occurredAt.getTime()
    || left.key.localeCompare(right.key));
}
