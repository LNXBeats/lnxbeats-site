export const SUPPORT_MESSAGE_MAX = 500;
export const SUPPORT_EMAIL_MAX = 254;
export const SUPPORT_CONFIRMATION_LEGAL = "Ce soutien libre n'est ni une facture de vente ni un reçu fiscal et n'ouvre droit à aucune contrepartie.";
export function parseSupportContact(input: { email?: unknown; message?: unknown }) {
  if (input.email != null && typeof input.email !== "string") throw new Error("INVALID_EMAIL");
  if (input.message != null && typeof input.message !== "string") throw new Error("INVALID_MESSAGE");
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const message = typeof input.message === "string" ? input.message.normalize("NFC").replace(/\r\n?/g, "\n").trim() : "";
  if (email && (email.length > SUPPORT_EMAIL_MAX || /[\s\u0000-\u001f\u007f<>]/u.test(email)
    || !/^[^@]+@[^@]+\.[^@]+$/.test(email))) throw new Error("INVALID_EMAIL");
  if (message.length > SUPPORT_MESSAGE_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(message)) throw new Error("INVALID_MESSAGE");
  return { supporterEmail: email || null, supporterMessage: message || null };
}
export function supportConfirmationPresentation(status: string, needsReconciliation = false) {
  const confirmed = status === "SUCCEEDED" || status === "PAID";
  const actionable = !confirmed && (["CREATED", "PENDING", "UNKNOWN", "REQUIRES_REVIEW", "REFUND_PENDING"].includes(status) || needsReconciliation);
  return { confirmed, actionable };
}
