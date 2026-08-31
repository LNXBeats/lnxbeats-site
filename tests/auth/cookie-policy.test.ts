import assert from "node:assert/strict";
import test from "node:test";

import {
  isSafeLocalShopPhase2QaHttpRuntime,
  isSafeLocalShopPhase3BStripeQaHttpRuntime,
  isSafeLocalShopPhase3CPaypalSandboxQaHttpRuntime,
  isSafeLocalShopPhase5ALogisticsQaHttpRuntime,
  isSafeLocalShopPhase5BAfterSalesQaHttpRuntime,
  isSafeLocalShopPhase5CShippingOperationsQaHttpRuntime,
  isSafeLocalShopPhase5DShippingProviderQaHttpRuntime,
  isSafeLocalShopPhase5EProductionReadinessQaHttpRuntime,
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
  SHOP_PHASE3C_PAYPAL_QA_CONFIRMATION,
  SHOP_PHASE3_QA_OWNER_EMAIL,
  SHOP_PHASE5A_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE5A_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE5A_QA_ORIGIN,
  SHOP_PHASE5A_QA_PRIVATE_MEDIA_ROOT,
  SHOP_PHASE5A_QA_PUBLIC_MEDIA_ROOT,
  SHOP_PHASE5A_QA_TARGET,
  SHOP_PHASE5B_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE5B_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE5B_QA_ORIGIN,
  SHOP_PHASE5B_QA_PRIVATE_MEDIA_ROOT,
  SHOP_PHASE5B_QA_PUBLIC_MEDIA_ROOT,
  SHOP_PHASE5B_QA_TARGET,
  SHOP_PHASE5C_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE5C_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE5C_QA_ORIGIN,
  SHOP_PHASE5C_QA_PRIVATE_MEDIA_ROOT,
  SHOP_PHASE5C_QA_PUBLIC_MEDIA_ROOT,
  SHOP_PHASE5C_QA_TARGET,
  SHOP_PHASE5D_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE5D_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE5D_QA_ORIGIN,
  SHOP_PHASE5D_QA_PRIVATE_MEDIA_ROOT,
  SHOP_PHASE5D_QA_PRISMA_PROOF,
  SHOP_PHASE5D_QA_PRISMA_PROOF_NAME,
  SHOP_PHASE5D_QA_PUBLIC_MEDIA_ROOT,
  SHOP_PHASE5D_QA_TARGET,
  SHOP_PHASE5D_QA_TERMS_VERSION,
  SHOP_PHASE5E_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE5E_QA_CONFIRMATION,
  SHOP_PHASE5E_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE5E_QA_ORDER_SNAPSHOT_VERSION,
  SHOP_PHASE5E_QA_ORIGIN,
  SHOP_PHASE5E_QA_PRIVATE_MEDIA_ROOT,
  SHOP_PHASE5E_QA_PUBLIC_MEDIA_ROOT,
  SHOP_PHASE5E_QA_SAV_ROOT,
  SHOP_PHASE5E_QA_TARGET,
  SHOP_PHASE5E_QA_TERMS_VERSION,
} from "@/lib/shop/qa-contract";
import { SHOP_AFTER_SALES_QA_CONFIRMATION } from "@/lib/shop/after-sales-config";
import {
  SHOP_LEGAL_QA_CONFIRMATION,
  SHOP_LEGAL_QA_TERMS_VERSION,
} from "@/lib/shop/legal";
import { SHOP_SHIPPING_QA_CONFIRMATION } from "@/lib/shop/shipping-config";
import { SHOP_SHIPPING_OPERATIONS_QA_CONFIRMATION } from "@/lib/shop/shipping-operations-config";
import { SHOP_SHIPPING_PROVIDER_QA_CONFIRMATION } from "@/lib/shop/shipping-provider-config";

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

function shopPhase3CPaypalEnvironment() {
  return {
    ...shopPhase2Environment(),
    PAYMENTS_ENABLED: "true",
    STRIPE_PAYMENTS_ENABLED: "false",
    STRIPE_MODE: "test",
    PAYPAL_PAYMENTS_ENABLED: "true",
    PAYPAL_ENVIRONMENT: "sandbox",
    PAYPAL_CLIENT_ID: "paypal_phase3c_cookie_client",
    PAYPAL_CLIENT_SECRET: "paypal_phase3c_cookie_secret",
    PAYPAL_WEBHOOK_ID: "paypal_phase3c_cookie_webhook",
    SHOP_PAYMENTS_ENABLED: "true",
    SHOP_LEGAL_READY: "true",
    SHOP_TERMS_VERSION: SHOP_LEGAL_QA_TERMS_VERSION,
    SHOP_LEGAL_QA_CONFIRM: SHOP_LEGAL_QA_CONFIRMATION,
    SHOP_PHASE3C_PAYPAL_QA_CONFIRM: SHOP_PHASE3C_PAYPAL_QA_CONFIRMATION,
    EMAIL_OWNER_RECIPIENT: SHOP_PHASE3_QA_OWNER_EMAIL,
  };
}

test("the explicitly guarded Shop Phase 3C PayPal Sandbox runtime disables secure HTTP cookies", () => {
  const environment = shopPhase3CPaypalEnvironment();
  assert.equal(isSafeLocalShopPhase3CPaypalSandboxQaHttpRuntime(environment), true);
  assert.equal(shouldUseSecureAuthCookies(true, environment), false);
});

test("incomplete, live or externally coupled Shop Phase 3C environments keep secure cookies", () => {
  const exact = shopPhase3CPaypalEnvironment();
  for (const mutation of [
    { SHOP_PHASE3C_PAYPAL_QA_CONFIRM: "" },
    { PAYPAL_ENVIRONMENT: "live" },
    { PAYPAL_CLIENT_SECRET: "" },
    { STRIPE_PAYMENTS_ENABLED: "true" },
    { STRIPE_SECRET_KEY: "sk_test_forbidden-fixture" },
    { NOTIFICATION_EMAIL_TRANSPORT: "resend" },
    { SHOP_TERMS_VERSION: "production-terms" },
    { LNX_DATABASE_TARGET: "another-target" },
    { RAILWAY_ENVIRONMENT_NAME: "staging" },
  ]) {
    const environment = { ...exact, ...mutation };
    assert.equal(isSafeLocalShopPhase3CPaypalSandboxQaHttpRuntime(environment), false);
    assert.equal(shouldUseSecureAuthCookies(true, environment), true);
  }
});

function shopPhase5ALogisticsEnvironment() {
  return {
    ...shopPhase2Environment(),
    NODE_ENV: "production",
    LNX_DATABASE_TARGET: SHOP_PHASE5A_QA_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/private/tmp/prisma-dev-nodejs/${SHOP_PHASE5A_QA_TARGET}/server.json`,
    DATABASE_URL: "postgresql://127.0.0.1:51270/template1?schema=public",
    AUTH_URL: SHOP_PHASE5A_QA_ORIGIN,
    SITE_URL: SHOP_PHASE5A_QA_ORIGIN,
    APP_CANONICAL_URL: SHOP_PHASE5A_QA_ORIGIN,
    AUTH_EMAIL_CAPTURE_PATH: SHOP_PHASE5A_QA_AUTH_CAPTURE_PATH,
    NOTIFICATION_CAPTURE_PATH: SHOP_PHASE5A_QA_NOTIFICATION_CAPTURE_PATH,
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false",
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false",
    STRIPE_MODE: "test",
    PAYPAL_ENVIRONMENT: "sandbox",
    SHOP_PAYMENTS_ENABLED: "false",
    SHOP_SHIPPING_ENABLED: "true",
    SHOP_SHIPPING_QA_CONFIRM: SHOP_SHIPPING_QA_CONFIRMATION,
    SHOP_LEGAL_READY: "true",
    SHOP_TERMS_VERSION: SHOP_LEGAL_QA_TERMS_VERSION,
    SHOP_LEGAL_QA_CONFIRM: SHOP_LEGAL_QA_CONFIRMATION,
    MEDIA_LOCAL_PUBLIC_ROOT: SHOP_PHASE5A_QA_PUBLIC_MEDIA_ROOT,
    MEDIA_LOCAL_PRIVATE_ROOT: SHOP_PHASE5A_QA_PRIVATE_MEDIA_ROOT,
    MEDIA_STORAGE_ROOT: SHOP_PHASE5A_QA_PUBLIC_MEDIA_ROOT,
    ORDER_UPLOAD_DIR: SHOP_PHASE5A_QA_PRIVATE_MEDIA_ROOT,
    [SHOP_PHASE2_QA_RUNTIME_CONFIRMATION_NAME]: undefined,
  } as Record<string, string | undefined>;
}

test("the exact guarded Shop Phase 5A logistics runtime disables secure HTTP cookies", () => {
  const environment = shopPhase5ALogisticsEnvironment();
  assert.equal(isSafeLocalShopPhase5ALogisticsQaHttpRuntime(environment), true);
  assert.equal(shouldUseSecureAuthCookies(true, environment), false);
  assert.equal(isSafeLocalShopPhase5ALogisticsQaHttpRuntime({
    ...environment,
    NODE_ENV: "test",
  }), true);
});

test("incomplete, remote or externally coupled Shop Phase 5A environments keep secure cookies", () => {
  const exact = shopPhase5ALogisticsEnvironment();
  for (const mutation of [
    { AUTH_URL: "https://qa.example.invalid" },
    { AUTH_URL: "http://127.0.0.1:31776" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { DATABASE_URL: "postgresql://db.example.invalid:51270/template1?schema=public" },
    { DATABASE_URL: "postgresql://127.0.0.1:5432/template1?schema=public" },
    { SHOP_SHIPPING_QA_CONFIRM: "" },
    { SHOP_SHIPPING_QA_CONFIRM: "wrong-confirmation" },
    { SHOP_SHIPPING_ENABLED: "false" },
    { RESEND_API_KEY: "re_forbidden-phase5a-fixture" },
    { LNX_DATABASE_TARGET: "another-target" },
    { LNX_PRISMA_DEV_SERVER_FILE: "/private/tmp/prisma-dev-nodejs/another-target/server.json" },
    { PAYMENTS_ENABLED: "true" },
    { NODE_ENV: "development" },
  ]) {
    const environment = { ...exact, ...mutation };
    assert.equal(isSafeLocalShopPhase5ALogisticsQaHttpRuntime(environment), false);
    assert.equal(shouldUseSecureAuthCookies(true, environment), true);
  }
});

function shopPhase5BAfterSalesEnvironment() {
  return {
    ...shopPhase5ALogisticsEnvironment(),
    LNX_DATABASE_TARGET: SHOP_PHASE5B_QA_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/private/tmp/prisma-dev-nodejs/${SHOP_PHASE5B_QA_TARGET}/server.json`,
    AUTH_URL: SHOP_PHASE5B_QA_ORIGIN,
    SITE_URL: SHOP_PHASE5B_QA_ORIGIN,
    APP_CANONICAL_URL: SHOP_PHASE5B_QA_ORIGIN,
    AUTH_EMAIL_CAPTURE_PATH: SHOP_PHASE5B_QA_AUTH_CAPTURE_PATH,
    NOTIFICATION_CAPTURE_PATH: SHOP_PHASE5B_QA_NOTIFICATION_CAPTURE_PATH,
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
    MEDIA_LOCAL_PUBLIC_ROOT: SHOP_PHASE5B_QA_PUBLIC_MEDIA_ROOT,
    MEDIA_LOCAL_PRIVATE_ROOT: SHOP_PHASE5B_QA_PRIVATE_MEDIA_ROOT,
    MEDIA_STORAGE_ROOT: SHOP_PHASE5B_QA_PUBLIC_MEDIA_ROOT,
    ORDER_UPLOAD_DIR: SHOP_PHASE5B_QA_PRIVATE_MEDIA_ROOT,
    SHOP_AFTER_SALES_ENABLED: "true",
    SHOP_AFTER_SALES_QA_CONFIRM: SHOP_AFTER_SALES_QA_CONFIRMATION,
    SHOP_AFTER_SALES_REFUND_PROVIDER: "fake",
  } as Record<string, string | undefined>;
}

test("the exact guarded Shop Phase 5B after-sales runtime alone permits an HTTP QA cookie", () => {
  const environment = shopPhase5BAfterSalesEnvironment();
  assert.equal(isSafeLocalShopPhase5BAfterSalesQaHttpRuntime(environment), true);
  assert.equal(shouldUseSecureAuthCookies(true, environment), false);
  for (const mutation of [
    { SHOP_AFTER_SALES_QA_CONFIRM: "wrong" },
    { SHOP_AFTER_SALES_REFUND_PROVIDER: "stripe" },
    { AUTH_URL: "https://www.lnxbeats.fr" },
    { DATABASE_URL: "postgresql://db.example.invalid:51270/template1" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { STRIPE_SECRET_KEY: "configured" },
  ]) {
    const invalid = { ...environment, ...mutation };
    assert.equal(isSafeLocalShopPhase5BAfterSalesQaHttpRuntime(invalid), false);
    assert.equal(shouldUseSecureAuthCookies(true, invalid), true);
  }
});

function shopPhase5CShippingOperationsEnvironment() {
  return {
    ...shopPhase5ALogisticsEnvironment(),
    LNX_DATABASE_TARGET: SHOP_PHASE5C_QA_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/private/tmp/prisma-dev-nodejs/${SHOP_PHASE5C_QA_TARGET}/server.json`,
    DATABASE_URL: "postgresql://127.0.0.1:51277/template1?schema=public",
    AUTH_URL: SHOP_PHASE5C_QA_ORIGIN,
    SITE_URL: SHOP_PHASE5C_QA_ORIGIN,
    APP_CANONICAL_URL: SHOP_PHASE5C_QA_ORIGIN,
    AUTH_EMAIL_CAPTURE_PATH: SHOP_PHASE5C_QA_AUTH_CAPTURE_PATH,
    NOTIFICATION_CAPTURE_PATH: SHOP_PHASE5C_QA_NOTIFICATION_CAPTURE_PATH,
    OWNER_EMAIL_NOTIFICATIONS_ENABLED: "true",
    CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
    MEDIA_LOCAL_PUBLIC_ROOT: SHOP_PHASE5C_QA_PUBLIC_MEDIA_ROOT,
    MEDIA_LOCAL_PRIVATE_ROOT: SHOP_PHASE5C_QA_PRIVATE_MEDIA_ROOT,
    MEDIA_STORAGE_ROOT: SHOP_PHASE5C_QA_PUBLIC_MEDIA_ROOT,
    ORDER_UPLOAD_DIR: SHOP_PHASE5C_QA_PRIVATE_MEDIA_ROOT,
    SHOP_SHIPPING_OPERATIONS_ENABLED: "true",
    SHOP_SHIPPING_OPERATIONS_QA_CONFIRM: SHOP_SHIPPING_OPERATIONS_QA_CONFIRMATION,
    SHOP_SHIPPING_OPERATIONS_PROVIDER: "manual",
  } as Record<string, string | undefined>;
}

test("the exact guarded Phase 5C shipping runtime alone permits an HTTP QA cookie", () => {
  const environment = shopPhase5CShippingOperationsEnvironment();
  assert.equal(isSafeLocalShopPhase5CShippingOperationsQaHttpRuntime(environment), true);
  assert.equal(shouldUseSecureAuthCookies(true, environment), false);
  for (const mutation of [
    { SHOP_SHIPPING_OPERATIONS_QA_CONFIRM: "wrong" },
    { SHOP_SHIPPING_OPERATIONS_PROVIDER: "colissimo" },
    { AUTH_URL: "https://www.lnxbeats.fr" },
    { DATABASE_URL: "postgresql://db.example.invalid:51277/template1" },
    { DATABASE_URL: "postgresql://127.0.0.1:5432/template1" },
    { LNX_DATABASE_TARGET: "lnx-studio-production" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { RESEND_API_KEY: "re_forbidden-phase5c-fixture" },
    { STRIPE_SECRET_KEY: "sk_test_forbidden-phase5c-fixture" },
    { PAYMENTS_ENABLED: "true" },
  ]) {
    const invalid = { ...environment, ...mutation };
    assert.equal(isSafeLocalShopPhase5CShippingOperationsQaHttpRuntime(invalid), false);
    assert.equal(shouldUseSecureAuthCookies(true, invalid), true);
  }
});

function shopPhase5DShippingProviderEnvironment() {
  return {
    ...shopPhase5CShippingOperationsEnvironment(),
    LNX_DATABASE_TARGET: SHOP_PHASE5D_QA_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/private/tmp/prisma-dev-nodejs/${SHOP_PHASE5D_QA_TARGET}/server.json`,
    DATABASE_URL: "postgresql://127.0.0.1:51279/template1?schema=public",
    AUTH_URL: SHOP_PHASE5D_QA_ORIGIN,
    SITE_URL: SHOP_PHASE5D_QA_ORIGIN,
    APP_CANONICAL_URL: SHOP_PHASE5D_QA_ORIGIN,
    AUTH_EMAIL_CAPTURE_PATH: SHOP_PHASE5D_QA_AUTH_CAPTURE_PATH,
    NOTIFICATION_CAPTURE_PATH: SHOP_PHASE5D_QA_NOTIFICATION_CAPTURE_PATH,
    MEDIA_LOCAL_PUBLIC_ROOT: SHOP_PHASE5D_QA_PUBLIC_MEDIA_ROOT,
    MEDIA_LOCAL_PRIVATE_ROOT: SHOP_PHASE5D_QA_PRIVATE_MEDIA_ROOT,
    MEDIA_STORAGE_ROOT: SHOP_PHASE5D_QA_PUBLIC_MEDIA_ROOT,
    ORDER_UPLOAD_DIR: SHOP_PHASE5D_QA_PRIVATE_MEDIA_ROOT,
    SHOP_TERMS_VERSION: SHOP_PHASE5D_QA_TERMS_VERSION,
    [SHOP_PHASE5D_QA_PRISMA_PROOF_NAME]: SHOP_PHASE5D_QA_PRISMA_PROOF,
    SHOP_SHIPPING_PROVIDER_ENABLED: "true",
    SHOP_SHIPPING_PROVIDER: "FAKE_LOCAL",
    SHOP_SHIPPING_PROVIDER_QA_CONFIRM: SHOP_SHIPPING_PROVIDER_QA_CONFIRMATION,
  } as Record<string, string | undefined>;
}

test("the exact guarded Phase 5D fake provider runtime alone permits an HTTP QA cookie", () => {
  const environment = shopPhase5DShippingProviderEnvironment();
  assert.equal(isSafeLocalShopPhase5DShippingProviderQaHttpRuntime(environment), true);
  assert.equal(shouldUseSecureAuthCookies(true, environment), false);
  for (const mutation of [
    { SHOP_SHIPPING_PROVIDER_QA_CONFIRM: "wrong" },
    { SHOP_SHIPPING_PROVIDER: "COLISSIMO" },
    { SITE_URL: "http://127.0.0.1:31778" },
    { APP_CANONICAL_URL: "http://127.0.0.1:31778" },
    { AUTH_URL: "https://www.lnxbeats.fr" },
    { DATABASE_URL: "postgresql://db.example.invalid:51279/template1" },
    { DATABASE_URL: "postgresql://127.0.0.1:5432/template1" },
    { DATABASE_URL: "postgresql://127.0.0.1:51279/another_database" },
    { LNX_DATABASE_TARGET: "lnx-studio-production" },
    { LNX_PRISMA_DEV_SERVER_FILE: "/private/tmp/prisma-dev-nodejs/another-target/server.json" },
    { [SHOP_PHASE5D_QA_PRISMA_PROOF_NAME]: "" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { COLISSIMO_API_KEY: "forbidden" },
    { COLISSIMO_CLIENT_ID: "forbidden" },
    { CARRIER_API_TOKEN: "forbidden" },
    { CARRIER_CLIENT_ID: "forbidden" },
    { STRIPE_SECRET_KEY: "forbidden" },
    { PAYMENTS_ENABLED: "true" },
    { SHOP_PAYMENTS_ENABLED: "true" },
    { STRIPE_PAYMENTS_ENABLED: "true" },
    { PAYPAL_PAYMENTS_ENABLED: "true" },
    { NOTIFICATION_EMAIL_TRANSPORT: "resend" },
    { MEDIA_STORAGE_DRIVER: "s3" },
    { AUTH_SECRET: "too-short" },
    { SHOP_TERMS_VERSION: SHOP_LEGAL_QA_TERMS_VERSION },
  ]) {
    const invalid = { ...environment, ...mutation };
    assert.equal(isSafeLocalShopPhase5DShippingProviderQaHttpRuntime(invalid), false);
    assert.equal(shouldUseSecureAuthCookies(true, invalid), true);
  }
});

function shopPhase5EProductionReadinessEnvironment() {
  return {
    ...shopPhase5BAfterSalesEnvironment(),
    LNX_DATABASE_TARGET: SHOP_PHASE5E_QA_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/private/tmp/prisma-dev-nodejs/${SHOP_PHASE5E_QA_TARGET}/server.json`,
    DATABASE_URL: "postgresql://127.0.0.1:51280/template1?schema=public",
    AUTH_URL: SHOP_PHASE5E_QA_ORIGIN,
    SITE_URL: SHOP_PHASE5E_QA_ORIGIN,
    APP_CANONICAL_URL: SHOP_PHASE5E_QA_ORIGIN,
    AUTH_EMAIL_CAPTURE_PATH: SHOP_PHASE5E_QA_AUTH_CAPTURE_PATH,
    NOTIFICATION_CAPTURE_PATH: SHOP_PHASE5E_QA_NOTIFICATION_CAPTURE_PATH,
    MEDIA_LOCAL_PUBLIC_ROOT: SHOP_PHASE5E_QA_PUBLIC_MEDIA_ROOT,
    MEDIA_LOCAL_PRIVATE_ROOT: SHOP_PHASE5E_QA_PRIVATE_MEDIA_ROOT,
    MEDIA_STORAGE_ROOT: SHOP_PHASE5E_QA_PUBLIC_MEDIA_ROOT,
    ORDER_UPLOAD_DIR: SHOP_PHASE5E_QA_PRIVATE_MEDIA_ROOT,
    SHOP_SAV_PRIVATE_STORAGE_ROOT: SHOP_PHASE5E_QA_SAV_ROOT,
    SHOP_CUSTOMER_SCOPE: "INDIVIDUALS_ONLY",
    SHOP_PRODUCTION_READINESS_QA: "true",
    SHOP_PRODUCTION_READINESS_QA_CONFIRM: SHOP_PHASE5E_QA_CONFIRMATION,
    SHOP_SHIPPING_RATE_SCOPE: "COMMERCIAL_CANDIDATE",
    SHOP_SHIPPING_QA_CONFIRM: SHOP_PHASE5E_QA_CONFIRMATION,
    SHOP_TERMS_VERSION: SHOP_PHASE5E_QA_TERMS_VERSION,
    SHOP_ORDER_SNAPSHOT_VERSION: SHOP_PHASE5E_QA_ORDER_SNAPSHOT_VERSION,
  } as Record<string, string | undefined>;
}

test("only the exact guarded Phase 5E production-readiness preview permits an HTTP QA cookie", () => {
  const exact = shopPhase5EProductionReadinessEnvironment();
  assert.equal(isSafeLocalShopPhase5EProductionReadinessQaHttpRuntime(exact), true);
  assert.equal(shouldUseSecureAuthCookies(true, exact), false);
  for (const mutation of [
    { SHOP_PRODUCTION_READINESS_QA_CONFIRM: "wrong" },
    { SHOP_CUSTOMER_SCOPE: "BUSINESS" },
    { SHOP_ALLOWED_COUNTRIES: "FR,BE" },
    { SHOP_RESERVATION_TTL_MINUTES: "31" },
    { SHOP_SHIPPING_RATE_SCOPE: "INTERNAL_QA" },
    { SITE_URL: "http://127.0.0.1:31779" },
    { DATABASE_URL: "postgresql://127.0.0.1:5432/template1" },
    { DATABASE_URL: "postgresql://db.example.invalid:51280/template1" },
    { LNX_DATABASE_TARGET: "lnx-studio-production" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { COLISSIMO_CLIENT_SECRET: "forbidden" },
    { STRIPE_SECRET_KEY: "forbidden" },
    { MEDIA_STORAGE_DRIVER: "s3" },
    { SHOP_PAYMENTS_ENABLED: "true" },
  ]) {
    const invalid = { ...exact, ...mutation };
    assert.equal(isSafeLocalShopPhase5EProductionReadinessQaHttpRuntime(invalid), false);
    assert.equal(shouldUseSecureAuthCookies(true, invalid), true);
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
  const environment = {
    NODE_ENV: "production",
    LNX_PREVIEW_MODE: "persistent-local",
    LNX_DATABASE_TARGET: "lnx-studio-local-preview",
    AUTH_URL: "http://127.0.0.1:31740",
  };
  assert.equal(shouldUseSecureAuthCookies(true, environment), false);
  assert.equal(shouldUseSecureAuthCookies(true, {
    ...environment,
    RAILWAY_ENVIRONMENT_NAME: "production",
  }), true);
});

test("development builds remain non-secure while ambiguous production builds fail closed", () => {
  assert.equal(shouldUseSecureAuthCookies(false, {}), false);
  assert.equal(shouldUseSecureAuthCookies(true, {}), true);
});
