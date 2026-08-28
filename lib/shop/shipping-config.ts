import "server-only";

export const SHOP_SHIPPING_QA_CONFIRMATION = "enable-internal-shop-shipping-qa";

export type ShopShippingConfiguration = Readonly<{
  enabled: boolean;
  scope: "INTERNAL_QA";
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
  if (!enabled) return Object.freeze({ enabled: false, scope: "INTERNAL_QA" });
  if (
    environment.NODE_ENV === "production"
    || environment.RAILWAY_ENVIRONMENT
    || environment.RAILWAY_ENVIRONMENT_NAME
    || environment.SHOP_ENABLED !== "true"
    || environment.SHOP_SHIPPING_QA_CONFIRM !== SHOP_SHIPPING_QA_CONFIRMATION
    || (!isLoopback(environment.AUTH_URL) && !isLoopback(environment.SITE_URL))
  ) {
    throw new ShopShippingConfigurationError("QA_CONTEXT_REQUIRED");
  }
  return Object.freeze({ enabled: true, scope: "INTERNAL_QA" });
}
