import assert from "node:assert/strict";
import test from "node:test";

import {
  parseShopPaymentConfiguration,
  shopPaymentProvidersAvailable,
  ShopPaymentConfigurationError,
} from "@/lib/shop/payment-config";

const armedEnvironment = {
  NODE_ENV: "test",
  AUTH_URL: "http://127.0.0.1:3000",
  SHOP_ENABLED: "true",
  SHOP_LOCAL_QA_CONFIRM: "enable-local-shop-commerce-qa",
  SHOP_ALLOWED_COUNTRIES: "FR",
  SHOP_RESERVATION_TTL_MINUTES: "30",
  SHOP_PAYMENTS_ENABLED: "true",
  PAYMENTS_ENABLED: "true",
  PAYMENT_DEPLOYMENT_ENV: "development",
  STRIPE_PAYMENTS_ENABLED: "true",
  STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_phase3fixture",
  STRIPE_WEBHOOK_SECRET: "whsec_phase3fixture",
  PAYPAL_PAYMENTS_ENABLED: "false",
} as const;

test("Shop Checkout is disabled by default", () => {
  assert.deepEqual(parseShopPaymentConfiguration({}), {
    enabled: false,
    configured: false,
    providers: { stripe: false, paypal: false },
  });
});

test("the Shop-specific switch arms only an already enabled provider stack", () => {
  assert.deepEqual(parseShopPaymentConfiguration(armedEnvironment), {
    enabled: true,
    configured: true,
    providers: { stripe: true, paypal: false },
  });
  assert.deepEqual(shopPaymentProvidersAvailable(armedEnvironment), {
    stripe: true,
    paypal: false,
  });
});

test("a visible Shop with SHOP_PAYMENTS_ENABLED=false remains non-payable", () => {
  const environment = { ...armedEnvironment, SHOP_PAYMENTS_ENABLED: "false" };
  assert.equal(parseShopPaymentConfiguration(environment).enabled, false);
  assert.deepEqual(shopPaymentProvidersAvailable(environment), {
    stripe: false,
    paypal: false,
  });
});

test("invalid or partially armed switches fail closed", () => {
  assert.throws(
    () => parseShopPaymentConfiguration({ ...armedEnvironment, SHOP_PAYMENTS_ENABLED: "yes" }),
    (error: unknown) => error instanceof ShopPaymentConfigurationError
      && error.code === "INVALID_SHOP_PAYMENTS_ENABLED",
  );
  assert.throws(
    () => parseShopPaymentConfiguration({ ...armedEnvironment, SHOP_ENABLED: "false" }),
    (error: unknown) => error instanceof ShopPaymentConfigurationError
      && error.code === "SHOP_DISABLED",
  );
  assert.throws(
    () => parseShopPaymentConfiguration({ ...armedEnvironment, PAYMENTS_ENABLED: "false" }),
    (error: unknown) => error instanceof ShopPaymentConfigurationError
      && error.code === "PAYMENTS_DISABLED",
  );
});
