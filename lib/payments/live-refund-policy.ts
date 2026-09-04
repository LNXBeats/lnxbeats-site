import "server-only";

import {
  PAYMENT_PRODUCTION_CONFIRMATION,
  parsePaymentsConfiguration,
} from "@/lib/payments/config";
import type { PaymentsConfiguration } from "@/lib/payments/types";

type Environment = Readonly<Record<string, string | undefined>>;

export const LIVE_REFUNDS_PRODUCTION_CONFIRMATION = "enable-production-live-refunds" as const;

export type LiveRefundReadiness = "OFF" | "READY_NOT_ARMED" | "ARMED" | "BLOCKED";

export type LiveRefundProductionPolicy = Readonly<{
  state: LiveRefundReadiness;
  requested: boolean;
  armed: boolean;
  confirmationPresent: boolean;
  confirmationValid: boolean;
  stripeReady: boolean;
  paypalReady: boolean;
  reasons: readonly string[];
}>;

function strictProductionRuntime(environment: Environment) {
  return environment.NODE_ENV === "production"
    && environment.RAILWAY_ENVIRONMENT_NAME === "production"
    && !/staging/i.test(environment.RAILWAY_ENVIRONMENT ?? "");
}

function providerReadiness(configuration: PaymentsConfiguration) {
  return {
    stripeReady: configuration.stripe.enabled
      && configuration.stripe.configured
      && configuration.stripe.mode === "live",
    paypalReady: configuration.paypal.enabled
      && configuration.paypal.configured
      && configuration.paypal.environment === "live",
  };
}

export function evaluateLiveRefundProductionPolicy(
  environment: Environment = process.env,
  suppliedConfiguration?: PaymentsConfiguration,
): LiveRefundProductionPolicy {
  const raw = environment.LIVE_REFUNDS_ENABLED?.trim();
  const requested = raw === "true";
  const confirmation = environment.LIVE_REFUNDS_PRODUCTION_CONFIRM?.trim();
  const confirmationPresent = Boolean(confirmation);
  const confirmationValid = confirmation === LIVE_REFUNDS_PRODUCTION_CONFIRMATION;
  const reasons: string[] = [];

  if (raw !== undefined && raw !== "" && raw !== "false" && raw !== "true") {
    reasons.push("INVALID_LIVE_REFUNDS_FLAG");
  }

  let configuration: PaymentsConfiguration | undefined = suppliedConfiguration;
  if (!configuration) {
    try {
      configuration = parsePaymentsConfiguration(environment);
    } catch {
      reasons.push("INVALID_PAYMENT_CONFIGURATION");
    }
  }

  const readiness = configuration
    ? providerReadiness(configuration)
    : { stripeReady: false, paypalReady: false };

  if (!requested) {
    if (confirmationPresent) reasons.push("CONFIRMATION_PRESENT_WHILE_DISABLED");
    if (reasons.length > 0) {
      return {
        state: "BLOCKED", requested, armed: false, confirmationPresent, confirmationValid,
        ...readiness, reasons,
      };
    }
    const codeReady = configuration?.deploymentEnvironment === "production"
      && configuration.enabled
      && (readiness.stripeReady || readiness.paypalReady);
    return {
      state: codeReady ? "READY_NOT_ARMED" : "OFF",
      requested,
      armed: false,
      confirmationPresent,
      confirmationValid,
      ...readiness,
      reasons,
    };
  }

  if (!configuration) reasons.push("PAYMENTS_CONFIGURATION_UNAVAILABLE");
  if (configuration?.deploymentEnvironment !== "production") reasons.push("PRODUCTION_DEPLOYMENT_REQUIRED");
  if (!strictProductionRuntime(environment)) reasons.push("STRICT_PRODUCTION_RUNTIME_REQUIRED");
  if (!configuration?.enabled) reasons.push("PAYMENTS_MUST_BE_ENABLED");
  if (environment.PAYMENT_PRODUCTION_CONFIRM?.trim() !== PAYMENT_PRODUCTION_CONFIRMATION) {
    reasons.push("PAYMENT_PRODUCTION_CONFIRMATION_REQUIRED");
  }
  if (!confirmationValid) reasons.push("LIVE_REFUNDS_PRODUCTION_CONFIRMATION_REQUIRED");
  if (!readiness.stripeReady && !readiness.paypalReady) reasons.push("LIVE_PROVIDER_REQUIRED");

  const state = reasons.length === 0 ? "ARMED" : "BLOCKED";
  return {
    state,
    requested,
    armed: state === "ARMED",
    confirmationPresent,
    confirmationValid,
    ...readiness,
    reasons,
  };
}

export function assertLiveRefundProductionArmed(
  environment: Environment = process.env,
  configuration?: PaymentsConfiguration,
) {
  const policy = evaluateLiveRefundProductionPolicy(environment, configuration);
  if (!policy.armed) throw new Error("LIVE_REFUNDS_NOT_ARMED");
  return policy;
}
