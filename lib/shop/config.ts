const COUNTRY_CODE = /^[A-Z]{2}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const LOCAL_QA_CONFIRMATION = "enable-local-shop-commerce-qa";
export type ShopConfiguration = Readonly<{
  enabled: boolean;
  pricingSource: "legacy";
  allowedCountries: readonly string[];
  reservationTtlMinutes: number;
  commerceConfigured: boolean;
}>;

function exactBoolean(value: string | undefined, name: string) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${name} must be either true or false.`);
}

function parseAllowedCountries(value: string | undefined) {
  if (value === undefined || value.trim() === "") return Object.freeze([] as string[]);
  const raw = value.split(",").map((country) => country.trim());
  if (raw.some((country) => !COUNTRY_CODE.test(country))) {
    throw new Error("SHOP_ALLOWED_COUNTRIES must be a comma-separated ISO 3166-1 alpha-2 allowlist.");
  }
  if (new Set(raw).size !== raw.length) {
    throw new Error("SHOP_ALLOWED_COUNTRIES must not contain duplicates.");
  }
  return Object.freeze(raw);
}

function parseReservationTtl(value: string | undefined) {
  if (value === undefined || value.trim() === "") return 0;
  const serialized = value;
  if (!/^\d+$/.test(serialized)) {
    throw new Error("SHOP_RESERVATION_TTL_MINUTES must be an integer.");
  }
  const parsed = Number(serialized);
  if (!Number.isSafeInteger(parsed) || parsed < 5 || parsed > 120) {
    throw new Error("SHOP_RESERVATION_TTL_MINUTES must be between 5 and 120.");
  }
  return parsed;
}

function assertLocalQaArmament(environment: Readonly<Record<string, string | undefined>>) {
  if (environment.NODE_ENV === "production") {
    throw new Error("SHOP_ENABLED=true is forbidden in a production runtime during Phase 2.");
  }
  if (environment.SHOP_LOCAL_QA_CONFIRM !== LOCAL_QA_CONFIRMATION) {
    throw new Error(`SHOP_LOCAL_QA_CONFIRM must equal ${LOCAL_QA_CONFIRMATION}.`);
  }
  const baseUrl = environment.AUTH_URL ?? environment.SITE_URL;
  if (!baseUrl) throw new Error("A loopback AUTH_URL or SITE_URL is required for local Shop QA.");
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    throw new Error("The local Shop QA base URL is invalid.");
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error("SHOP_ENABLED=true is restricted to an explicit loopback preview during Phase 2.");
  }
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

  const enabled = exactBoolean(environment.SHOP_ENABLED, "SHOP_ENABLED");
  const allowedCountries = parseAllowedCountries(environment.SHOP_ALLOWED_COUNTRIES);
  const reservationTtlMinutes = parseReservationTtl(environment.SHOP_RESERVATION_TTL_MINUTES);
  const commerceConfigured = allowedCountries.length > 0 && reservationTtlMinutes >= 5;
  if (enabled) {
    assertLocalQaArmament(environment);
    if (!commerceConfigured) {
      throw new Error(
        "SHOP_ALLOWED_COUNTRIES and SHOP_RESERVATION_TTL_MINUTES are required before enabling the Shop.",
      );
    }
  }

  return {
    enabled,
    pricingSource,
    allowedCountries,
    reservationTtlMinutes,
    commerceConfigured,
  };
}

export function shopHealthSummary(configuration: ShopConfiguration) {
  return {
    enabled: configuration.enabled,
    pricingSource: configuration.pricingSource,
    commerceConfigured: configuration.commerceConfigured,
  } as const;
}
