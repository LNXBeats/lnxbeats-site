const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 120;
export const REGISTRATION_CODE_LENGTH = 6;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidEmail(value: string) {
  const email = normalizeEmail(value);
  return email.length <= 320 && EMAIL_PATTERN.test(email);
}

export function isValidPassword(value: string) {
  return value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}

export function validateRegistrationEmail(value: string) {
  const email = normalizeEmail(value);
  if (!isValidEmail(email)) return { ok: false as const, message: "Saisissez une adresse email valide." };
  return { ok: true as const, value: email };
}

export function validateRegistrationCode(value: string) {
  const code = value.trim();
  if (!/^\d{6}$/.test(code)) return { ok: false as const, message: "Saisissez les six chiffres du code." };
  return { ok: true as const, value: code };
}

export function validateRegistrationPassword(input: { password: string; passwordConfirmation: string }) {
  if (!isValidPassword(input.password)) {
    return { ok: false as const, message: "Le mot de passe doit contenir entre 12 et 128 caractères." };
  }
  if (input.password !== input.passwordConfirmation) {
    return { ok: false as const, message: "Les deux mots de passe ne correspondent pas." };
  }
  return { ok: true as const, value: input.password };
}

export function validateProfileName(value: string) {
  const displayName = normalizeDisplayName(value);
  if (!displayName || displayName.length > DISPLAY_NAME_MAX_LENGTH) return null;
  return displayName;
}

export function isAllowedRegistrationEmailPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return Object.keys(payload).every((key) => key === "email")
    && typeof payload.email === "string"
    && isValidEmail(payload.email);
}

export function isAllowedRegistrationCodePayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return Object.keys(payload).every((key) => key === "attemptId" || key === "code")
    && typeof payload.attemptId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.attemptId)
    && typeof payload.code === "string"
    && /^\d{6}$/.test(payload.code);
}

export function isAllowedRegistrationCompletionPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return Object.keys(payload).every((key) => key === "password" || key === "passwordConfirmation")
    && typeof payload.password === "string"
    && typeof payload.passwordConfirmation === "string"
    && validateRegistrationPassword({
      password: payload.password,
      passwordConfirmation: payload.passwordConfirmation,
    }).ok;
}

export function isAllowedProfilePayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return Object.keys(payload).every((key) => key === "name")
    && typeof payload.name === "string"
    && Boolean(validateProfileName(payload.name));
}

export function isAllowedEmailRequestPayload(value: unknown, callbackURL: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  const callbackKey = callbackURL === "/verifier-email" ? "callbackURL" : "redirectTo";
  const allowedKeys = new Set(["email", callbackKey]);
  return Object.keys(payload).every((key) => allowedKeys.has(key))
    && typeof payload.email === "string"
    && isValidEmail(payload.email)
    && payload[callbackKey] === callbackURL;
}

export function isAllowedResetPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return Object.keys(payload).every((key) => key === "newPassword" || key === "token")
    && typeof payload.newPassword === "string"
    && isValidPassword(payload.newPassword)
    && typeof payload.token === "string"
    && payload.token.length > 20
    && payload.token.length <= 512;
}
