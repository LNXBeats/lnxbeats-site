import "server-only";

import type {
  PaymentConfiguration,
  PaymentDeploymentEnvironment,
  PaymentHealthSummary,
  PaymentsConfiguration,
  PaymentsHealthSummary,
  PaypalPaymentConfiguration,
  StripePaymentConfiguration,
} from "@/lib/payments/types";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;
export const PAYMENT_STAGING_CONFIRMATION = "payments-staging-sandbox-approved" as const;

type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

export type PaymentConfigurationErrorCode =
  | "INVALID_PAYMENTS_ENABLED"
  | "INVALID_PROVIDER_FLAG"
  | "INVALID_DEPLOYMENT_ENVIRONMENT"
  | "STAGING_CONFIRMATION_REQUIRED"
  | "NO_PROVIDER_ENABLED"
  | "LIVE_MODE_FORBIDDEN"
  | "INVALID_STRIPE_MODE"
  | "LIVE_SECRET_KEY_FORBIDDEN"
  | "INVALID_SECRET_KEY"
  | "INVALID_WEBHOOK_SECRET"
  | "LIVE_PUBLISHABLE_KEY_FORBIDDEN"
  | "INVALID_PUBLISHABLE_KEY"
  | "INVALID_PAYPAL_ENVIRONMENT"
  | "INVALID_PAYPAL_CLIENT_ID"
  | "INVALID_PAYPAL_CLIENT_SECRET"
  | "INVALID_PAYPAL_WEBHOOK_ID"
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

function booleanFlag(
  environment: PaymentEnvironment,
  name: string,
  errorCode: "INVALID_PAYMENTS_ENABLED" | "INVALID_PROVIDER_FLAG",
) {
  const value = optional(environment, name);
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new PaymentConfigurationError(errorCode, `${name} must be true or false.`);
}

function configuredDeploymentEnvironment(
  environment: PaymentEnvironment,
): PaymentDeploymentEnvironment {
  const value = optional(environment, "PAYMENT_DEPLOYMENT_ENV") ?? "development";
  if (value === "development" || value === "staging") return value;
  throw new PaymentConfigurationError(
    value === "production" ? "LIVE_MODE_FORBIDDEN" : "INVALID_DEPLOYMENT_ENVIRONMENT",
    "Payments are restricted to development or staging sandbox runtimes.",
  );
}

function configuredStripeMode(environment: PaymentEnvironment) {
  const value = optional(environment, "STRIPE_MODE");
  if (value === undefined || value === "test") return value;
  if (value === "live") {
    throw new PaymentConfigurationError(
      "LIVE_MODE_FORBIDDEN",
      "Live Stripe mode is forbidden in V0.7.4.",
    );
  }
  throw new PaymentConfigurationError(
    "INVALID_STRIPE_MODE",
    "STRIPE_MODE must be test in V0.7.4.",
  );
}

function configuredStripeSecretKey(environment: PaymentEnvironment) {
  const value = optional(environment, "STRIPE_SECRET_KEY");
  if (value === undefined) return undefined;
  if (/^(?:sk|rk)_live_/.test(value)) {
    throw new PaymentConfigurationError(
      "LIVE_SECRET_KEY_FORBIDDEN",
      "A live Stripe credential is forbidden in V0.7.4.",
    );
  }
  if (!/^(?:sk|rk)_test_[A-Za-z0-9_-]{8,}$/.test(value)) {
    throw new PaymentConfigurationError(
      "INVALID_SECRET_KEY",
      "STRIPE_SECRET_KEY must be a Stripe test or restricted test credential.",
    );
  }
  return value;
}

function configuredStripeWebhookSecret(environment: PaymentEnvironment) {
  const value = optional(environment, "STRIPE_WEBHOOK_SECRET");
  if (value === undefined) return undefined;
  if (!/^whsec_[A-Za-z0-9_-]{8,}$/.test(value)) {
    throw new PaymentConfigurationError(
      "INVALID_WEBHOOK_SECRET",
      "STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret.",
    );
  }
  return value;
}

function configuredStripePublishableKey(environment: PaymentEnvironment) {
  const value = optional(environment, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  if (value === undefined) return undefined;
  if (/^pk_live_/.test(value)) {
    throw new PaymentConfigurationError(
      "LIVE_PUBLISHABLE_KEY_FORBIDDEN",
      "A live Stripe publishable key is forbidden in V0.7.4.",
    );
  }
  if (!/^pk_test_[A-Za-z0-9_-]{8,}$/.test(value)) {
    throw new PaymentConfigurationError(
      "INVALID_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a Stripe test publishable key.",
    );
  }
  return value;
}

function parseStripeConfiguration(
  environment: PaymentEnvironment,
  enabled: boolean,
): StripePaymentConfiguration {
  const mode = configuredStripeMode(environment);
  const secretKey = configuredStripeSecretKey(environment);
  const webhookSecret = configuredStripeWebhookSecret(environment);
  const publishableKey = configuredStripePublishableKey(environment);
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

function configuredPaypalEnvironment(environment: PaymentEnvironment) {
  const value = optional(environment, "PAYPAL_ENVIRONMENT");
  if (value === undefined || value === "sandbox") return value;
  if (value === "live" || value === "production") {
    throw new PaymentConfigurationError(
      "LIVE_MODE_FORBIDDEN",
      "PayPal production mode is forbidden in V0.7.4.",
    );
  }
  throw new PaymentConfigurationError(
    "INVALID_PAYPAL_ENVIRONMENT",
    "PAYPAL_ENVIRONMENT must be sandbox in V0.7.4.",
  );
}

function configuredPaypalCredential(
  environment: PaymentEnvironment,
  name: "PAYPAL_CLIENT_ID" | "PAYPAL_CLIENT_SECRET" | "PAYPAL_WEBHOOK_ID",
) {
  const value = optional(environment, name);
  if (value === undefined) return undefined;
  const valid = name === "PAYPAL_WEBHOOK_ID"
    ? /^[A-Za-z0-9_-]{6,255}$/.test(value)
    : /^[A-Za-z0-9_-]{12,255}$/.test(value);
  if (!valid) {
    const code = name === "PAYPAL_CLIENT_ID"
      ? "INVALID_PAYPAL_CLIENT_ID"
      : name === "PAYPAL_CLIENT_SECRET"
        ? "INVALID_PAYPAL_CLIENT_SECRET"
        : "INVALID_PAYPAL_WEBHOOK_ID";
    throw new PaymentConfigurationError(code, `${name} is invalid.`);
  }
  return value;
}

function parsePaypalConfiguration(
  environment: PaymentEnvironment,
  enabled: boolean,
): PaypalPaymentConfiguration {
  const paypalEnvironment = configuredPaypalEnvironment(environment);
  const clientId = configuredPaypalCredential(environment, "PAYPAL_CLIENT_ID");
  const clientSecret = configuredPaypalCredential(environment, "PAYPAL_CLIENT_SECRET");
  const webhookId = configuredPaypalCredential(environment, "PAYPAL_WEBHOOK_ID");
  const configured = paypalEnvironment === "sandbox"
    && clientId !== undefined
    && clientSecret !== undefined
    && webhookId !== undefined;

  if (!enabled) {
    return {
      provider: "paypal",
      enabled: false,
      configured,
      environment: configured ? "sandbox" : "disabled",
    };
  }
  if (!configured || paypalEnvironment !== "sandbox") {
    throw new PaymentConfigurationError(
      "INCOMPLETE_CONFIGURATION",
      "PayPal payments are enabled but their sandbox configuration is incomplete.",
    );
  }
  return {
    provider: "paypal",
    enabled: true,
    configured: true,
    environment: paypalEnvironment,
    clientId,
    clientSecret,
    webhookId,
  };
}

export function parsePaymentsConfiguration(
  environment: PaymentEnvironment = process.env,
): PaymentsConfiguration {
  const enabled = booleanFlag(environment, "PAYMENTS_ENABLED", "INVALID_PAYMENTS_ENABLED");
  const deploymentEnvironment = configuredDeploymentEnvironment(environment);
  const stripeRequested = booleanFlag(environment, "STRIPE_PAYMENTS_ENABLED", "INVALID_PROVIDER_FLAG");
  const paypalRequested = booleanFlag(environment, "PAYPAL_PAYMENTS_ENABLED", "INVALID_PROVIDER_FLAG");

  if (
    enabled
    && deploymentEnvironment === "staging"
    && optional(environment, "PAYMENT_STAGING_CONFIRM") !== PAYMENT_STAGING_CONFIRMATION
  ) {
    throw new PaymentConfigurationError(
      "STAGING_CONFIRMATION_REQUIRED",
      "Staging sandbox payments require their explicit confirmation.",
    );
  }
  if (enabled && !stripeRequested && !paypalRequested) {
    throw new PaymentConfigurationError(
      "NO_PROVIDER_ENABLED",
      "Payments are enabled but no provider is explicitly enabled.",
    );
  }

  return {
    enabled,
    deploymentEnvironment,
    stripe: parseStripeConfiguration(environment, enabled && stripeRequested),
    paypal: parsePaypalConfiguration(environment, enabled && paypalRequested),
  };
}

/** Legacy Stripe-only accessor kept for the existing Stripe adapter. */
export function parsePaymentConfiguration(
  environment: PaymentEnvironment = process.env,
): PaymentConfiguration {
  return parsePaymentsConfiguration(environment).stripe;
}

export function assertPaymentServerEnvironment(
  environment: PaymentEnvironment = process.env,
) {
  const configuration = parsePaymentsConfiguration(environment);
  if (!configuration.stripe.enabled) {
    throw new PaymentConfigurationError(
      "INCOMPLETE_CONFIGURATION",
      "Stripe payments are unavailable.",
    );
  }
  return configuration.stripe;
}

export function assertPaypalServerEnvironment(
  environment: PaymentEnvironment = process.env,
) {
  const configuration = parsePaymentsConfiguration(environment);
  if (!configuration.paypal.enabled) {
    throw new PaymentConfigurationError(
      "INCOMPLETE_CONFIGURATION",
      "PayPal payments are unavailable.",
    );
  }
  return configuration.paypal;
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

export function paymentsHealthSummary(
  configuration: PaymentsConfiguration,
): PaymentsHealthSummary {
  return {
    enabled: configuration.enabled,
    deploymentEnvironment: configuration.deploymentEnvironment,
    providers: {
      stripe: paymentHealthSummary(configuration.stripe),
      paypal: {
        provider: configuration.paypal.provider,
        enabled: configuration.paypal.enabled,
        configured: configuration.paypal.configured,
        environment: configuration.paypal.environment,
      },
    },
  };
}
