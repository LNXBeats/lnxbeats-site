import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";

export const NOTIFICATION_QA_TARGET = "lnx-studio-v073-notifications-test";
export const NOTIFICATION_QA_CONFIRMATION = "run-v073-notification-runtime-qa";
export const NOTIFICATION_QA_DATABASE_PORT = "51254";
export const NOTIFICATION_QA_HTTP_PORT = "31730";
export const NOTIFICATION_QA_PROOF_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v073-notifications-test/server.json";

type Environment = Record<string, string | undefined>;
type Proof = { name?: string; pid?: number; exports?: { database?: { connectionString?: string } } };

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for notification QA.`);
  return value;
}

function assertAlive(proof: Proof) {
  const pid = Number(proof.pid);
  assert.ok(Number.isInteger(pid) && pid > 0, "The notification QA proof has no valid PID.");
  try { process.kill(pid, 0); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") return;
    throw new Error("The notification QA database process is not running.");
  }
}

export function assertNotificationQaEnvironment(environment: Environment, proof: Proof) {
  assert.ok(environment.NOTIFICATION_QA_CONFIRM === NOTIFICATION_QA_CONFIRMATION, "Notification QA requires explicit confirmation.");
  assert.ok(environment.NODE_ENV === "test", "Notification QA requires NODE_ENV=test.");
  assert.ok(!environment.RAILWAY_ENVIRONMENT, "Notification QA refuses Railway.");
  assert.ok(environment.LNX_DATABASE_TARGET === NOTIFICATION_QA_TARGET, "Notification QA refuses every other database target.");
  assert.ok(environment.NOTIFICATION_DEPLOYMENT_ENV === "development", "Notification QA requires development mode.");
  assert.ok(environment.NOTIFICATION_EMAIL_TRANSPORT === "capture", "Notification QA requires capture transport.");
  assert.ok(environment.EMAIL_NOTIFICATIONS_ENABLED === "true", "Notification QA requires the email flag.");
  assert.ok(environment.OWNER_EMAIL_NOTIFICATIONS_ENABLED === "true", "Notification QA requires the owner email flag.");
  assert.ok(environment.CLIENT_EMAIL_NOTIFICATIONS_ENABLED === "true", "Notification QA requires the client email flag.");
  assert.ok(!environment.EMAIL_OWNER_RECIPIENT?.trim(), "Notification QA must keep the real owner destination absent.");
  assert.ok(environment.SMS_TRANSPORT === "disabled", "Notification QA requires the SMS transport to remain disabled.");
  assert.ok(environment.SMS_NOTIFICATIONS_ENABLED === "false", "Notification QA requires SMS notifications to remain disabled.");

  const rawDatabaseUrl = required(environment, "DATABASE_URL");
  const databaseUrl = assertSafeLocalPostgresUrl(rawDatabaseUrl);
  assert.ok(databaseUrl.port === NOTIFICATION_QA_DATABASE_PORT, "Notification QA requires its dedicated PostgreSQL port.");
  assert.ok(decodeURIComponent(databaseUrl.pathname) === "/template1", "Notification QA requires the Prisma Dev database path.");
  assert.ok(proof.name === NOTIFICATION_QA_TARGET, "Notification QA proof name mismatch.");
  assert.ok(proof.exports?.database?.connectionString === rawDatabaseUrl, "Notification QA proof connection mismatch.");
  assertAlive(proof);

  const authUrl = new URL(required(environment, "AUTH_URL"));
  assert.ok(authUrl.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(authUrl.hostname), "Notification QA requires loopback HTTP.");
  assert.ok(authUrl.port === NOTIFICATION_QA_HTTP_PORT && authUrl.pathname === "/", "Notification QA requires its exact HTTP port.");
  assert.ok(!authUrl.username && !authUrl.password && !authUrl.search && !authUrl.hash, "Notification QA AUTH_URL must be canonical.");
  return { databaseUrl: databaseUrl.toString(), baseUrl: authUrl.origin, proofPid: Number(proof.pid) } as const;
}

export async function loadAndAssertNotificationQaEnvironment(environment: Environment = process.env) {
  const proofPath = required(environment, "LNX_PRISMA_DEV_SERVER_FILE");
  assert.ok(proofPath === NOTIFICATION_QA_PROOF_FILE, "Notification QA requires its exact proof file.");
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as Proof;
  return assertNotificationQaEnvironment(environment, proof);
}
