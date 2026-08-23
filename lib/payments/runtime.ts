import "server-only";

import { parsePaymentsConfiguration } from "@/lib/payments/config";
import { loadAndAssertPaymentQaRuntimeBaseEnvironment } from "@/lib/payments/qa-guard";

type PaymentEnvironment = Record<string, string | undefined>;

export class PaymentRuntimeError extends Error {
  constructor() {
    super("The payment runtime is unavailable.");
    this.name = "PaymentRuntimeError";
  }
}

function canonicalHttpsOrigin(value: string | undefined) {
  if (!value) throw new PaymentRuntimeError();
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) throw new PaymentRuntimeError();
  return url.origin;
}

/**
 * Shared runtime gate for every provider route. Development remains bound to
 * the disposable Prisma QA proof; deployed runtimes require Railway's exact
 * named environment plus a canonical HTTPS origin.
 */
export async function assertPaymentsRuntimeEnvironment(
  environment: PaymentEnvironment = process.env,
) {
  try {
    const configuration = parsePaymentsConfiguration(environment);
    if (!configuration.enabled) throw new PaymentRuntimeError();

    if (configuration.deploymentEnvironment === "development") {
      await loadAndAssertPaymentQaRuntimeBaseEnvironment(environment);
      return configuration;
    }

    const expectedRailwayEnvironment = configuration.deploymentEnvironment;
    if (
      environment.NODE_ENV !== "production"
      || environment.RAILWAY_ENVIRONMENT_NAME !== expectedRailwayEnvironment
      || (expectedRailwayEnvironment === "staging" && /production/i.test(environment.RAILWAY_ENVIRONMENT ?? ""))
      || (expectedRailwayEnvironment === "production" && /staging/i.test(environment.RAILWAY_ENVIRONMENT ?? ""))
    ) throw new PaymentRuntimeError();

    const canonicalOrigin = canonicalHttpsOrigin(
      environment.APP_CANONICAL_URL ?? environment.AUTH_URL ?? environment.SITE_URL,
    );
    if (
      (environment.AUTH_URL && canonicalHttpsOrigin(environment.AUTH_URL) !== canonicalOrigin)
      || (environment.SITE_URL && canonicalHttpsOrigin(environment.SITE_URL) !== canonicalOrigin)
    ) throw new PaymentRuntimeError();

    if (
      configuration.deploymentEnvironment === "production"
      && !["lnxbeats.fr", "www.lnxbeats.fr"].includes(new URL(canonicalOrigin).hostname)
    ) throw new PaymentRuntimeError();

    return configuration;
  } catch (error) {
    if (error instanceof PaymentRuntimeError) throw error;
    throw new PaymentRuntimeError();
  }
}
