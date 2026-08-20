import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";

export const RIGHTS_QA_TARGET = "lnx-studio-v072-test";
export const RIGHTS_QA_CONFIRMATION = "run-rights-contracts-qa";
export const RIGHTS_QA_DATABASE_PORT = "51250";
export const RIGHTS_QA_HTTP_PORT = "31720";
export const RIGHTS_QA_PROOF_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v072-test/server.json";

type Environment = Record<string, string | undefined>;
type Proof = { name?: string; pid?: number; exports?: { database?: { connectionString?: string } } };

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the rights QA.`);
  return value;
}

function alive(proof: Proof) {
  const pid = Number(proof.pid);
  assert.ok(Number.isInteger(pid) && pid > 0, "Rights QA proof has no valid process identifier.");
  try { process.kill(pid, 0); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") return;
    throw new Error("Rights QA proof process is not running.");
  }
}

export function assertRightsQaEnvironment(environment: Environment, proof: Proof) {
  assert.ok(environment.RIGHTS_QA_CONFIRM === RIGHTS_QA_CONFIRMATION, "Rights QA requires explicit confirmation.");
  assert.ok(environment.NODE_ENV === "test", "Rights QA requires NODE_ENV=test.");
  assert.ok(environment.EMAIL_PROVIDER === "capture", "Rights QA requires captured email transport.");
  assert.ok(!environment.RAILWAY_ENVIRONMENT, "Rights QA refuses Railway.");
  assert.ok(environment.LNX_DATABASE_TARGET === RIGHTS_QA_TARGET, "Rights QA refuses non-disposable database targets.");
  const rawDatabaseUrl = required(environment, "DATABASE_URL");
  const databaseUrl = assertSafeLocalPostgresUrl(rawDatabaseUrl);
  assert.ok(databaseUrl.port === RIGHTS_QA_DATABASE_PORT, "Rights QA requires its dedicated PostgreSQL port.");
  assert.ok(decodeURIComponent(databaseUrl.pathname) === "/template1", "Rights QA requires the Prisma Dev database path.");
  assert.ok(proof.name === RIGHTS_QA_TARGET, "Rights QA proof target mismatch.");
  assert.ok(proof.exports?.database?.connectionString === rawDatabaseUrl, "Rights QA proof DATABASE_URL mismatch.");
  const origin = new URL(required(environment, "AUTH_URL"));
  assert.ok(origin.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(origin.hostname), "Rights QA requires loopback HTTP.");
  assert.ok(origin.port === RIGHTS_QA_HTTP_PORT && origin.pathname === "/", "Rights QA requires its dedicated canonical HTTP origin.");
  assert.ok(!origin.username && !origin.password && !origin.search && !origin.hash, "Rights QA origin must be canonical.");
  assert.ok(required(environment, "AUTH_SECRET").length >= 32, "Rights QA AUTH_SECRET is too short.");
  assert.ok(required(environment, "LNX_AUTH_QA_PASSWORD").length >= 12, "Rights QA password is too short.");
  assert.ok(environment.PAYMENTS_ENABLED === "false", "Rights QA forbids payment creation.");
  assert.ok(!environment.STRIPE_SECRET_KEY && !environment.STRIPE_WEBHOOK_SECRET, "Rights QA forbids Stripe credentials.");
  return { target: RIGHTS_QA_TARGET, databaseUrl: databaseUrl.toString(), baseUrl: origin.origin, proofPid: Number(proof.pid) } as const;
}

export async function loadAndAssertRightsQaEnvironment(environment: Environment = process.env) {
  const proofPath = required(environment, "LNX_PRISMA_DEV_SERVER_FILE");
  assert.ok(proofPath === RIGHTS_QA_PROOF_FILE, "Rights QA requires its dedicated proof file.");
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as Proof;
  alive(proof);
  return assertRightsQaEnvironment(environment, proof);
}
