export type EmailProvider = "capture" | "resend";

export const RESEND_PREVIEW_FROM = "LNX Beats <no-reply@email.lnxbeats.fr>";
export const RESEND_PREVIEW_REPLY_TO = "lnx.beats.pro@gmail.com";

type ProviderEnvironment = {
  EMAIL_PROVIDER?: string;
  LNX_DATABASE_TARGET?: string;
  NODE_ENV?: string;
};

export function configuredEmailProvider(environment: ProviderEnvironment): EmailProvider {
  const provider = environment.EMAIL_PROVIDER?.trim().toLowerCase();
  if (provider === "capture" || provider === "resend") return provider;
  throw new Error("A supported transactional email transport must be configured.");
}

export function assertResendPreviewDelivery(input: {
  apiKey: string | undefined;
  environment: ProviderEnvironment;
  from: string | undefined;
  idempotencyKey?: string;
  isPersistentLocalPreview: boolean;
  kind: "registration-code" | "verification" | "password-reset";
  replyTo: string | undefined;
  to: string;
}) {
  const recipient = input.to.trim().toLowerCase();
  const databaseTarget = input.environment.LNX_DATABASE_TARGET ?? "";

  if (input.environment.NODE_ENV === "test" || databaseTarget.endsWith("-test")) {
    throw new Error("Real transactional email is disabled in automated tests.");
  }
  if (!input.isPersistentLocalPreview) {
    throw new Error("Real transactional email is restricted to the approved local preview.");
  }
  if (recipient.endsWith("@example.invalid") || recipient !== RESEND_PREVIEW_REPLY_TO) {
    throw new Error("Real transactional email is restricted to the approved preview recipient.");
  }
  if (!input.apiKey?.trim()) {
    throw new Error("Transactional email credentials are unavailable.");
  }
  if (input.from?.trim() !== RESEND_PREVIEW_FROM) {
    throw new Error("The transactional sender is not approved.");
  }
  if (input.replyTo?.trim().toLowerCase() !== RESEND_PREVIEW_REPLY_TO) {
    throw new Error("The transactional reply address is not approved.");
  }
  if (input.kind === "registration-code" && !input.idempotencyKey) {
    throw new Error("Registration email requires an idempotency key.");
  }
  if (input.idempotencyKey && (
    input.idempotencyKey.length > 256
    || !/^[A-Za-z0-9_./:-]+$/.test(input.idempotencyKey)
  )) {
    throw new Error("The transactional email idempotency key is invalid.");
  }
}
