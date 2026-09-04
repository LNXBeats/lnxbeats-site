import assert from "node:assert/strict";
import test from "node:test";

import { PAYMENT_PRODUCTION_CONFIRMATION } from "@/lib/payments/config";
import {
  evaluateLiveRefundProductionPolicy,
  LIVE_REFUNDS_PRODUCTION_CONFIRMATION,
} from "@/lib/payments/live-refund-policy";

const stripeSecret = ["sk", "live", "refund-policy-fixture"].join("_");
const stripeWebhook = ["whsec", "refund-policy-fixture"].join("_");

function production(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "production",
    RAILWAY_ENVIRONMENT: "production-fixture",
    PAYMENT_DEPLOYMENT_ENV: "production",
    APP_CANONICAL_URL: "https://www.lnxbeats.fr",
    AUTH_URL: "https://www.lnxbeats.fr",
    SITE_URL: "https://www.lnxbeats.fr",
    PAYMENTS_ENABLED: "true",
    STRIPE_PAYMENTS_ENABLED: "true",
    STRIPE_MODE: "live",
    STRIPE_SECRET_KEY: stripeSecret,
    STRIPE_WEBHOOK_SECRET: stripeWebhook,
    PAYPAL_PAYMENTS_ENABLED: "false",
    PAYMENT_PRODUCTION_CONFIRM: PAYMENT_PRODUCTION_CONFIRMATION,
    LIVE_REFUNDS_ENABLED: "false",
    ...overrides,
  };
}

test("Live refunds distinguish OFF, code-ready, armed and blocked states", () => {
  assert.equal(evaluateLiveRefundProductionPolicy({
    ...production(), PAYMENTS_ENABLED: "false", STRIPE_PAYMENTS_ENABLED: "false",
  }).state, "OFF");
  assert.equal(evaluateLiveRefundProductionPolicy(production()).state, "READY_NOT_ARMED");
  assert.equal(evaluateLiveRefundProductionPolicy(production({
    LIVE_REFUNDS_ENABLED: "true",
    LIVE_REFUNDS_PRODUCTION_CONFIRM: LIVE_REFUNDS_PRODUCTION_CONFIRMATION,
  })).state, "ARMED");
  assert.equal(evaluateLiveRefundProductionPolicy(production({
    LIVE_REFUNDS_ENABLED: "true",
  })).state, "BLOCKED");
});

test("the flag alone, stale confirmation and non-production runtimes fail closed", () => {
  const flagOnly = evaluateLiveRefundProductionPolicy(production({ LIVE_REFUNDS_ENABLED: "true" }));
  assert.equal(flagOnly.armed, false);
  assert.ok(flagOnly.reasons.includes("LIVE_REFUNDS_PRODUCTION_CONFIRMATION_REQUIRED"));

  const stale = evaluateLiveRefundProductionPolicy(production({
    LIVE_REFUNDS_PRODUCTION_CONFIRM: LIVE_REFUNDS_PRODUCTION_CONFIRMATION,
  }));
  assert.equal(stale.state, "BLOCKED");
  assert.ok(stale.reasons.includes("CONFIRMATION_PRESENT_WHILE_DISABLED"));

  const wrongRuntime = evaluateLiveRefundProductionPolicy(production({
    NODE_ENV: "test",
    LIVE_REFUNDS_ENABLED: "true",
    LIVE_REFUNDS_PRODUCTION_CONFIRM: LIVE_REFUNDS_PRODUCTION_CONFIRMATION,
  }));
  assert.equal(wrongRuntime.state, "BLOCKED");
  assert.ok(wrongRuntime.reasons.includes("STRICT_PRODUCTION_RUNTIME_REQUIRED"));
});

test("an invalid Live refund value is BLOCKED rather than interpreted as armed", () => {
  const policy = evaluateLiveRefundProductionPolicy(production({ LIVE_REFUNDS_ENABLED: "yes" }));
  assert.equal(policy.state, "BLOCKED");
  assert.equal(policy.armed, false);
  assert.ok(policy.reasons.includes("INVALID_LIVE_REFUNDS_FLAG"));
});

test("the policy result exposes readiness booleans but never credential values", () => {
  const policy = evaluateLiveRefundProductionPolicy(production({
    LIVE_REFUNDS_ENABLED: "true",
    LIVE_REFUNDS_PRODUCTION_CONFIRM: LIVE_REFUNDS_PRODUCTION_CONFIRMATION,
  }));
  const serialized = JSON.stringify(policy);
  assert.equal(policy.stripeReady, true);
  assert.doesNotMatch(serialized, new RegExp(stripeSecret));
  assert.doesNotMatch(serialized, new RegExp(stripeWebhook));
});
