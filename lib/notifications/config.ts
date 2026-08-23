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
  workerEnabled: boolean;
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
export const NOTIFICATION_PRODUCTION_CONFIRMATION = "I_UNDERSTAND_THIS_ENABLES_PRODUCTION_EMAILS";
export const NOTIFICATION_SCHEDULER_MODE = "railway-cron";
export const RESEND_API_BASE_URL = "https://api.resend.com";

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

function senderAddress(value: string) {
  const match = value.match(/^[^<>\r\n]+ <([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>$/);
  if (!match?.[1]) throw new Error("EMAIL_FROM is invalid.");
  return match[1].toLowerCase();
}

function senderDisplayName(value: string) {
  return value.slice(0, value.indexOf("<")).trim();
}

export function isLnxProductionEmailAddress(value: string) {
  const domain = value.toLowerCase().split("@").at(-1) ?? "";
  return domain === "lnxbeats.fr" || domain.endsWith(".lnxbeats.fr");
}

function isProductionHostname(value: string) {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === "lnxbeats.fr" || hostname.endsWith(".lnxbeats.fr");
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
  const workerEnabled = flag(optional(environment, "NOTIFICATION_WORKER_ENABLED"), false, "NOTIFICATION_WORKER_ENABLED");
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
  const railwayEnvironment = (optional(environment, "RAILWAY_ENVIRONMENT_NAME") ?? optional(environment, "RAILWAY_ENVIRONMENT"))?.toLowerCase() ?? null;
  const configuredResendBaseUrl = optional(environment, "RESEND_BASE_URL");

  if (railwayEnvironment && ["staging", "production"].includes(deploymentEnvironment) && railwayEnvironment !== deploymentEnvironment) {
    throw new Error("Notification and Railway deployment environments do not match.");
  }
  if (deploymentEnvironment === "production" && emailTransport === "capture") throw new Error("Capture email is forbidden in production.");
  if (deploymentEnvironment === "production" && smsTransport !== "disabled") throw new Error("SMS transport is disabled in production.");
  if (smsEnabled && smsTransport === "disabled") throw new Error("SMS notifications require a configured transport.");
  if (emailTransport === "disabled" && (emailEnabled || ownerEmailEnabled || clientEmailEnabled)) {
    throw new Error("Email flags cannot enable a disabled transport.");
  }
  if ((ownerEmailEnabled || clientEmailEnabled) && !emailEnabled) {
    throw new Error("Recipient email flags require email notifications to be enabled.");
  }
  if (workerEnabled && !emailEnabled) throw new Error("The notification worker requires email notifications to be enabled.");
  if (workerEnabled && (!workerSecret || workerSecret.length < 32)) throw new Error("Notification worker configuration is incomplete.");
  if (emailTransport === "resend") {
    const stagingConfirmed = deploymentEnvironment === "staging" && environment.NOTIFICATION_STAGING_CONFIRM === STAGING_CONFIRMATION;
    const productionConfirmed = deploymentEnvironment === "production"
      && environment.NOTIFICATION_PRODUCTION_CONFIRM === NOTIFICATION_PRODUCTION_CONFIRMATION;
    if (!stagingConfirmed && !productionConfirmed) {
      throw new Error("Resend requires an explicitly confirmed deployment environment.");
    }
    if (!resendApiKey?.startsWith("re_") || !resendWebhookSecret?.startsWith("whsec_") || !emailFrom || !emailReplyTo || !appCanonicalUrl) {
      throw new Error("Resend configuration is incomplete.");
    }
    if (ownerEmailEnabled && !ownerRecipient) throw new Error("Owner email notifications require a recipient.");
    if (workerSecret !== null && workerSecret.length < 32) throw new Error("Notification worker secret is too short.");
    if (configuredResendBaseUrl && configuredResendBaseUrl !== RESEND_API_BASE_URL) throw new Error("RESEND_BASE_URL is not approved.");
    if (deploymentEnvironment === "production") {
      if (!isProductionHostname(appCanonicalUrl)) throw new Error("Production notification links require the LNX Beats canonical domain.");
      if (!["LNX Beats", "LNX Studio"].includes(senderDisplayName(emailFrom))) {
        throw new Error("Production email display name is not approved.");
      }
      if (!isLnxProductionEmailAddress(senderAddress(emailFrom)) || !isLnxProductionEmailAddress(emailReplyTo)) {
        throw new Error("Production From and Reply-To addresses require the LNX Beats domain.");
      }
      if (ownerRecipient && (ownerRecipient.endsWith(".invalid") || ownerRecipient.endsWith(".test") || ownerRecipient.endsWith("@resend.dev"))) {
        throw new Error("Production owner recipient is not valid.");
      }
      if (stagingRecipientAllowlist.length > 0 || environment.NOTIFICATION_STAGING_CONFIRM || environment.NOTIFICATION_STAGING_QA_CONFIRM || environment.NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM) {
        throw new Error("Staging notification controls are forbidden in production.");
      }
    }
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
    workerEnabled,
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
    emailEnabled: configuration.emailEnabled,
    ownerEmailEnabled: configuration.ownerEmailEnabled,
    clientEmailEnabled: configuration.clientEmailEnabled,
    emailConfigured: configuration.emailConfigured,
    smsTransport: configuration.smsTransport,
    workerEnabled: configuration.workerEnabled,
    workerConfigured: configuration.workerConfigured,
    webhookConfigured: configuration.webhookConfigured,
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
