const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 120;

export type RegistrationInput = {
  email: string;
  password: string;
  passwordConfirmation: string;
  displayName: string;
};

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

export function validateRegistrationInput(input: RegistrationInput) {
  const email = normalizeEmail(input.email);
  const displayName = normalizeDisplayName(input.displayName) || "Membre LNX";

  if (!isValidEmail(email)) return { ok: false as const, message: "Saisissez une adresse email valide." };
  if (!isValidPassword(input.password)) {
    return { ok: false as const, message: "Le mot de passe doit contenir entre 12 et 128 caractères." };
  }
  if (input.password !== input.passwordConfirmation) {
    return { ok: false as const, message: "Les deux mots de passe ne correspondent pas." };
  }
  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false as const, message: "Le nom d’affichage est trop long." };
  }

  return { ok: true as const, value: { email, password: input.password, displayName } };
}

export function validateProfileName(value: string) {
  const displayName = normalizeDisplayName(value);
  if (!displayName || displayName.length > DISPLAY_NAME_MAX_LENGTH) return null;
  return displayName;
}

export function isAllowedPublicRegistrationPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  const allowedKeys = new Set(["email", "password", "name", "callbackURL", "rememberMe"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) return false;
  return (
    typeof payload.email === "string"
    && isValidEmail(payload.email)
    && typeof payload.password === "string"
    && isValidPassword(payload.password)
    && typeof payload.name === "string"
    && Boolean(validateProfileName(payload.name))
    && (payload.callbackURL === undefined || payload.callbackURL === "/verifier-email")
    && (payload.rememberMe === undefined || typeof payload.rememberMe === "boolean")
  );
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
