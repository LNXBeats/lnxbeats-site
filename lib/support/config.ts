import "server-only";

type Environment = Readonly<Record<string, string | undefined>>;
export class SupportError extends Error {
  constructor(readonly code: "DISABLED" | "INVALID" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "UNAVAILABLE") {
    super("Le soutien ne peut pas être traité actuellement.");
  }
}

/** Deliberately test-only. Live activation requires a separate reviewed change. */
export function isSupportEnabled(env: Environment = process.env) {
  if (env.SUPPORT_ENABLED !== "true" || env.SUPPORT_TEST_MODE !== "true") return false;
  return isSupportTestEnvironment(env);
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

export function requireSupportEnabled() {
  if (!isSupportEnabled()) throw new SupportError("DISABLED");
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
  requireSupportEnabled();
  return new URL(process.env.SITE_URL ?? process.env.AUTH_URL!).origin;
}
