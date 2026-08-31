import type { OrderNotificationKind } from "@/lib/notifications/types";

export const ADMIN_NOTIFICATION_RETRY_CONFIRMATION = "I_CONFIRM_THIS_NOTIFICATION_RETRY";
export const ADMIN_NOTIFICATION_SUPPRESSION_CONFIRMATION = "I_CONFIRM_THIS_RECIPIENT_SUPPRESSION";

export const notificationKindPresentation: Record<OrderNotificationKind, string> = {
  OWNER_NEW_ORDER: "Nouvelle commande — propriétaire",
  CUSTOMER_PAYMENT_CONFIRMED: "Paiement confirmé — client",
  CUSTOMER_ORDER_ACCEPTED: "Commande acceptée — client",
  CUSTOMER_CREATION_STARTED: "Création démarrée — client",
  CUSTOMER_DELIVERY_READY: "Livraison disponible — client",
  OWNER_RIGHTS_REQUESTED: "Nouvelle demande de droits — propriétaire",
  CUSTOMER_RIGHTS_INFORMATION_REQUIRED: "Informations demandées — client",
  CUSTOMER_RIGHTS_PREAUTHORIZATION_READY: "Préautorisation disponible — client",
  CUSTOMER_RIGHTS_CONTRACT_READY: "Contrat prêt — client",
  OWNER_RIGHTS_CLIENT_ACCEPTED: "Contrat accepté — propriétaire",
  CUSTOMER_RIGHTS_REJECTED: "Demande de droits rejetée — client",
  CUSTOMER_RIGHTS_READY_FOR_PAYMENT: "Dossier prêt pour paiement futur — client",
  CUSTOMER_PARTIAL_REFUND: "Remboursement partiel — client",
  CUSTOMER_REFUND_COMPLETED: "Remboursement total — client",
  OWNER_PAYMENT_INCIDENT: "Incident de paiement — propriétaire",
  OWNER_SHOP_ORDER_PAID: "Commande Boutique payée — propriétaire",
  CUSTOMER_SHOP_PAYMENT_CONFIRMED: "Commande Boutique confirmée — client",
  CUSTOMER_SHOP_PREPARING: "Commande Boutique en préparation — client",
  CUSTOMER_SHOP_SHIPPED: "Commande Boutique expédiée — client",
  OWNER_SHOP_RETURN_REQUESTED: "Demande SAV Boutique — propriétaire",
  CUSTOMER_SHOP_RETURN_APPROVED: "Demande SAV acceptée — client",
  CUSTOMER_SHOP_RETURN_REJECTED: "Demande SAV refusée — client",
  CUSTOMER_SHOP_RETURN_RECEIVED: "Retour Boutique reçu — client",
  CUSTOMER_SHOP_REFUND_CONFIRMED: "Remboursement Boutique confirmé — client",
  OWNER_SHOP_SAV_EVIDENCE_ADDED: "Preuve SAV ajoutée — propriétaire",
  OWNER_SHOP_CANCELLATION_REQUESTED: "Annulation Boutique demandée — propriétaire",
  CUSTOMER_SHOP_CANCELLATION_APPROVED: "Annulation Boutique acceptée — client",
  CUSTOMER_SHOP_CANCELLATION_REJECTED: "Annulation Boutique refusée — client",
  OWNER_SHOP_ADDRESS_CORRECTION_REQUESTED: "Correction d’adresse demandée — propriétaire",
  CUSTOMER_SHOP_ADDRESS_CORRECTION_APPROVED: "Correction d’adresse acceptée — client",
  CUSTOMER_SHOP_ADDRESS_CORRECTION_REJECTED: "Correction d’adresse refusée — client",
};

export function isAdminNotificationRetryConfirmed(value: unknown) {
  return value === ADMIN_NOTIFICATION_RETRY_CONFIRMATION;
}

export function isAdminNotificationSuppressionConfirmed(value: unknown) {
  return value === ADMIN_NOTIFICATION_SUPPRESSION_CONFIRMATION;
}

export function maskedProviderMessageId(value: string | null) {
  if (!value) return "Non attribué";
  if (value.length <= 10) return `${value.slice(0, 2)}••••`;
  return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

export const notificationEventOutcomePresentation = {
  PROCESSED: "Traité",
  IGNORED: "Ignoré sans effet",
  REQUIRES_REVIEW: "À examiner",
} as const;

export const notificationSuppressionReasonPresentation = {
  HARD_BOUNCE: "Rejet permanent",
  COMPLAINT: "Plainte destinataire",
  PROVIDER_SUPPRESSED: "Suppression fournisseur",
  MANUAL: "Blocage manuel",
} as const;
