import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  formatPaymentDiagnostic,
  runPaymentDiagnostic,
  type PaymentDatabaseDiagnostic,
  type PaymentDiagnosticRepository,
} from "@/lib/payments/production-diagnostic";

const liveSecretKey = ["rk", "live", "diagnostic-secret-fixture"].join("_");
const webhookSecret = ["whsec", "diagnostic-webhook-fixture"].join("_");
const paypalClientId = ["paypal", "diagnostic", "client", "fixture"].join("-");
const paypalClientSecret = ["paypal", "diagnostic", "secret", "fixture"].join("-");
const paypalWebhookId = ["paypal", "diagnostic", "webhook", "fixture"].join("-");

const productionBase = {
  PAYMENT_DEPLOYMENT_ENV: "production",
  NODE_ENV: "production",
  RAILWAY_ENVIRONMENT_NAME: "production",
  RAILWAY_ENVIRONMENT: "production-fixture",
  APP_CANONICAL_URL: "https://www.lnxbeats.fr",
  AUTH_URL: "https://www.lnxbeats.fr",
  SITE_URL: "https://www.lnxbeats.fr",
  PAYMENTS_ENABLED: "false",
  STRIPE_PAYMENTS_ENABLED: "false",
  PAYPAL_PAYMENTS_ENABLED: "false",
} as const;

const stripeLive = {
  STRIPE_MODE: "live",
  STRIPE_SECRET_KEY: liveSecretKey,
  STRIPE_WEBHOOK_SECRET: webhookSecret,
} as const;

const cleanDatabase: PaymentDatabaseDiagnostic = {
  reachable: true,
  migrationsKnown: 17,
  migrationsApplied: 17,
  failedMigrations: 0,
  modeAnomalies: 0,
  currencyAnomalies: 0,
  relationshipAnomalies: 0,
  reviewRequired: 0,
};

function repository(
  database: PaymentDatabaseDiagnostic = cleanDatabase,
  inspect?: (expectedMode: "TEST" | "LIVE") => void,
): PaymentDiagnosticRepository {
  return {
    inspect: async (expectedMode) => {
      inspect?.(expectedMode);
      return database;
    },
  };
}

test("production is SAFE_DISABLED with configured Stripe Live and no enabled provider", async () => {
  const result = await runPaymentDiagnostic({ ...productionBase, ...stripeLive }, repository());

  assert.equal(result.status, "SAFE_DISABLED");
  assert.equal(result.production, true);
  assert.equal(result.paymentsEnabled, false);
  assert.equal(result.liveRefundsEnabled, false);
  assert.deepEqual(
    [result.stripe.flag, result.stripe.enabled, result.stripe.mode, result.stripe.configured],
    [false, false, "live", true],
  );
});

test("disabled and absent PayPal configuration is valid", async () => {
  const result = await runPaymentDiagnostic({ ...productionBase, ...stripeLive }, repository());

  assert.equal(result.status, "SAFE_DISABLED");
  assert.deepEqual(
    [result.paypal.flag, result.paypal.enabled, result.paypal.environment, result.paypal.configured],
    [false, false, "disabled", false],
  );
});

test("Stripe Test configuration in production is INVALID", async () => {
  const result = await runPaymentDiagnostic({
    ...productionBase,
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: ["sk", "test", "diagnostic-mode-fixture"].join("_"),
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  }, repository());

  assert.equal(result.status, "INVALID");
  assert.equal(result.stripe.mode, "test");
  assert.equal(result.checks.find(({ name }) => name === "stripe.mode.matchesDeployment")?.passed, false);
});

test("armed production payments without confirmation are INVALID", async () => {
  const result = await runPaymentDiagnostic({
    ...productionBase,
    ...stripeLive,
    PAYMENTS_ENABLED: "true",
    STRIPE_PAYMENTS_ENABLED: "true",
  }, repository());

  assert.equal(result.status, "INVALID");
  assert.equal(result.productionConfirmationPresent, false);
});

test("enabled provider without required credentials is INVALID", async () => {
  const result = await runPaymentDiagnostic({
    ...productionBase,
    PAYMENTS_ENABLED: "true",
    STRIPE_PAYMENTS_ENABLED: "true",
    STRIPE_MODE: "live",
    PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved",
  }, repository());

  assert.equal(result.status, "INVALID");
  assert.equal(result.stripe.configured, false);
});

test("inconsistent application origins are INVALID", async () => {
  const result = await runPaymentDiagnostic({
    ...productionBase,
    ...stripeLive,
    AUTH_URL: "https://lnxbeats.fr",
  }, repository());

  assert.equal(result.status, "INVALID");
  assert.equal(result.originsConsistent, false);
  assert.equal(result.canonicalOrigin, "invalid");
});

test("staging is accepted only as an explicitly non-production environment", async () => {
  let inspectedMode: "TEST" | "LIVE" | undefined;
  const result = await runPaymentDiagnostic({
    PAYMENT_DEPLOYMENT_ENV: "staging",
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "staging",
    RAILWAY_ENVIRONMENT: "staging-fixture",
    APP_CANONICAL_URL: "https://lnxbeats-site-staging.up.railway.app",
    AUTH_URL: "https://lnxbeats-site-staging.up.railway.app",
    SITE_URL: "https://lnxbeats-site-staging.up.railway.app",
    PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
  }, repository(cleanDatabase, (mode) => {
    inspectedMode = mode;
  }));

  assert.equal(result.status, "SAFE_DISABLED");
  assert.equal(result.environment, "staging");
  assert.equal(result.production, false);
  assert.equal(inspectedMode, "TEST");
});

test("configured disabled flags remain visible without enabling payments", async () => {
  const result = await runPaymentDiagnostic({
    ...productionBase,
    ...stripeLive,
    STRIPE_PAYMENTS_ENABLED: "true",
  }, repository());

  assert.equal(result.status, "CONFIGURED_DISABLED");
  assert.equal(result.paymentsEnabled, false);
  assert.equal(result.stripe.flag, true);
  assert.equal(result.stripe.enabled, false);
});

test("database anomalies and operator review fail closed", async () => {
  const result = await runPaymentDiagnostic(
    { ...productionBase, ...stripeLive },
    repository({
      ...cleanDatabase,
      modeAnomalies: 1,
      relationshipAnomalies: 2,
      reviewRequired: 3,
    }),
  );

  assert.equal(result.status, "INVALID");
  assert.equal(result.database.modeAnomalies, 1);
  assert.equal(result.database.relationshipAnomalies, 2);
  assert.equal(result.database.reviewRequired, 3);
});

test("diagnostic output contains no credentials or confirmation value", async () => {
  const environment = {
    ...productionBase,
    ...stripeLive,
    PAYPAL_ENVIRONMENT: "live",
    PAYPAL_CLIENT_ID: paypalClientId,
    PAYPAL_CLIENT_SECRET: paypalClientSecret,
    PAYPAL_WEBHOOK_ID: paypalWebhookId,
    PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved",
  };
  const output = formatPaymentDiagnostic(await runPaymentDiagnostic(environment, repository()));

  for (const secret of [
    liveSecretKey,
    webhookSecret,
    paypalClientId,
    paypalClientSecret,
    paypalWebhookId,
    environment.PAYMENT_PRODUCTION_CONFIRM,
  ]) {
    assert.doesNotMatch(output, new RegExp(secret));
  }
  assert.match(output, /stripe\.secretConfigured=true/);
  assert.match(output, /paypal\.webhookConfigured=true/);
  assert.match(output, /liveRefundsEnabled=false/);
  assert.match(output, /PASS refunds\.live\.disabled/);
});

test("diagnostic reports the explicit Live refund opt-in without exposing its variable name", async () => {
  const result = await runPaymentDiagnostic({
    ...productionBase,
    ...stripeLive,
    LIVE_REFUNDS_ENABLED: "true",
  }, repository());
  const output = formatPaymentDiagnostic(result);
  assert.equal(result.status, "CONFIGURED_DISABLED");
  assert.equal(result.liveRefundsEnabled, true);
  assert.match(output, /liveRefundsEnabled=true/);
  assert.match(output, /PASS refunds\.live\.explicitly-enabled/);
  assert.doesNotMatch(output, /LIVE_REFUNDS_ENABLED/);
});

test("diagnostic repository is read exactly once and implementation has no mutation/provider call", async () => {
  let inspections = 0;
  await runPaymentDiagnostic({ ...productionBase, ...stripeLive }, repository(cleanDatabase, () => {
    inspections += 1;
  }));
  assert.equal(inspections, 1);

  const source = await readFile(
    new URL("../../lib/payments/production-diagnostic.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
  assert.doesNotMatch(source, /stripe\.(?:checkout|paymentIntents|refunds)|api-m\.paypal\.com/);
  assert.match(source, /"orderId" IS NULL AND "shopOrderId" IS NULL/);
  assert.match(source, /"orderId" IS NOT NULL AND "shopOrderId" IS NOT NULL/);
  assert.match(source, /GROUP BY "orderId"/);
  assert.match(source, /GROUP BY "shopOrderId"/);
  assert.match(source, /"shopOrderId" IS NOT NULL/);
});
