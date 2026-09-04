import "server-only";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { SHOP_PHASE5B_QA_ORIGIN, SHOP_PHASE5B_QA_TARGET } from "@/lib/shop/qa-contract";
import { shopProductionReadinessQaEnabled } from "@/lib/shop/production-readiness-config";
import { isStrictShopProductionEnvironment } from "@/lib/shop/production-environment";
import { evaluateLiveRefundProductionPolicy } from "@/lib/payments/live-refund-policy";

export const SHOP_AFTER_SALES_QA_CONFIRMATION = "enable-local-shop-after-sales-qa";
export const SHOP_AFTER_SALES_QA_TARGET = SHOP_PHASE5B_QA_TARGET;
export const SHOP_AFTER_SALES_QA_ORIGIN = SHOP_PHASE5B_QA_ORIGIN;

export type ShopAfterSalesRefundProvider = "disabled" | "fake" | "payments";

export function shopAfterSalesRefundProvider(environment: NodeJS.ProcessEnv = process.env): ShopAfterSalesRefundProvider | "blocked" {
  if (isStrictShopProductionEnvironment(environment)) {
    const configured = environment.SHOP_AFTER_SALES_REFUND_PROVIDER ?? "disabled";
    const liveRefunds = evaluateLiveRefundProductionPolicy(environment);
    if (configured === "disabled" && liveRefunds.state !== "BLOCKED") return "disabled";
    if (configured === "payments" && liveRefunds.armed) return "payments";
    return "blocked";
  }
  if (environment.SHOP_AFTER_SALES_REFUND_PROVIDER === "fake") return "fake";
  return "blocked";
}

export function shopAfterSalesQaEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (isStrictShopProductionEnvironment(environment)) {
    return environment.SHOP_AFTER_SALES_ENABLED === "true"
      && shopAfterSalesRefundProvider(environment) !== "blocked";
  }
  if (shopProductionReadinessQaEnabled(environment)) {
    return environment.SHOP_AFTER_SALES_ENABLED === "true"
      && environment.SHOP_AFTER_SALES_QA_CONFIRM === SHOP_AFTER_SALES_QA_CONFIRMATION
      && environment.SHOP_AFTER_SALES_REFUND_PROVIDER === "fake";
  }
  if (environment.SHOP_AFTER_SALES_ENABLED !== "true") return false;
  if (environment.SHOP_AFTER_SALES_QA_CONFIRM !== SHOP_AFTER_SALES_QA_CONFIRMATION) return false;
  if (environment.SHOP_AFTER_SALES_REFUND_PROVIDER !== "fake") return false;
  if (environment.AUTH_URL !== SHOP_AFTER_SALES_QA_ORIGIN || environment.SITE_URL !== SHOP_AFTER_SALES_QA_ORIGIN) return false;
  if (environment.LNX_DATABASE_TARGET !== SHOP_AFTER_SALES_QA_TARGET) return false;
  if (!environment.LNX_PRISMA_DEV_SERVER_FILE?.endsWith(`/prisma-dev-nodejs/${SHOP_AFTER_SALES_QA_TARGET}/server.json`)) return false;
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
  for (const forbidden of [
    "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET",
    "PAYPAL_WEBHOOK_ID", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "NOTIFICATION_WORKER_SECRET",
    "MEDIA_S3_ENDPOINT", "MEDIA_S3_ACCESS_KEY_ID", "MEDIA_S3_SECRET_ACCESS_KEY",
  ]) {
    if (environment[forbidden]?.trim()) return false;
  }
  try {
    const url = assertSafeLocalPostgresUrl(environment.DATABASE_URL ?? "");
    return decodeURIComponent(url.pathname) === "/template1";
  } catch {
    return false;
  }
}

export const shopAfterSalesEnabled = shopAfterSalesQaEnabled;

export function assertShopAfterSalesQaEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (!shopAfterSalesQaEnabled(environment)) {
    throw new Error("SHOP_AFTER_SALES_QA_DISABLED");
  }
}

export const assertShopAfterSalesEnabled = assertShopAfterSalesQaEnabled;

export function assertShopRefundExecutionEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (!shopAfterSalesQaEnabled(environment)) throw new Error("SHOP_AFTER_SALES_DISABLED");
  const provider = shopAfterSalesRefundProvider(environment);
  if (provider === "disabled" || provider === "blocked") throw new Error("SHOP_REFUNDS_DISABLED");
  return provider;
}
