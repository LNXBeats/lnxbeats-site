import assert from "node:assert/strict";
import test from "node:test";

import {
  PAYMENT_PRODUCTION_CONFIRMATION,
  PAYMENT_STAGING_CONFIRMATION,
} from "@/lib/payments/config";
import {
  assertPaymentsRuntimeEnvironment,
  assertPaypalWebhookRuntimeEnvironment,
  assertStripeWebhookRuntimeEnvironment,
  PaymentRuntimeError,
} from "@/lib/payments/runtime";

const staging = {
  PAYMENTS_ENABLED: "true",
  PAYMENT_DEPLOYMENT_ENV: "staging",
  PAYMENT_STAGING_CONFIRM: PAYMENT_STAGING_CONFIRMATION,
  PAYPAL_PAYMENTS_ENABLED: "true",
  PAYPAL_ENVIRONMENT: "sandbox",
  PAYPAL_CLIENT_ID: "paypal-client-runtime-fixture",
  PAYPAL_CLIENT_SECRET: "paypal-secret-runtime-fixture",
  PAYPAL_WEBHOOK_ID: "paypal-webhook-runtime-fixture",
  NODE_ENV: "production",
  RAILWAY_ENVIRONMENT: "staging-identifier",
  RAILWAY_ENVIRONMENT_NAME: "staging",
  APP_CANONICAL_URL: "https://staging.example.test",
  AUTH_URL: "https://staging.example.test",
  SITE_URL: "https://staging.example.test",
} as const;

test("accepts only an explicitly confirmed HTTPS Railway staging sandbox", async () => {
  const configuration = await assertPaymentsRuntimeEnvironment(staging);
  assert.equal(configuration.deploymentEnvironment, "staging");
  assert.equal(configuration.paypal.enabled, true);

  for (const environment of [
    { ...staging, PAYMENT_STAGING_CONFIRM: undefined },
    { ...staging, NODE_ENV: "development" },
    { ...staging, RAILWAY_ENVIRONMENT_NAME: "production" },
    { ...staging, RAILWAY_ENVIRONMENT: "production" },
    { ...staging, APP_CANONICAL_URL: "http://staging.example.test" },
    { ...staging, AUTH_URL: "https://other.example.test" },
    { ...staging, AUTH_URL: "https://staging.example.test/unexpected" },
  ]) {
    await assert.rejects(
      assertPaymentsRuntimeEnvironment(environment),
      (error) => error instanceof PaymentRuntimeError,
    );
  }
});

test("keeps the global and provider flags fail-closed", async () => {
  for (const environment of [
    { ...staging, PAYMENTS_ENABLED: "false" },
    { ...staging, PAYPAL_PAYMENTS_ENABLED: "false" },
    { ...staging, PAYPAL_ENVIRONMENT: "live" },
  ]) {
    await assert.rejects(
      assertPaymentsRuntimeEnvironment(environment),
      (error) => error instanceof PaymentRuntimeError,
    );
  }
});

test("historical signed reconciliation remains configured after Checkout kill switches close", async () => {
  const paypal = await assertPaypalWebhookRuntimeEnvironment({
    ...staging,
    PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
  });
  assert.equal(paypal.paypal.environment, "sandbox");

  const stripe = await assertStripeWebhookRuntimeEnvironment({
    ...staging,
    PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: "sk_test_historical-runtime-fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_historical-runtime-fixture",
  });
  assert.equal(stripe.stripe.mode, "test");
});

test("accepts only explicitly armed live providers in the exact Railway production environment", async () => {
  const production = {
    PAYMENTS_ENABLED: "true",
    PAYMENT_DEPLOYMENT_ENV: "production",
    PAYMENT_PRODUCTION_CONFIRM: PAYMENT_PRODUCTION_CONFIRMATION,
    STRIPE_PAYMENTS_ENABLED: "true",
    STRIPE_MODE: "live",
    STRIPE_SECRET_KEY: ["sk", "live", "runtime-fixture"].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "runtime-fixture"].join("_"),
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT: "production-identifier",
    RAILWAY_ENVIRONMENT_NAME: "production",
    APP_CANONICAL_URL: "https://www.lnxbeats.fr",
    AUTH_URL: "https://www.lnxbeats.fr",
    SITE_URL: "https://www.lnxbeats.fr",
  } as const;
  const configuration = await assertPaymentsRuntimeEnvironment(production);
  assert.equal(configuration.deploymentEnvironment, "production");
  assert.equal(configuration.stripe.enabled && configuration.stripe.mode, "live");

  for (const environment of [
    { ...production, PAYMENT_PRODUCTION_CONFIRM: undefined },
    { ...production, RAILWAY_ENVIRONMENT_NAME: "staging" },
    { ...production, RAILWAY_ENVIRONMENT: "staging-identifier" },
    { ...production, APP_CANONICAL_URL: "https://staging.example.test", AUTH_URL: "https://staging.example.test", SITE_URL: "https://staging.example.test" },
    { ...production, SITE_URL: "https://www.lnxbeats.fr/unexpected" },
    { ...production, STRIPE_MODE: "test", STRIPE_SECRET_KEY: ["sk", "test", "runtime-fixture"].join("_") },
  ]) {
    await assert.rejects(
      assertPaymentsRuntimeEnvironment(environment),
      (error) => error instanceof PaymentRuntimeError,
    );
  }
});
