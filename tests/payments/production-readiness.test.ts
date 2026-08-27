import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@/generated/prisma/client";

import {
  PAYMENT_PRODUCTION_CONFIRMATION,
  PaymentConfigurationError,
  parsePaymentsConfiguration,
} from "@/lib/payments/config";
import { runProductionPaymentPreflight } from "@/lib/payments/production-preflight";

const liveSecretKey = ["sk", "live", "production-readiness-fixture"].join("_");
const livePublishableKey = ["pk", "live", "production-readiness-fixture"].join("_");
const webhookSecret = ["whsec", "production-readiness-fixture"].join("_");

const productionBase = {
  PAYMENT_DEPLOYMENT_ENV: "production",
  NODE_ENV: "production",
  RAILWAY_ENVIRONMENT_NAME: "production",
  RAILWAY_ENVIRONMENT: "production-fixture",
  APP_CANONICAL_URL: "https://www.lnxbeats.fr",
  AUTH_URL: "https://www.lnxbeats.fr",
  SITE_URL: "https://www.lnxbeats.fr",
} as const;

const stripeLive = {
  STRIPE_MODE: "live",
  STRIPE_SECRET_KEY: liveSecretKey,
  STRIPE_WEBHOOK_SECRET: webhookSecret,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: livePublishableKey,
} as const;

const paypalLive = {
  PAYPAL_ENVIRONMENT: "live",
  PAYPAL_CLIENT_ID: "paypal-live-client-fixture",
  PAYPAL_CLIENT_SECRET: "paypal-live-secret-fixture",
  PAYPAL_WEBHOOK_ID: "paypal-live-webhook-fixture",
} as const;

function databaseFixture() {
  let query = 0;
  return {
    $queryRaw: async () => {
      query += 1;
      if (query === 1) return [{ count: 20n }];
      if (query === 2) return [{ count: 0n }];
      return [
        { table_name: "payments", column_name: "mode" },
        { table_name: "provider_events", column_name: "livemode" },
      ];
    },
    payment: {
      groupBy: async () => [],
      count: async () => 0,
    },
  } as unknown as PrismaClient;
}

test("production remains safely disabled even when live credentials are preloaded", async () => {
  const environment = {
    ...productionBase,
    ...stripeLive,
    ...paypalLive,
    PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
  };
  const configuration = parsePaymentsConfiguration(environment);
  assert.equal(configuration.enabled, false);
  assert.deepEqual(
    [configuration.stripe.enabled, configuration.paypal.enabled],
    [false, false],
  );
  assert.equal(configuration.stripe.mode, "live");
  assert.equal(configuration.paypal.environment, "live");

  const result = await runProductionPaymentPreflight(environment, databaseFixture());
  assert.equal(result.passed, true);
  assert.equal(result.status, "SAFE_DISABLED");
  assert.equal(result.rules.find(({ name }) => name === "refunds.live.disabled")?.passed, true);
  assert.doesNotMatch(JSON.stringify(result), /production-readiness-fixture|paypal-live-/);
});

test("production arming is explicit and supports one provider at a time", async () => {
  const common = {
    ...productionBase,
    ...stripeLive,
    ...paypalLive,
    PAYMENTS_ENABLED: "true",
    PAYMENT_PRODUCTION_CONFIRM: PAYMENT_PRODUCTION_CONFIRMATION,
  };
  const stripe = await runProductionPaymentPreflight({
    ...common,
    STRIPE_PAYMENTS_ENABLED: "true",
    PAYPAL_PAYMENTS_ENABLED: "false",
  }, databaseFixture());
  assert.equal(stripe.status, "READY_FOR_STRIPE_LIVE_QA");
  assert.equal(stripe.rules.find(({ name }) => name === "refunds.live.disabled")?.passed, true);

  const stripeWithLiveRefunds = await runProductionPaymentPreflight({
    ...common,
    STRIPE_PAYMENTS_ENABLED: "true",
    PAYPAL_PAYMENTS_ENABLED: "false",
    LIVE_REFUNDS_ENABLED: "true",
  }, databaseFixture());
  assert.equal(stripeWithLiveRefunds.status, "BLOCKED");
  assert.equal(stripeWithLiveRefunds.passed, false);
  assert.equal(
    stripeWithLiveRefunds.rules.find(({ name }) => name === "refunds.live.disabled")?.passed,
    false,
  );

  const paypal = await runProductionPaymentPreflight({
    ...common,
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "true",
  }, databaseFixture());
  assert.equal(paypal.status, "READY_FOR_PAYPAL_LIVE_QA");

  const dual = await runProductionPaymentPreflight({
    ...common,
    STRIPE_PAYMENTS_ENABLED: "true",
    PAYPAL_PAYMENTS_ENABLED: "true",
  }, databaseFixture());
  assert.equal(dual.status, "READY_FOR_DUAL_LIVE_QA");
});

test("test/sandbox in production and live credentials in staging fail closed", () => {
  const testKey = ["sk", "test", "mode-isolation-fixture"].join("_");
  const cases = [
    {
      ...productionBase,
      PAYMENTS_ENABLED: "false",
      STRIPE_MODE: "test",
      STRIPE_SECRET_KEY: testKey,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
    },
    {
      ...productionBase,
      PAYMENTS_ENABLED: "false",
      ...paypalLive,
      PAYPAL_ENVIRONMENT: "sandbox",
    },
    {
      PAYMENT_DEPLOYMENT_ENV: "staging",
      PAYMENTS_ENABLED: "false",
      ...stripeLive,
    },
    {
      PAYMENT_DEPLOYMENT_ENV: "staging",
      PAYMENTS_ENABLED: "false",
      ...paypalLive,
    },
  ];
  for (const environment of cases) {
    assert.throws(
      () => parsePaymentsConfiguration(environment),
      (error) => error instanceof PaymentConfigurationError
        && error.code === "MODE_ENVIRONMENT_MISMATCH",
    );
  }
});

test("production activation refuses missing confirmation and provider credentials", () => {
  assert.throws(
    () => parsePaymentsConfiguration({
      ...productionBase,
      ...stripeLive,
      PAYMENTS_ENABLED: "true",
      STRIPE_PAYMENTS_ENABLED: "true",
    }),
    (error) => error instanceof PaymentConfigurationError
      && error.code === "PRODUCTION_CONFIRMATION_REQUIRED",
  );
  assert.throws(
    () => parsePaymentsConfiguration({
      ...productionBase,
      PAYMENTS_ENABLED: "true",
      PAYMENT_PRODUCTION_CONFIRM: PAYMENT_PRODUCTION_CONFIRMATION,
      STRIPE_PAYMENTS_ENABLED: "true",
      STRIPE_MODE: "live",
    }),
    (error) => error instanceof PaymentConfigurationError
      && error.code === "INCOMPLETE_CONFIGURATION",
  );
});
