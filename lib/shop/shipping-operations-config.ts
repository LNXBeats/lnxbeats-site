import "server-only";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import {
  SHOP_PHASE5C_QA_ORIGIN,
  SHOP_PHASE5C_QA_TARGET,
  SHOP_PHASE5C_RUNTIME_QA_TARGET,
  SHOP_PHASE5D_QA_ORIGIN,
  SHOP_PHASE5D_QA_TARGET,
  SHOP_PHASE5D_RUNTIME_QA_TARGET,
} from "@/lib/shop/qa-contract";
import { isStrictShopProductionEnvironment } from "@/lib/shop/production-environment";

export const SHOP_SHIPPING_OPERATIONS_QA_CONFIRMATION = "enable-local-shop-shipping-operations-qa";
export const SHOP_SHIPPING_OPERATIONS_QA_TARGET = SHOP_PHASE5C_QA_TARGET;
export const SHOP_SHIPPING_OPERATIONS_RUNTIME_QA_TARGET = SHOP_PHASE5C_RUNTIME_QA_TARGET;
export const SHOP_SHIPPING_OPERATIONS_QA_ORIGIN = SHOP_PHASE5C_QA_ORIGIN;

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
] as const;

export function shopShippingOperationsQaEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.SHOP_SHIPPING_OPERATIONS_ENABLED !== "true") return false;
  if (isStrictShopProductionEnvironment(environment)) {
    return environment.SHOP_SHIPPING_OPERATIONS_PROVIDER === "manual"
      && environment.SHOP_SHIPPING_PROVIDER_ENABLED === "false"
      && environment.LIVE_REFUNDS_ENABLED === "false";
  }
  if (environment.SHOP_SHIPPING_OPERATIONS_QA_CONFIRM !== SHOP_SHIPPING_OPERATIONS_QA_CONFIRMATION) return false;
  if (environment.SHOP_SHIPPING_OPERATIONS_PROVIDER !== "manual") return false;
  const phase5c = environment.AUTH_URL === SHOP_PHASE5C_QA_ORIGIN
    && environment.SITE_URL === SHOP_PHASE5C_QA_ORIGIN
    && (environment.LNX_DATABASE_TARGET === SHOP_PHASE5C_QA_TARGET
      || environment.LNX_DATABASE_TARGET === SHOP_PHASE5C_RUNTIME_QA_TARGET);
  const phase5d = environment.AUTH_URL === SHOP_PHASE5D_QA_ORIGIN
    && environment.SITE_URL === SHOP_PHASE5D_QA_ORIGIN
    && (environment.LNX_DATABASE_TARGET === SHOP_PHASE5D_QA_TARGET
      || environment.LNX_DATABASE_TARGET === SHOP_PHASE5D_RUNTIME_QA_TARGET);
  if (!phase5c && !phase5d) return false;
  const target = environment.LNX_DATABASE_TARGET;
  if (!target) return false;
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
  ) return false;
  if (FORBIDDEN_EXTERNAL_SECRETS.some((name) => environment[name]?.trim())) return false;
  try {
    const url = assertSafeLocalPostgresUrl(environment.DATABASE_URL ?? "");
    return decodeURIComponent(url.pathname) === "/template1" && url.port !== "5432";
  } catch {
    return false;
  }
}

export function assertShopShippingOperationsQaEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (!shopShippingOperationsQaEnabled(environment)) throw new Error("SHOP_SHIPPING_OPERATIONS_QA_DISABLED");
}
