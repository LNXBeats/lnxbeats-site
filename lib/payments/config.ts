import "server-only";

import type {
  PaymentConfiguration,
  PaymentHealthSummary,
} from "@/lib/payments/types";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

export type PaymentConfigurationErrorCode =
  | "INVALID_PAYMENTS_ENABLED"
  | "LIVE_MODE_FORBIDDEN"
  | "INVALID_STRIPE_MODE"
  | "LIVE_SECRET_KEY_FORBIDDEN"
  | "INVALID_SECRET_KEY"
  | "INVALID_WEBHOOK_SECRET"
  | "LIVE_PUBLISHABLE_KEY_FORBIDDEN"
  | "INVALID_PUBLISHABLE_KEY"
  | "INCOMPLETE_CONFIGURATION";

export class PaymentConfigurationError extends Error {
  constructor(readonly code: PaymentConfigurationErrorCode, message: string) {
    super(message);
    this.name = "PaymentConfigurationError";
  }
}

function optional(environment: PaymentEnvironment, name: string) {
  return environment[name]?.trim() || undefined;
}

function configuredFlag(environment: PaymentEnvironment) {
  const value = optional(environment, "PAYMENTS_ENABLED");
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new PaymentConfigurationError(
    "INVALID_PAYMENTS_ENABLED",
    "PAYMENTS_ENABLED must be true or false.",
  );
}

function configuredMode(environment: PaymentEnvironment) {
  const value = optional(environment, "STRIPE_MODE");
  if (value === undefined || value === "test") return value;
  if (value === "live") {
    throw new PaymentConfigurationError(
      "LIVE_MODE_FORBIDDEN",
      "Live Stripe mode is forbidden in the V0.7 payment foundation.",
    );
  }
  throw new PaymentConfigurationError(
    "INVALID_STRIPE_MODE",
    "STRIPE_MODE must be test in the V0.7 payment foundation.",
  );
}

function configuredSecretKey(environment: PaymentEnvironment) {
  const value = optional(environment, "STRIPE_SECRET_KEY");
  if (value === undefined) return undefined;
  if (/^(?:sk|rk)_live_/.test(value)) {
    throw new PaymentConfigurationError(
      "LIVE_SECRET_KEY_FORBIDDEN",
      "A live Stripe credential is forbidden in the V0.7 payment foundation.",
    );
  }
  if (!/^(?:sk|rk)_test_[A-Za-z0-9_\-]{8,}$/.test(value)) {
    throw new PaymentConfigurationError(
      "INVALID_SECRET_KEY",
      "STRIPE_SECRET_KEY must be a Stripe test or restricted test credential.",
    );
  }
  return value;
}

function configuredWebhookSecret(environment: PaymentEnvironment) {
  const value = optional(environment, "STRIPE_WEBHOOK_SECRET");
  if (value === undefined) return undefined;
  if (!/^whsec_[A-Za-z0-9_\-]{8,}$/.test(value)) {
    throw new PaymentConfigurationError(
      "INVALID_WEBHOOK_SECRET",
      "STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret.",
    );
  }
  return value;
}

function configuredPublishableKey(environment: PaymentEnvironment) {
  const value = optional(environment, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  if (value === undefined) return undefined;
  if (/^pk_live_/.test(value)) {
    throw new PaymentConfigurationError(
      "LIVE_PUBLISHABLE_KEY_FORBIDDEN",
      "A live Stripe publishable key is forbidden in the V0.7 payment foundation.",
    );
  }
  if (!/^pk_test_[A-Za-z0-9_\-]{8,}$/.test(value)) {
    throw new PaymentConfigurationError(
      "INVALID_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a Stripe test publishable key.",
    );
  }
  return value;
}

export function parsePaymentConfiguration(
  environment: PaymentEnvironment = process.env,
): PaymentConfiguration {
  const enabled = configuredFlag(environment);
  const mode = configuredMode(environment);
  const secretKey = configuredSecretKey(environment);
  const webhookSecret = configuredWebhookSecret(environment);
  const publishableKey = configuredPublishableKey(environment);
  const configured = mode === "test" && secretKey !== undefined && webhookSecret !== undefined;

  if (!enabled) {
    return {
      provider: "stripe",
      enabled: false,
      configured,
      mode: configured ? "test" : "disabled",
      apiVersion: STRIPE_API_VERSION,
    };
  }

  if (!configured || mode !== "test") {
    throw new PaymentConfigurationError(
      "INCOMPLETE_CONFIGURATION",
      "Stripe payments are enabled but their test configuration is incomplete.",
    );
  }

  return {
    provider: "stripe",
    enabled: true,
    configured: true,
    mode,
    apiVersion: STRIPE_API_VERSION,
    secretKey,
    webhookSecret,
    ...(publishableKey ? { publishableKey } : {}),
  };
}

export function assertPaymentServerEnvironment(environment: PaymentEnvironment = process.env) {
  const configuration = parsePaymentConfiguration(environment);
  if (!configuration.enabled) {
    throw new PaymentConfigurationError(
      "INCOMPLETE_CONFIGURATION",
      "Stripe payments are unavailable.",
    );
  }
  if (environment.RAILWAY_ENVIRONMENT) {
    throw new PaymentConfigurationError(
      "LIVE_MODE_FORBIDDEN",
      "Stripe V0.7 test payments are forbidden on Railway.",
    );
  }
  if (environment.NODE_ENV === "production") {
    throw new PaymentConfigurationError(
      "LIVE_MODE_FORBIDDEN",
      "Stripe V0.7 test payments are forbidden in a production runtime.",
    );
  }
  return configuration;
}

export function paymentHealthSummary(
  configuration: PaymentConfiguration,
): PaymentHealthSummary {
  return {
    provider: configuration.provider,
    enabled: configuration.enabled,
    configured: configuration.configured,
    mode: configuration.mode,
    apiVersion: configuration.apiVersion,
  };
}
