import assert from "node:assert/strict";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { removeCatalogCover } from "@/lib/catalog/media-storage";
import { prisma } from "@/lib/prisma";

const EMAIL = "lnx-v0603-cover-browser-admin@example.invalid";

function guard() {
  assert.equal(process.env.LNX_DATABASE_TARGET, "lnx-studio-v0603-test");
  assert.equal(process.env.AUTH_URL, "http://127.0.0.1:3103");
  assert.ok(process.env.MEDIA_STORAGE_ROOT?.startsWith("/private/tmp/lnx-studio-v0603-cover-qa-"));
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname));
  assert.ok(databaseUrl.port && databaseUrl.port !== "5432");
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12);
}

async function cleanup() {
  const project = await prisma.project.findUnique({ where: { slug: "laboratoire-narratif" }, include: { assets: { include: { asset: true } } } });
  if (project?.assets.length) {
    await prisma.$transaction(async (transaction) => {
      await transaction.projectAsset.deleteMany({ where: { projectId: project.id } });
      await transaction.asset.deleteMany({ where: { id: { in: project.assets.map(({ assetId }) => assetId) } } });
    });
    for (const relation of project.assets) await removeCatalogCover(relation.asset.storageKey);
  }
  await prisma.$transaction(async (transaction) => {
    await transaction.session.deleteMany({ where: { user: { email: EMAIL } } });
    await transaction.account.deleteMany({ where: { user: { email: EMAIL } } });
    await transaction.user.deleteMany({ where: { email: EMAIL } });
  });
}

async function run() {
  guard();
  const operation = process.argv[2];
  await cleanup();
  if (operation === "cleanup") {
    console.info("Browser cover QA fixture cleaned.");
    return;
  }
  assert.equal(operation, "setup");
  await createInternalAuthUser({ email: EMAIL, password: process.env.LNX_AUTH_QA_PASSWORD!, displayName: "Cover Browser QA", role: "ADMIN" });
  console.info("Browser cover QA ADMIN fixture ready.");
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Browser cover QA fixture failed.");
    process.exitCode = 1;
  });
