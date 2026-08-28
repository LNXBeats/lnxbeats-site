import "server-only";

import {
  assertPaypalReconciliationServerEnvironment,
  assertStripeReconciliationServerEnvironment,
  parsePaymentsConfiguration,
} from "@/lib/payments/config";
import {
  loadAndAssertPaymentQaDatabaseEnvironment,
  loadAndAssertPaymentQaRuntimeBaseEnvironment,
} from "@/lib/payments/qa-guard";
import type { PaymentDeploymentEnvironment } from "@/lib/payments/types";
import {
  SHOP_PHASE2_QA_TARGET,
  SHOP_PHASE3B_STRIPE_QA_CONFIRMATION,
  SHOP_PHASE3C_PAYPAL_QA_CONFIRMATION,
} from "@/lib/shop/qa-contract";
import { loadAndAssertShopPhase3CPaypalSandboxQaEnvironment } from "@/lib/shop/paypal-sandbox-qa-guard";
import { loadAndAssertShopPhase3BStripeQaEnvironment } from "@/lib/shop/stripe-test-qa-guard";

type PaymentEnvironment = Record<string, string | undefined>;

export class PaymentRuntimeError extends Error {
  constructor() {
    super("The payment runtime is unavailable.");
    this.name = "PaymentRuntimeError";
  }
}

async function assertPaymentDeploymentRuntimeEnvironment(
  deploymentEnvironment: PaymentDeploymentEnvironment,
  environment: PaymentEnvironment,
  historicalReconciliation: boolean,
) {
  if (deploymentEnvironment === "development") {
    if (
      environment.LNX_DATABASE_TARGET === SHOP_PHASE2_QA_TARGET
      && environment.SHOP_PHASE3C_PAYPAL_QA_CONFIRM === SHOP_PHASE3C_PAYPAL_QA_CONFIRMATION
    ) {
      await loadAndAssertShopPhase3CPaypalSandboxQaEnvironment(environment, { historicalReconciliation });
      return;
    }
    if (
      environment.LNX_DATABASE_TARGET === SHOP_PHASE2_QA_TARGET
      && environment.SHOP_PHASE3B_STRIPE_QA_CONFIRM === SHOP_PHASE3B_STRIPE_QA_CONFIRMATION
    ) {
      await loadAndAssertShopPhase3BStripeQaEnvironment(environment, { historicalReconciliation });
      return;
    }
    if (historicalReconciliation) {
      await loadAndAssertPaymentQaDatabaseEnvironment(environment);
    } else {
      await loadAndAssertPaymentQaRuntimeBaseEnvironment(environment);
    }
    return;
  }

  const expectedRailwayEnvironment = deploymentEnvironment;
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
    deploymentEnvironment === "production"
    && !["lnxbeats.fr", "www.lnxbeats.fr"].includes(new URL(canonicalOrigin).hostname)
  ) throw new PaymentRuntimeError();
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
    await assertPaymentDeploymentRuntimeEnvironment(configuration.deploymentEnvironment, environment, false);
    return configuration;
  } catch (error) {
    if (error instanceof PaymentRuntimeError) throw error;
    throw new PaymentRuntimeError();
  }
}

export async function assertStripeWebhookRuntimeEnvironment(
  environment: PaymentEnvironment = process.env,
) {
  try {
    const configuration = assertStripeReconciliationServerEnvironment(environment);
    await assertPaymentDeploymentRuntimeEnvironment(configuration.deploymentEnvironment, environment, true);
    return configuration;
  } catch (error) {
    if (error instanceof PaymentRuntimeError) throw error;
    throw new PaymentRuntimeError();
  }
}

export async function assertPaypalWebhookRuntimeEnvironment(
  environment: PaymentEnvironment = process.env,
) {
  try {
    const configuration = assertPaypalReconciliationServerEnvironment(environment);
    await assertPaymentDeploymentRuntimeEnvironment(configuration.deploymentEnvironment, environment, true);
    return configuration;
  } catch (error) {
    if (error instanceof PaymentRuntimeError) throw error;
    throw new PaymentRuntimeError();
  }
}
