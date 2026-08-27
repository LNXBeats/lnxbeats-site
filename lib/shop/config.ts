export type ShopConfiguration = Readonly<{
  enabled: false;
  pricingSource: "legacy";
}>;

function exactBoolean(value: string | undefined, name: string) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${name} must be either true or false.`);
}

export function parseShopConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ShopConfiguration {
  const pricingSource = environment.MUSIC_PRICING_SOURCE || "legacy";
  if (pricingSource !== "legacy") {
    throw new Error(
      "MUSIC_PRICING_SOURCE must remain legacy until the dedicated financial cutover.",
    );
  }

  const shopRequested = exactBoolean(environment.SHOP_ENABLED, "SHOP_ENABLED");
  if (shopRequested) {
    throw new Error("SHOP_ENABLED must remain false during the V1.1 foundation phase.");
  }

  return { enabled: false, pricingSource };
}

export function shopHealthSummary(configuration: ShopConfiguration) {
  return {
    enabled: configuration.enabled,
    pricingSource: configuration.pricingSource,
  } as const;
}
