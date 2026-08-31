import "server-only";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import {
  SHOP_PHASE5D_QA_ORIGIN,
  SHOP_PHASE5D_QA_TARGET,
  SHOP_PHASE5D_RUNTIME_QA_TARGET,
} from "@/lib/shop/qa-contract";

export const SHOP_SHIPPING_PROVIDER_QA_CONFIRMATION = "enable-local-shop-shipping-provider-qa";
export const SHOP_SHIPPING_PROVIDER_QA_TARGET = SHOP_PHASE5D_QA_TARGET;
export const SHOP_SHIPPING_PROVIDER_RUNTIME_QA_TARGET = SHOP_PHASE5D_RUNTIME_QA_TARGET;
export const SHOP_SHIPPING_PROVIDER_QA_ORIGIN = SHOP_PHASE5D_QA_ORIGIN;

const FORBIDDEN_EXTERNAL_SECRETS = [
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
  "COLISSIMO_API_KEY",
  "LA_POSTE_API_KEY",
  "COLISSIMO_CLIENT_ID",
  "COLISSIMO_CLIENT_SECRET",
  "COLISSIMO_CONTRACT_NUMBER",
  "COLISSIMO_PASSWORD",
  "LA_POSTE_CLIENT_ID",
  "LA_POSTE_CLIENT_SECRET",
] as const;

const CARRIER_CREDENTIAL_NAME = /(?:COLISSIMO|LA_POSTE|LAPOSTE|CARRIER).*(?:KEY|SECRET|TOKEN|PASSWORD|CONTRACT|CREDENTIAL)/i;

export function shopShippingProviderQaEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.SHOP_SHIPPING_PROVIDER_ENABLED !== "true") return false;
  if (environment.SHOP_SHIPPING_PROVIDER !== "FAKE_LOCAL") return false;
  if (environment.SHOP_SHIPPING_PROVIDER_QA_CONFIRM !== SHOP_SHIPPING_PROVIDER_QA_CONFIRMATION) return false;
  if (environment.AUTH_URL !== SHOP_PHASE5D_QA_ORIGIN || environment.SITE_URL !== SHOP_PHASE5D_QA_ORIGIN) return false;
  const target = environment.LNX_DATABASE_TARGET;
  if (target !== SHOP_PHASE5D_QA_TARGET && target !== SHOP_PHASE5D_RUNTIME_QA_TARGET) return false;
  if (!environment.LNX_PRISMA_DEV_SERVER_FILE?.endsWith(`/prisma-dev-nodejs/${target}/server.json`)) return false;
  if (Object.entries(environment).some(([name, value]) => name.startsWith("RAILWAY_") && Boolean(value?.trim()))) return false;
  if (
    environment.PAYMENTS_ENABLED !== "false"
    || environment.SHOP_PAYMENTS_ENABLED !== "false"
    || environment.STRIPE_PAYMENTS_ENABLED !== "false"
    || environment.PAYPAL_PAYMENTS_ENABLED !== "false"
    || environment.LIVE_REFUNDS_ENABLED !== "false"
    || environment.NOTIFICATION_EMAIL_TRANSPORT !== "capture"
    || environment.EMAIL_PROVIDER !== "capture"
    || environment.MEDIA_STORAGE_DRIVER !== "local"
  ) return false;
  if (FORBIDDEN_EXTERNAL_SECRETS.some((name) => environment[name]?.trim())) return false;
  if (Object.entries(environment).some(([name, value]) => CARRIER_CREDENTIAL_NAME.test(name) && Boolean(value?.trim()))) return false;
  try {
    const url = assertSafeLocalPostgresUrl(environment.DATABASE_URL ?? "");
    return decodeURIComponent(url.pathname) === "/template1" && url.port !== "5432";
  } catch {
    return false;
  }
}

export function assertShopShippingProviderQaEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (!shopShippingProviderQaEnabled(environment)) throw new Error("SHOP_SHIPPING_PROVIDER_QA_DISABLED");
}
