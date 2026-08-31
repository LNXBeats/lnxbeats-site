import "server-only";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import {
  SHOP_PHASE5E_QA_CONFIRMATION,
  SHOP_PHASE5E_QA_ORDER_SNAPSHOT_VERSION,
  SHOP_PHASE5E_QA_ORIGIN,
  SHOP_PHASE5E_QA_TARGET,
  SHOP_PHASE5E_QA_TERMS_VERSION,
  SHOP_PHASE5E_RUNTIME_QA_TARGET,
} from "@/lib/shop/qa-contract";

export const SHOP_PHASE5E_ORIGIN = SHOP_PHASE5E_QA_ORIGIN;
export const SHOP_PHASE5E_RUNTIME_TARGET = SHOP_PHASE5E_RUNTIME_QA_TARGET;
export const SHOP_PHASE5E_PREVIEW_TARGET = SHOP_PHASE5E_QA_TARGET;
export const SHOP_PHASE5E_CONFIRMATION = SHOP_PHASE5E_QA_CONFIRMATION;
export const SHOP_PHASE5E_TERMS_VERSION = SHOP_PHASE5E_QA_TERMS_VERSION;
export const SHOP_PHASE5E_ORDER_SNAPSHOT_VERSION = SHOP_PHASE5E_QA_ORDER_SNAPSHOT_VERSION;

export function assertShopProductionReadinessQaEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (
    (environment.NODE_ENV !== "test" && environment.NODE_ENV !== "production")
    || environment.RAILWAY_ENVIRONMENT
    || environment.RAILWAY_ENVIRONMENT_NAME
    || environment.SHOP_PRODUCTION_READINESS_QA !== "true"
    || environment.SHOP_PRODUCTION_READINESS_QA_CONFIRM !== SHOP_PHASE5E_CONFIRMATION
    || environment.AUTH_URL !== SHOP_PHASE5E_ORIGIN
    || environment.SITE_URL !== SHOP_PHASE5E_ORIGIN
    || ![SHOP_PHASE5E_RUNTIME_TARGET, SHOP_PHASE5E_PREVIEW_TARGET].includes(environment.LNX_DATABASE_TARGET ?? "")
  ) throw new Error("Phase 5E production-readiness QA is not armed.");
  const database = assertSafeLocalPostgresUrl(environment.DATABASE_URL ?? "");
  if (database.port === "5432" || decodeURIComponent(database.pathname) !== "/template1") {
    throw new Error("Phase 5E requires an isolated Prisma Dev database on a nonstandard loopback port.");
  }
  const target = environment.LNX_DATABASE_TARGET!;
  if (!environment.LNX_PRISMA_DEV_SERVER_FILE?.endsWith(`/prisma-dev-nodejs/${target}/server.json`)) {
    throw new Error("Phase 5E requires the exact Prisma Dev server proof path.");
  }
  const exact: Record<string, string> = {
    SHOP_ENABLED: "true",
    SHOP_CUSTOMER_SCOPE: "INDIVIDUALS_ONLY",
    SHOP_ALLOWED_COUNTRIES: "FR",
    SHOP_RESERVATION_TTL_MINUTES: "30",
    SHOP_SHIPPING_ENABLED: "true",
    SHOP_SHIPPING_RATE_SCOPE: "COMMERCIAL_CANDIDATE",
    SHOP_SHIPPING_QA_CONFIRM: SHOP_PHASE5E_CONFIRMATION,
    SHOP_PAYMENTS_ENABLED: "false",
    PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
    LIVE_REFUNDS_ENABLED: "false",
    NOTIFICATION_EMAIL_TRANSPORT: "capture",
    NOTIFICATION_WORKER_ENABLED: "false",
    SHOP_TERMS_VERSION: SHOP_PHASE5E_TERMS_VERSION,
    SHOP_ORDER_SNAPSHOT_VERSION: SHOP_PHASE5E_ORDER_SNAPSHOT_VERSION,
    MUSIC_PRICING_SOURCE: "legacy",
  };
  for (const [name, value] of Object.entries(exact)) {
    if (environment[name] !== value) throw new Error(`${name} must be exactly ${value} for Phase 5E.`);
  }
  for (const name of [
    "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET",
    "PAYPAL_WEBHOOK_ID", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY", "CLOUDFLARE_API_TOKEN", "COLISSIMO_API_KEY", "LA_POSTE_API_KEY",
  ]) if (environment[name]?.trim()) throw new Error(`${name} is forbidden in Phase 5E QA.`);
  return { origin: SHOP_PHASE5E_ORIGIN, target: environment.LNX_DATABASE_TARGET, databasePort: database.port } as const;
}

export function shopProductionReadinessQaEnabled(environment: NodeJS.ProcessEnv = process.env) {
  try {
    assertShopProductionReadinessQaEnabled(environment);
    return true;
  } catch {
    return false;
  }
}
