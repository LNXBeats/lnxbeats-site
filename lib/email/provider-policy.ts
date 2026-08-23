import { createHash } from "node:crypto";

import { isFictitiousRecipient, normalizeNotificationRecipient } from "@/lib/notifications/domain";
import { parseNotificationConfiguration } from "@/lib/notifications/config";

export type EmailProvider = "disabled" | "capture" | "resend";

export const RESEND_PREVIEW_FROM = "LNX Beats <no-reply@email.lnxbeats.fr>";
export const RESEND_PREVIEW_REPLY_TO = "lnx.beats.pro@gmail.com";

type ProviderEnvironment = Record<string, string | undefined>;

export function configuredEmailProvider(environment: ProviderEnvironment): EmailProvider {
  const provider = environment.EMAIL_PROVIDER?.trim().toLowerCase();
  if (provider === "disabled" || provider === "capture" || provider === "resend") return provider;
  throw new Error("A supported transactional email transport must be configured.");
}

function assertIdempotencyKey(value: string | undefined) {
  if (!value || value.length > 256 || !/^[A-Za-z0-9_./:-]+$/.test(value)) {
    throw new Error("The transactional email idempotency key is invalid.");
  }
}

export function authEmailIdempotencyKey(kind: "verification" | "password-reset", token: string) {
  return `auth-${kind}/${createHash("sha256").update(token).digest("hex")}`;
}

export function assertResendAuthDelivery(input: {
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
  if (!input.apiKey?.trim()) {
    throw new Error("Transactional email credentials are unavailable.");
  }
  assertIdempotencyKey(input.idempotencyKey);

  if (input.isPersistentLocalPreview) {
    if (recipient.endsWith("@example.invalid") || recipient !== RESEND_PREVIEW_REPLY_TO) {
      throw new Error("Real transactional email is restricted to the approved preview recipient.");
    }
    if (input.from?.trim() !== RESEND_PREVIEW_FROM) throw new Error("The transactional sender is not approved.");
    if (input.replyTo?.trim().toLowerCase() !== RESEND_PREVIEW_REPLY_TO) throw new Error("The transactional reply address is not approved.");
    return;
  }

  const configuration = parseNotificationConfiguration(input.environment);
  if (
    configuration.deploymentEnvironment !== "production"
    || configuration.emailTransport !== "resend"
    || !configuration.emailEnabled
    || !configuration.clientEmailEnabled
    || input.from?.trim() !== configuration.emailFrom
    || input.replyTo?.trim().toLowerCase() !== configuration.emailReplyTo
  ) throw new Error("Authentication email production delivery is not armed.");
  const canonicalOrigin = configuration.canonicalUrl;
  const authOrigin = new URL(input.environment.AUTH_URL ?? "").origin;
  if (!canonicalOrigin || authOrigin !== canonicalOrigin) throw new Error("Authentication email origin is not approved.");
  const normalized = normalizeNotificationRecipient(recipient);
  if (isFictitiousRecipient(normalized) || normalized.endsWith("@resend.dev")) {
    throw new Error("Authentication email recipient is not approved for production.");
  }
}

export const assertResendPreviewDelivery = assertResendAuthDelivery;
