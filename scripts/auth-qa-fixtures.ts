import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { prisma } from "@/lib/prisma";

const EXPECTED_TARGET = "lnx-studio-v052-test";
const EXPECTED_CAPTURE_PATH = "/private/tmp/lnx-studio-v052-mailbox.jsonl";
const EXPECTED_SERVER_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v052-test/server.json";
const QA_EMAILS = [
  "lnx-v052-browser-member@example.invalid",
  "lnx-v052-browser-admin@example.invalid",
] as const;

async function validateSafetyGuards() {
  assert.equal(process.env.NODE_ENV, "test", "NODE_ENV must be test.");
  assert.equal(process.env.LNX_DATABASE_TARGET, EXPECTED_TARGET, `LNX_DATABASE_TARGET must be ${EXPECTED_TARGET}.`);
  assert.equal(process.env.EMAIL_PROVIDER, "capture");
  assert.equal(process.env.AUTH_EMAIL_CAPTURE_PATH, EXPECTED_CAPTURE_PATH);
  assert.ok(process.env.DATABASE_URL);
  assert.equal(process.env.LNX_PRISMA_DEV_SERVER_FILE, EXPECTED_SERVER_FILE);

  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(databaseUrl.protocol));
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname));
  assert.ok(databaseUrl.port && databaseUrl.port !== "5432");

  const proof = JSON.parse(await readFile(EXPECTED_SERVER_FILE, "utf8")) as {
    name?: string;
    pid?: number;
    exports?: { database?: { connectionString?: string } };
  };
  assert.equal(proof.name, EXPECTED_TARGET);
  assert.ok(proof.pid && proof.pid > 0);
  assert.equal(proof.exports?.database?.connectionString, process.env.DATABASE_URL);
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.rateLimit.deleteMany();
    await transaction.verification.deleteMany();
    await transaction.session.deleteMany({ where: { user: { email: { in: [...QA_EMAILS] } } } });
    await transaction.account.deleteMany({ where: { user: { email: { in: [...QA_EMAILS] } } } });
    await transaction.user.deleteMany({ where: { email: { in: [...QA_EMAILS] } } });
  });
  await unlink(EXPECTED_CAPTURE_PATH).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function assertClean() {
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.account.count(),
    prisma.session.count(),
    prisma.verification.count(),
    prisma.rateLimit.count(),
  ]);
  assert.ok(counts.every((count) => count === 0), "Authentication data remains in the disposable database.");
  const capturedEmail = await readFile(EXPECTED_CAPTURE_PATH, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  assert.equal(capturedEmail, "", "Captured QA email remains on disk.");
}

async function run() {
  await validateSafetyGuards();
  const operation = process.argv[2];

  if (operation === "cleanup") {
    await cleanup();
    await assertClean();
    console.info("Browser QA fixtures and captured emails removed.");
    return;
  }

  assert.equal(operation, "setup", "Use setup or cleanup.");
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12);
  await cleanup();
  await createInternalAuthUser({
    email: QA_EMAILS[1],
    password: process.env.LNX_AUTH_QA_PASSWORD,
    displayName: "LNX Browser Admin QA",
    role: "ADMIN",
  });
  console.info("Browser QA ADMIN fixture created; member registration remains public-flow only.");
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Browser QA fixture operation failed.");
    process.exitCode = 1;
  });
