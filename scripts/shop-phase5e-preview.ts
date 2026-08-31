import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import {
  assertPhase5EPreviewBuildProof,
  parsePhase5EPreviewBuildProof,
  PHASE5E_PREVIEW_BUILD_PROOF_VERSION,
  type Phase5EPreviewBuildProof,
} from "@/lib/shop/phase5e-preview-build-proof";
import { assertShopProductionReadinessQaEnabled, SHOP_PHASE5E_ORIGIN, SHOP_PHASE5E_PREVIEW_TARGET } from "@/lib/shop/production-readiness-config";

const execFileAsync = promisify(execFile);
const BUILD_ID_PATH = ".next/BUILD_ID";
const BUILD_PROOF_PATH = ".next/phase5e-build-proof.json";

const ALLOWED_ENV = [
  "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SHELL", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ",
  "NODE_ENV", "NEXT_TELEMETRY_DISABLED", "DATABASE_URL", "LNX_DATABASE_TARGET", "LNX_PRISMA_DEV_SERVER_FILE",
  "AUTH_URL", "SITE_URL", "APP_CANONICAL_URL", "AUTH_SECRET", "AUTH_QA_ACCESS_ENABLED", "LNX_AUTH_QA_MEMBER_PASSWORD", "LNX_AUTH_QA_ADMIN_PASSWORD",
  "EMAIL_PROVIDER", "AUTH_EMAIL_CAPTURE_PATH", "EMAIL_NOTIFICATIONS_ENABLED", "OWNER_EMAIL_NOTIFICATIONS_ENABLED", "CLIENT_EMAIL_NOTIFICATIONS_ENABLED",
  "EMAIL_OWNER_RECIPIENT", "NOTIFICATION_DEPLOYMENT_ENV", "NOTIFICATION_EMAIL_TRANSPORT", "NOTIFICATION_CAPTURE_PATH", "NOTIFICATION_WORKER_ENABLED",
  "NOTIFICATION_SCHEDULER_MODE", "SMS_TRANSPORT", "SMS_NOTIFICATIONS_ENABLED", "PAYMENTS_ENABLED", "PAYMENT_DEPLOYMENT_ENV",
  "LIVE_REFUNDS_ENABLED", "STRIPE_PAYMENTS_ENABLED", "STRIPE_MODE", "PAYPAL_PAYMENTS_ENABLED", "PAYPAL_ENVIRONMENT",
  "SHOP_ENABLED", "SHOP_CUSTOMER_SCOPE", "SHOP_LOCAL_QA_CONFIRM", "SHOP_ALLOWED_COUNTRIES", "SHOP_RESERVATION_TTL_MINUTES", "SHOP_PAYMENTS_ENABLED", "MUSIC_PRICING_SOURCE",
  "SHOP_SHIPPING_ENABLED", "SHOP_SHIPPING_RATE_SCOPE", "SHOP_SHIPPING_QA_CONFIRM", "SHOP_LEGAL_READY", "SHOP_LEGAL_QA_CONFIRM", "SHOP_TERMS_VERSION", "SHOP_ORDER_SNAPSHOT_VERSION",
  "SHOP_AFTER_SALES_ENABLED", "SHOP_AFTER_SALES_QA_CONFIRM", "SHOP_AFTER_SALES_REFUND_PROVIDER",
  "SHOP_PRODUCTION_READINESS_QA", "SHOP_PRODUCTION_READINESS_QA_CONFIRM", "SHOP_SAV_PRIVATE_STORAGE_ROOT",
  "MEDIA_DEPLOYMENT_ENV", "MEDIA_STORAGE_DRIVER", "MEDIA_LOCAL_PUBLIC_ROOT", "MEDIA_LOCAL_PRIVATE_ROOT", "MEDIA_STORAGE_ROOT", "ORDER_UPLOAD_MODE", "ORDER_UPLOAD_DIR",
] as const;

async function guard() {
  const identity = assertShopProductionReadinessQaEnabled();
  assert.equal(identity.target, SHOP_PHASE5E_PREVIEW_TARGET);
  const database = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as { name?: string; pid?: number; databasePort?: number; exports?: { database?: { connectionString?: string } } };
  assert.equal(proof.name, SHOP_PHASE5E_PREVIEW_TARGET);
  const proofDatabase = assertSafeLocalPostgresUrl(proof.exports?.database?.connectionString ?? "");
  assert.equal(proofDatabase.hostname, database.hostname);
  assert.equal(proofDatabase.port, database.port);
  process.kill(Number(proof.pid), 0);
}

async function gitValue(...args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  return stdout.trim();
}

async function assertTrackedTreeClean() {
  try {
    await execFileAsync("git", ["diff", "--quiet", "HEAD", "--"], { cwd: process.cwd() });
  } catch {
    throw new Error("La preview Phase 5E exige un HEAD commité sans modification suivie.");
  }
}

async function currentBuildIdentity() {
  return {
    head: await gitValue("rev-parse", "HEAD"),
    tree: await gitValue("rev-parse", "HEAD^{tree}"),
    buildId: (await readFile(BUILD_ID_PATH, "utf8")).trim(),
    worktree: process.cwd(),
    target: SHOP_PHASE5E_PREVIEW_TARGET,
    origin: SHOP_PHASE5E_ORIGIN,
  };
}

async function runNext(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: "inherit" });
  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => resolve(value ?? 1));
  });
}

async function run() {
  const operation = process.argv[2];
  assert.ok(operation === "build" || operation === "start", "Use build or start.");
  await guard();
  await assertTrackedTreeClean();
  const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
  const args = operation === "build" ? [nextCli, "build", "--webpack"] : [nextCli, "start", "-H", "127.0.0.1", "-p", "31780"];
  const env = Object.fromEntries(ALLOWED_ENV.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]!]])) as NodeJS.ProcessEnv;
  if (operation === "build") {
    const headBefore = await gitValue("rev-parse", "HEAD");
    const treeBefore = await gitValue("rev-parse", "HEAD^{tree}");
    console.info("Building guarded Phase 5E preview from the committed HEAD.");
    const code = await runNext(args, env);
    if (code !== 0) {
      process.exitCode = code;
      return;
    }
    await assertTrackedTreeClean();
    const identity = await currentBuildIdentity();
    assert.equal(identity.head, headBefore, "HEAD modifié pendant le build Phase 5E.");
    assert.equal(identity.tree, treeBefore, "Tree Git modifié pendant le build Phase 5E.");
    const proof: Phase5EPreviewBuildProof = {
      version: PHASE5E_PREVIEW_BUILD_PROOF_VERSION,
      ...identity,
    };
    await writeFile(BUILD_PROOF_PATH, `${JSON.stringify(proof)}\n`, { encoding: "utf8", mode: 0o600 });
    console.info(`Guarded Phase 5E preview build recorded for HEAD ${identity.head}.`);
    return;
  }

  const identity = await currentBuildIdentity();
  const proof = parsePhase5EPreviewBuildProof(await readFile(BUILD_PROOF_PATH, "utf8"));
  assertPhase5EPreviewBuildProof(proof, identity);
  console.info(`Starting guarded Phase 5E preview at ${SHOP_PHASE5E_ORIGIN} from HEAD ${identity.head}.`);
  const code = await runNext(args, env);
  if (code !== 0) process.exitCode = code;
}

run().catch((error: unknown) => {
  console.error("The guarded Phase 5E preview command failed.");
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
});
