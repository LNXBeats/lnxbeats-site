import "server-only";

export const SHOP_PRODUCTION_CONFIRMATION = "enable-production-shop-open-readiness";
export const SHOP_PRODUCTION_ORIGIN = "https://www.lnxbeats.fr";
export const SHOP_PRODUCTION_DATABASE_TARGET = "lnx-studio-production";

function exactOrigin(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.origin === SHOP_PRODUCTION_ORIGIN
      && url.pathname === "/"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

/**
 * Identifies the one runtime in which Production Shop capabilities may be
 * armed. This is deliberately stricter than NODE_ENV=production: local builds,
 * previews and staging cannot satisfy it.
 */
export function isStrictShopProductionEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  return environment.NODE_ENV === "production"
    && environment.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() === "production"
    && !/staging|preview/i.test(environment.RAILWAY_ENVIRONMENT ?? "")
    && environment.LNX_DATABASE_TARGET === SHOP_PRODUCTION_DATABASE_TARGET
    && exactOrigin(environment.AUTH_URL)
    && exactOrigin(environment.APP_CANONICAL_URL ?? environment.SITE_URL)
    && environment.SHOP_PRODUCTION_CONFIRM === SHOP_PRODUCTION_CONFIRMATION;
}

export function assertStrictShopProductionEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  if (!isStrictShopProductionEnvironment(environment)) {
    throw new Error("SHOP_PRODUCTION_ENVIRONMENT_INVALID");
  }
}
