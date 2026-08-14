import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";

export const PAYMENT_QA_TARGET = "lnx-studio-v070-test";
export const PAYMENT_QA_CONFIRMATION = "run-stripe-test-payment-qa";
export const PAYMENT_QA_DATABASE_PORT = "51250";
export const PAYMENT_QA_HTTP_PORT = "31700";
export const PAYMENT_QA_PROOF_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v070-test/server.json";

type PaymentQaEnvironment = Record<string, string | undefined>;

type PrismaRuntimeProof = {
  name?: string;
  pid?: number;
  exports?: { database?: { connectionString?: string } };
};

function required(environment: PaymentQaEnvironment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Stripe test QA.`);
  return value;
}

function loopback(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function assertPaymentQaBaseEnvironment(
  environment: PaymentQaEnvironment,
  proof: PrismaRuntimeProof,
  allowedNodeEnvironments: readonly string[],
) {
  assert.equal(environment.PAYMENT_QA_CONFIRM, PAYMENT_QA_CONFIRMATION, "Stripe test QA requires its explicit confirmation.");
  assert.ok(
    environment.NODE_ENV && allowedNodeEnvironments.includes(environment.NODE_ENV),
    "Stripe test QA requires an explicitly allowed local Node environment.",
  );
  assert.equal(environment.EMAIL_PROVIDER, "capture", "Stripe test QA requires captured email transport.");
  assert.ok(!environment.RAILWAY_ENVIRONMENT, "Stripe test QA refuses Railway environments.");
  assert.equal(required(environment, "LNX_DATABASE_TARGET"), PAYMENT_QA_TARGET, "Stripe test QA refuses every non-disposable database target.");

  const rawDatabaseUrl = required(environment, "DATABASE_URL");
  const databaseUrl = assertSafeLocalPostgresUrl(rawDatabaseUrl);
  assert.ok(
    databaseUrl.port === PAYMENT_QA_DATABASE_PORT,
    "Stripe test QA requires its dedicated PostgreSQL port.",
  );
  assert.ok(
    decodeURIComponent(databaseUrl.pathname) === "/template1",
    "Stripe test QA requires the Prisma Dev database path.",
  );
  assert.equal(proof.name, PAYMENT_QA_TARGET, "The Prisma runtime proof does not match the Stripe test database.");
  assert.ok(
    proof.exports?.database?.connectionString === rawDatabaseUrl,
    "The Prisma runtime proof does not match DATABASE_URL.",
  );
  assert.ok(Number.isInteger(proof.pid) && Number(proof.pid) > 0, "The Prisma runtime proof has no valid process identifier.");

  const authUrl = new URL(required(environment, "AUTH_URL"));
  assert.ok(authUrl.protocol === "http:", "Stripe test QA requires a loopback HTTP origin.");
  assert.ok(loopback(authUrl.hostname), "Stripe test QA requires a loopback HTTP origin.");
  assert.ok(
    authUrl.port === PAYMENT_QA_HTTP_PORT,
    "Stripe test QA requires its dedicated HTTP origin.",
  );
  assert.ok(authUrl.pathname === "/", "Stripe test QA AUTH_URL must not contain a path.");
  assert.ok(
    !authUrl.username && !authUrl.password && !authUrl.search && !authUrl.hash,
    "Stripe test QA AUTH_URL must be canonical.",
  );

  const authSecret = required(environment, "AUTH_SECRET");
  assert.ok(authSecret.length >= 32, "Stripe test QA AUTH_SECRET is too short.");
  const password = required(environment, "LNX_AUTH_QA_PASSWORD");
  assert.ok(password.length >= 12, "Stripe test QA password is too short.");

  return {
    target: PAYMENT_QA_TARGET,
    databaseUrl: databaseUrl.toString(),
    baseUrl: authUrl.origin,
    proofPid: Number(proof.pid),
  } as const;
}

export function assertPaymentQaDatabaseEnvironment(
  environment: PaymentQaEnvironment,
  proof: PrismaRuntimeProof,
) {
  return assertPaymentQaBaseEnvironment(environment, proof, ["test"]);
}

export function assertPaymentQaEnvironment(
  environment: PaymentQaEnvironment,
  proof: PrismaRuntimeProof,
) {
  const runtime = assertPaymentQaDatabaseEnvironment(environment, proof);
  assert.equal(environment.PAYMENTS_ENABLED, "true", "Stripe test QA requires the payment feature flag.");
  assert.equal(environment.STRIPE_MODE, "test", "Stripe test QA refuses Stripe live mode.");
  const secretKey = required(environment, "STRIPE_SECRET_KEY");
  assert.ok(/^(?:sk|rk)_test_/.test(secretKey), "Stripe test QA requires a test API key.");
  assert.ok(!/_live_/.test(secretKey), "Stripe test QA refuses a live API key.");
  assert.ok(
    /^whsec_/.test(required(environment, "STRIPE_WEBHOOK_SECRET")),
    "Stripe test QA requires a webhook signing secret.",
  );
  return runtime;
}

export function assertPaymentQaRuntimeEnvironment(
  environment: PaymentQaEnvironment,
  proof: PrismaRuntimeProof,
) {
  const runtime = assertPaymentQaBaseEnvironment(
    environment,
    proof,
    ["development", "test"],
  );
  assert.equal(environment.PAYMENTS_ENABLED, "true", "Stripe test QA requires the payment feature flag.");
  assert.equal(environment.STRIPE_MODE, "test", "Stripe test QA refuses Stripe live mode.");
  const secretKey = required(environment, "STRIPE_SECRET_KEY");
  assert.ok(/^(?:sk|rk)_test_/.test(secretKey), "Stripe test QA requires a test API key.");
  assert.ok(!/_live_/.test(secretKey), "Stripe test QA refuses a live API key.");
  assert.ok(
    /^whsec_/.test(required(environment, "STRIPE_WEBHOOK_SECRET")),
    "Stripe test QA requires a webhook signing secret.",
  );
  return runtime;
}

function assertProofProcessIsAlive(proof: PrismaRuntimeProof) {
  const pid = Number(proof.pid);
  assert.ok(Number.isInteger(pid) && pid > 0, "The Prisma runtime proof has no valid process identifier.");
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "EPERM"
    ) return;
    throw new Error("The Prisma runtime proof process is not running.");
  }
}

export async function loadAndAssertPaymentQaDatabaseEnvironment(
  environment: PaymentQaEnvironment = process.env,
) {
  const proofPath = required(environment, "LNX_PRISMA_DEV_SERVER_FILE");
  assert.equal(proofPath, PAYMENT_QA_PROOF_FILE, "Stripe test QA requires its dedicated Prisma runtime proof file.");
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as PrismaRuntimeProof;
  assertProofProcessIsAlive(proof);
  return assertPaymentQaDatabaseEnvironment(environment, proof);
}

export async function loadAndAssertPaymentQaEnvironment(environment: PaymentQaEnvironment = process.env) {
  const proofPath = required(environment, "LNX_PRISMA_DEV_SERVER_FILE");
  assert.equal(proofPath, PAYMENT_QA_PROOF_FILE, "Stripe test QA requires its dedicated Prisma runtime proof file.");
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as PrismaRuntimeProof;
  assertProofProcessIsAlive(proof);
  return assertPaymentQaEnvironment(environment, proof);
}

export async function loadAndAssertPaymentQaRuntimeEnvironment(
  environment: PaymentQaEnvironment = process.env,
) {
  const proofPath = required(environment, "LNX_PRISMA_DEV_SERVER_FILE");
  assert.equal(proofPath, PAYMENT_QA_PROOF_FILE, "Stripe test QA requires its dedicated Prisma runtime proof file.");
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as PrismaRuntimeProof;
  assertProofProcessIsAlive(proof);
  return assertPaymentQaRuntimeEnvironment(environment, proof);
}
