import assert from "node:assert/strict";
import { readFile, readdir, rm } from "node:fs/promises";

import sharp from "sharp";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import {
  createAndActivateMusicPricingVersion,
  MusicPricingServiceError,
} from "@/lib/pricing/service";
import { prisma } from "@/lib/prisma";
import { adminProductEditorPayload } from "@/lib/shop/product-admin-form";
import {
  adjustAdminProductStock,
  archiveAdminProduct,
  createAdminProduct,
  ProductServiceError,
  publishAdminProduct,
  unpublishAdminProduct,
  updateAdminProduct,
} from "@/lib/shop/product-service";
import {
  deleteAdminProductImage,
  getAdminProductImage,
  ProductImageError,
  replaceAdminProductImage,
  updateAdminProductImageAlt,
} from "@/lib/shop/product-image";

const QA_TARGET = "lnx-studio-v110-test";
const QA_PRISMA_DEV_TECHNICAL_DATABASE = "template1";
const QA_ADMIN_EMAIL = "lnx-v110-admin@example.invalid";
const QA_PRODUCT_SLUG = "lnx-v110-runtime-product";
const QA_MEDIA_ROOT = "/private/tmp/lnx-v110-product-image-runtime-media";
const CONFIGURATION_KEY = "music-order";
const SEEDED_ACTIVE_VERSION = "2026-08-v2";

function productInput(overrides: Record<string, unknown> = {}) {
  return adminProductEditorPayload({
    slug: QA_PRODUCT_SLUG,
    title: "Produit physique V1.1 QA",
    description: "Fixture locale jetable pour valider la fondation Boutique sans vente ni fournisseur externe.",
    price: "42,00",
    currency: "EUR",
    trackInventory: "on",
    stock: "5",
    shippingRequired: "on",
    shippingPrice: "6,00",
    position: "11",
    ...overrides,
  });
}

async function assertDisposableDatabase() {
  assert.equal(process.env.NODE_ENV, "test", "NODE_ENV must be test.");
  assert.equal(process.env.LNX_DATABASE_TARGET, QA_TARGET, `LNX_DATABASE_TARGET must be ${QA_TARGET}.`);
  assert.ok(!process.env.RAILWAY_ENVIRONMENT, "Railway environments are forbidden for this runtime.");
  assert.ok(!process.env.RAILWAY_ENVIRONMENT_NAME, "Railway environments are forbidden for this runtime.");
  assert.equal(process.env.MEDIA_DEPLOYMENT_ENV, "test");
  assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local");
  assert.equal(process.env.MEDIA_LOCAL_PUBLIC_ROOT, QA_MEDIA_ROOT);

  const databaseUrl = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath, "LNX_PRISMA_DEV_SERVER_FILE is required.");
  assert.match(
    proofPath,
    /[/\\]prisma-dev-nodejs[/\\]lnx-studio-v110-test[/\\]server\.json$/,
    "The Prisma Dev proof must belong to the dedicated V1.1 runtime.",
  );

  const proof = JSON.parse(await readFile(proofPath, "utf8")) as {
    name?: string;
    pid?: number;
    exports?: { database?: { connectionString?: string } };
  };
  assert.equal(proof.name, QA_TARGET);
  const proofConnectionString = proof.exports?.database?.connectionString ?? "";
  const proofDatabaseUrl = assertSafeLocalPostgresUrl(
    proofConnectionString,
    "Prisma Dev proof connection string",
  );
  assert.equal(
    process.env.DATABASE_URL,
    proofConnectionString,
    "The runtime must use the exact connection exported by the dedicated Prisma Dev proof.",
  );
  assert.equal(
    decodeURIComponent(databaseUrl.pathname.slice(1)),
    QA_PRISMA_DEV_TECHNICAL_DATABASE,
    "Only the dedicated Prisma Dev technical database is accepted for this runtime.",
  );
  assert.equal(
    decodeURIComponent(proofDatabaseUrl.pathname.slice(1)),
    QA_PRISMA_DEV_TECHNICAL_DATABASE,
    "The Prisma Dev proof must identify the authorized technical database.",
  );
  assert.ok(Number.isInteger(proof.pid) && Number(proof.pid) > 0, "The disposable Prisma Dev server must be running.");
  try {
    process.kill(Number(proof.pid), 0);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EPERM") throw error;
  }

  const metadata = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
    SELECT current_database() AS database, current_schema() AS schema
  `;
  assert.equal(metadata[0]?.database, QA_PRISMA_DEV_TECHNICAL_DATABASE);
  assert.equal(metadata[0]?.schema, "public");

  const migrations = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
    FROM "_prisma_migrations"
    WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
  `;
  assert.equal(Number(migrations[0]?.count), 20, "All 20 migrations must be applied before the runtime test.");
}

async function cleanupFixtures() {
  await prisma.$transaction(async (transaction) => {
    const products = await transaction.product.findMany({
      where: { slug: { startsWith: QA_PRODUCT_SLUG } },
      select: { id: true },
    });
    const productIds = products.map(({ id }) => id);
    if (productIds.length) {
      const productAssets = await transaction.productAsset.findMany({
        where: { productId: { in: productIds } },
        select: { assetId: true },
      });
      await transaction.productAsset.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.productStockAdjustment.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.productAuditEvent.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.product.deleteMany({ where: { id: { in: productIds } } });
      await transaction.asset.deleteMany({ where: { id: { in: productAssets.map(({ assetId }) => assetId) } } });
    }
    await transaction.asset.deleteMany({ where: { filename: { startsWith: "runtime-product-" } } });

    const seededVersion = await transaction.musicPricingVersion.findUniqueOrThrow({
      where: { version: SEEDED_ACTIVE_VERSION },
    });
    await transaction.musicPricingVersion.updateMany({
      where: { source: "ADMIN" },
      data: { status: "RETIRED", retiredAt: new Date() },
    });
    await transaction.musicPricingConfiguration.update({
      where: { key: CONFIGURATION_KEY },
      data: {
        activeVersionId: seededVersion.id,
        revision: 1,
        updatedByAdminId: null,
      },
    });
    await transaction.musicPricingVersion.update({
      where: { id: seededVersion.id },
      data: { status: "ACTIVE", retiredAt: null },
    });
    await transaction.musicPricingActivation.deleteMany({ where: { source: "ADMIN" } });
    await transaction.musicPricingVersion.deleteMany({ where: { source: "ADMIN" } });
    await transaction.user.deleteMany({ where: { email: QA_ADMIN_EMAIL } });
  });
  await rm(QA_MEDIA_ROOT, { recursive: true, force: true });
}

async function assertClean(stage: string) {
  const [products, assets, admins, adminVersions, adminActivations, configuration] = await Promise.all([
    prisma.product.count({ where: { slug: { startsWith: QA_PRODUCT_SLUG } } }),
    prisma.asset.count({ where: { filename: { startsWith: "runtime-product-" } } }),
    prisma.user.count({ where: { email: QA_ADMIN_EMAIL } }),
    prisma.musicPricingVersion.count({ where: { source: "ADMIN" } }),
    prisma.musicPricingActivation.count({ where: { source: "ADMIN" } }),
    prisma.musicPricingConfiguration.findUnique({
      where: { key: CONFIGURATION_KEY },
      include: { activeVersion: true },
    }),
  ]);
  assert.deepEqual(
    {
      products,
      assets,
      admins,
      adminVersions,
      adminActivations,
      revision: configuration?.revision,
      activeVersion: configuration?.activeVersion.version,
    },
    {
      products: 0,
      assets: 0,
      admins: 0,
      adminVersions: 0,
      adminActivations: 0,
      revision: 1,
      activeVersion: SEEDED_ACTIVE_VERSION,
    },
    `${stage}: V1.1 disposable fixtures remain.`,
  );
}

async function productRuntime(actorAdminId: string, passed: string[]) {
  const created = await createAdminProduct(productInput(), actorAdminId);
  assert.equal(created.status, "DRAFT");
  assert.equal(created.lockVersion, 1);
  assert.equal(created.stock, 5);
  assert.equal(await prisma.productAuditEvent.count({ where: { productId: created.id, action: "CREATED" } }), 1);
  passed.push("product create persists one DRAFT and one audit event");

  await assert.rejects(
    () => updateAdminProduct(created.id, created.lockVersion, productInput({
      title: "Produit physique V1.1 QA — révisé",
      price: "45,00",
      stock: "6",
    }), actorAdminId),
    (error: unknown) => error instanceof ProductServiceError
      && error.code === "STOCK_CONFIRMATION_REQUIRED",
  );
  const unchangedAfterRefusal = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(unchangedAfterRefusal.stock, 5);
  assert.equal(unchangedAfterRefusal.lockVersion, 1);

  const updated = await updateAdminProduct(created.id, created.lockVersion, productInput({
    title: "Produit physique V1.1 QA — révisé",
    price: "45,00",
    stock: "6",
  }), actorAdminId, { stockChangeConfirmed: true });
  assert.equal(updated.status, "DRAFT");
  assert.equal(updated.lockVersion, 2);
  assert.equal(updated.stock, 6);
  assert.deepEqual(
    await prisma.productStockAdjustment.findMany({
      where: { productId: created.id },
      select: { stockBefore: true, stockAfter: true, delta: true },
      orderBy: { createdAt: "asc" },
    }),
    [{ stockBefore: 5, stockAfter: 6, delta: 1 }],
  );
  passed.push("product update is versioned and stock history is persisted");

  const adjusted = await adjustAdminProductStock(
    created.id,
    updated.lockVersion,
    { delta: "+5", reason: "Réception de cinq exemplaires en QA locale" },
    actorAdminId,
  );
  assert.equal(adjusted.stock, 11);
  assert.equal(adjusted.lockVersion, 3);
  assert.deepEqual(
    await prisma.productStockAdjustment.findFirstOrThrow({
      where: { productId: created.id },
      select: { stockBefore: true, stockAfter: true, delta: true, reason: true, actorAdminId: true },
      orderBy: { createdAt: "desc" },
    }),
    {
      stockBefore: 6,
      stockAfter: 11,
      delta: 5,
      reason: "Réception de cinq exemplaires en QA locale",
      actorAdminId,
    },
  );
  assert.equal(
    await prisma.productAuditEvent.count({ where: { productId: created.id, action: "STOCK_ADJUSTED" } }),
    1,
  );
  passed.push("explicit +5 stock adjustment is atomic and persists history plus audit actor");

  await assert.rejects(
    adjustAdminProductStock(
      created.id,
      adjusted.lockVersion,
      { delta: "-12", reason: "Refus du stock final négatif" },
      actorAdminId,
    ),
    (error: unknown) => error instanceof ProductServiceError && error.code === "INSUFFICIENT_STOCK",
  );
  const afterNegativeRefusal = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(afterNegativeRefusal.stock, 11);
  assert.equal(afterNegativeRefusal.lockVersion, 3);
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: created.id } }), 2);
  passed.push("negative final stock is refused without mutation or audit row");

  const concurrent = await Promise.allSettled([
    adjustAdminProductStock(
      created.id,
      adjusted.lockVersion,
      { delta: "-1", reason: "Concurrence runtime A" },
      actorAdminId,
    ),
    adjustAdminProductStock(
      created.id,
      adjusted.lockVersion,
      { delta: "-1", reason: "Concurrence runtime B" },
      actorAdminId,
    ),
  ]);
  assert.equal(concurrent.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = concurrent.find(({ status }) => status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof ProductServiceError);
  assert.equal(rejected.reason.code, "CONFLICT");
  const afterConcurrent = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(afterConcurrent.stock, 10);
  assert.equal(afterConcurrent.lockVersion, 4);
  passed.push("concurrent stock writes produce one commit and one conflict");

  await assert.rejects(
    publishAdminProduct(created.id, afterConcurrent.lockVersion, actorAdminId),
    (error: unknown) => error instanceof Error
      && "code" in error
      && typeof error.code === "string"
      && error.code.includes("PUBLICATION_BLOCKED:IMAGE_MISSING"),
  );
  const afterBlockedPublish = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(afterBlockedPublish.status, "DRAFT");
  assert.equal(afterBlockedPublish.lockVersion, 4);
  passed.push("publication fails closed without a public image and leaves the DRAFT unchanged");

  const secondaryImage = await prisma.asset.create({
    data: {
      type: "IMAGE",
      storageKey: "catalog/images/11000000-0000-4000-8000-000000000001.webp",
      storageBackend: "LOCAL",
      storageProvider: "local",
      visibility: "PUBLIC",
      filename: "runtime-product-secondary.webp",
      mimeType: "image/webp",
      sizeBytes: 128n,
      width: 1,
      height: 1,
      alt: "Image produit fictive V1.1 QA",
      rightsStatus: "CLEARED",
      rightsNote: "Fixture locale jetable, aucun objet de stockage externe.",
      confidence: "CONFIRMED",
    },
  });
  await prisma.productAsset.create({
    data: { productId: created.id, assetId: secondaryImage.id, position: 1 },
  });
  await assert.rejects(
    publishAdminProduct(created.id, afterBlockedPublish.lockVersion, actorAdminId),
    (error: unknown) => error instanceof Error
      && "code" in error
      && typeof error.code === "string"
      && error.code.includes("PUBLICATION_BLOCKED:IMAGE_MISSING"),
  );
  await prisma.productAsset.delete({ where: { productId_assetId: { productId: created.id, assetId: secondaryImage.id } } });
  await prisma.asset.delete({ where: { id: secondaryImage.id } });
  passed.push("an eligible gallery position cannot replace the required primary image at position zero");

  const firstBytes = await sharp({
    create: { width: 2_400, height: 1_200, channels: 3, background: { r: 38, g: 28, b: 18 } },
  }).jpeg({ quality: 88 }).toBuffer();
  await assert.rejects(replaceAdminProductImage({
    productId: created.id,
    expectedLockVersion: afterBlockedPublish.lockVersion,
    expectedAssetId: null,
    file: new File([firstBytes], "runtime-product-rollback.jpg", { type: "image/jpeg" }),
    alt: "Visuel devant être compensé",
    rightsConfirmed: true,
    actorAdminId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  }));
  const afterForcedRollback = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(afterForcedRollback.lockVersion, 4);
  assert.equal(await prisma.productAsset.count({ where: { productId: created.id } }), 0);
  assert.equal(await prisma.asset.count({ where: { filename: { startsWith: "runtime-product-" } } }), 0);
  const remainingFiles = await readdir(QA_MEDIA_ROOT, { recursive: true }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  assert.equal(remainingFiles.some((entry) => entry.endsWith(".webp")), false);
  passed.push("database failure rolls back ProductAsset/Asset/product version and compensates the new local object");

  const first = await replaceAdminProductImage({
    productId: created.id,
    expectedLockVersion: afterBlockedPublish.lockVersion,
    expectedAssetId: null,
    file: new File([firstBytes], "runtime-product-first.jpg", { type: "image/jpeg" }),
    alt: "Premier visuel produit runtime",
    rightsConfirmed: true,
    actorAdminId,
  });
  const afterFirstImage = await prisma.product.findUniqueOrThrow({
    where: { id: created.id },
    include: { assets: { include: { asset: true } } },
  });
  assert.equal(afterFirstImage.lockVersion, 5);
  assert.equal(afterFirstImage.assets.length, 1);
  assert.equal(afterFirstImage.assets[0]?.position, 0);
  assert.equal(afterFirstImage.assets[0]?.asset.id, first.assetId);
  assert.equal(afterFirstImage.assets[0]?.asset.type, "IMAGE");
  assert.equal(afterFirstImage.assets[0]?.asset.visibility, "PUBLIC");
  assert.equal(afterFirstImage.assets[0]?.asset.rightsStatus, "CLEARED");
  assert.deepEqual(
    { width: afterFirstImage.assets[0]?.asset.width, height: afterFirstImage.assets[0]?.asset.height },
    { width: 1_600, height: 800 },
  );
  assert.ok(await getAdminProductImage(created.id));
  const firstStorageKey = afterFirstImage.assets[0]!.asset.storageKey;
  assert.ok((await readFile(`${QA_MEDIA_ROOT}/${firstStorageKey}`)).length > 0);
  passed.push("real JPEG persistence creates one normalized PUBLIC/CLEARED primary ProductAsset and local object");

  const sharedProduct = await createAdminProduct(productInput({
    slug: `${QA_PRODUCT_SLUG}-shared`,
    title: "Produit partagé V1.1 QA",
    position: "12",
  }), actorAdminId);
  await prisma.productAsset.create({
    data: { productId: sharedProduct.id, assetId: first.assetId, position: 0 },
  });
  await assert.rejects(
    updateAdminProductImageAlt({
      productId: created.id,
      expectedLockVersion: afterFirstImage.lockVersion,
      expectedAssetId: first.assetId,
      alt: "Modification interdite d’un Asset partagé",
      actorAdminId,
    }),
    (error: unknown) => error instanceof ProductImageError && error.code === "SHARED_ASSET",
  );
  assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: first.assetId } })).alt, "Premier visuel produit runtime");
  await prisma.$transaction(async (transaction) => {
    await transaction.productAsset.deleteMany({ where: { productId: sharedProduct.id } });
    await transaction.productAuditEvent.deleteMany({ where: { productId: sharedProduct.id } });
    await transaction.product.delete({ where: { id: sharedProduct.id } });
  });
  passed.push("shared Asset alt mutation fails closed without changing either product");

  const secondBytes = await sharp({
    create: { width: 900, height: 1_200, channels: 3, background: { r: 20, g: 32, b: 40 } },
  }).png().toBuffer();
  await assert.rejects(
    replaceAdminProductImage({
      productId: created.id,
      expectedLockVersion: 4,
      expectedAssetId: first.assetId,
      file: new File([secondBytes], "runtime-product-stale.png", { type: "image/png" }),
      alt: "Tentative concurrente",
      rightsConfirmed: true,
      actorAdminId,
    }),
    (error: unknown) => error instanceof Error && error.name === "ProductImageConflictError",
  );
  assert.equal((await getAdminProductImage(created.id))?.id, first.assetId);

  const second = await replaceAdminProductImage({
    productId: created.id,
    expectedLockVersion: 5,
    expectedAssetId: first.assetId,
    file: new File([secondBytes], "runtime-product-second.png", { type: "image/png" }),
    alt: "Second visuel produit runtime",
    rightsConfirmed: true,
    actorAdminId,
  });
  const afterReplacement = await prisma.product.findUniqueOrThrow({
    where: { id: created.id },
    include: { assets: { include: { asset: true } } },
  });
  assert.equal(afterReplacement.lockVersion, 6);
  assert.equal(afterReplacement.assets.length, 1);
  assert.equal(afterReplacement.assets[0]?.asset.id, second.assetId);
  assert.equal(await prisma.asset.count({ where: { id: first.assetId } }), 0);
  await assert.rejects(readFile(`${QA_MEDIA_ROOT}/${firstStorageKey}`), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"));
  passed.push("replacement switches atomically and cleans the obsolete Asset and local object");

  const updatedAlt = await updateAdminProductImageAlt({
    productId: created.id,
    expectedLockVersion: 6,
    expectedAssetId: second.assetId,
    alt: "Visuel final accessible du produit",
    actorAdminId,
  });
  assert.equal(updatedAlt.assetId, second.assetId);
  assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: second.assetId } })).alt, "Visuel final accessible du produit");

  const published = await publishAdminProduct(created.id, 7, actorAdminId);
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.lockVersion, 8);
  assert.ok(published.publishedAt instanceof Date);
  await assert.rejects(
    deleteAdminProductImage({
      productId: created.id,
      expectedLockVersion: published.lockVersion,
      expectedAssetId: second.assetId,
      actorAdminId,
    }),
    (error: unknown) => error instanceof ProductImageError && error.code === "NOT_DRAFT",
  );
  assert.equal((await getAdminProductImage(created.id))?.id, second.assetId);
  const unpublished = await unpublishAdminProduct(
    created.id,
    published.lockVersion,
    actorAdminId,
  );
  assert.equal(unpublished.status, "DRAFT");
  assert.equal(unpublished.lockVersion, 9);
  assert.equal(unpublished.publishedAt, null);
  assert.deepEqual(
    await prisma.productAuditEvent.findMany({
      where: { productId: created.id, action: { in: ["PUBLISHED", "UNPUBLISHED"] } },
      select: { action: true },
      orderBy: { occurredAt: "asc" },
    }),
    [{ action: "PUBLISHED" }, { action: "UNPUBLISHED" }],
  );
  passed.push("a real primary image permits publish and published deletion is refused until explicit unpublish");

  const secondStorageKey = (await prisma.asset.findUniqueOrThrow({ where: { id: second.assetId } })).storageKey;
  await deleteAdminProductImage({
    productId: created.id,
    expectedLockVersion: unpublished.lockVersion,
    expectedAssetId: second.assetId,
    actorAdminId,
  });
  const afterDeletion = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(afterDeletion.status, "DRAFT");
  assert.equal(afterDeletion.lockVersion, 10);
  assert.equal(await prisma.productAsset.count({ where: { productId: created.id } }), 0);
  assert.equal(await prisma.asset.count({ where: { id: second.assetId } }), 0);
  await assert.rejects(readFile(`${QA_MEDIA_ROOT}/${secondStorageKey}`), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"));
  passed.push("DRAFT deletion removes relation, dedicated Asset and local object while preserving product state");

  const archived = await archiveAdminProduct(created.id, afterDeletion.lockVersion, actorAdminId);
  assert.equal(archived.status, "ARCHIVED");
  assert.equal(archived.lockVersion, 11);
  assert.ok(archived.archivedAt instanceof Date);
  await assert.rejects(
    adjustAdminProductStock(created.id, archived.lockVersion, { delta: "1", reason: "Refus après archivage" }, actorAdminId),
    (error: unknown) => error instanceof ProductServiceError && error.code === "ARCHIVED",
  );
  passed.push("archive is audited and makes the product read-only");
}

async function pricingRuntime(actorAdminId: string, passed: string[]) {
  const before = await prisma.musicPricingConfiguration.findUniqueOrThrow({
    where: { key: CONFIGURATION_KEY },
    include: { activeVersion: true },
  });
  assert.equal(before.revision, 1);
  assert.deepEqual(
    {
      version: before.activeVersion.version,
      base: before.activeVersion.basePriceCents,
      cover: before.activeVersion.coverPriceCents,
      priority: before.activeVersion.priorityPriceCents,
    },
    { version: SEEDED_ACTIVE_VERSION, base: 2000, cover: 1000, priority: 3000 },
  );

  const concurrent = await Promise.allSettled([
    createAndActivateMusicPricingVersion({
      expectedRevision: before.revision,
      actorAdminId,
      pricing: {
        basePrice: "25,00",
        coverPrice: "12,00",
        priorityPrice: "35,00",
        currency: "EUR",
      },
    }),
    createAndActivateMusicPricingVersion({
      expectedRevision: before.revision,
      actorAdminId,
      pricing: {
        basePrice: "26,00",
        coverPrice: "13,00",
        priorityPrice: "36,00",
        currency: "EUR",
      },
    }),
  ]);
  assert.equal(concurrent.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(concurrent.filter(({ status }) => status === "rejected").length, 1);
  const fulfilled = concurrent.find(({ status }) => status === "fulfilled");
  const rejected = concurrent.find(({ status }) => status === "rejected");
  assert.ok(fulfilled?.status === "fulfilled");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof MusicPricingServiceError);
  assert.equal(rejected.reason.code, "REVISION_CONFLICT");
  const result = fulfilled.value;
  assert.equal(result.revision, 2);
  assert.equal(result.version.status, "ACTIVE");

  const after = await prisma.musicPricingConfiguration.findUniqueOrThrow({
    where: { key: CONFIGURATION_KEY },
    include: { activeVersion: true },
  });
  assert.equal(after.revision, 2);
  assert.ok(
    (after.activeVersion.basePriceCents === 2500
      && after.activeVersion.coverPriceCents === 1200
      && after.activeVersion.priorityPriceCents === 3500)
    || (after.activeVersion.basePriceCents === 2600
      && after.activeVersion.coverPriceCents === 1300
      && after.activeVersion.priorityPriceCents === 3600),
  );
  assert.equal(after.activeVersion.createdByAdminId, actorAdminId);

  const retiredSeed = await prisma.musicPricingVersion.findUniqueOrThrow({ where: { version: SEEDED_ACTIVE_VERSION } });
  assert.deepEqual(
    {
      status: retiredSeed.status,
      base: retiredSeed.basePriceCents,
      cover: retiredSeed.coverPriceCents,
      priority: retiredSeed.priorityPriceCents,
    },
    { status: "RETIRED", base: 2000, cover: 1000, priority: 3000 },
  );
  assert.equal(await prisma.musicPricingActivation.count({ where: { source: "ADMIN" } }), 1);
  passed.push("concurrent pricing activation produces exactly one successor and one revision conflict");
  passed.push("pricing activation preserves the immutable amounts of the retired seeded version");

  await assert.rejects(
    createAndActivateMusicPricingVersion({
      expectedRevision: 1,
      actorAdminId,
      pricing: {
        basePrice: "27,00",
        coverPrice: "14,00",
        priorityPrice: "37,00",
        currency: "EUR",
      },
    }),
    (error: unknown) => error instanceof MusicPricingServiceError && error.code === "REVISION_CONFLICT",
  );
  assert.equal(await prisma.musicPricingVersion.count({ where: { source: "ADMIN" } }), 1);
  assert.equal(await prisma.musicPricingActivation.count({ where: { source: "ADMIN" } }), 1);
  passed.push("stale pricing activation fails without a partial version or audit event");

  await assert.rejects(
    createAndActivateMusicPricingVersion({
      expectedRevision: 2,
      actorAdminId,
      pricing: {
        basePrice: String(after.activeVersion.basePriceCents / 100).replace(".", ","),
        coverPrice: String(after.activeVersion.coverPriceCents / 100).replace(".", ","),
        priorityPrice: String(after.activeVersion.priorityPriceCents / 100).replace(".", ","),
        currency: "EUR",
      },
    }),
    (error: unknown) => error instanceof MusicPricingServiceError && error.code === "UNCHANGED",
  );
  assert.equal(await prisma.musicPricingVersion.count({ where: { source: "ADMIN" } }), 1);
  passed.push("unchanged pricing cannot create a duplicate version");
}

async function run() {
  await assertDisposableDatabase();
  await cleanupFixtures();
  await assertClean("precondition");
  const passed: string[] = [];

  try {
    const admin = await prisma.user.create({
      data: {
        email: QA_ADMIN_EMAIL,
        displayName: "V1.1 Runtime Admin",
        role: "ADMIN",
        status: "ACTIVE",
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });

    await productRuntime(admin.id, passed);
    await pricingRuntime(admin.id, passed);

    console.info("V1.1 shop/pricing PostgreSQL runtime: PASS");
    for (const item of passed) console.info(`- ${item}`);
  } finally {
    await cleanupFixtures();
    await assertClean("postcondition");
    await prisma.$disconnect();
  }
}

await run();
