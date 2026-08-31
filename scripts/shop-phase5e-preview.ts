import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { assertShopProductionReadinessQaEnabled, SHOP_PHASE5E_ORIGIN, SHOP_PHASE5E_PREVIEW_TARGET } from "@/lib/shop/production-readiness-config";

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

async function run() {
  const operation = process.argv[2];
  assert.ok(operation === "build" || operation === "start", "Use build or start.");
  await guard();
  const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
  const args = operation === "build" ? [nextCli, "build", "--webpack"] : [nextCli, "start", "-H", "127.0.0.1", "-p", "31780"];
  const env = Object.fromEntries(ALLOWED_ENV.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]!]])) as NodeJS.ProcessEnv;
  console.info(operation === "build" ? "Building guarded Phase 5E preview." : `Starting guarded Phase 5E preview at ${SHOP_PHASE5E_ORIGIN}.`);
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: "inherit" });
  const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", (value) => resolve(value ?? 1)); });
  if (code !== 0) process.exitCode = code;
}

run().catch((error: unknown) => {
  console.error("The guarded Phase 5E preview command failed.");
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
});
