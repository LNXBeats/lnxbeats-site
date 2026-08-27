import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { parseShopConfiguration } from "@/lib/shop/config";

export const SHOP_PHASE2_QA_TARGET = "lnx-studio-v110-phase2-test";
export const SHOP_PHASE2_QA_REQUESTED_DATABASE_PORT = "51260";
export const SHOP_PHASE2_QA_HTTP_PORT = "31760";
export const SHOP_PHASE2_QA_ORIGIN = `http://127.0.0.1:${SHOP_PHASE2_QA_HTTP_PORT}`;
export const SHOP_PHASE2_QA_CONFIRMATION = "enable-local-shop-commerce-qa";
export const SHOP_PHASE2_QA_PROOF_FILE = path.join(
  homedir(),
  "Library/Application Support/prisma-dev-nodejs",
  SHOP_PHASE2_QA_TARGET,
  "server.json",
);
export const SHOP_PHASE2_QA_AUTH_CAPTURE_PATH = "/private/tmp/lnx-studio-v110-phase2-auth-mailbox.jsonl";
export const SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH = "/private/tmp/lnx-studio-v110-phase2-notifications.jsonl";
export const SHOP_PHASE2_QA_MEDIA_ROOT = "/private/tmp/lnx-studio-v110-phase2-media";
export const SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT = `${SHOP_PHASE2_QA_MEDIA_ROOT}/public`;
export const SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT = `${SHOP_PHASE2_QA_MEDIA_ROOT}/private`;

const SHOP_PHASE2_QA_FORBIDDEN_NEXT_ENV_FILES = [
  ".env",
  ".env.test",
  ".env.test.local",
] as const;

const SHOP_PHASE2_QA_CHILD_ENVIRONMENT_NAMES = [
  "NODE_ENV",
  "LNX_DATABASE_TARGET",
  "LNX_PRISMA_DEV_SERVER_FILE",
  "DATABASE_URL",
  "AUTH_URL",
  "SITE_URL",
  "APP_CANONICAL_URL",
  "AUTH_SECRET",
  "LNX_AUTH_QA_MEMBER_PASSWORD",
  "LNX_AUTH_QA_ADMIN_PASSWORD",
  "AUTH_QA_ACCESS_ENABLED",
  "EMAIL_PROVIDER",
  "AUTH_EMAIL_CAPTURE_PATH",
  "EMAIL_NOTIFICATIONS_ENABLED",
  "OWNER_EMAIL_NOTIFICATIONS_ENABLED",
  "CLIENT_EMAIL_NOTIFICATIONS_ENABLED",
  "NOTIFICATION_DEPLOYMENT_ENV",
  "NOTIFICATION_EMAIL_TRANSPORT",
  "NOTIFICATION_CAPTURE_PATH",
  "NOTIFICATION_WORKER_ENABLED",
  "NOTIFICATION_SCHEDULER_MODE",
  "SMS_TRANSPORT",
  "SMS_NOTIFICATIONS_ENABLED",
  "PAYMENTS_ENABLED",
  "PAYMENT_DEPLOYMENT_ENV",
  "LIVE_REFUNDS_ENABLED",
  "STRIPE_PAYMENTS_ENABLED",
  "STRIPE_MODE",
  "PAYPAL_PAYMENTS_ENABLED",
  "PAYPAL_ENVIRONMENT",
  "SHOP_ENABLED",
  "SHOP_LOCAL_QA_CONFIRM",
  "SHOP_ALLOWED_COUNTRIES",
  "SHOP_RESERVATION_TTL_MINUTES",
  "MUSIC_PRICING_SOURCE",
  "MEDIA_DEPLOYMENT_ENV",
  "MEDIA_STORAGE_DRIVER",
  "MEDIA_LOCAL_PUBLIC_ROOT",
  "MEDIA_LOCAL_PRIVATE_ROOT",
  "MEDIA_STORAGE_ROOT",
  "ORDER_UPLOAD_MODE",
  "ORDER_UPLOAD_DIR",
] as const;

const SHOP_PHASE2_QA_SYSTEM_ENVIRONMENT_NAMES = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TZ",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
  "NEXT_TELEMETRY_DISABLED",
] as const;

type ShopQaEnvironment = Readonly<Record<string, string | undefined>>;

export type ShopPhase2QaProof = Readonly<{
  name?: string;
  pid?: number;
  databasePort?: number;
  exports?: { database?: { connectionString?: string } };
}>;

function required(environment: ShopQaEnvironment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the local Shop Phase 2 QA.`);
  return value;
}

function assertExact(environment: ShopQaEnvironment, name: string, expected: string) {
  assert.equal(
    environment[name],
    expected,
    `${name} must be exactly ${expected} for the local Shop Phase 2 QA.`,
  );
}

function assertAbsent(environment: ShopQaEnvironment, names: readonly string[]) {
  for (const name of names) {
    assert.ok(!environment[name]?.trim(), `${name} must be absent from the local Shop Phase 2 QA.`);
  }
}

function assertNoExternalProviderEnvironment(environment: ShopQaEnvironment) {
  const allowedProviderSettings = new Set([
    "STRIPE_PAYMENTS_ENABLED",
    "STRIPE_MODE",
    "PAYPAL_PAYMENTS_ENABLED",
    "PAYPAL_ENVIRONMENT",
  ]);
  for (const [name, value] of Object.entries(environment)) {
    if (!value?.trim() || allowedProviderSettings.has(name)) continue;
    const externalProviderVariable = /^(?:AWS|CLOUDFLARE|R2|RAILWAY|RESEND|S3|NEXT_PUBLIC_STRIPE|NEXT_PUBLIC_PAYPAL)_/.test(name)
      || /^STRIPE_/.test(name)
      || /^PAYPAL_/.test(name)
      || /^MEDIA_S3_/.test(name);
    assert.ok(!externalProviderVariable, `${name} must be absent from the local Shop Phase 2 QA.`);
  }
}

export function shopPhase2QaChildEnvironment(
  environment: ShopQaEnvironment = process.env,
) {
  return Object.fromEntries(
    [
      ...SHOP_PHASE2_QA_SYSTEM_ENVIRONMENT_NAMES,
      ...SHOP_PHASE2_QA_CHILD_ENVIRONMENT_NAMES,
    ].flatMap((name) => {
      const value = environment[name];
      return value === undefined ? [] : [[name, value] as const];
    }),
  ) as NodeJS.ProcessEnv;
}

export async function assertNoShopPhase2QaNextEnvironmentFiles(
  root = process.cwd(),
) {
  for (const filename of SHOP_PHASE2_QA_FORBIDDEN_NEXT_ENV_FILES) {
    try {
      await access(path.join(root, filename));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    throw new Error(`${filename} is forbidden in the isolated Shop Phase 2 QA worktree.`);
  }
}

function assertCanonicalOrigin(environment: ShopQaEnvironment) {
  for (const name of ["AUTH_URL", "SITE_URL", "APP_CANONICAL_URL"] as const) {
    const raw = required(environment, name);
    const url = new URL(raw);
    assert.equal(url.origin, SHOP_PHASE2_QA_ORIGIN, `${name} must use the dedicated Shop Phase 2 origin.`);
    assert.equal(url.protocol, "http:", `${name} must use loopback HTTP.`);
    assert.equal(url.hostname, "127.0.0.1", `${name} must use the exact loopback host.`);
    assert.equal(url.port, SHOP_PHASE2_QA_HTTP_PORT, `${name} must use the dedicated Shop Phase 2 port.`);
    assert.equal(url.pathname, "/", `${name} must not contain a path.`);
    assert.ok(!url.username && !url.password && !url.search && !url.hash, `${name} must be canonical.`);
    assert.equal(raw, SHOP_PHASE2_QA_ORIGIN, `${name} must match the canonical Shop Phase 2 origin exactly.`);
  }
}

function assertSecretShape(environment: ShopQaEnvironment) {
  const authSecret = required(environment, "AUTH_SECRET");
  assert.ok(authSecret.length >= 32 && authSecret.length <= 1_024, "AUTH_SECRET has an invalid length.");
  assert.ok(!/[\r\n]/.test(authSecret), "AUTH_SECRET contains an invalid line break.");
  const memberPassword = required(environment, "LNX_AUTH_QA_MEMBER_PASSWORD");
  const adminPassword = required(environment, "LNX_AUTH_QA_ADMIN_PASSWORD");
  for (const [name, password] of [
    ["LNX_AUTH_QA_MEMBER_PASSWORD", memberPassword],
    ["LNX_AUTH_QA_ADMIN_PASSWORD", adminPassword],
  ] as const) {
    assert.ok(password.length >= 12 && password.length <= 128, `${name} has an invalid length.`);
    assert.ok(!/[\r\n]/.test(password), `${name} contains an invalid line break.`);
  }
  assert.notEqual(memberPassword, adminPassword, "The MEMBER and ADMIN QA passwords must be distinct.");
}

function assertNoExternalServices(environment: ShopQaEnvironment) {
  assertExact(environment, "EMAIL_PROVIDER", "capture");
  assertExact(environment, "AUTH_EMAIL_CAPTURE_PATH", SHOP_PHASE2_QA_AUTH_CAPTURE_PATH);
  assertExact(environment, "NOTIFICATION_DEPLOYMENT_ENV", "development");
  assertExact(environment, "NOTIFICATION_EMAIL_TRANSPORT", "capture");
  assertExact(environment, "NOTIFICATION_CAPTURE_PATH", SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH);
  assertExact(environment, "NOTIFICATION_WORKER_ENABLED", "false");
  assertExact(environment, "NOTIFICATION_SCHEDULER_MODE", "disabled");
  assertExact(environment, "EMAIL_NOTIFICATIONS_ENABLED", "true");
  assertExact(environment, "OWNER_EMAIL_NOTIFICATIONS_ENABLED", "true");
  assertExact(environment, "CLIENT_EMAIL_NOTIFICATIONS_ENABLED", "true");
  assertExact(environment, "SMS_TRANSPORT", "disabled");
  assertExact(environment, "SMS_NOTIFICATIONS_ENABLED", "false");

  assertExact(environment, "PAYMENTS_ENABLED", "false");
  assertExact(environment, "PAYMENT_DEPLOYMENT_ENV", "development");
  assertExact(environment, "STRIPE_PAYMENTS_ENABLED", "false");
  assertExact(environment, "PAYPAL_PAYMENTS_ENABLED", "false");
  assertExact(environment, "LIVE_REFUNDS_ENABLED", "false");

  assertExact(environment, "MEDIA_DEPLOYMENT_ENV", "test");
  assertExact(environment, "MEDIA_STORAGE_DRIVER", "local");
  assertExact(environment, "MEDIA_LOCAL_PUBLIC_ROOT", SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT);
  assertExact(environment, "MEDIA_LOCAL_PRIVATE_ROOT", SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT);
  assertExact(environment, "MEDIA_STORAGE_ROOT", SHOP_PHASE2_QA_PUBLIC_MEDIA_ROOT);
  assertExact(environment, "ORDER_UPLOAD_MODE", "local-qa");
  assertExact(environment, "ORDER_UPLOAD_DIR", SHOP_PHASE2_QA_PRIVATE_MEDIA_ROOT);

  assertExact(environment, "AUTH_QA_ACCESS_ENABLED", "false");
  assertAbsent(environment, [
    "AUTH_QA_ACCESS_CONFIRM",
    "AUTH_QA_ACCESS_SECRET",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "RESEND_BASE_URL",
    "NOTIFICATION_WORKER_SECRET",
    "NOTIFICATION_STAGING_CONFIRM",
    "NOTIFICATION_PRODUCTION_CONFIRM",
    "NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST",
    "NOTIFICATION_STAGING_QA_CONFIRM",
    "NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM",
    "NOTIFICATION_PRODUCTION_OWNER_SMOKE_CONFIRM",
    "EMAIL_OWNER_RECIPIENT",
    "EMAIL_FROM",
    "EMAIL_REPLY_TO",
    "SMS_OWNER_RECIPIENT",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "PAYMENT_STAGING_CONFIRM",
    "PAYMENT_PRODUCTION_CONFIRM",
    "PAYMENT_QA_CONFIRM",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_WEBHOOK_ID",
    "MEDIA_STORAGE_PROVIDER",
    "MEDIA_S3_ENDPOINT",
    "MEDIA_S3_ACCESS_KEY_ID",
    "MEDIA_S3_SECRET_ACCESS_KEY",
    "MEDIA_S3_REGION",
    "MEDIA_S3_FORCE_PATH_STYLE",
    "MEDIA_PUBLIC_BUCKET",
    "MEDIA_PRIVATE_BUCKET",
    "MEDIA_R2_STAGING_CONFIRM",
    "MEDIA_R2_STAGING_RUNTIME_CONFIRM",
    "MEDIA_R2_AUDIO_WAV_CONFIRM",
    "MEDIA_MIGRATION_CONFIRM",
    "MEDIA_MIGRATION_MAINTENANCE_CONFIRM",
    "MEDIA_MIGRATION_DATABASE_CONFIRM",
    "SHADOW_DATABASE_URL",
    "DIRECT_URL",
    "ADMIN_EMAIL",
    "ADMIN_BOOTSTRAP_CONFIRM",
    "ADMIN_BOOTSTRAP_PASSWORD",
    "CATALOG_PRODUCTION_CONFIRM",
    "MEDIA_PRODUCTION_CONFIRM",
  ]);
  assertNoExternalProviderEnvironment(environment);
}

function assertShopPhase2QaRuntimeBase(
  environment: ShopQaEnvironment,
  proof: ShopPhase2QaProof,
) {
  assertExact(environment, "NODE_ENV", "test");
  assertExact(environment, "LNX_DATABASE_TARGET", SHOP_PHASE2_QA_TARGET);
  assert.ok(!environment.LNX_PREVIEW_MODE, "The personal persistent preview is forbidden for Shop Phase 2 QA.");
  assertAbsent(environment, ["RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME"]);

  const rawDatabaseUrl = required(environment, "DATABASE_URL");
  const databaseUrl = assertSafeLocalPostgresUrl(rawDatabaseUrl);
  assert.ok(
    Number.isInteger(proof.databasePort)
      && Number(proof.databasePort) > 0
      && Number(proof.databasePort) <= 65_535
      && Number(proof.databasePort) !== 5_432,
    "The Prisma Dev proof has no valid isolated database port.",
  );
  assert.equal(
    databaseUrl.port,
    String(proof.databasePort),
    "DATABASE_URL must use the exact database port exported by the Prisma Dev proof.",
  );
  assert.equal(
    decodeURIComponent(databaseUrl.pathname),
    "/template1",
    "The Shop Phase 2 QA must use the dedicated Prisma Dev technical database.",
  );
  assert.equal(proof.name, SHOP_PHASE2_QA_TARGET, "The Prisma Dev proof target does not match.");
  assert.equal(
    proof.exports?.database?.connectionString,
    rawDatabaseUrl,
    "DATABASE_URL must be the exact connection exported by the Prisma Dev proof.",
  );
  assert.ok(Number.isInteger(proof.pid) && Number(proof.pid) > 0, "The Prisma Dev proof has no valid process identifier.");

  assertCanonicalOrigin(environment);
  assertSecretShape(environment);
  assertNoExternalServices(environment);
  return {
    target: SHOP_PHASE2_QA_TARGET,
    databaseUrl: rawDatabaseUrl,
    baseUrl: SHOP_PHASE2_QA_ORIGIN,
    proofPid: Number(proof.pid),
  } as const;
}

export function assertShopPhase2QaEnvironment(
  environment: ShopQaEnvironment,
  proof: ShopPhase2QaProof,
) {
  const runtime = assertShopPhase2QaRuntimeBase(environment, proof);
  assertExact(environment, "SHOP_ENABLED", "true");
  assertExact(environment, "SHOP_LOCAL_QA_CONFIRM", SHOP_PHASE2_QA_CONFIRMATION);
  assertExact(environment, "SHOP_ALLOWED_COUNTRIES", "FR");
  assertExact(environment, "SHOP_RESERVATION_TTL_MINUTES", "30");
  assertExact(environment, "MUSIC_PRICING_SOURCE", "legacy");
  const configuration = parseShopConfiguration(environment);
  assert.equal(configuration.enabled, true, "The Shop Phase 2 QA must explicitly enable the Shop.");
  assert.equal(configuration.pricingSource, "legacy", "Music pricing must stay on the legacy source.");

  return runtime;
}

export function assertShopPhase2QaExpiryEnvironment(
  environment: ShopQaEnvironment,
  proof: ShopPhase2QaProof,
) {
  const runtime = assertShopPhase2QaRuntimeBase(environment, proof);
  assert.ok(
    environment.SHOP_ENABLED === "true" || environment.SHOP_ENABLED === "false",
    "SHOP_ENABLED must be explicitly true or false for Shop Phase 2 expiry.",
  );
  assertExact(environment, "MUSIC_PRICING_SOURCE", "legacy");
  const configuration = parseShopConfiguration(environment);
  assert.equal(
    configuration.commerceConfigured,
    true,
    "The Shop Phase 2 expiry command requires the explicit countries and reservation TTL.",
  );
  return { ...runtime, shopEnabled: configuration.enabled } as const;
}

function assertProofProcessIsAlive(proof: ShopPhase2QaProof) {
  const pid = Number(proof.pid);
  assert.ok(Number.isInteger(pid) && pid > 0, "The Prisma Dev proof has no valid process identifier.");
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") return;
    throw new Error("The Shop Phase 2 Prisma Dev process is not running.");
  }
}

export async function loadAndAssertShopPhase2QaEnvironment(
  environment: ShopQaEnvironment = process.env,
) {
  await assertNoShopPhase2QaNextEnvironmentFiles();
  const proof = await loadShopPhase2QaProof(environment);
  return assertShopPhase2QaEnvironment(environment, proof);
}

async function loadShopPhase2QaProof(environment: ShopQaEnvironment) {
  const proofPath = required(environment, "LNX_PRISMA_DEV_SERVER_FILE");
  assert.equal(proofPath, SHOP_PHASE2_QA_PROOF_FILE, "The Shop Phase 2 QA requires its exact Prisma Dev proof file.");
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as ShopPhase2QaProof;
  assertProofProcessIsAlive(proof);
  return proof;
}

export async function loadAndAssertShopPhase2QaExpiryEnvironment(
  environment: ShopQaEnvironment = process.env,
) {
  await assertNoShopPhase2QaNextEnvironmentFiles();
  const proof = await loadShopPhase2QaProof(environment);
  return assertShopPhase2QaExpiryEnvironment(environment, proof);
}
