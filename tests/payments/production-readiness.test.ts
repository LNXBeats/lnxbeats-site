import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";

import type { PrismaClient } from "@/generated/prisma/client";

import {
  PAYMENT_PRODUCTION_CONFIRMATION,
  PaymentConfigurationError,
  parsePaymentsConfiguration,
} from "@/lib/payments/config";
import { LIVE_REFUNDS_PRODUCTION_CONFIRMATION } from "@/lib/payments/live-refund-policy";
import { runProductionPaymentPreflight } from "@/lib/payments/production-preflight";

const liveSecretKey = ["sk", "live", "production-readiness-fixture"].join("_");
const livePublishableKey = ["pk", "live", "production-readiness-fixture"].join("_");
const webhookSecret = ["whsec", "production-readiness-fixture"].join("_");
const migrationCount = readdirSync("prisma/migrations", { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;

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

function databaseFixture(options: Readonly<{
  orderWinnerCounts?: Readonly<Record<string, number>>;
  shopOrderWinnerCounts?: Readonly<Record<string, number>>;
  invalidParents?: number;
}> = {}) {
  let query = 0;
  return {
    $queryRaw: async () => {
      query += 1;
      if (query === 1) return [{ count: BigInt(migrationCount) }];
      if (query === 2) return [{ count: 0n }];
      return [
        { table_name: "payments", column_name: "mode" },
        { table_name: "provider_events", column_name: "livemode" },
      ];
    },
    payment: {
      groupBy: async (input: {
        by: readonly string[];
        where: Record<string, unknown>;
      }) => {
        const parent = input.by[0];
        const counts = parent === "shopOrderId"
          ? options.shopOrderWinnerCounts ?? {}
          : options.orderWinnerCounts ?? {};
        if (parent === "shopOrderId") {
          assert.deepEqual(input.where.orderId, null);
          assert.deepEqual(input.where.shopOrderId, { not: null });
        } else {
          assert.equal(parent, "orderId");
          assert.deepEqual(input.where.orderId, { not: null });
          assert.deepEqual(input.where.shopOrderId, null);
        }
        return Object.entries(counts)
          .filter(([, count]) => count > 1)
          .map(([id, count]) => ({ [parent]: id, _count: { _all: count } }));
      },
      count: async (input: { where?: { OR?: unknown } }) => input.where?.OR
        ? options.invalidParents ?? 0
        : 0,
    },
  } as unknown as PrismaClient;
}

test("winner preflight groups Shop payments by their non-null ShopOrder parent", async () => {
  const environment = {
    ...productionBase,
    ...stripeLive,
    PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
  };
  const distinctParents = await runProductionPaymentPreflight(environment, databaseFixture({
    shopOrderWinnerCounts: {
      "11111111-1111-4111-8111-111111111111": 1,
      "22222222-2222-4222-8222-222222222222": 1,
    },
  }));
  assert.equal(distinctParents.rules.find(({ name }) => name === "database.winner.invariant")?.passed, true);

  const duplicateParent = await runProductionPaymentPreflight(environment, databaseFixture({
    shopOrderWinnerCounts: {
      "11111111-1111-4111-8111-111111111111": 2,
    },
  }));
  assert.equal(duplicateParent.status, "BLOCKED");
  assert.equal(duplicateParent.rules.find(({ name }) => name === "database.winner.invariant")?.passed, false);

  const xorViolation = await runProductionPaymentPreflight(environment, databaseFixture({ invalidParents: 1 }));
  assert.equal(xorViolation.rules.find(({ name }) => name === "database.parent.xor")?.passed, false);
});

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
  assert.equal(result.liveRefunds.state, "OFF");
  assert.equal(result.rules.find(({ name }) => name === "refunds.live.policy")?.passed, true);
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
  assert.equal(stripe.liveRefunds.state, "READY_NOT_ARMED");
  assert.equal(stripe.rules.find(({ name }) => name === "refunds.live.policy")?.passed, true);

  const stripeWithLiveRefunds = await runProductionPaymentPreflight({
    ...common,
    STRIPE_PAYMENTS_ENABLED: "true",
    PAYPAL_PAYMENTS_ENABLED: "false",
    LIVE_REFUNDS_ENABLED: "true",
  }, databaseFixture());
  assert.equal(stripeWithLiveRefunds.status, "BLOCKED");
  assert.equal(stripeWithLiveRefunds.passed, false);
  assert.equal(
    stripeWithLiveRefunds.rules.find(({ name }) => name === "refunds.live.policy")?.passed,
    false,
  );

  const stripeWithArmedLiveRefunds = await runProductionPaymentPreflight({
    ...common,
    STRIPE_PAYMENTS_ENABLED: "true",
    PAYPAL_PAYMENTS_ENABLED: "false",
    LIVE_REFUNDS_ENABLED: "true",
    LIVE_REFUNDS_PRODUCTION_CONFIRM: LIVE_REFUNDS_PRODUCTION_CONFIRMATION,
  }, databaseFixture());
  assert.equal(stripeWithArmedLiveRefunds.status, "READY_FOR_STRIPE_LIVE_QA");
  assert.equal(stripeWithArmedLiveRefunds.liveRefunds.state, "ARMED");
  assert.equal(stripeWithArmedLiveRefunds.rules.find(({ name }) => name === "refunds.live.confirmation")?.passed, true);

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
