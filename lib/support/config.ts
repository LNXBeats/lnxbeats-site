import "server-only";

type Environment = Readonly<Record<string, string | undefined>>;
export class SupportError extends Error {
  constructor(readonly code: "DISABLED" | "INVALID" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "UNAVAILABLE") {
    super("Le soutien ne peut pas être traité actuellement.");
  }
}

export type SupportMode = "TEST" | "LIVE";

/** The context is independent of checkout switches, so existing payments can
 * settle after closure. LIVE requires an explicit mode and the real deployment. */
export function supportMode(env: Environment = process.env): SupportMode | null {
  if (isSupportTestEnvironment(env)) return "TEST";
  if (env.SUPPORT_TEST_MODE !== "false" || env.PAYMENT_DEPLOYMENT_ENV !== "production"
    || env.RAILWAY_ENVIRONMENT_NAME !== "production") return null;
  try {
    const url = new URL(env.SITE_URL ?? env.AUTH_URL ?? "");
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && ["lnxbeats.fr", "www.lnxbeats.fr"].includes(url.hostname) ? "LIVE" : null;
  } catch { return null; }
}

export function requireSupportEnvironment(expected?: string) {
  const mode = supportMode();
  if (!mode || (expected !== undefined && expected !== mode)) throw new SupportError("DISABLED");
  return mode;
}

/** These scoped opt-ins are deployment decisions backed by external gates,
 * never claims that configuration itself proves provider eligibility. */
export function isSupportProviderEnabled(provider: "STRIPE" | "PAYPAL", env: Environment = process.env) {
  const mode = supportMode(env);
  if (!mode || env.SUPPORT_ENABLED !== "true") return false;
  return mode === "TEST" ? env[`SUPPORT_${provider}_ENABLED`] !== "false"
    : env[`SUPPORT_${provider}_ENABLED`] === "true" && env[`SUPPORT_${provider}_LIVE_APPROVED`] === "true";
}

export function isSupportEnabled(env: Environment = process.env) {
  return isSupportProviderEnabled("STRIPE", env) || isSupportProviderEnabled("PAYPAL", env);
}

export function isSupportTestEnvironment(env: Environment = process.env) {
  if (env.SUPPORT_TEST_MODE !== "true") return false;
  if (env.PAYMENT_DEPLOYMENT_ENV === "production" || env.RAILWAY_ENVIRONMENT_NAME === "production") return false;
  try {
    const url = new URL(env.SITE_URL ?? env.AUTH_URL ?? "");
    return !["lnxbeats.fr", "www.lnxbeats.fr"].includes(url.hostname)
      && (url.protocol === "https:" || ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch { return false; }
}

export function requireSupportTestEnvironment() {
  if (!isSupportTestEnvironment()) throw new SupportError("DISABLED");
}

export function requireSupportEnabled(provider?: "STRIPE" | "PAYPAL") {
  if (provider ? !isSupportProviderEnabled(provider) : !isSupportEnabled()) throw new SupportError("DISABLED");
}

export function supportLimits(env: Environment = process.env) {
  const minimum = Number(env.SUPPORT_MIN_CENTS ?? 100);
  const maximum = Number(env.SUPPORT_MAX_CENTS ?? 50000);
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)
    || minimum < 100 || maximum > 50000 || maximum < minimum) throw new SupportError("DISABLED");
  return { minCents: minimum, maxCents: maximum, currency: "EUR" as const };
}

export function validateSupportAmount(value: unknown) {
  const { minCents, maxCents } = supportLimits();
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minCents || value > maxCents) {
    throw new SupportError("INVALID");
  }
  return value;
}

export function supportBaseUrl() {
  requireSupportEnvironment();
  return new URL(process.env.SITE_URL ?? process.env.AUTH_URL!).origin;
}
