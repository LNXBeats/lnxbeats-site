import assert from "node:assert/strict";
import test from "node:test";

import { healthResponse } from "@/lib/health";

const names: readonly string[] = [
  "PAYMENTS_ENABLED",
  "STRIPE_MODE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "MEDIA_STORAGE_DRIVER",
  "MEDIA_DEPLOYMENT_ENV",
  "RAILWAY_ENVIRONMENT",
  "NODE_ENV",
];

async function withEnvironment(
  environment: Record<string, string | undefined>,
  operation: () => Promise<void>,
) {
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, {
      MEDIA_STORAGE_DRIVER: "local",
      MEDIA_DEPLOYMENT_ENV: "local-preview",
    });
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await operation();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

const healthyRuntime = { assertPaymentQaRuntime: async () => {} };

test("health reports disabled payments without exposing configuration values", async () => {
  await withEnvironment({}, async () => {
    const response = await healthResponse(healthyRuntime);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.payments, {
      provider: "stripe",
      enabled: false,
      configured: false,
      mode: "disabled",
      apiVersion: "2026-07-29.dahlia",
    });
    assert.doesNotMatch(JSON.stringify(payload), /secretKey|webhookSecret|publishableKey/);
  });
});

test("health reports only an aggregate for a complete Stripe test configuration", async () => {
  await withEnvironment({
    PAYMENTS_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: ["sk", "test", "health-fixture"].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "health-fixture"].join("_"),
  }, async () => {
    const response = await healthResponse(healthyRuntime);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.payments, {
      provider: "stripe",
      enabled: true,
      configured: true,
      mode: "test",
      apiVersion: "2026-07-29.dahlia",
    });
    assert.doesNotMatch(JSON.stringify(payload), /sk_test_|whsec_/);
  });
});

test("health refuses enabled payments outside the isolated Stripe QA runtime", async () => {
  await withEnvironment({
    PAYMENTS_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: ["sk", "test", "health-fixture"].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "health-fixture"].join("_"),
  }, async () => {
    const response = await healthResponse({
      assertPaymentQaRuntime: async () => {
        throw new Error("personal database");
      },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      service: "lnx-studio",
      check: "payments",
    });
  });
});

test("health fails closed without leaking details when enabled payment configuration is invalid", async () => {
  await withEnvironment({ PAYMENTS_ENABLED: "true", STRIPE_MODE: "test" }, async () => {
    const response = await healthResponse(healthyRuntime);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      service: "lnx-studio",
      check: "payments",
    });
  });
});

test("health refuses an enabled Stripe test runtime on Railway or in production", async () => {
  const paymentEnvironment = {
    PAYMENTS_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: ["sk", "test", "health-fixture"].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "health-fixture"].join("_"),
  };
  for (const forbiddenEnvironment of [
    { RAILWAY_ENVIRONMENT: "production" },
    { NODE_ENV: "production" },
  ]) {
    await withEnvironment({ ...paymentEnvironment, ...forbiddenEnvironment }, async () => {
      const response = await healthResponse(healthyRuntime);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        ok: false,
        service: "lnx-studio",
        check: forbiddenEnvironment.RAILWAY_ENVIRONMENT ? "media-storage" : "payments",
      });
    });
  }
});
