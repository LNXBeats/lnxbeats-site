import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPaypalServerEnvironment,
  parsePaymentConfiguration,
  parsePaymentsConfiguration,
  assertPaymentServerEnvironment,
  paymentHealthSummary,
  PaymentConfigurationError,
  STRIPE_API_VERSION,
} from "@/lib/payments/config";

const completeTestEnvironment = {
  PAYMENTS_ENABLED: "true",
  STRIPE_PAYMENTS_ENABLED: "true",
  STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: ["sk", "test", "payment-config-fixture"].join("_"),
  STRIPE_WEBHOOK_SECRET: ["whsec", "payment-config-fixture"].join("_"),
} as const;

test("payments are disabled safely when no Stripe configuration exists", () => {
  assert.deepEqual(parsePaymentConfiguration({}), {
    provider: "stripe",
    enabled: false,
    configured: false,
    mode: "disabled",
    apiVersion: "2026-07-29.dahlia",
  });
  assert.equal(STRIPE_API_VERSION, "2026-07-29.dahlia");
});

test("enabled payments require a complete explicit test configuration", () => {
  const configuration = parsePaymentConfiguration(completeTestEnvironment);
  assert.deepEqual(configuration, {
    provider: "stripe",
    enabled: true,
    configured: true,
    mode: "test",
    apiVersion: "2026-07-29.dahlia",
    secretKey: ["sk", "test", "payment-config-fixture"].join("_"),
    webhookSecret: ["whsec", "payment-config-fixture"].join("_"),
  });

  for (const environment of [
    { PAYMENTS_ENABLED: "true", STRIPE_PAYMENTS_ENABLED: "true" },
    { ...completeTestEnvironment, STRIPE_MODE: undefined },
    { ...completeTestEnvironment, STRIPE_SECRET_KEY: undefined },
    { ...completeTestEnvironment, STRIPE_WEBHOOK_SECRET: undefined },
  ]) {
    assert.throws(
      () => parsePaymentConfiguration(environment),
      (error) => error instanceof PaymentConfigurationError
        && error.code === "INCOMPLETE_CONFIGURATION",
    );
  }
});

test("PayPal is explicit, complete, sandbox-only and secret-free in health data", () => {
  const paypalEnvironment = {
    PAYMENTS_ENABLED: "true",
    PAYPAL_PAYMENTS_ENABLED: "true",
    PAYPAL_ENVIRONMENT: "sandbox",
    PAYPAL_CLIENT_ID: "paypal-client-fixture",
    PAYPAL_CLIENT_SECRET: "paypal-secret-fixture",
    PAYPAL_WEBHOOK_ID: "paypal-webhook-fixture",
  } as const;
  const configuration = parsePaymentsConfiguration(paypalEnvironment);
  assert.equal(configuration.stripe.enabled, false);
  assert.deepEqual(configuration.paypal, {
    provider: "paypal",
    enabled: true,
    configured: true,
    environment: "sandbox",
    clientId: "paypal-client-fixture",
    clientSecret: "paypal-secret-fixture",
    webhookId: "paypal-webhook-fixture",
  });
  assert.equal(assertPaypalServerEnvironment(paypalEnvironment).environment, "sandbox");

  for (const environment of [
    { ...paypalEnvironment, PAYPAL_CLIENT_ID: undefined },
    { ...paypalEnvironment, PAYPAL_CLIENT_SECRET: undefined },
    { ...paypalEnvironment, PAYPAL_WEBHOOK_ID: undefined },
  ]) {
    assert.throws(
      () => parsePaymentsConfiguration(environment),
      (error) => error instanceof PaymentConfigurationError
        && error.code === "INCOMPLETE_CONFIGURATION",
    );
  }
  assert.throws(
    () => parsePaymentsConfiguration({ ...paypalEnvironment, PAYPAL_ENVIRONMENT: "live" }),
    (error) => error instanceof PaymentConfigurationError && error.code === "LIVE_MODE_FORBIDDEN",
  );
});

test("a disabled foundation may be preconfigured without becoming reachable", () => {
  const configuration = parsePaymentConfiguration({
    ...completeTestEnvironment,
    PAYMENTS_ENABLED: "false",
    STRIPE_SECRET_KEY: ["rk", "test", "restricted-payment-config-fixture"].join("_"),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: ["pk", "test", "payment-config-fixture"].join("_"),
  });
  assert.deepEqual(configuration, {
    provider: "stripe",
    enabled: false,
    configured: true,
    mode: "test",
    apiVersion: "2026-07-29.dahlia",
  });
  assert.equal("secretKey" in configuration, false);
  assert.equal("webhookSecret" in configuration, false);
  assert.equal("publishableKey" in configuration, false);
});

test("live, malformed and ambiguous configurations fail closed", () => {
  const rejected = [
    [{ PAYMENTS_ENABLED: "yes" }, "INVALID_PAYMENTS_ENABLED"],
    [{ PAYMENTS_ENABLED: "true", STRIPE_PAYMENTS_ENABLED: "sometimes" }, "INVALID_PROVIDER_FLAG"],
    [{ PAYMENTS_ENABLED: "false", STRIPE_MODE: "live" }, "LIVE_MODE_FORBIDDEN"],
    [{ PAYMENTS_ENABLED: "false", STRIPE_MODE: "sandbox" }, "INVALID_STRIPE_MODE"],
    [{ PAYMENTS_ENABLED: "false", STRIPE_SECRET_KEY: ["sk", "live", "forbidden"].join("_") }, "LIVE_SECRET_KEY_FORBIDDEN"],
    [{ PAYMENTS_ENABLED: "false", STRIPE_SECRET_KEY: ["rk", "live", "forbidden"].join("_") }, "LIVE_SECRET_KEY_FORBIDDEN"],
    [{ PAYMENTS_ENABLED: "false", STRIPE_SECRET_KEY: "secret" }, "INVALID_SECRET_KEY"],
    [{ PAYMENTS_ENABLED: "false", STRIPE_WEBHOOK_SECRET: "webhook" }, "INVALID_WEBHOOK_SECRET"],
    [{ PAYMENTS_ENABLED: "false", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: ["pk", "live", "forbidden"].join("_") }, "LIVE_PUBLISHABLE_KEY_FORBIDDEN"],
    [{ PAYMENTS_ENABLED: "false", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "publishable" }, "INVALID_PUBLISHABLE_KEY"],
  ] as const;

  for (const [environment, expectedCode] of rejected) {
    assert.throws(
      () => parsePaymentConfiguration(environment),
      (error) => error instanceof PaymentConfigurationError
        && error.code === expectedCode,
    );
  }

  const credential = "not-a-valid-key-private-sentinel";
  assert.throws(
    () => parsePaymentConfiguration({ STRIPE_SECRET_KEY: credential }),
    (error) => error instanceof PaymentConfigurationError
      && error.code === "INVALID_SECRET_KEY"
      && !error.message.includes(credential),
  );
});

test("the health summary cannot expose payment credentials", () => {
  const configuration = parsePaymentConfiguration({
    ...completeTestEnvironment,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: ["pk", "test", "payment-config-fixture"].join("_"),
  });
  const summary = paymentHealthSummary(configuration);
  assert.deepEqual(summary, {
    provider: "stripe",
    enabled: true,
    configured: true,
    mode: "test",
    apiVersion: "2026-07-29.dahlia",
  });
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /sk_test_|rk_test_|whsec_|pk_test_/);
});

test("provider configuration remains sandbox-only and staging requires explicit confirmation", () => {
  assert.throws(() => assertPaymentServerEnvironment({
    ...completeTestEnvironment,
    PAYMENT_DEPLOYMENT_ENV: "staging",
  }));
  assert.throws(() => assertPaymentServerEnvironment({
    ...completeTestEnvironment,
    PAYMENT_DEPLOYMENT_ENV: "production",
  }));
  assert.equal(assertPaymentServerEnvironment({
    ...completeTestEnvironment,
    NODE_ENV: "test",
  }).mode, "test");
});
