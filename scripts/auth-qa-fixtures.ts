import assert from "node:assert/strict";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { prisma } from "@/lib/prisma";

const EXPECTED_TARGET = "lnx-studio-v051-test";
const QA_EMAILS = [
  "lnx-v051-browser-member@example.invalid",
  "lnx-v051-browser-admin@example.invalid",
] as const;

function validateSafetyGuards() {
  assert.equal(process.env.NODE_ENV, "test", "NODE_ENV must be test.");
  assert.equal(process.env.LNX_DATABASE_TARGET, EXPECTED_TARGET, `LNX_DATABASE_TARGET must be ${EXPECTED_TARGET}.`);
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required.");
  assert.ok(process.env.LNX_PRISMA_DEV_PROXY_URL, "LNX_PRISMA_DEV_PROXY_URL is required.");

  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(databaseUrl.protocol));
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname));
  assert.ok(databaseUrl.port && databaseUrl.port !== "5432");

  const proxyUrl = new URL(process.env.LNX_PRISMA_DEV_PROXY_URL);
  assert.equal(proxyUrl.protocol, "prisma+postgres:");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(proxyUrl.hostname));
  const apiKey = proxyUrl.searchParams.get("api_key");
  assert.ok(apiKey);
  const proof = JSON.parse(Buffer.from(apiKey, "base64url").toString("utf8")) as {
    name?: string;
    databaseUrl?: string;
  };
  assert.equal(proof.name, EXPECTED_TARGET);
  assert.equal(proof.databaseUrl, process.env.DATABASE_URL);
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.rateLimit.deleteMany();
    await transaction.verification.deleteMany();
    await transaction.session.deleteMany({ where: { user: { email: { in: [...QA_EMAILS] } } } });
    await transaction.account.deleteMany({ where: { user: { email: { in: [...QA_EMAILS] } } } });
    await transaction.user.deleteMany({ where: { email: { in: [...QA_EMAILS] } } });
  });
}

async function assertClean() {
  const count = await prisma.user.count({ where: { email: { in: [...QA_EMAILS] } } });
  assert.equal(count, 0, "Browser QA users remain in the disposable database.");
}

async function run() {
  validateSafetyGuards();
  const operation = process.argv[2];

  if (operation === "cleanup") {
    await cleanup();
    await assertClean();
    console.info("Browser QA fixtures removed.");
    return;
  }

  assert.equal(operation, "setup", "Use setup or cleanup.");
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12);
  await assertClean();

  await createInternalAuthUser({
    email: QA_EMAILS[0],
    password: process.env.LNX_AUTH_QA_PASSWORD,
    displayName: "LNX Browser Member QA",
    role: "MEMBER",
  });
  await createInternalAuthUser({
    email: QA_EMAILS[1],
    password: process.env.LNX_AUTH_QA_PASSWORD,
    displayName: "LNX Browser Admin QA",
    role: "ADMIN",
  });

  console.info("Browser QA fixtures created (MEMBER and ADMIN, fictitious data only). ");
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Browser QA fixture operation failed.");
    process.exitCode = 1;
  });
