import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { ADMIN_PRINCIPAL_EMAIL } from "@/lib/auth/environment";
import { verifyPassword } from "@/lib/auth/password";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { prisma } from "@/lib/prisma";
import { applyProductionAdminBootstrap, planProductionAdminBootstrap } from "@/lib/production/admin-bootstrap";
import { applyProductionCatalogImport, planProductionCatalogImport } from "@/lib/production/catalog-import";
import {
  ADMIN_PRODUCTION_CONFIRMATION,
  CATALOG_PRODUCTION_CONFIRMATION,
  MEDIA_PRODUCTION_CONFIRMATION,
} from "@/lib/production/bootstrap-environment";
import {
  applyProductionMediaImport,
  planProductionMediaImport,
  type ProductionMediaProvider,
} from "@/lib/production/media-import";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Disposable DATABASE_URL is required.");
assertSafeLocalPostgresUrl(databaseUrl);
if (!process.env.LNX_DATABASE_TARGET?.endsWith("-test")) throw new Error("A disposable test target is required.");

const password = "temporary-runtime-password-2026";
const productionEnvironment = {
  NODE_ENV: "production",
  LNX_DATABASE_TARGET: "lnx-studio-production",
  AUTH_URL: "https://www.lnxbeats.fr",
  APP_CANONICAL_URL: "https://www.lnxbeats.fr",
  DATABASE_URL: "postgresql://app:secret@production.internal:5432/lnx_production",
  ADMIN_EMAIL: ADMIN_PRINCIPAL_EMAIL,
  ADMIN_BOOTSTRAP_CONFIRM: ADMIN_PRODUCTION_CONFIRMATION,
  ADMIN_BOOTSTRAP_PASSWORD: password,
  CATALOG_PRODUCTION_CONFIRM: CATALOG_PRODUCTION_CONFIRMATION,
  MEDIA_PRODUCTION_CONFIRM: MEDIA_PRODUCTION_CONFIRMATION,
  MEDIA_DEPLOYMENT_ENV: "production",
  MEDIA_STORAGE_DRIVER: "s3",
  MEDIA_STORAGE_PROVIDER: "r2",
  MEDIA_S3_REGION: "auto",
  MEDIA_S3_FORCE_PATH_STYLE: "false",
  MEDIA_PUBLIC_BUCKET: "lnx-studio-production-public",
  MEDIA_PRIVATE_BUCKET: "lnx-studio-production-private",
};

async function migrationProof() {
  const expected = (await readdir(path.join(process.cwd(), "prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).length;
  const applied = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  assert.equal(Number(applied[0]?.count ?? 0), expected);
  assert.equal(expected, 19);
  return expected;
}

async function cleanDomainRows() {
  await prisma.$transaction(async (transaction) => {
    await transaction.projectAsset.deleteMany();
    await transaction.asset.deleteMany();
    await transaction.credit.deleteMany();
    await transaction.platformLink.deleteMany();
    await transaction.confidenceAnnotation.deleteMany();
    await transaction.track.deleteMany();
    await transaction.project.deleteMany();
    await transaction.session.deleteMany();
    await transaction.account.deleteMany();
    await transaction.user.deleteMany();
  });
}

async function run() {
  const migrations = await migrationProof();
  await cleanDomainRows();
  assert.equal(await prisma.user.count(), 0);
  assert.equal(await prisma.project.count(), 0);

  const adminDryRun = await planProductionAdminBootstrap(prisma, productionEnvironment);
  assert.equal(adminDryRun.action, "WOULD_CREATE");
  assert.equal(await prisma.user.count(), 0);
  const createdAdmin = await applyProductionAdminBootstrap(prisma, productionEnvironment);
  assert.equal(createdAdmin.action, "CREATED");
  const account = await prisma.account.findFirstOrThrow({ where: { userId: createdAdmin.userId, providerId: "credential" }, select: { password: true } });
  assert.ok(account.password);
  assert.equal(await verifyPassword(account.password, password), true);
  assert.equal((await applyProductionAdminBootstrap(prisma, productionEnvironment)).action, "NONE");

  await prisma.account.deleteMany({ where: { userId: createdAdmin.userId } });
  await prisma.user.delete({ where: { id: createdAdmin.userId } });
  const member = await prisma.user.create({
    data: { email: ADMIN_PRINCIPAL_EMAIL, displayName: "Owner promotion proof", emailVerified: true, emailVerifiedAt: new Date(), status: "ACTIVE", role: "MEMBER" },
  });
  assert.equal((await applyProductionAdminBootstrap(prisma, { ...productionEnvironment, ADMIN_BOOTSTRAP_PASSWORD: undefined })).action, "PROMOTED");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).role, "ADMIN");
  assert.equal((await applyProductionAdminBootstrap(prisma, { ...productionEnvironment, ADMIN_BOOTSTRAP_PASSWORD: undefined })).action, "NONE");

  const catalogDryRun = await planProductionCatalogImport(prisma, productionEnvironment);
  assert.equal(catalogDryRun.creates.length, 25);
  assert.equal(await prisma.project.count(), 0);
  await assert.rejects(
    () => applyProductionCatalogImport(prisma, productionEnvironment, { afterCreate: (count) => { if (count === 1) throw new Error("forced-rollback-proof"); } }),
    /forced-rollback-proof/,
  );
  assert.equal(await prisma.project.count(), 0);
  const catalogApply = await applyProductionCatalogImport(prisma, productionEnvironment);
  assert.deepEqual(catalogApply, { created: 25, skipped: 0, sourceProjects: 25 });
  const catalogSecond = await applyProductionCatalogImport(prisma, productionEnvironment);
  assert.deepEqual(catalogSecond, { created: 0, skipped: 25, sourceProjects: 25 });

  const objects = new Map<string, string>();
  let puts = 0;
  const provider: ProductionMediaProvider = {
    inspect: async (entry) => {
      const current = objects.get(`${entry.visibility}:${entry.targetKey}`);
      return current === undefined ? "absent" : current === entry.checksumSha256 ? "identical" : "conflict";
    },
    putIfAbsent: async (entry) => { puts += 1; objects.set(`${entry.visibility}:${entry.targetKey}`, entry.checksumSha256); },
  };
  const manifestPath = path.join(process.cwd(), "data/production-media-manifest.json");
  const sourceRoot = path.join(process.cwd(), ".local-media");
  const mediaDryRun = await planProductionMediaImport(prisma, manifestPath, sourceRoot, productionEnvironment);
  assert.equal(mediaDryRun.prepared.length, 14);
  assert.equal(mediaDryRun.publicObjects, 14);
  assert.equal(mediaDryRun.privateObjects, 0);
  assert.equal(puts, 0);
  const mediaApply = await applyProductionMediaImport(prisma, provider, manifestPath, sourceRoot, productionEnvironment);
  assert.equal(mediaApply.uploaded, 14);
  assert.equal(mediaApply.databaseCreated, 14);
  const mediaSecond = await applyProductionMediaImport(prisma, provider, manifestPath, sourceRoot, productionEnvironment);
  assert.equal(mediaSecond.uploaded, 0);
  assert.equal(mediaSecond.storageSkipped, 14);
  assert.equal(puts, 14);
  assert.equal(await prisma.asset.count(), 14);
  assert.equal(await prisma.projectAsset.count(), 14);

  const qaCounts = await Promise.all([
    prisma.user.count({ where: { email: { endsWith: ".invalid" } } }),
    prisma.order.count(), prisma.payment.count(), prisma.rightsRequest.count(), prisma.orderNotification.count(),
  ]);
  assert.deepEqual(qaCounts, [0, 0, 0, 0, 0]);

  console.info(JSON.stringify({
    ok: true,
    migrations,
    databaseInitiallyEmpty: true,
    admin: { dryRun: "WOULD_CREATE", create: "CREATED", promote: "PROMOTED", idempotent: "NONE" },
    catalog: { projects: 25, rollback: "PASS", idempotentSkips: 25 },
    media: { objects: 14, put: 14, secondRunSkips: 14, provider: "fake" },
    qaRows: 0,
  }));
}

run()
  .finally(async () => { await cleanDomainRows(); await prisma.$disconnect(); })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Production bootstrap runtime failed.");
    process.exitCode = 1;
  });
