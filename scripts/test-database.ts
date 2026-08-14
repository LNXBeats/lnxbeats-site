import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const EXPECTED_TARGET = "lnx-studio-v041-test";
const MODEL_DELEGATES = [
  "user",
  "customer",
  "project",
  "track",
  "platformLink",
  "credit",
  "confidenceAnnotation",
  "asset",
  "projectAsset",
  "order",
  "orderEvent",
  "orderAsset",
  "favorite",
];
const EXPECTED_CHECKS = [
  "assets_dimensions_positive",
  "assets_sizeBytes_nonnegative",
  "credits_position_nonnegative",
  "credits_single_parent",
  "order_events_status_changes",
  "platform_links_position_nonnegative",
  "platform_links_scope_project_consistent",
  "project_assets_position_nonnegative",
  "projects_trackCount_nonnegative",
  "tracks_durationSeconds_nonnegative",
  "tracks_position_positive",
];

function validateSafetyGuards() {
  assert.equal(process.env.NODE_ENV, "test", "NODE_ENV must be test.");
  assert.equal(process.env.ALLOW_DATABASE_RESET, "true", "ALLOW_DATABASE_RESET must be true.");
  assert.equal(process.env.LNX_DATABASE_TARGET, EXPECTED_TARGET, `LNX_DATABASE_TARGET must be ${EXPECTED_TARGET}.`);
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required.");
  assert.ok(process.env.LNX_EXPECTED_DATABASE, "LNX_EXPECTED_DATABASE is required.");

  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(databaseUrl.protocol), "Only PostgreSQL URLs are accepted.");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname), "Only a loopback host is accepted.");
  assert.ok(databaseUrl.port && databaseUrl.port !== "5432", "An explicit non-default test port is required.");
  assert.equal(databaseUrl.pathname.slice(1), process.env.LNX_EXPECTED_DATABASE, "The database name does not match the explicit test target.");
}

function record(results: string[], name: string) {
  results.push(name);
}

async function expectFailure(
  results: string[],
  name: string,
  operation: () => Promise<unknown>,
  expectedCode?: string,
) {
  let error: unknown;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }

  assert.ok(error, `${name} should have been rejected by PostgreSQL.`);
  if (expectedCode) {
    assert.ok(error && typeof error === "object" && "code" in error, `${name} did not expose a Prisma error code.`);
    assert.equal(error.code, expectedCode, `${name} returned an unexpected Prisma error code.`);
  }
  record(results, name);
}

async function counts() {
  const countClient = prisma as unknown as Record<string, { count: () => Promise<number> }>;
  const entries = await Promise.all(
    MODEL_DELEGATES.map(async (delegate) => [delegate, await countClient[delegate].count()] as const),
  );
  return Object.fromEntries(entries);
}

async function assertEmpty(stage: string) {
  const current = await counts();
  assert.ok(Object.values(current).every((count) => count === 0), `${stage}: QA rows remain in the test database.`);
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.orderAsset.deleteMany();
    await transaction.orderNotification.deleteMany();
    await transaction.orderEvent.deleteMany();
    await transaction.favorite.deleteMany();
    await transaction.projectAsset.deleteMany();
    await transaction.confidenceAnnotation.deleteMany();
    await transaction.credit.deleteMany();
    await transaction.platformLink.deleteMany();
    await transaction.track.deleteMany();
    await transaction.order.deleteMany();
    await transaction.asset.deleteMany();
    await transaction.customer.deleteMany();
    await transaction.project.deleteMany();
    await transaction.user.deleteMany();
  });
}

async function run() {
  validateSafetyGuards();
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString);
  const secondImport = await import("@/lib/prisma");
  const results: string[] = [];
  let cleanupComplete = false;
  let cleanupAllowed = false;
  let primaryDisconnected = false;

  assert.equal(prisma, secondImport.prisma, "The development Prisma singleton was not reused.");
  record(results, "Prisma singleton reused");

  try {
    const metadata = await prisma.$queryRawUnsafe<Array<{ database: string; schema: string; version: string }>>(
      `SELECT current_database() AS database, current_schema() AS schema, version() AS version`,
    );
    assert.equal(metadata[0].database, process.env.LNX_EXPECTED_DATABASE);
    assert.equal(metadata[0].schema, "public");
    record(results, "Prisma Client connected");

    const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`,
    );
    assert.equal(tables.length, 13, "The migrated database must expose 13 model tables.");

    const checks = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
      `SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND c.contype = 'c' ORDER BY conname`,
    );
    assert.deepEqual(checks.map(({ conname }) => conname), EXPECTED_CHECKS);
    record(results, "Physical schema inspected");

    await assertEmpty("precondition");
    cleanupAllowed = true;

    const userEmail = "lnx-v041-user@example.invalid";
    const user = await prisma.user.create({
      data: { email: userEmail, displayName: "LNX V0.4.1 QA" },
    });
    assert.match(user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(user.role, "MEMBER");
    assert.equal(user.status, "PENDING");
    assert.ok(user.createdAt instanceof Date && user.updatedAt instanceof Date);
    const readUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(readUser.email, userEmail);
    const updatedUser = await prisma.user.update({ where: { id: user.id }, data: { displayName: "LNX V0.4.1 QA updated" } });
    assert.equal(updatedUser.displayName, "LNX V0.4.1 QA updated");
    assert.ok(updatedUser.updatedAt.getTime() >= user.updatedAt.getTime());
    record(results, "User CRUD and defaults");

    await expectFailure(results, "User email unique", () => prisma.user.create({ data: { email: userEmail } }), "P2002");

    const customer = await prisma.customer.create({
      data: { email: "lnx-v041-customer@example.invalid", displayName: "LNX Customer QA", user: { connect: { id: user.id } } },
    });
    assert.equal(customer.userId, user.id);
    await expectFailure(results, "Customer email unique", () => prisma.customer.create({ data: { email: customer.email } }), "P2002");
    await expectFailure(
      results,
      "Customer one-to-one user unique",
      () => prisma.customer.create({ data: { email: "lnx-v041-customer-2@example.invalid", userId: user.id } }),
      "P2002",
    );

    const project = await prisma.project.create({
      data: { slug: "lnx-v041-project", title: "LNX V0.4.1 Project QA", type: "ALBUM", catalogPosition: 1 },
    });
    assert.equal(project.releaseDate, null);
    assert.equal(project.status, "DRAFT");
    assert.ok(project.createdAt instanceof Date && project.updatedAt instanceof Date);
    await expectFailure(
      results,
      "Project slug unique",
      () => prisma.project.create({ data: { slug: project.slug, title: "Duplicate", type: "SINGLE", catalogPosition: 2 } }),
      "P2002",
    );
    await expectFailure(results, "Project trackCount CHECK", () =>
      prisma.project.create({ data: { slug: "lnx-v041-negative-track-count", title: "Invalid", type: "PROJECT", trackCount: -1, catalogPosition: 2 } }),
    );

    const trackOne = await prisma.track.create({
      data: { projectId: project.id, position: 1, title: "Track QA 1", durationSeconds: 90 },
    });
    const trackTwo = await prisma.track.create({
      data: { projectId: project.id, position: 2, title: "Track QA 2" },
    });
    assert.deepEqual(
      (await prisma.track.findMany({ where: { projectId: project.id }, orderBy: { position: "asc" } })).map(({ position }) => position),
      [1, 2],
    );
    await expectFailure(
      results,
      "Track position unique",
      () => prisma.track.create({ data: { projectId: project.id, position: 1, title: "Duplicate position" } }),
      "P2002",
    );
    await expectFailure(results, "Track position CHECK", () =>
      prisma.track.create({ data: { projectId: project.id, position: 0, title: "Invalid position" } }),
    );
    await expectFailure(results, "Track duration CHECK", () =>
      prisma.track.create({ data: { projectId: project.id, position: 3, title: "Invalid duration", durationSeconds: -1 } }),
    );
    await expectFailure(results, "Track foreign key", () =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "tracks" ("id", "projectId", "position", "title", "status", "confidence", "createdAt", "updatedAt") VALUES ($1::uuid, $2::uuid, 99, 'Orphan QA', 'DRAFT', 'UNKNOWN', NOW(), NOW())`,
        randomUUID(),
        randomUUID(),
      ),
    );

    const artistLink = await prisma.platformLink.create({
      data: { platform: "SPOTIFY", scope: "ARTIST", url: "https://example.invalid/lnx-v041/artist" },
    });
    await prisma.platformLink.create({
      data: { projectId: project.id, platform: "APPLE_MUSIC", scope: "RELEASE", url: "https://example.invalid/lnx-v041/release" },
    });
    await prisma.platformLink.create({
      data: { platform: "ETSY", scope: "STORE", url: "https://example.invalid/lnx-v041/store" },
    });
    await expectFailure(results, "Platform URL unique", () =>
      prisma.platformLink.create({ data: { platform: "OTHER", scope: "STORE", url: artistLink.url } }),
      "P2002",
    );
    await expectFailure(results, "Platform position CHECK", () =>
      prisma.platformLink.create({ data: { platform: "OTHER", scope: "STORE", url: "https://example.invalid/lnx-v041/negative-position", position: -1 } }),
    );
    await expectFailure(results, "Platform RELEASE scope CHECK", () =>
      prisma.platformLink.create({ data: { platform: "DEEZER", scope: "RELEASE", url: "https://example.invalid/lnx-v041/release-without-project" } }),
    );
    await expectFailure(results, "Platform ARTIST scope CHECK", () =>
      prisma.platformLink.create({ data: { projectId: project.id, platform: "YOUTUBE", scope: "ARTIST", url: "https://example.invalid/lnx-v041/artist-with-project" } }),
    );

    await prisma.credit.create({ data: { projectId: project.id, name: "Project Credit QA", role: "PRODUCER" } });
    await prisma.credit.create({ data: { trackId: trackOne.id, name: "Track Credit QA", role: "WRITER" } });
    await expectFailure(results, "Credit missing parent CHECK", () =>
      prisma.credit.create({ data: { name: "Invalid Credit QA", role: "OTHER" } }),
    );
    await expectFailure(results, "Credit double parent CHECK", () =>
      prisma.credit.create({ data: { projectId: project.id, trackId: trackTwo.id, name: "Invalid Credit QA", role: "OTHER" } }),
    );
    await expectFailure(results, "Credit position CHECK", () =>
      prisma.credit.create({ data: { projectId: project.id, name: "Invalid Credit QA", role: "OTHER", position: -1 } }),
    );

    const asset = await prisma.asset.create({
      data: {
        type: "COVER",
        storageKey: "qa/v041/cover",
        filename: "cover-qa.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024n,
        width: 1200,
        height: 1200,
      },
    });
    await prisma.projectAsset.create({ data: { projectId: project.id, assetId: asset.id, role: "COVER" } });
    await expectFailure(results, "Asset storage key unique", () =>
      prisma.asset.create({ data: { type: "IMAGE", storageKey: asset.storageKey, filename: "duplicate.jpg", mimeType: "image/jpeg", sizeBytes: 1n } }),
      "P2002",
    );
    await expectFailure(results, "ProjectAsset composite unique", () =>
      prisma.projectAsset.create({ data: { projectId: project.id, assetId: asset.id, role: "COVER" } }),
      "P2002",
    );
    await expectFailure(results, "Asset size CHECK", () =>
      prisma.asset.create({ data: { type: "IMAGE", storageKey: "qa/v041/negative-size", filename: "invalid.jpg", mimeType: "image/jpeg", sizeBytes: -1n } }),
    );
    await expectFailure(results, "Asset width CHECK", () =>
      prisma.asset.create({ data: { type: "IMAGE", storageKey: "qa/v041/negative-width", filename: "invalid.jpg", mimeType: "image/jpeg", sizeBytes: 1n, width: -1 } }),
    );
    await expectFailure(results, "Asset height CHECK", () =>
      prisma.asset.create({ data: { type: "IMAGE", storageKey: "qa/v041/negative-height", filename: "invalid.jpg", mimeType: "image/jpeg", sizeBytes: 1n, height: -1 } }),
    );
    await expectFailure(results, "ProjectAsset position CHECK", () =>
      prisma.projectAsset.create({ data: { projectId: project.id, assetId: asset.id, role: "HERO", position: -1 } }),
    );

    const order = await prisma.order.create({
      data: {
        orderNumber: "LNX-V041-QA-001",
        customerEmail: "snapshot-v041@example.invalid",
        customerName: "Snapshot QA",
        brief: "Brief QA exclusivement fictif.",
        userId: user.id,
        customerId: customer.id,
      },
    });
    assert.equal(order.status, "DRAFT");
    assert.equal(order.customerEmail, "snapshot-v041@example.invalid");
    await expectFailure(results, "Order number unique", () =>
      prisma.order.create({ data: { orderNumber: order.orderNumber, customerEmail: "duplicate@example.invalid", brief: "Duplicate QA" } }),
      "P2002",
    );

    const orderEvent = await prisma.orderEvent.create({
      data: { orderId: order.id, fromStatus: "SUBMITTED", toStatus: "REVIEWING", actorUserId: user.id },
    });
    await expectFailure(results, "OrderEvent status CHECK", () =>
      prisma.orderEvent.create({ data: { orderId: order.id, fromStatus: "REVIEWING", toStatus: "REVIEWING" } }),
    );
    await prisma.orderAsset.create({ data: { orderId: order.id, assetId: asset.id, role: "REFERENCE" } });
    await expectFailure(results, "OrderAsset composite unique", () =>
      prisma.orderAsset.create({ data: { orderId: order.id, assetId: asset.id, role: "REFERENCE" } }),
      "P2002",
    );

    const annotation = await prisma.confidenceAnnotation.create({
      data: { projectId: project.id, domain: "OVERALL", level: "CONFIRMED", note: "QA only", verifiedById: user.id },
    });
    assert.ok(annotation.createdAt instanceof Date && annotation.updatedAt instanceof Date);
    await expectFailure(results, "Confidence domain unique", () =>
      prisma.confidenceAnnotation.create({ data: { projectId: project.id, domain: "OVERALL", level: "UNKNOWN" } }),
      "P2002",
    );

    await prisma.favorite.create({ data: { userId: user.id, projectId: project.id } });
    await expectFailure(results, "Favorite composite unique", () =>
      prisma.favorite.create({ data: { userId: user.id, projectId: project.id } }),
      "P2002",
    );

    await expectFailure(results, "Project delete RESTRICT", () => prisma.project.delete({ where: { id: project.id } }), "P2003");
    await expectFailure(results, "Asset delete RESTRICT", () => prisma.asset.delete({ where: { id: asset.id } }), "P2003");
    await expectFailure(results, "Order delete RESTRICT", () => prisma.order.delete({ where: { id: order.id } }), "P2003");

    await prisma.user.delete({ where: { id: user.id } });
    const [customerAfterUser, orderAfterUser, eventAfterUser, annotationAfterUser, favoriteCount] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { id: customer.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.orderEvent.findUniqueOrThrow({ where: { id: orderEvent.id } }),
      prisma.confidenceAnnotation.findUniqueOrThrow({ where: { id: annotation.id } }),
      prisma.favorite.count({ where: { projectId: project.id } }),
    ]);
    assert.equal(customerAfterUser.userId, null);
    assert.equal(orderAfterUser.userId, null);
    assert.equal(eventAfterUser.actorUserId, null);
    assert.equal(annotationAfterUser.verifiedById, null);
    assert.equal(favoriteCount, 0);
    record(results, "SET NULL and Favorite CASCADE on User delete");

    await prisma.customer.delete({ where: { id: customer.id } });
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).customerId, null);
    record(results, "SET NULL on Customer delete");

    const cascadeUser = await prisma.user.create({ data: { email: "lnx-v041-cascade@example.invalid" } });
    const cascadeProject = await prisma.project.create({ data: { slug: "lnx-v041-cascade", title: "Cascade QA", type: "PROJECT", catalogPosition: 2 } });
    await prisma.favorite.create({ data: { userId: cascadeUser.id, projectId: cascadeProject.id } });
    await prisma.project.delete({ where: { id: cascadeProject.id } });
    assert.equal(await prisma.favorite.count({ where: { userId: cascadeUser.id } }), 0);
    assert.ok(await prisma.user.findUnique({ where: { id: cascadeUser.id } }));
    record(results, "Favorite CASCADE on Project delete");

    const transactionUserEmail = "lnx-v041-transaction@example.invalid";
    const transactionProjectSlug = "lnx-v041-transaction";
    let rolledBack = false;
    try {
      await prisma.$transaction(async (transaction) => {
        await transaction.user.create({ data: { email: transactionUserEmail } });
        await transaction.project.create({ data: { slug: transactionProjectSlug, title: "Transaction QA", type: "PROJECT", catalogPosition: 3 } });
        throw new Error("intentional V0.4.1 rollback");
      });
    } catch (error) {
      rolledBack = error instanceof Error && error.message === "intentional V0.4.1 rollback";
    }
    assert.equal(rolledBack, true);
    assert.equal(await prisma.user.count({ where: { email: transactionUserEmail } }), 0);
    assert.equal(await prisma.project.count({ where: { slug: transactionProjectSlug } }), 0);
    record(results, "Transaction rollback");

    const concurrentEmail = "lnx-v041-concurrent@example.invalid";
    const concurrent = await Promise.allSettled([
      prisma.user.create({ data: { email: concurrentEmail } }),
      prisma.user.create({ data: { email: concurrentEmail } }),
    ]);
    assert.equal(concurrent.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(concurrent.filter(({ status }) => status === "rejected").length, 1);
    assert.equal(await prisma.user.count({ where: { email: concurrentEmail } }), 1);
    record(results, "Concurrent database uniqueness");

    await cleanup();
    await assertEmpty("cleanup");
    cleanupComplete = true;
    record(results, "QA cleanup");

    await prisma.$disconnect();
    primaryDisconnected = true;
    const reconnectClient = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const reconnect = await reconnectClient.$queryRawUnsafe<Array<{ ok: number }>>(`SELECT 1::int AS ok`);
    assert.equal(reconnect[0].ok, 1);
    record(results, "Prisma reconnect");
    await reconnectClient.$disconnect();

    console.log("PostgreSQL runtime validation passed.");
    console.log(JSON.stringify({
      testsPassed: results.length,
      uniqueAndCompositeConstraintsTested: 11,
      checkConstraintsTested: EXPECTED_CHECKS.length,
      foreignKeysTested: 1,
      restrictBehaviorsTested: 3,
      setNullBehaviorsTested: 5,
      cascadeBehaviorsTested: 2,
      transactionRollback: true,
      reconnect: true,
      qaRowsRemaining: 0,
    }, null, 2));
  } finally {
    try {
      if (cleanupAllowed && !cleanupComplete) {
        await cleanup();
        await assertEmpty("final cleanup");
      }
    } finally {
      if (!primaryDisconnected) await prisma.$disconnect();
    }
  }
}

run().catch((error) => {
  console.error(`PostgreSQL runtime validation failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
