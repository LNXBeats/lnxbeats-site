import "server-only";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import {
  SHOP_PHASE2_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE2_QA_CONFIRMATION,
  SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE2_QA_ORIGIN,
  SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT,
  SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT,
  SHOP_PHASE2_QA_RUNTIME_CONFIRMATION,
  SHOP_PHASE2_QA_RUNTIME_CONFIRMATION_NAME,
  SHOP_PHASE2_QA_TARGET,
  SHOP_PHASE3B_STRIPE_QA_CONFIRMATION,
  SHOP_PHASE3C_PAYPAL_QA_CONFIRMATION,
  SHOP_PHASE3_QA_OWNER_EMAIL,
  SHOP_PHASE5A_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE5A_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE5A_QA_ORIGIN,
  SHOP_PHASE5A_QA_PRIVATE_MEDIA_ROOT,
  SHOP_PHASE5A_QA_PUBLIC_MEDIA_ROOT,
  SHOP_PHASE5A_QA_TARGET,
} from "@/lib/shop/qa-contract";
import {
  SHOP_LEGAL_QA_CONFIRMATION,
  SHOP_LEGAL_QA_TERMS_VERSION,
} from "@/lib/shop/legal";
import { SHOP_SHIPPING_QA_CONFIRMATION } from "@/lib/shop/shipping-config";

export const ADMIN_PRINCIPAL_EMAIL = "lnx.beats.pro@gmail.com";
export const LOCAL_PREVIEW_DATABASE_TARGET = "lnx-studio-local-preview";

type AuthEnvironment = Readonly<Record<string, string | undefined>>;

const SHOP_PHASE2_AUTH_COOKIE_ENVIRONMENT = Object.freeze({
  NODE_ENV: "test",
  LNX_DATABASE_TARGET: SHOP_PHASE2_QA_TARGET,
  AUTH_URL: SHOP_PHASE2_QA_ORIGIN,
  SITE_URL: SHOP_PHASE2_QA_ORIGIN,
  APP_CANONICAL_URL: SHOP_PHASE2_QA_ORIGIN,
  AUTH_QA_ACCESS_ENABLED: "false",
  EMAIL_PROVIDER: "capture",
  AUTH_EMAIL_CAPTURE_PATH: SHOP_PHASE2_QA_AUTH_CAPTURE_PATH,
  NOTIFICATION_DEPLOYMENT_ENV: "development",
  NOTIFICATION_EMAIL_TRANSPORT: "capture",
  NOTIFICATION_CAPTURE_PATH: SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH,
  NOTIFICATION_WORKER_ENABLED: "false",
  NOTIFICATION_SCHEDULER_MODE: "disabled",
  EMAIL_NOTIFICATIONS_ENABLED: "true",
  OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
  CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
  SMS_TRANSPORT: "disabled",
  SMS_NOTIFICATIONS_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  PAYMENT_DEPLOYMENT_ENV: "development",
  LIVE_REFUNDS_ENABLED: "false",
  STRIPE_PAYMENTS_ENABLED: "false",
  PAYPAL_PAYMENTS_ENABLED: "false",
  MEDIA_DEPLOYMENT_ENV: "test",
  MEDIA_STORAGE_DRIVER: "local",
  MEDIA_LOCAL_PUBLIC_ROOT: SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT,
  MEDIA_LOCAL_PRIVATE_ROOT: SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT,
  MEDIA_STORAGE_ROOT: SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT,
  ORDER_UPLOAD_MODE: "local-qa",
  ORDER_UPLOAD_DIR: SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT,
  SHOP_ENABLED: "true",
  SHOP_LOCAL_QA_CONFIRM: SHOP_PHASE2_QA_CONFIRMATION,
  SHOP_ALLOWED_COUNTRIES: "FR",
  SHOP_RESERVATION_TTL_MINUTES: "30",
  MUSIC_PRICING_SOURCE: "legacy",
} satisfies Record<string, string>);

const SHOP_PHASE2_FORBIDDEN_EXTERNAL_SECRETS = [
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "NOTIFICATION_WORKER_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "MEDIA_S3_ENDPOINT",
  "MEDIA_S3_ACCESS_KEY_ID",
  "MEDIA_S3_SECRET_ACCESS_KEY",
] as const;

const SHOP_PHASE3B_STRIPE_AUTH_COOKIE_ENVIRONMENT = Object.freeze({
  ...SHOP_PHASE2_AUTH_COOKIE_ENVIRONMENT,
  PAYMENTS_ENABLED: "true",
  STRIPE_PAYMENTS_ENABLED: "true",
  STRIPE_MODE: "test",
  PAYPAL_PAYMENTS_ENABLED: "false",
  PAYPAL_ENVIRONMENT: "sandbox",
  SHOP_PAYMENTS_ENABLED: "true",
  SHOP_LEGAL_READY: "true",
  SHOP_TERMS_VERSION: SHOP_LEGAL_QA_TERMS_VERSION,
  SHOP_LEGAL_QA_CONFIRM: SHOP_LEGAL_QA_CONFIRMATION,
  SHOP_PHASE3B_STRIPE_QA_CONFIRM: SHOP_PHASE3B_STRIPE_QA_CONFIRMATION,
  EMAIL_OWNER_RECIPIENT: SHOP_PHASE3_QA_OWNER_EMAIL,
} satisfies Record<string, string>);

const SHOP_PHASE3B_FORBIDDEN_EXTERNAL_SECRETS = SHOP_PHASE2_FORBIDDEN_EXTERNAL_SECRETS.filter(
  (name) => name !== "STRIPE_SECRET_KEY" && name !== "STRIPE_WEBHOOK_SECRET",
);

const SHOP_PHASE3C_PAYPAL_AUTH_COOKIE_ENVIRONMENT = Object.freeze({
  ...SHOP_PHASE2_AUTH_COOKIE_ENVIRONMENT,
  PAYMENTS_ENABLED: "true",
  STRIPE_PAYMENTS_ENABLED: "false",
  STRIPE_MODE: "test",
  PAYPAL_PAYMENTS_ENABLED: "true",
  PAYPAL_ENVIRONMENT: "sandbox",
  SHOP_PAYMENTS_ENABLED: "true",
  SHOP_LEGAL_READY: "true",
  SHOP_TERMS_VERSION: SHOP_LEGAL_QA_TERMS_VERSION,
  SHOP_LEGAL_QA_CONFIRM: SHOP_LEGAL_QA_CONFIRMATION,
  SHOP_PHASE3C_PAYPAL_QA_CONFIRM: SHOP_PHASE3C_PAYPAL_QA_CONFIRMATION,
  EMAIL_OWNER_RECIPIENT: SHOP_PHASE3_QA_OWNER_EMAIL,
} satisfies Record<string, string>);

const SHOP_PHASE3C_FORBIDDEN_EXTERNAL_SECRETS = SHOP_PHASE2_FORBIDDEN_EXTERNAL_SECRETS.filter(
  (name) => name !== "PAYPAL_CLIENT_ID" && name !== "PAYPAL_CLIENT_SECRET" && name !== "PAYPAL_WEBHOOK_ID",
);

const SHOP_PHASE5A_AUTH_COOKIE_ENVIRONMENT = Object.freeze({
  LNX_DATABASE_TARGET: SHOP_PHASE5A_QA_TARGET,
  AUTH_URL: SHOP_PHASE5A_QA_ORIGIN,
  SITE_URL: SHOP_PHASE5A_QA_ORIGIN,
  APP_CANONICAL_URL: SHOP_PHASE5A_QA_ORIGIN,
  AUTH_QA_ACCESS_ENABLED: "false",
  EMAIL_PROVIDER: "capture",
  AUTH_EMAIL_CAPTURE_PATH: SHOP_PHASE5A_QA_AUTH_CAPTURE_PATH,
  NOTIFICATION_DEPLOYMENT_ENV: "development",
  NOTIFICATION_EMAIL_TRANSPORT: "capture",
  NOTIFICATION_CAPTURE_PATH: SHOP_PHASE5A_QA_NOTIFICATION_CAPTURE_PATH,
  NOTIFICATION_WORKER_ENABLED: "false",
  NOTIFICATION_SCHEDULER_MODE: "disabled",
  EMAIL_NOTIFICATIONS_ENABLED: "true",
  OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false",
  CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
  SMS_TRANSPORT: "disabled",
  SMS_NOTIFICATIONS_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  PAYMENT_DEPLOYMENT_ENV: "development",
  LIVE_REFUNDS_ENABLED: "false",
  STRIPE_PAYMENTS_ENABLED: "false",
  STRIPE_MODE: "test",
  PAYPAL_PAYMENTS_ENABLED: "false",
  PAYPAL_ENVIRONMENT: "sandbox",
  SHOP_ENABLED: "true",
  SHOP_LOCAL_QA_CONFIRM: SHOP_PHASE2_QA_CONFIRMATION,
  SHOP_ALLOWED_COUNTRIES: "FR",
  SHOP_RESERVATION_TTL_MINUTES: "30",
  SHOP_PAYMENTS_ENABLED: "false",
  MUSIC_PRICING_SOURCE: "legacy",
  SHOP_SHIPPING_ENABLED: "true",
  SHOP_SHIPPING_QA_CONFIRM: SHOP_SHIPPING_QA_CONFIRMATION,
  SHOP_LEGAL_READY: "true",
  SHOP_TERMS_VERSION: SHOP_LEGAL_QA_TERMS_VERSION,
  SHOP_LEGAL_QA_CONFIRM: SHOP_LEGAL_QA_CONFIRMATION,
  MEDIA_DEPLOYMENT_ENV: "test",
  MEDIA_STORAGE_DRIVER: "local",
  MEDIA_LOCAL_PUBLIC_ROOT: SHOP_PHASE5A_QA_PUBLIC_MEDIA_ROOT,
  MEDIA_LOCAL_PRIVATE_ROOT: SHOP_PHASE5A_QA_PRIVATE_MEDIA_ROOT,
  MEDIA_STORAGE_ROOT: SHOP_PHASE5A_QA_PUBLIC_MEDIA_ROOT,
  ORDER_UPLOAD_MODE: "local-qa",
  ORDER_UPLOAD_DIR: SHOP_PHASE5A_QA_PRIVATE_MEDIA_ROOT,
} satisfies Record<string, string>);

export function isLoopbackUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isPersistentLocalPreview(environment: AuthEnvironment = process.env) {
  return environment.LNX_PREVIEW_MODE === "persistent-local"
    && environment.LNX_DATABASE_TARGET === LOCAL_PREVIEW_DATABASE_TARGET
    && isLoopbackUrl(environment.AUTH_URL ?? environment.SITE_URL);
}

function hasDedicatedShopPhase2Database(environment: AuthEnvironment) {
  const rawDatabaseUrl = environment.DATABASE_URL;
  if (!rawDatabaseUrl) return false;
  try {
    const databaseUrl = assertSafeLocalPostgresUrl(rawDatabaseUrl);
    return decodeURIComponent(databaseUrl.pathname) === "/template1";
  } catch {
    return false;
  }
}

function hasSafeLocalShopQaIdentity(environment: AuthEnvironment) {
  if (environment.LNX_PREVIEW_MODE?.trim()) return false;
  if (Object.entries(environment).some(
    ([name, value]) => name.startsWith("RAILWAY_") && Boolean(value?.trim()),
  )) return false;
  if (environment[SHOP_PHASE2_QA_RUNTIME_CONFIRMATION_NAME] !== SHOP_PHASE2_QA_RUNTIME_CONFIRMATION) {
    return false;
  }
  if (!environment.LNX_PRISMA_DEV_SERVER_FILE?.endsWith(
    `/prisma-dev-nodejs/${SHOP_PHASE2_QA_TARGET}/server.json`,
  )) return false;
  if (!hasDedicatedShopPhase2Database(environment)) return false;
  return Boolean(environment.AUTH_SECRET && environment.AUTH_SECRET.length >= 32);
}

function hasSafeLocalShopPhase5AIdentity(environment: AuthEnvironment) {
  if (environment.LNX_PREVIEW_MODE?.trim()) return false;
  if (Object.entries(environment).some(
    ([name, value]) => name.startsWith("RAILWAY_") && Boolean(value?.trim()),
  )) return false;
  if (!environment.LNX_PRISMA_DEV_SERVER_FILE?.endsWith(
    `/prisma-dev-nodejs/${SHOP_PHASE5A_QA_TARGET}/server.json`,
  )) return false;
  if (!hasDedicatedShopPhase2Database(environment)) return false;
  return Boolean(environment.AUTH_SECRET && environment.AUTH_SECRET.length >= 32);
}

export function isSafeLocalShopPhase2QaHttpRuntime(
  environment: AuthEnvironment = process.env,
) {
  if (Object.entries(SHOP_PHASE2_AUTH_COOKIE_ENVIRONMENT).some(
    ([name, expected]) => environment[name] !== expected,
  )) return false;
  if (SHOP_PHASE2_FORBIDDEN_EXTERNAL_SECRETS.some((name) => environment[name]?.trim())) return false;
  return hasSafeLocalShopQaIdentity(environment);
}

export function isSafeLocalShopPhase3BStripeQaHttpRuntime(
  environment: AuthEnvironment = process.env,
) {
  if (Object.entries(SHOP_PHASE3B_STRIPE_AUTH_COOKIE_ENVIRONMENT).some(
    ([name, expected]) => environment[name] !== expected,
  )) return false;
  if (SHOP_PHASE3B_FORBIDDEN_EXTERNAL_SECRETS.some((name) => environment[name]?.trim())) return false;
  const stripeKey = environment.STRIPE_SECRET_KEY?.trim();
  if (!stripeKey || !/^(?:sk|rk)_test_[A-Za-z0-9_-]{8,}$/.test(stripeKey) || /_live_/.test(stripeKey)) {
    return false;
  }
  if (!/^whsec_[A-Za-z0-9_-]{8,}$/.test(environment.STRIPE_WEBHOOK_SECRET?.trim() ?? "")) {
    return false;
  }
  return hasSafeLocalShopQaIdentity(environment);
}

export function isSafeLocalShopPhase3CPaypalSandboxQaHttpRuntime(
  environment: AuthEnvironment = process.env,
) {
  if (Object.entries(SHOP_PHASE3C_PAYPAL_AUTH_COOKIE_ENVIRONMENT).some(
    ([name, expected]) => environment[name] !== expected,
  )) return false;
  if (SHOP_PHASE3C_FORBIDDEN_EXTERNAL_SECRETS.some((name) => environment[name]?.trim())) return false;
  if (!/^[A-Za-z0-9_-]{12,255}$/.test(environment.PAYPAL_CLIENT_ID?.trim() ?? "")) return false;
  if (!/^[A-Za-z0-9_-]{12,255}$/.test(environment.PAYPAL_CLIENT_SECRET?.trim() ?? "")) return false;
  if (!/^[A-Za-z0-9_-]{6,255}$/.test(environment.PAYPAL_WEBHOOK_ID?.trim() ?? "")) return false;
  return hasSafeLocalShopQaIdentity(environment);
}

export function isSafeLocalShopPhase5ALogisticsQaHttpRuntime(
  environment: AuthEnvironment = process.env,
) {
  if (environment.NODE_ENV !== "test" && environment.NODE_ENV !== "production") return false;
  if (Object.entries(SHOP_PHASE5A_AUTH_COOKIE_ENVIRONMENT).some(
    ([name, expected]) => environment[name] !== expected,
  )) return false;
  if (SHOP_PHASE2_FORBIDDEN_EXTERNAL_SECRETS.some((name) => environment[name]?.trim())) return false;
  return hasSafeLocalShopPhase5AIdentity(environment);
}

export function shouldUseSecureAuthCookies(
  productionBuild: boolean,
  environment: AuthEnvironment = process.env,
) {
  if (!productionBuild) return false;
  if (isPersistentLocalPreview(environment)) return false;
  return !isSafeLocalShopPhase2QaHttpRuntime(environment)
    && !isSafeLocalShopPhase3BStripeQaHttpRuntime(environment)
    && !isSafeLocalShopPhase3CPaypalSandboxQaHttpRuntime(environment)
    && !isSafeLocalShopPhase5ALogisticsQaHttpRuntime(environment);
}

export function configuredAdminEmail() {
  const configured = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!configured || configured !== ADMIN_PRINCIPAL_EMAIL) {
    throw new Error("ADMIN_EMAIL must identify the approved LNX Beats administrator account.");
  }
  return configured;
}
