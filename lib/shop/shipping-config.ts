import "server-only";

import { shopProductionReadinessQaEnabled } from "@/lib/shop/production-readiness-config";
import { isStrictShopProductionEnvironment } from "@/lib/shop/production-environment";

export const SHOP_SHIPPING_QA_CONFIRMATION = "enable-internal-shop-shipping-qa";
export const SHOP_PRODUCTION_READINESS_QA_CONFIRMATION = "enable-phase5e-production-readiness-qa";

export type ShopShippingConfiguration = Readonly<{
  enabled: boolean;
  scope: "INTERNAL_QA" | "COMMERCIAL_CANDIDATE";
  allowDraft: boolean;
  runtime: "DISABLED" | "LOCAL_QA" | "PRODUCTION";
}>;

export class ShopShippingConfigurationError extends Error {
  constructor(readonly code: "INVALID_FLAG" | "QA_CONTEXT_REQUIRED") {
    super(code);
    this.name = "ShopShippingConfigurationError";
  }
}
function exactBoolean(value: string | undefined) {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new ShopShippingConfigurationError("INVALID_FLAG");
}

function isLoopback(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function parseShopShippingConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ShopShippingConfiguration {
  const enabled = exactBoolean(environment.SHOP_SHIPPING_ENABLED);
  if (!enabled) return Object.freeze({ enabled: false, scope: "INTERNAL_QA", allowDraft: false, runtime: "DISABLED" });
  const productionReadiness = environment.SHOP_SHIPPING_RATE_SCOPE === "COMMERCIAL_CANDIDATE";
  const exactProductionReadinessQa = productionReadinessQaEnabled(environment);
  const strictProduction = productionReadiness && isStrictShopProductionEnvironment(environment);
  if (strictProduction) {
    if (environment.SHOP_ENABLED !== "true" || environment.SHOP_LEGAL_READY !== "true") {
      throw new ShopShippingConfigurationError("QA_CONTEXT_REQUIRED");
    }
    return Object.freeze({ enabled: true, scope: "COMMERCIAL_CANDIDATE", allowDraft: false, runtime: "PRODUCTION" });
  }
  const expectedConfirmation = productionReadiness
    ? SHOP_PRODUCTION_READINESS_QA_CONFIRMATION
    : SHOP_SHIPPING_QA_CONFIRMATION;
  if (
    (environment.NODE_ENV === "production" && !exactProductionReadinessQa)
    || environment.RAILWAY_ENVIRONMENT
    || environment.RAILWAY_ENVIRONMENT_NAME
    || environment.SHOP_ENABLED !== "true"
    || environment.SHOP_SHIPPING_QA_CONFIRM !== expectedConfirmation
    || (!isLoopback(environment.AUTH_URL) && !isLoopback(environment.SITE_URL))
  ) {
    throw new ShopShippingConfigurationError("QA_CONTEXT_REQUIRED");
  }
  if (environment.SHOP_SHIPPING_RATE_SCOPE && !productionReadiness && environment.SHOP_SHIPPING_RATE_SCOPE !== "INTERNAL_QA") {
    throw new ShopShippingConfigurationError("QA_CONTEXT_REQUIRED");
  }
  return Object.freeze({
    enabled: true,
    scope: productionReadiness ? "COMMERCIAL_CANDIDATE" : "INTERNAL_QA",
    allowDraft: exactProductionReadinessQa,
    runtime: "LOCAL_QA",
  });
}

function productionReadinessQaEnabled(environment: NodeJS.ProcessEnv) {
  return environment.SHOP_SHIPPING_RATE_SCOPE === "COMMERCIAL_CANDIDATE"
    && shopProductionReadinessQaEnabled(environment);
}
