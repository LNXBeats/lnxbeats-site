import assert from "node:assert/strict";
import test from "node:test";

import { PAYMENT_STAGING_CONFIRMATION } from "@/lib/payments/config";
import { assertPaymentsRuntimeEnvironment, PaymentRuntimeError } from "@/lib/payments/runtime";

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
