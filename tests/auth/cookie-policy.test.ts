import assert from "node:assert/strict";
import test from "node:test";

import {
  isSafeLocalShopPhase2QaHttpRuntime,
  isSafeLocalShopPhase3BStripeQaHttpRuntime,
  shouldUseSecureAuthCookies,
} from "@/lib/auth/environment";
import {
  SHOP_PHASE2_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE2_QA_CONFIRMATION,
  SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE2_QA_ORIGIN,
  SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT,
  SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT,
  SHOP_PHASE2_QA_RUNTIME_CONFIRMATION,
  SHOP_PHASE2_QA_RUNTIME_CONFIRMATION_NAME,
  SHOP_PHASE2_QA_TARGET,
  SHOP_PHASE3B_STRIPE_QA_CONFIRMATION,
  SHOP_PHASE3_QA_OWNER_EMAIL,
} from "@/lib/shop/qa-contract";
import {
  SHOP_LEGAL_QA_CONFIRMATION,
  SHOP_LEGAL_QA_TERMS_VERSION,
} from "@/lib/shop/legal";

function shopPhase2Environment() {
  return {
    NODE_ENV: "test",
    LNX_DATABASE_TARGET: SHOP_PHASE2_QA_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/private/tmp/prisma-dev-nodejs/${SHOP_PHASE2_QA_TARGET}/server.json`,
    DATABASE_URL: "postgresql://127.0.0.1:51260/template1?schema=public",
    AUTH_URL: SHOP_PHASE2_QA_ORIGIN,
    SITE_URL: SHOP_PHASE2_QA_ORIGIN,
    APP_CANONICAL_URL: SHOP_PHASE2_QA_ORIGIN,
    AUTH_SECRET: "a".repeat(32),
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
    LIVE_REFUNDS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
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
    [SHOP_PHASE2_QA_RUNTIME_CONFIRMATION_NAME]: SHOP_PHASE2_QA_RUNTIME_CONFIRMATION,
  } as Record<string, string | undefined>;
}

test("production and staging production builds always keep secure auth cookies", () => {
  assert.equal(shouldUseSecureAuthCookies(true, {
    NODE_ENV: "production",
    LNX_DATABASE_TARGET: "lnx-studio-production",
    AUTH_URL: "https://www.lnxbeats.fr",
    SITE_URL: "https://www.lnxbeats.fr",
  }), true);
  assert.equal(shouldUseSecureAuthCookies(true, {
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "staging",
    LNX_DATABASE_TARGET: "lnx-studio-staging",
    AUTH_URL: "https://lnxbeats-site-staging.up.railway.app",
  }), true);
});

test("the guarded Shop Phase 2 HTTP runtime disables secure auth cookies in a production build", () => {
  const environment = shopPhase2Environment();
  assert.equal(isSafeLocalShopPhase2QaHttpRuntime(environment), true);
  assert.equal(shouldUseSecureAuthCookies(true, environment), false);
});

function shopPhase3BStripeEnvironment() {
  return {
    ...shopPhase2Environment(),
    PAYMENTS_ENABLED: "true",
    STRIPE_PAYMENTS_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: "rk_test_phase3b-cookie-fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_phase3b-cookie-fixture",
    PAYPAL_PAYMENTS_ENABLED: "false",
    PAYPAL_ENVIRONMENT: "sandbox",
    SHOP_PAYMENTS_ENABLED: "true",
    SHOP_LEGAL_READY: "true",
    SHOP_TERMS_VERSION: SHOP_LEGAL_QA_TERMS_VERSION,
    SHOP_LEGAL_QA_CONFIRM: SHOP_LEGAL_QA_CONFIRMATION,
    SHOP_PHASE3B_STRIPE_QA_CONFIRM: SHOP_PHASE3B_STRIPE_QA_CONFIRMATION,
    EMAIL_OWNER_RECIPIENT: SHOP_PHASE3_QA_OWNER_EMAIL,
  };
}

test("the explicitly guarded Shop Phase 3B Stripe TEST runtime disables secure HTTP cookies", () => {
  const environment = shopPhase3BStripeEnvironment();
  assert.equal(isSafeLocalShopPhase3BStripeQaHttpRuntime(environment), true);
  assert.equal(shouldUseSecureAuthCookies(true, environment), false);
});

test("incomplete, live or externally coupled Shop Phase 3B environments keep secure cookies", () => {
  const exact = shopPhase3BStripeEnvironment();
  for (const mutation of [
    { SHOP_PHASE3B_STRIPE_QA_CONFIRM: "" },
    { STRIPE_SECRET_KEY: "sk_live_forbidden-fixture" },
    { STRIPE_WEBHOOK_SECRET: "" },
    { PAYPAL_PAYMENTS_ENABLED: "true" },
    { PAYPAL_CLIENT_ID: "sandbox-client-forbidden" },
    { NOTIFICATION_EMAIL_TRANSPORT: "resend" },
    { SHOP_TERMS_VERSION: "production-terms" },
    { LNX_DATABASE_TARGET: "another-target" },
    { RAILWAY_ENVIRONMENT_NAME: "staging" },
  ]) {
    const environment = { ...exact, ...mutation };
    assert.equal(isSafeLocalShopPhase3BStripeQaHttpRuntime(environment), false);
    assert.equal(shouldUseSecureAuthCookies(true, environment), true);
  }
});

test("incomplete, remote or ambiguous Shop Phase 2 environments fail closed", () => {
  const exact = shopPhase2Environment();
  for (const mutation of [
    { SHOP_LOCAL_QA_CONFIRM: "" },
    { LNX_DATABASE_TARGET: "another-target" },
    { AUTH_URL: "http://localhost:31760" },
    { SITE_URL: "https://www.lnxbeats.fr" },
    { DATABASE_URL: "postgresql://db.example.invalid:51260/template1?schema=public" },
    { DATABASE_URL: "postgresql://127.0.0.1:5432/template1?schema=public" },
    { LNX_PRISMA_DEV_SERVER_FILE: "" },
    { [SHOP_PHASE2_QA_RUNTIME_CONFIRMATION_NAME]: "" },
    { RAILWAY_ENVIRONMENT_NAME: "staging" },
    { STRIPE_SECRET_KEY: "configured" },
    { LNX_PREVIEW_MODE: "persistent-local" },
  ]) {
    const environment = { ...exact, ...mutation };
    assert.equal(isSafeLocalShopPhase2QaHttpRuntime(environment), false);
    assert.equal(shouldUseSecureAuthCookies(true, environment), true);
  }
});

test("the existing persistent local preview cookie exception is preserved", () => {
  assert.equal(shouldUseSecureAuthCookies(true, {
    NODE_ENV: "production",
    LNX_PREVIEW_MODE: "persistent-local",
    LNX_DATABASE_TARGET: "lnx-studio-local-preview",
    AUTH_URL: "http://127.0.0.1:31740",
  }), false);
});

test("development builds remain non-secure while ambiguous production builds fail closed", () => {
  assert.equal(shouldUseSecureAuthCookies(false, {}), false);
  assert.equal(shouldUseSecureAuthCookies(true, {}), true);
});
