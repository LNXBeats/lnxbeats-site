export const ADMIN_NOTIFICATION_RETRY_CONFIRMATION = "I_CONFIRM_THIS_NOTIFICATION_RETRY";
export const ADMIN_NOTIFICATION_SUPPRESSION_CONFIRMATION = "I_CONFIRM_THIS_RECIPIENT_SUPPRESSION";

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
