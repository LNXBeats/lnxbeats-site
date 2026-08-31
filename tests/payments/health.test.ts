import assert from "node:assert/strict";
import test from "node:test";

import { healthResponse } from "@/lib/health";
import { resetMediaStorageCacheForTests } from "@/lib/media/storage/config";
import { setS3ClientFactoryForTests } from "@/lib/media/storage/s3";

const names: readonly string[] = [
  "PAYMENTS_ENABLED",
  "PAYMENT_DEPLOYMENT_ENV",
  "PAYMENT_STAGING_CONFIRM",
  "PAYMENT_PRODUCTION_CONFIRM",
  "STRIPE_PAYMENTS_ENABLED",
  "PAYPAL_PAYMENTS_ENABLED",
  "STRIPE_MODE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "PAYPAL_ENVIRONMENT",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "LIVE_REFUNDS_ENABLED",
  "MEDIA_STORAGE_DRIVER",
  "MEDIA_DEPLOYMENT_ENV",
  "MEDIA_STORAGE_PROVIDER",
  "MEDIA_S3_ENDPOINT",
  "MEDIA_S3_REGION",
  "MEDIA_S3_ACCESS_KEY_ID",
  "MEDIA_S3_SECRET_ACCESS_KEY",
  "MEDIA_PUBLIC_BUCKET",
  "MEDIA_PRIVATE_BUCKET",
  "MEDIA_S3_FORCE_PATH_STYLE",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_ENVIRONMENT_NAME",
  "APP_CANONICAL_URL",
  "AUTH_URL",
  "SITE_URL",
  "NODE_ENV",
  "SHOP_ENABLED",
  "MUSIC_PRICING_SOURCE",
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

const healthyRuntime = { assertPaymentRuntime: async () => {} };

test("500 health validations remain configuration-only and create no S3 client", async () => {
  await withEnvironment({
    NODE_ENV: "test",
    MEDIA_STORAGE_DRIVER: "s3",
    MEDIA_DEPLOYMENT_ENV: "test",
    MEDIA_STORAGE_PROVIDER: "minio",
    MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000/storage",
    MEDIA_S3_REGION: "us-east-1",
    MEDIA_S3_ACCESS_KEY_ID: "health-test-access",
    MEDIA_S3_SECRET_ACCESS_KEY: "health-test-secret",
    MEDIA_PUBLIC_BUCKET: "health-public-test",
    MEDIA_PRIVATE_BUCKET: "health-private-test",
    MEDIA_S3_FORCE_PATH_STYLE: "true",
  }, async () => {
    let clientCreations = 0;
    resetMediaStorageCacheForTests();
    setS3ClientFactoryForTests(() => {
      clientCreations += 1;
      throw new Error("health must not create an S3 client");
    });
    try {
      const responses = await Promise.all(
        Array.from({ length: 500 }, () => healthResponse(healthyRuntime)),
      );
      assert.ok(responses.every((response) => response.status === 200));
      assert.equal(clientCreations, 0);
    } finally {
      resetMediaStorageCacheForTests();
      setS3ClientFactoryForTests(null);
    }
  });
});

test("health fails closed on a shared public/private bucket without creating an S3 client", async () => {
  await withEnvironment({
    NODE_ENV: "test",
    MEDIA_STORAGE_DRIVER: "s3",
    MEDIA_DEPLOYMENT_ENV: "test",
    MEDIA_STORAGE_PROVIDER: "minio",
    MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000/storage",
    MEDIA_S3_REGION: "us-east-1",
    MEDIA_S3_ACCESS_KEY_ID: "health-shared-bucket-access",
    MEDIA_S3_SECRET_ACCESS_KEY: "health-shared-bucket-secret",
    MEDIA_PUBLIC_BUCKET: "health-shared-test",
    MEDIA_PRIVATE_BUCKET: "health-shared-test",
    MEDIA_S3_FORCE_PATH_STYLE: "true",
  }, async () => {
    let clientCreations = 0;
    resetMediaStorageCacheForTests();
    setS3ClientFactoryForTests(() => {
      clientCreations += 1;
      throw new Error("invalid health configuration must not create a client");
    });
    try {
      const response = await healthResponse(healthyRuntime);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        ok: false,
        service: "lnx-studio",
        check: "media-storage",
      });
      assert.equal(clientCreations, 0);
    } finally {
      resetMediaStorageCacheForTests();
      setS3ClientFactoryForTests(null);
    }
  });
});

test("health reports disabled payments without exposing configuration values", async () => {
  await withEnvironment({}, async () => {
    const response = await healthResponse(healthyRuntime);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.payments, {
      enabled: false,
      deploymentEnvironment: "development",
      liveRefundsEnabled: false,
      providers: {
        stripe: {
          provider: "stripe",
          enabled: false,
          configured: false,
          mode: "disabled",
          apiVersion: "2026-07-29.dahlia",
        },
        paypal: {
          provider: "paypal",
          enabled: false,
          configured: false,
          environment: "disabled",
        },
      },
    });
    assert.doesNotMatch(JSON.stringify(payload), /secretKey|webhookSecret|publishableKey/);
    assert.deepEqual(payload.shop, {
      enabled: false,
      pricingSource: "legacy",
      commerceConfigured: false,
    });
  });
});

test("health fails closed when the unimplemented database pricing cutover is requested", async () => {
  await withEnvironment({ MUSIC_PRICING_SOURCE: "database" }, async () => {
    const response = await healthResponse(healthyRuntime);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      service: "lnx-studio",
      check: "shop",
    });
  });
});

test("health reports only an aggregate for a complete Stripe test configuration", async () => {
  await withEnvironment({
    PAYMENTS_ENABLED: "true",
    STRIPE_PAYMENTS_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: ["sk", "test", "health-fixture"].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "health-fixture"].join("_"),
  }, async () => {
    const response = await healthResponse(healthyRuntime);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.payments, {
      enabled: true,
      deploymentEnvironment: "development",
      liveRefundsEnabled: false,
      providers: {
        stripe: {
          provider: "stripe",
          enabled: true,
          configured: true,
          mode: "test",
          apiVersion: "2026-07-29.dahlia",
        },
        paypal: {
          provider: "paypal",
          enabled: false,
          configured: false,
          environment: "disabled",
        },
      },
    });
    assert.doesNotMatch(JSON.stringify(payload), /sk_test_|whsec_/);
  });
});

test("health exposes only the Live refund gate boolean", async () => {
  await withEnvironment({ LIVE_REFUNDS_ENABLED: "true" }, async () => {
    const response = await healthResponse(healthyRuntime);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.payments.liveRefundsEnabled, true);
    assert.doesNotMatch(JSON.stringify(payload), /LIVE_REFUNDS_ENABLED/);
  });
});

test("health refuses enabled payments outside the isolated Stripe QA runtime", async () => {
  await withEnvironment({
    PAYMENTS_ENABLED: "true",
    STRIPE_PAYMENTS_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: ["sk", "test", "health-fixture"].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "health-fixture"].join("_"),
  }, async () => {
    const response = await healthResponse({
      assertPaymentRuntime: async () => {
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

test("health refuses an enabled staging runtime when its runtime gate fails", async () => {
  const paymentEnvironment = {
    PAYMENTS_ENABLED: "true",
    STRIPE_PAYMENTS_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: ["sk", "test", "health-fixture"].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "health-fixture"].join("_"),
    PAYMENT_DEPLOYMENT_ENV: "staging",
    PAYMENT_STAGING_CONFIRM: "payments-staging-sandbox-approved",
  };
  await withEnvironment(paymentEnvironment, async () => {
    const response = await healthResponse({ assertPaymentRuntime: async () => { throw new Error("wrong runtime"); } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, service: "lnx-studio", check: "payments" });
  });
});

test("health exposes only the PayPal Sandbox aggregate", async () => {
  await withEnvironment({
    PAYMENTS_ENABLED: "true",
    PAYPAL_PAYMENTS_ENABLED: "true",
    PAYPAL_ENVIRONMENT: "sandbox",
    PAYPAL_CLIENT_ID: "paypal-client-health-fixture",
    PAYPAL_CLIENT_SECRET: "paypal-secret-health-fixture",
    PAYPAL_WEBHOOK_ID: "paypal-webhook-health-fixture",
  }, async () => {
    const response = await healthResponse(healthyRuntime);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.payments.providers.paypal, {
      provider: "paypal",
      enabled: true,
      configured: true,
      environment: "sandbox",
    });
    assert.doesNotMatch(JSON.stringify(payload), /paypal-(?:client|secret|webhook)-health-fixture/);
  });
});
