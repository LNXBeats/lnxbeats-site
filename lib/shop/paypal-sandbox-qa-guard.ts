import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import {
  SHOP_PHASE2_QA_PROOF_FILE,
  shopPhase2QaChildEnvironment,
} from "@/lib/shop/qa-guard";
import {
  SHOP_PHASE2_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE2_QA_HTTP_PORT,
  SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE2_QA_ORIGIN,
  SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT,
  SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT,
  SHOP_PHASE2_QA_RUNTIME_CONFIRMATION,
  SHOP_PHASE2_QA_RUNTIME_CONFIRMATION_NAME,
  SHOP_PHASE2_QA_TARGET,
  SHOP_PHASE3C_PAYPAL_QA_CONFIRMATION,
  SHOP_PHASE3_QA_OWNER_EMAIL,
} from "@/lib/shop/qa-contract";
import {
  SHOP_LEGAL_QA_CONFIRMATION,
  SHOP_LEGAL_QA_TERMS_VERSION,
} from "@/lib/shop/legal";

type Environment = Readonly<Record<string, string | undefined>>;
type Proof = Readonly<{
  name?: string;
  pid?: number;
  databasePort?: number;
  exports?: { database?: { connectionString?: string } };
}>;

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for Shop PayPal Sandbox QA.`);
  return value;
}

function exact(environment: Environment, name: string, expected: string) {
  assert.equal(environment[name], expected, `${name} has an invalid Shop PayPal Sandbox QA value.`);
}

function absent(environment: Environment, names: readonly string[]) {
  for (const name of names) {
    assert.ok(!environment[name]?.trim(), `${name} is forbidden in Shop PayPal Sandbox QA.`);
  }
}

function assertNoRailwayEnvironment(environment: Environment) {
  assert.ok(
    !Object.entries(environment).some(
      ([name, value]) => name.startsWith("RAILWAY_") && Boolean(value?.trim()),
    ),
    "Railway environment variables are forbidden in Shop PayPal Sandbox QA.",
  );
}

function assertProofProcessIsAlive(proof: Proof) {
  const pid = Number(proof.pid);
  assert.ok(Number.isInteger(pid) && pid > 0, "The Prisma Dev proof has no valid process identifier.");
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") return;
    throw new Error("The Shop PayPal Sandbox Prisma Dev process is not running.");
  }
}

function assertOrigin(environment: Environment) {
  for (const name of ["AUTH_URL", "SITE_URL", "APP_CANONICAL_URL"] as const) {
    const raw = required(environment, name);
    const url = new URL(raw);
    assert.equal(raw, SHOP_PHASE2_QA_ORIGIN, `${name} must use the dedicated loopback origin.`);
    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, SHOP_PHASE2_QA_HTTP_PORT);
    assert.equal(url.pathname, "/");
    assert.ok(!url.username && !url.password && !url.search && !url.hash);
  }
}

function assertProviderIsolation(environment: Environment) {
  exact(environment, "PAYPAL_PAYMENTS_ENABLED", "true");
  exact(environment, "PAYPAL_ENVIRONMENT", "sandbox");
  assert.match(required(environment, "PAYPAL_CLIENT_ID"), /^[A-Za-z0-9_-]{12,255}$/);
  assert.match(required(environment, "PAYPAL_CLIENT_SECRET"), /^[A-Za-z0-9_-]{12,255}$/);
  assert.match(required(environment, "PAYPAL_WEBHOOK_ID"), /^[A-Za-z0-9_-]{6,255}$/);
  exact(environment, "STRIPE_PAYMENTS_ENABLED", "false");
  exact(environment, "STRIPE_MODE", "test");
  exact(environment, "LIVE_REFUNDS_ENABLED", "false");
  absent(environment, [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "PAYMENT_STAGING_CONFIRM",
    "PAYMENT_PRODUCTION_CONFIRM",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "RESEND_BASE_URL",
  ]);
  assertNoRailwayEnvironment(environment);
}

function assertCaptureAndLocalStorage(environment: Environment) {
  exact(environment, "EMAIL_PROVIDER", "capture");
  exact(environment, "AUTH_EMAIL_CAPTURE_PATH", SHOP_PHASE2_QA_AUTH_CAPTURE_PATH);
  exact(environment, "NOTIFICATION_DEPLOYMENT_ENV", "development");
  exact(environment, "NOTIFICATION_EMAIL_TRANSPORT", "capture");
  exact(environment, "NOTIFICATION_CAPTURE_PATH", SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH);
  exact(environment, "NOTIFICATION_WORKER_ENABLED", "false");
  exact(environment, "NOTIFICATION_SCHEDULER_MODE", "disabled");
  exact(environment, "EMAIL_NOTIFICATIONS_ENABLED", "true");
  exact(environment, "OWNER_EMAIL_NOTIFICATIONS_ENABLED", "true");
  exact(environment, "CLIENT_EMAIL_NOTIFICATIONS_ENABLED", "true");
  exact(environment, "EMAIL_OWNER_RECIPIENT", SHOP_PHASE3_QA_OWNER_EMAIL);
  exact(environment, "SMS_TRANSPORT", "disabled");
  exact(environment, "SMS_NOTIFICATIONS_ENABLED", "false");
  exact(environment, "MEDIA_DEPLOYMENT_ENV", "test");
  exact(environment, "MEDIA_STORAGE_DRIVER", "local");
  exact(environment, "MEDIA_LOCAL_PUBLIC_ROOT", SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT);
  exact(environment, "MEDIA_LOCAL_PRIVATE_ROOT", SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT);
  exact(environment, "MEDIA_STORAGE_ROOT", SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT);
  exact(environment, "ORDER_UPLOAD_MODE", "local-qa");
  exact(environment, "ORDER_UPLOAD_DIR", SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT);
  absent(environment, [
    "EMAIL_FROM",
    "EMAIL_REPLY_TO",
    "NOTIFICATION_WORKER_SECRET",
    "MEDIA_STORAGE_PROVIDER",
    "MEDIA_S3_ENDPOINT",
    "MEDIA_S3_ACCESS_KEY_ID",
    "MEDIA_S3_SECRET_ACCESS_KEY",
    "MEDIA_PUBLIC_BUCKET",
    "MEDIA_PRIVATE_BUCKET",
  ]);
}

export async function assertShopPhase3CPaypalSandboxQaEnvironment(
  environment: Environment,
  proof: Proof,
  options: Readonly<{ historicalReconciliation?: boolean }> = {},
) {
  exact(environment, "NODE_ENV", "test");
  exact(environment, "LNX_DATABASE_TARGET", SHOP_PHASE2_QA_TARGET);
  exact(environment, "LNX_PRISMA_DEV_SERVER_FILE", SHOP_PHASE2_QA_PROOF_FILE);
  exact(environment, "SHOP_PHASE3C_PAYPAL_QA_CONFIRM", SHOP_PHASE3C_PAYPAL_QA_CONFIRMATION);
  assert.ok(!environment.LNX_PREVIEW_MODE, "Persistent preview mode is forbidden.");

  const rawDatabaseUrl = required(environment, "DATABASE_URL");
  const databaseUrl = assertSafeLocalPostgresUrl(rawDatabaseUrl);
  assert.equal(proof.name, SHOP_PHASE2_QA_TARGET);
  assert.ok(Number.isInteger(proof.databasePort) && Number(proof.databasePort) > 0);
  assert.notEqual(Number(proof.databasePort), 5_432);
  assert.equal(databaseUrl.port, String(proof.databasePort));
  assert.equal(decodeURIComponent(databaseUrl.pathname), "/template1");
  assert.equal(proof.exports?.database?.connectionString, rawDatabaseUrl);
  assertProofProcessIsAlive(proof);
  assertOrigin(environment);

  exact(environment, "SHOP_ENABLED", "true");
  exact(environment, "SHOP_LOCAL_QA_CONFIRM", "enable-local-shop-commerce-qa");
  exact(environment, "SHOP_ALLOWED_COUNTRIES", "FR");
  exact(environment, "SHOP_RESERVATION_TTL_MINUTES", "30");
  exact(environment, "MUSIC_PRICING_SOURCE", "legacy");
  exact(environment, "SHOP_LEGAL_READY", "true");
  exact(environment, "SHOP_TERMS_VERSION", SHOP_LEGAL_QA_TERMS_VERSION);
  exact(environment, "SHOP_LEGAL_QA_CONFIRM", SHOP_LEGAL_QA_CONFIRMATION);
  exact(environment, "PAYMENT_DEPLOYMENT_ENV", "development");
  exact(environment, "PAYMENTS_ENABLED", "true");
  if (options.historicalReconciliation) {
    assert.ok(
      environment.SHOP_PAYMENTS_ENABLED === "true" || environment.SHOP_PAYMENTS_ENABLED === "false",
      "Historical reconciliation requires an explicit Shop payment switch.",
    );
  } else {
    exact(environment, "SHOP_PAYMENTS_ENABLED", "true");
  }
  assertProviderIsolation(environment);
  assertCaptureAndLocalStorage(environment);
  return {
    target: SHOP_PHASE2_QA_TARGET,
    baseUrl: SHOP_PHASE2_QA_ORIGIN,
    proofPid: Number(proof.pid),
    paypalEnvironment: "sandbox" as const,
  };
}

export async function loadAndAssertShopPhase3CPaypalSandboxQaEnvironment(
  environment: Environment = process.env,
  options: Readonly<{ historicalReconciliation?: boolean }> = {},
) {
  const proofPath = required(environment, "LNX_PRISMA_DEV_SERVER_FILE");
  assert.equal(proofPath, SHOP_PHASE2_QA_PROOF_FILE);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as Proof;
  return assertShopPhase3CPaypalSandboxQaEnvironment(environment, proof, options);
}

export function shopPhase3CPaypalSandboxQaChildEnvironment(
  environment: Environment = process.env,
) {
  return {
    ...shopPhase2QaChildEnvironment(environment, { validatedRuntime: true }),
    [SHOP_PHASE2_QA_RUNTIME_CONFIRMATION_NAME]: SHOP_PHASE2_QA_RUNTIME_CONFIRMATION,
    SHOP_PHASE3C_PAYPAL_QA_CONFIRM: SHOP_PHASE3C_PAYPAL_QA_CONFIRMATION,
    SHOP_LEGAL_READY: "true",
    SHOP_TERMS_VERSION: SHOP_LEGAL_QA_TERMS_VERSION,
    SHOP_LEGAL_QA_CONFIRM: SHOP_LEGAL_QA_CONFIRMATION,
    SHOP_PAYMENTS_ENABLED: environment.SHOP_PAYMENTS_ENABLED,
    PAYMENTS_ENABLED: "true",
    STRIPE_PAYMENTS_ENABLED: "false",
    STRIPE_MODE: "test",
    PAYPAL_PAYMENTS_ENABLED: "true",
    PAYPAL_ENVIRONMENT: "sandbox",
    PAYPAL_CLIENT_ID: required(environment, "PAYPAL_CLIENT_ID"),
    PAYPAL_CLIENT_SECRET: required(environment, "PAYPAL_CLIENT_SECRET"),
    PAYPAL_WEBHOOK_ID: required(environment, "PAYPAL_WEBHOOK_ID"),
    LIVE_REFUNDS_ENABLED: "false",
    EMAIL_OWNER_RECIPIENT: SHOP_PHASE3_QA_OWNER_EMAIL,
  } satisfies NodeJS.ProcessEnv;
}
