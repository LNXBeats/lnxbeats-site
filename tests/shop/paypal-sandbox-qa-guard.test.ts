import assert from "node:assert/strict";
import test from "node:test";

import { SHOP_PHASE2_QA_PROOF_FILE } from "@/lib/shop/qa-guard";
import {
  SHOP_PHASE2_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE2_QA_ORIGIN,
  SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT,
  SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT,
  SHOP_PHASE2_QA_TARGET,
  SHOP_PHASE3C_PAYPAL_QA_CONFIRMATION,
  SHOP_PHASE3_QA_OWNER_EMAIL,
} from "@/lib/shop/qa-contract";
import { assertShopPhase3CPaypalSandboxQaEnvironment } from "@/lib/shop/paypal-sandbox-qa-guard";

const environment = {
  NODE_ENV: "test",
  LNX_DATABASE_TARGET: SHOP_PHASE2_QA_TARGET,
  LNX_PRISMA_DEV_SERVER_FILE: SHOP_PHASE2_QA_PROOF_FILE,
  DATABASE_URL: "postgresql://qa:qa@127.0.0.1:51260/template1",
  AUTH_URL: SHOP_PHASE2_QA_ORIGIN,
  SITE_URL: SHOP_PHASE2_QA_ORIGIN,
  APP_CANONICAL_URL: SHOP_PHASE2_QA_ORIGIN,
  SHOP_PHASE3C_PAYPAL_QA_CONFIRM: SHOP_PHASE3C_PAYPAL_QA_CONFIRMATION,
  SHOP_ENABLED: "true",
  SHOP_LOCAL_QA_CONFIRM: "enable-local-shop-commerce-qa",
  SHOP_ALLOWED_COUNTRIES: "FR",
  SHOP_RESERVATION_TTL_MINUTES: "30",
  MUSIC_PRICING_SOURCE: "legacy",
  SHOP_LEGAL_READY: "true",
  SHOP_TERMS_VERSION: "shop-cgv-phase3-qa-v1",
  SHOP_LEGAL_QA_CONFIRM: "enable-local-shop-legal-qa",
  SHOP_PAYMENTS_ENABLED: "true",
  PAYMENT_DEPLOYMENT_ENV: "development",
  PAYMENTS_ENABLED: "true",
  STRIPE_PAYMENTS_ENABLED: "false",
  STRIPE_MODE: "test",
  PAYPAL_PAYMENTS_ENABLED: "true",
  PAYPAL_ENVIRONMENT: "sandbox",
  PAYPAL_CLIENT_ID: "paypal_phase3c_client_fixture",
  PAYPAL_CLIENT_SECRET: "paypal_phase3c_secret_fixture",
  PAYPAL_WEBHOOK_ID: "paypal_phase3c_webhook_fixture",
  LIVE_REFUNDS_ENABLED: "false",
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
  EMAIL_OWNER_RECIPIENT: SHOP_PHASE3_QA_OWNER_EMAIL,
  SMS_TRANSPORT: "disabled",
  SMS_NOTIFICATIONS_ENABLED: "false",
  MEDIA_DEPLOYMENT_ENV: "test",
  MEDIA_STORAGE_DRIVER: "local",
  MEDIA_LOCAL_PUBLIC_ROOT: SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT,
  MEDIA_LOCAL_PRIVATE_ROOT: SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT,
  MEDIA_STORAGE_ROOT: SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT,
  ORDER_UPLOAD_MODE: "local-qa",
  ORDER_UPLOAD_DIR: SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT,
} as const;

const proof = {
  name: SHOP_PHASE2_QA_TARGET,
  pid: process.pid,
  databasePort: 51260,
  exports: { database: { connectionString: environment.DATABASE_URL } },
};

test("Shop Phase 3C accepts only the armed loopback PayPal Sandbox runtime", async () => {
  const result = await assertShopPhase3CPaypalSandboxQaEnvironment(environment, proof);
  assert.equal(result.paypalEnvironment, "sandbox");
  assert.equal(result.target, SHOP_PHASE2_QA_TARGET);
});

test("Shop Phase 3C refuses PayPal Live, Stripe credentials, remote DBs and missing armament", async () => {
  for (const override of [
    { PAYPAL_ENVIRONMENT: "live" },
    { STRIPE_SECRET_KEY: "sk_test_forbidden_fixture" },
    { DATABASE_URL: "postgresql://qa:qa@example.invalid:5432/shop" },
    { SHOP_PHASE3C_PAYPAL_QA_CONFIRM: "" },
    { NOTIFICATION_EMAIL_TRANSPORT: "resend" },
    { PAYPAL_CLIENT_SECRET: "" },
    { RAILWAY_HOME: "/forbidden" },
  ]) {
    await assert.rejects(() => assertShopPhase3CPaypalSandboxQaEnvironment(
      { ...environment, ...override },
      override.DATABASE_URL ? { ...proof, exports: { database: { connectionString: override.DATABASE_URL } } } : proof,
    ));
  }
});

test("historical PayPal reconciliation remains allowed after only the Shop Checkout kill switch closes", async () => {
  await assertShopPhase3CPaypalSandboxQaEnvironment(
    { ...environment, SHOP_PAYMENTS_ENABLED: "false" },
    proof,
    { historicalReconciliation: true },
  );
  await assert.rejects(() => assertShopPhase3CPaypalSandboxQaEnvironment(
    { ...environment, SHOP_PAYMENTS_ENABLED: "false" },
    proof,
  ));
});
