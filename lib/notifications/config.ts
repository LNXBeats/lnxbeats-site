import "server-only";

export type NotificationEmailTransport = "disabled" | "capture" | "resend";
export type NotificationSmsTransport = "disabled" | "capture";
export type NotificationDeploymentEnvironment = "development" | "staging" | "production";

export type NotificationConfiguration = Readonly<{
  deploymentEnvironment: NotificationDeploymentEnvironment;
  emailTransport: NotificationEmailTransport;
  smsTransport: NotificationSmsTransport;
  emailEnabled: boolean;
  ownerEmailEnabled: boolean;
  clientEmailEnabled: boolean;
  smsEnabled: boolean;
  emailConfigured: boolean;
  workerConfigured: boolean;
  webhookConfigured: boolean;
  canonicalUrl: string | null;
  emailFrom: string | null;
  emailReplyTo: string | null;
  ownerRecipient: string | null;
  stagingRecipientAllowlist: readonly string[];
  resendApiKey: string | null;
  resendWebhookSecret: string | null;
  workerSecret: string | null;
  capturePath: string;
}>;

const DEFAULT_CAPTURE_PATH = "/private/tmp/lnx-studio-v073-notifications.jsonl";
const STAGING_CONFIRMATION = "resend-staging-approved";

function optional(environment: Record<string, string | undefined>, name: string) {
  return environment[name]?.trim() || null;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T, name: string): T {
  const normalized = value?.toLowerCase() ?? fallback;
  if ((allowed as readonly string[]).includes(normalized)) return normalized as T;
  throw new Error(`${name} is invalid.`);
}

function flag(value: string | null, fallback: boolean, name: string) {
  if (value === null) return fallback;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  throw new Error(`${name} is invalid.`);
}

function email(value: string | null, name: string) {
  if (value === null) return null;
  const normalized = value.toLowerCase();
  if (normalized.length > 320 || /[\r\n]/.test(normalized) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error(`${name} is invalid.`);
  }
  return normalized;
}

function sender(value: string | null) {
  if (value === null) return null;
  if (value.length > 400 || /[\r\n]/.test(value) || !/^[^<>\r\n]+ <[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/.test(value)) {
    throw new Error("EMAIL_FROM is invalid.");
  }
  return value;
}

function canonicalUrl(value: string | null) {
  if (value === null) return null;
  const parsed = new URL(value);
  const loopback = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if ((!loopback && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("APP_CANONICAL_URL is invalid.");
  }
  return parsed.origin;
}

export function parseNotificationConfiguration(
  environment: Record<string, string | undefined> = process.env,
): NotificationConfiguration {
  const inferredDeployment = environment.NODE_ENV === "production" ? "production" : "development";
  const deploymentEnvironment = oneOf(
    optional(environment, "NOTIFICATION_DEPLOYMENT_ENV"),
    ["development", "staging", "production"] as const,
    inferredDeployment,
    "NOTIFICATION_DEPLOYMENT_ENV",
  );
  const emailTransport = oneOf(
    optional(environment, "NOTIFICATION_EMAIL_TRANSPORT"),
    ["disabled", "capture", "resend"] as const,
    deploymentEnvironment === "production" ? "disabled" : "capture",
    "NOTIFICATION_EMAIL_TRANSPORT",
  );
  const smsTransport = oneOf(
    optional(environment, "SMS_TRANSPORT"),
    ["disabled", "capture"] as const,
    "disabled",
    "SMS_TRANSPORT",
  );
  const emailEnabled = flag(optional(environment, "EMAIL_NOTIFICATIONS_ENABLED"), emailTransport !== "disabled", "EMAIL_NOTIFICATIONS_ENABLED");
  const ownerEmailEnabled = flag(optional(environment, "OWNER_EMAIL_NOTIFICATIONS_ENABLED"), emailTransport === "capture", "OWNER_EMAIL_NOTIFICATIONS_ENABLED");
  const clientEmailEnabled = flag(optional(environment, "CLIENT_EMAIL_NOTIFICATIONS_ENABLED"), emailTransport === "capture", "CLIENT_EMAIL_NOTIFICATIONS_ENABLED");
  const smsEnabled = flag(optional(environment, "SMS_NOTIFICATIONS_ENABLED"), false, "SMS_NOTIFICATIONS_ENABLED");
  const emailFrom = sender(optional(environment, "EMAIL_FROM"));
  const emailReplyTo = email(optional(environment, "EMAIL_REPLY_TO"), "EMAIL_REPLY_TO");
  const ownerRecipient = email(optional(environment, "EMAIL_OWNER_RECIPIENT"), "EMAIL_OWNER_RECIPIENT");
  const stagingRecipientAllowlist = (optional(environment, "NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => email(value, "NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST")!);
  const appCanonicalUrl = canonicalUrl(optional(environment, "APP_CANONICAL_URL"));
  const resendApiKey = optional(environment, "RESEND_API_KEY");
  const resendWebhookSecret = optional(environment, "RESEND_WEBHOOK_SECRET");
  const workerSecret = optional(environment, "NOTIFICATION_WORKER_SECRET");

  if (deploymentEnvironment === "production" && (emailTransport !== "disabled" || emailEnabled || ownerEmailEnabled || clientEmailEnabled || smsEnabled)) {
    throw new Error("Production notifications remain disabled in V0.7.3.");
  }
  if (smsEnabled && smsTransport === "disabled") throw new Error("SMS notifications require a configured transport.");
  if (emailTransport === "disabled" && (emailEnabled || ownerEmailEnabled || clientEmailEnabled)) {
    throw new Error("Email flags cannot enable a disabled transport.");
  }
  if ((ownerEmailEnabled || clientEmailEnabled) && !emailEnabled) {
    throw new Error("Recipient email flags require email notifications to be enabled.");
  }
  if (emailTransport === "resend") {
    if (deploymentEnvironment !== "staging" || environment.NOTIFICATION_STAGING_CONFIRM !== STAGING_CONFIRMATION) {
      throw new Error("Resend requires an explicitly confirmed staging environment.");
    }
    if (!resendApiKey?.startsWith("re_") || !resendWebhookSecret?.startsWith("whsec_") || !emailFrom || !emailReplyTo || !appCanonicalUrl) {
      throw new Error("Resend staging configuration is incomplete.");
    }
    if (ownerEmailEnabled && !ownerRecipient) throw new Error("Owner email notifications require a recipient.");
    if (workerSecret !== null && workerSecret.length < 32) throw new Error("Notification worker secret is too short.");
  }

  const emailConfigured = emailTransport === "capture"
    || (emailTransport === "resend" && Boolean(resendApiKey && emailFrom && emailReplyTo && appCanonicalUrl));
  return {
    deploymentEnvironment,
    emailTransport,
    smsTransport,
    emailEnabled,
    ownerEmailEnabled,
    clientEmailEnabled,
    smsEnabled,
    emailConfigured,
    workerConfigured: Boolean(workerSecret && workerSecret.length >= 32),
    webhookConfigured: Boolean(resendWebhookSecret?.startsWith("whsec_")),
    canonicalUrl: appCanonicalUrl,
    emailFrom,
    emailReplyTo,
    ownerRecipient,
    stagingRecipientAllowlist,
    resendApiKey,
    resendWebhookSecret,
    workerSecret,
    capturePath: optional(environment, "NOTIFICATION_CAPTURE_PATH") ?? DEFAULT_CAPTURE_PATH,
  };
}

export function notificationHealthSummary(configuration: NotificationConfiguration) {
  return {
    emailTransport: configuration.emailTransport,
    emailConfigured: configuration.emailConfigured,
    smsTransport: configuration.smsTransport,
    workerConfigured: configuration.workerConfigured,
  } as const;
}

export function notificationChannelAvailability(
  environment: Record<string, string | undefined> = process.env,
) {
  const configuration = parseNotificationConfiguration(environment);
  return {
    email: configuration.emailEnabled ? "ENABLED" as const : "DISABLED" as const,
    sms: configuration.smsTransport === "capture" ? "CAPTURE" as const : "DISABLED" as const,
  };
}
