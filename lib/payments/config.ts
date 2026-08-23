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
export const PAYMENT_PRODUCTION_CONFIRMATION = "payments-production-live-approved" as const;

type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

export type PaymentConfigurationErrorCode =
  | "INVALID_PAYMENTS_ENABLED"
  | "INVALID_PROVIDER_FLAG"
  | "INVALID_DEPLOYMENT_ENVIRONMENT"
  | "STAGING_CONFIRMATION_REQUIRED"
  | "PRODUCTION_CONFIRMATION_REQUIRED"
  | "NO_PROVIDER_ENABLED"
  | "MODE_ENVIRONMENT_MISMATCH"
  | "INVALID_STRIPE_MODE"
  | "INVALID_SECRET_KEY"
  | "INVALID_WEBHOOK_SECRET"
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
  if (value === "development" || value === "staging" || value === "production") return value;
  throw new PaymentConfigurationError(
    "INVALID_DEPLOYMENT_ENVIRONMENT",
    "PAYMENT_DEPLOYMENT_ENV must be development, staging, or production.",
  );
}

function configuredStripeMode(environment: PaymentEnvironment) {
  const value = optional(environment, "STRIPE_MODE");
  if (value === undefined || value === "test" || value === "live") return value;
  throw new PaymentConfigurationError(
    "INVALID_STRIPE_MODE",
    "STRIPE_MODE must be test or live.",
  );
}

function configuredStripeSecretKey(environment: PaymentEnvironment) {
  const value = optional(environment, "STRIPE_SECRET_KEY");
  if (value === undefined) return undefined;
  if (!/^(?:sk|rk)_(?:test|live)_[A-Za-z0-9_-]{8,}$/.test(value)) {
    throw new PaymentConfigurationError(
      "INVALID_SECRET_KEY",
      "STRIPE_SECRET_KEY must be a Stripe secret or restricted credential.",
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
  if (!/^pk_(?:test|live)_[A-Za-z0-9_-]{8,}$/.test(value)) {
    throw new PaymentConfigurationError(
      "INVALID_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a Stripe publishable key.",
    );
  }
  return value;
}

function parseStripeConfiguration(
  environment: PaymentEnvironment,
  enabled: boolean,
  deploymentEnvironment: PaymentDeploymentEnvironment,
): StripePaymentConfiguration {
  const mode = configuredStripeMode(environment);
  const secretKey = configuredStripeSecretKey(environment);
  const webhookSecret = configuredStripeWebhookSecret(environment);
  const publishableKey = configuredStripePublishableKey(environment);
  const secretMode = secretKey?.includes("_live_") ? "live" : secretKey?.includes("_test_") ? "test" : undefined;
  const publishableMode = publishableKey?.startsWith("pk_live_") ? "live" : publishableKey?.startsWith("pk_test_") ? "test" : undefined;
  if (!mode && (secretKey || webhookSecret || publishableKey)) {
    throw new PaymentConfigurationError("INCOMPLETE_CONFIGURATION", "STRIPE_MODE is required when Stripe credentials are present.");
  }
  if ((mode && secretMode && mode !== secretMode) || (mode && publishableMode && mode !== publishableMode)) {
    throw new PaymentConfigurationError("MODE_ENVIRONMENT_MISMATCH", "Stripe credentials do not match STRIPE_MODE.");
  }
  if (mode && ((deploymentEnvironment === "production") !== (mode === "live"))) {
    throw new PaymentConfigurationError("MODE_ENVIRONMENT_MISMATCH", "Stripe mode does not match the payment deployment environment.");
  }
  const configured = mode !== undefined && secretMode === mode && webhookSecret !== undefined;

  if (!enabled) {
    return {
      provider: "stripe",
      enabled: false,
      configured,
      mode: configured ? mode : "disabled",
      apiVersion: STRIPE_API_VERSION,
    };
  }
  if (!configured || !mode || !secretKey || !webhookSecret) {
    throw new PaymentConfigurationError(
      "INCOMPLETE_CONFIGURATION",
      "Stripe payments are enabled but their configuration is incomplete.",
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
  if (value === undefined || value === "sandbox" || value === "live") return value;
  throw new PaymentConfigurationError(
    "INVALID_PAYPAL_ENVIRONMENT",
    "PAYPAL_ENVIRONMENT must be sandbox or live.",
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
  deploymentEnvironment: PaymentDeploymentEnvironment,
): PaypalPaymentConfiguration {
  const paypalEnvironment = configuredPaypalEnvironment(environment);
  const clientId = configuredPaypalCredential(environment, "PAYPAL_CLIENT_ID");
  const clientSecret = configuredPaypalCredential(environment, "PAYPAL_CLIENT_SECRET");
  const webhookId = configuredPaypalCredential(environment, "PAYPAL_WEBHOOK_ID");
  if (!paypalEnvironment && (clientId || clientSecret || webhookId)) {
    throw new PaymentConfigurationError("INCOMPLETE_CONFIGURATION", "PAYPAL_ENVIRONMENT is required when PayPal credentials are present.");
  }
  if (
    paypalEnvironment
    && ((deploymentEnvironment === "production") !== (paypalEnvironment === "live"))
  ) {
    throw new PaymentConfigurationError("MODE_ENVIRONMENT_MISMATCH", "PayPal environment does not match the payment deployment environment.");
  }
  const configured = paypalEnvironment !== undefined
    && clientId !== undefined
    && clientSecret !== undefined
    && webhookId !== undefined;

  if (!enabled) {
    return {
      provider: "paypal",
      enabled: false,
      configured,
      environment: configured ? paypalEnvironment : "disabled",
    };
  }
  if (!configured || !paypalEnvironment) {
    throw new PaymentConfigurationError(
      "INCOMPLETE_CONFIGURATION",
      "PayPal payments are enabled but their configuration is incomplete.",
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
  if (
    enabled
    && deploymentEnvironment === "production"
    && optional(environment, "PAYMENT_PRODUCTION_CONFIRM") !== PAYMENT_PRODUCTION_CONFIRMATION
  ) {
    throw new PaymentConfigurationError(
      "PRODUCTION_CONFIRMATION_REQUIRED",
      "Production live payments require their explicit confirmation.",
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
    stripe: parseStripeConfiguration(environment, enabled && stripeRequested, deploymentEnvironment),
    paypal: parsePaypalConfiguration(environment, enabled && paypalRequested, deploymentEnvironment),
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
