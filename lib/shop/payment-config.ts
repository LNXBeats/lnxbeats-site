import "server-only";

import { parsePaymentsConfiguration } from "@/lib/payments/config";
import type { PaymentProvider } from "@/lib/payments/types";
import { parseShopConfiguration } from "@/lib/shop/config";

type ShopPaymentEnvironment = Readonly<Record<string, string | undefined>>;

export type ShopPaymentConfiguration = Readonly<{
  enabled: boolean;
  configured: boolean;
  providers: Readonly<{
    stripe: boolean;
    paypal: boolean;
  }>;
}>;

export class ShopPaymentConfigurationError extends Error {
  constructor(
    readonly code:
      | "INVALID_SHOP_PAYMENTS_ENABLED"
      | "SHOP_DISABLED"
      | "PAYMENTS_DISABLED"
      | "NO_PROVIDER_ENABLED",
    message: string,
  ) {
    super(message);
    this.name = "ShopPaymentConfigurationError";
  }
}

function exactBoolean(value: string | undefined) {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === "" || normalized === "false") return false;
  if (normalized === "true") return true;
  throw new ShopPaymentConfigurationError(
    "INVALID_SHOP_PAYMENTS_ENABLED",
    "SHOP_PAYMENTS_ENABLED must be true or false.",
  );
}

/**
 * SHOP_PAYMENTS_ENABLED is an additional Checkout-opening kill switch. It is
 * deliberately absent from webhook reconciliation: once a provider attempt
 * exists, disabling the Shop must not discard authentic financial evidence.
 */
export function parseShopPaymentConfiguration(
  environment: ShopPaymentEnvironment = process.env,
): ShopPaymentConfiguration {
  const requested = exactBoolean(environment.SHOP_PAYMENTS_ENABLED);
  const shop = parseShopConfiguration(environment);
  const payments = parsePaymentsConfiguration(environment);
  const providers = {
    stripe: payments.stripe.enabled,
    paypal: payments.paypal.enabled,
  } as const;
  const configured = shop.enabled && payments.enabled && (providers.stripe || providers.paypal);

  if (requested && !shop.enabled) {
    throw new ShopPaymentConfigurationError(
      "SHOP_DISABLED",
      "SHOP_ENABLED must be true before Shop Checkout can be enabled.",
    );
  }
  if (requested && !payments.enabled) {
    throw new ShopPaymentConfigurationError(
      "PAYMENTS_DISABLED",
      "PAYMENTS_ENABLED must be true before Shop Checkout can be enabled.",
    );
  }
  if (requested && !providers.stripe && !providers.paypal) {
    throw new ShopPaymentConfigurationError(
      "NO_PROVIDER_ENABLED",
      "At least one configured payment provider is required for Shop Checkout.",
    );
  }

  return {
    enabled: requested && configured,
    configured,
    providers,
  };
}

export function shopPaymentProvidersAvailable(
  environment: ShopPaymentEnvironment = process.env,
) {
  const configuration = parseShopPaymentConfiguration(environment);
  return configuration.enabled
    ? configuration.providers
    : { stripe: false, paypal: false } as const;
}

export function assertShopPaymentProviderEnabled(
  provider: PaymentProvider,
  environment: ShopPaymentEnvironment = process.env,
) {
  const configuration = parseShopPaymentConfiguration(environment);
  const available = provider === "STRIPE"
    ? configuration.providers.stripe
    : configuration.providers.paypal;
  if (!configuration.enabled || !available) {
    throw new ShopPaymentConfigurationError(
      available ? "PAYMENTS_DISABLED" : "NO_PROVIDER_ENABLED",
      "This Shop payment provider is unavailable.",
    );
  }
  return configuration;
}
