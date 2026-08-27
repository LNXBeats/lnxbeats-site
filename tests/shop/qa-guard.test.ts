import assert from "node:assert/strict";
import test from "node:test";

import {
  assertShopPhase2QaEnvironment,
  assertShopPhase2QaExpiryEnvironment,
  shopPhase2QaChildEnvironment,
  SHOP_PHASE2_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE2_QA_CONFIRMATION,
  SHOP_PHASE2_QA_REQUESTED_DATABASE_PORT,
  SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE2_QA_ORIGIN,
  SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT,
  SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT,
  SHOP_PHASE2_QA_TARGET,
  type ShopPhase2QaProof,
} from "@/lib/shop/qa-guard";

function validEnvironment() {
  const databaseUrl = `postgresql://127.0.0.1:${SHOP_PHASE2_QA_REQUESTED_DATABASE_PORT}/template1?schema=public`;
  return {
    NODE_ENV: "test",
    LNX_DATABASE_TARGET: SHOP_PHASE2_QA_TARGET,
    DATABASE_URL: databaseUrl,
    AUTH_URL: SHOP_PHASE2_QA_ORIGIN,
    SITE_URL: SHOP_PHASE2_QA_ORIGIN,
    APP_CANONICAL_URL: SHOP_PHASE2_QA_ORIGIN,
    AUTH_SECRET: "a".repeat(32),
    LNX_AUTH_QA_MEMBER_PASSWORD: "m".repeat(12),
    LNX_AUTH_QA_ADMIN_PASSWORD: "a".repeat(13),
    AUTH_QA_ACCESS_ENABLED: "false",
    EMAIL_PROVIDER: "capture",
    AUTH_EMAIL_CAPTURE_PATH: SHOP_PHASE2_QA_AUTH_CAPTURE_PATH,
    NOTIFICATION_DEPLOYMENT_ENV: "development",
    NOTIFICATION_EMAIL_TRANSPORT: "capture",
    NOTIFICATION_CAPTURE_PATH: SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH,
    NOTIFICATION_WORKER_ENABLED: "false",
    NOTIFICATION_SCHEDULER_MODE: "disabled",
    EMAIL_NOTIFICATIONS_ENABLED: "true",
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
    SMS_TRANSPORT: "disabled",
    SMS_NOTIFICATIONS_ENABLED: "false",
    PAYMENTS_ENABLED: "false",
    PAYMENT_DEPLOYMENT_ENV: "development",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
    LIVE_REFUNDS_ENABLED: "false",
    MEDIA_DEPLOYMENT_ENV: "test",
    MEDIA_STORAGE_DRIVER: "local",
    MEDIA_LOCAL_PUBLIC_ROOT: SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT,
    MEDIA_LOCAL_PRIVATE_ROOT: SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT,
    MEDIA_STORAGE_ROOT: SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT,
    ORDER_UPLOAD_MODE: "local-qa",
    ORDER_UPLOAD_DIR: SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT,
    SHOP_ENABLED: "true",
    SHOP_LOCAL_QA_CONFIRM: SHOP_PHASE2_QA_CONFIRMATION,
    SHOP_ALLOWED_COUNTRIES: "FR",
    SHOP_RESERVATION_TTL_MINUTES: "30",
    MUSIC_PRICING_SOURCE: "legacy",
  } as Record<string, string | undefined>;
}

function validProof(environment: Record<string, string | undefined>): ShopPhase2QaProof {
  return {
    name: SHOP_PHASE2_QA_TARGET,
    pid: process.pid,
    databasePort: Number(SHOP_PHASE2_QA_REQUESTED_DATABASE_PORT),
    exports: { database: { connectionString: environment.DATABASE_URL } },
  };
}

test("Shop Phase 2 QA accepts only its exact disposable local runtime", () => {
  const environment = validEnvironment();
  assert.deepEqual(assertShopPhase2QaEnvironment(environment, validProof(environment)), {
    target: SHOP_PHASE2_QA_TARGET,
    databaseUrl: environment.DATABASE_URL,
    baseUrl: SHOP_PHASE2_QA_ORIGIN,
    proofPid: process.pid,
  });
});

test("Shop Phase 2 QA accepts a dynamic loopback port only when the proof exports it exactly", () => {
  const environment = validEnvironment();
  environment.DATABASE_URL = environment.DATABASE_URL?.replace(
    `:${SHOP_PHASE2_QA_REQUESTED_DATABASE_PORT}/`,
    ":51254/",
  );
  const proof = { ...validProof(environment), databasePort: 51_254 };
  assert.equal(assertShopPhase2QaEnvironment(environment, proof).databaseUrl, environment.DATABASE_URL);
  assert.throws(() => assertShopPhase2QaEnvironment(environment, {
    ...proof,
    databasePort: 51_255,
  }));
  assert.throws(() => assertShopPhase2QaEnvironment(environment, {
    ...proof,
    databasePort: 5_432,
  }));
  assert.throws(() => assertShopPhase2QaEnvironment(environment, {
    ...proof,
    databasePort: undefined,
  }));
});

test("Shop Phase 2 QA requires the complete fail-closed transport and storage contract", () => {
  for (const name of [
    "EMAIL_NOTIFICATIONS_ENABLED",
    "OWNER_EMAIL_NOTIFICATIONS_ENABLED",
    "CLIENT_EMAIL_NOTIFICATIONS_ENABLED",
    "PAYMENT_DEPLOYMENT_ENV",
    "MEDIA_STORAGE_ROOT",
  ] as const) {
    const environment = validEnvironment();
    delete environment[name];
    assert.throws(
      () => assertShopPhase2QaEnvironment(environment, validProof(environment)),
      new RegExp(name),
    );
  }
});

test("Shop Phase 2 child processes receive only the explicit allowlist", () => {
  const environment: Record<string, string | undefined> = {
    ...validEnvironment(),
    PATH: "/usr/bin",
    UNRELATED_SECRET: "must-not-leak",
    RAILWAY_TOKEN: "must-not-leak",
  };
  const childEnvironment = shopPhase2QaChildEnvironment(environment);
  assert.equal(childEnvironment.NODE_ENV, "test");
  assert.equal(childEnvironment.DATABASE_URL, environment.DATABASE_URL);
  assert.equal(childEnvironment.EMAIL_NOTIFICATIONS_ENABLED, "true");
  assert.equal(childEnvironment.PATH, "/usr/bin");
  assert.equal(childEnvironment.UNRELATED_SECRET, undefined);
  assert.equal(childEnvironment.RAILWAY_TOKEN, undefined);
});

test("Shop Phase 2 expiry stays on the exact QA target after the commerce kill switch", () => {
  const enabled = validEnvironment();
  assert.equal(
    assertShopPhase2QaExpiryEnvironment(enabled, validProof(enabled)).shopEnabled,
    true,
  );

  const disabled = { ...validEnvironment(), SHOP_ENABLED: "false", SHOP_LOCAL_QA_CONFIRM: "" };
  assert.equal(
    assertShopPhase2QaExpiryEnvironment(disabled, validProof(disabled)).shopEnabled,
    false,
  );

  const implicit: Record<string, string | undefined> = { ...disabled };
  delete implicit.SHOP_ENABLED;
  assert.throws(() => assertShopPhase2QaExpiryEnvironment(implicit, validProof(implicit)));
  assert.throws(() => assertShopPhase2QaExpiryEnvironment(
    { ...disabled, LNX_DATABASE_TARGET: "another-target" },
    validProof(disabled),
  ));
});

test("Shop Phase 2 QA refuses personal, remote, default-port and mismatched databases", () => {
  for (const mutation of [
    { LNX_DATABASE_TARGET: "lnx-studio-local-preview" },
    { DATABASE_URL: "postgresql://db.example.invalid:51260/template1?schema=public" },
    { DATABASE_URL: "postgresql://127.0.0.1:5432/template1?schema=public" },
  ]) {
    const environment = { ...validEnvironment(), ...mutation };
    assert.throws(() => assertShopPhase2QaEnvironment(environment, validProof(environment)));
  }

  const environment = validEnvironment();
  assert.throws(() => assertShopPhase2QaEnvironment(environment, {
    ...validProof(environment),
    name: "another-test-runtime",
  }));
  assert.throws(() => assertShopPhase2QaEnvironment(environment, {
    ...validProof(environment),
    exports: { database: { connectionString: `${environment.DATABASE_URL}&application_name=wrong` } },
  }));
});

test("Shop Phase 2 QA refuses non-canonical origins and any Railway identity", () => {
  for (const mutation of [
    { AUTH_URL: "http://localhost:31760" },
    { SITE_URL: `${SHOP_PHASE2_QA_ORIGIN}/boutique` },
    { APP_CANONICAL_URL: `${SHOP_PHASE2_QA_ORIGIN}?preview=true` },
    { RAILWAY_ENVIRONMENT: "staging" },
    { RAILWAY_ENVIRONMENT_NAME: "staging" },
  ]) {
    const environment = { ...validEnvironment(), ...mutation };
    assert.throws(() => assertShopPhase2QaEnvironment(environment, validProof(environment)));
  }
});

test("Shop Phase 2 QA refuses external transports, provider credentials and unsafe media roots", () => {
  for (const mutation of [
    { EMAIL_PROVIDER: "resend" },
    { RESEND_API_KEY: "configured" },
    { PAYMENTS_ENABLED: "true" },
    { STRIPE_SECRET_KEY: "configured" },
    { PAYPAL_CLIENT_SECRET: "configured" },
    { MEDIA_STORAGE_DRIVER: "s3" },
    { MEDIA_S3_ACCESS_KEY_ID: "configured" },
    { MEDIA_LOCAL_PUBLIC_ROOT: "/tmp/shared-media" },
    { AUTH_QA_ACCESS_ENABLED: "true" },
  ]) {
    const environment = { ...validEnvironment(), ...mutation };
    assert.throws(() => assertShopPhase2QaEnvironment(environment, validProof(environment)));
  }
});

test("Shop Phase 2 QA requires server-only flags and secrets without embedding their values", () => {
  for (const mutation of [
    { SHOP_ENABLED: "false" },
    { SHOP_LOCAL_QA_CONFIRM: "" },
    { MUSIC_PRICING_SOURCE: "database" },
    { AUTH_SECRET: "short" },
    { LNX_AUTH_QA_MEMBER_PASSWORD: "short" },
    { LNX_AUTH_QA_ADMIN_PASSWORD: "short" },
    { LNX_AUTH_QA_ADMIN_PASSWORD: "m".repeat(12) },
  ]) {
    const environment = { ...validEnvironment(), ...mutation };
    assert.throws(() => assertShopPhase2QaEnvironment(environment, validProof(environment)));
  }
});

test("Shop Phase 2 QA does not fall back to the retired shared password variable", () => {
  const environment = validEnvironment();
  delete environment.LNX_AUTH_QA_MEMBER_PASSWORD;
  delete environment.LNX_AUTH_QA_ADMIN_PASSWORD;
  environment.LNX_AUTH_QA_PASSWORD = "legacy-value-is-not-accepted";
  assert.throws(() => assertShopPhase2QaEnvironment(environment, validProof(environment)));
});
