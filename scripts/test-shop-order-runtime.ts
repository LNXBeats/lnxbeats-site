import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { parseShopOrderIntent } from "@/lib/shop/order-domain";
import {
  confirmShopOrderPayment,
  createShopOrder,
  expireShopOrderReservations,
  getAdminShopOrder,
  getMemberShopOrder,
  getPublicShopProduct,
  releaseShopOrderReservation,
  ShopServiceError,
} from "@/lib/shop/order-service";
import { loadAndAssertShopPhase2QaEnvironment, SHOP_PHASE2_QA_TARGET } from "@/lib/shop/qa-guard";
import {
  adjustAdminProductStock,
  ProductServiceError,
  updateAdminProduct,
} from "@/lib/shop/product-service";

const EXPECTED_MIGRATION_COUNT = 20;
const EXPECTED_BASELINE_MIGRATION_COUNT = 19;
const TECHNICAL_DATABASE = "template1";
const BASELINE_MODE = "migration-baseline";
const MIGRATION_BASELINE_PATH = "/private/tmp/lnx-studio-v110-phase2-migration-baseline.json";
const MIGRATION_BASELINE_VERSION = 1;
const V1_BASELINE = {
  userId: "81000000-0000-4000-8000-000000000001",
  userEmail: "lnx-v110-phase2-migration-baseline@example.invalid",
  orderId: "82000000-0000-4000-8000-000000000001",
  orderNumber: "LNX-2026-990001",
  paymentId: "83000000-0000-4000-8000-000000000001",
  paymentIdempotencyKey: "lnx-v110-phase2-migration-baseline-payment",
  providerEventId: "lnx-v110-phase2-migration-baseline-provider-event",
  notificationEventId: "84000000-0000-4000-8000-000000000001",
  notificationProviderEventId: "lnx-v110-phase2-migration-baseline-notification-event",
} as const;
const FIXTURE_EMAILS = [
  "lnx-v110-phase2-stock-a@example.invalid",
  "lnx-v110-phase2-stock-b@example.invalid",
  "lnx-v110-phase2-stock-c@example.invalid",
  "lnx-v110-phase2-stock-admin@example.invalid",
] as const;
const FIXTURE_PRODUCT_SLUGS = [
  "lnx-v110-phase2-runtime-stock-one",
  "lnx-v110-phase2-runtime-untracked",
] as const;
const FIXTURE_STORAGE_KEYS = [
  "shop/runtime/lnx-v110-phase2-stock-one.webp",
  "shop/runtime/lnx-v110-phase2-untracked.webp",
] as const;
const CREATION_TOKENS = Array.from({ length: 12 }, (_, index) =>
  `71000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);

type GuardedRuntime = Awaited<ReturnType<typeof loadAndAssertShopPhase2QaEnvironment>>;
type MigrationRow = Readonly<{
  migrationName: string;
  checksum: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
}>;
type V1Counts = Readonly<{
  users: number;
  orders: number;
  payments: number;
  providerEvents: number;
  notificationEvents: number;
}>;
type RuntimeIdentity = Readonly<{
  database: string;
  schema: string;
  serverAddress: string | null;
  serverPort: number | null;
  postmasterStartedAt: string;
}>;
type MigrationBaseline = Readonly<{
  version: number;
  target: string;
  proofPid: number;
  identity: RuntimeIdentity;
  migrationCount: number;
  beforeFixture: V1Counts;
  withFixture: V1Counts;
}>;

async function expectedMigrations() {
  const root = path.join(process.cwd(), "prisma", "migrations");
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.equal(names.length, EXPECTED_MIGRATION_COUNT);
  return Promise.all(names.map(async (name) => ({
    name,
    checksum: createHash("sha256")
      .update(await readFile(path.join(root, name, "migration.sql")))
      .digest("hex"),
  })));
}

async function runtimeIdentity(): Promise<RuntimeIdentity> {
  const rows = await prisma.$queryRaw<Array<{
    database: string;
    schema: string;
    serverAddress: string | null;
    serverPort: number | null;
    postmasterStartedAt: Date;
  }>>`
    SELECT current_database() AS database,
      current_schema() AS schema,
      inet_server_addr()::text AS "serverAddress",
      inet_server_port() AS "serverPort",
      pg_postmaster_start_time() AS "postmasterStartedAt"
  `;
  const value = rows[0];
  assert.ok(value, "The disposable PostgreSQL identity is unavailable.");
  return { ...value, postmasterStartedAt: value.postmasterStartedAt.toISOString() };
}

async function assertExactRuntimeDatabase(runtime: GuardedRuntime) {
  assert.equal(runtime.target, SHOP_PHASE2_QA_TARGET);
  const url = new URL(runtime.databaseUrl);
  const identity = await runtimeIdentity();
  assert.equal(identity.database, TECHNICAL_DATABASE);
  assert.equal(identity.schema, "public");
  const explicitTcpIdentity = identity.serverAddress !== null || identity.serverPort !== null;
  if (explicitTcpIdentity) {
    assert.ok(identity.serverAddress !== null && ["127.0.0.1", "::1"].includes(identity.serverAddress));
    assert.equal(identity.serverPort, Number(url.port));
  } else {
    // Prisma Dev’s PGlite compatibility layer reports NULL for both inet_server_*
    // functions. The guarded URL and live server.json proof above remain the
    // authoritative, exact loopback identity in that mode.
    assert.equal(identity.serverAddress, null);
    assert.equal(identity.serverPort, null);
  }
  assert.ok(Number.isInteger(runtime.proofPid) && runtime.proofPid > 0);
  return identity;
}

async function assertRuntimeMigrationCount(expectedCount: 19 | 20) {
  const expected = await expectedMigrations();
  const applied = await prisma.$queryRaw<MigrationRow[]>`
    SELECT "migration_name" AS "migrationName", "checksum",
      "finished_at" AS "finishedAt", "rolled_back_at" AS "rolledBackAt"
    FROM "_prisma_migrations"
    ORDER BY "migration_name" ASC, "started_at" ASC
  `;
  assert.equal(applied.length, expectedCount);
  assert.ok(applied.every(({ finishedAt, rolledBackAt }) => finishedAt !== null && rolledBackAt === null));
  assert.deepEqual(
    applied.map(({ migrationName, checksum }) => ({ name: migrationName, checksum })),
    expected.slice(0, expectedCount),
  );
}

async function v1Counts(): Promise<V1Counts> {
  const [users, orders, payments, providerEvents, notificationEvents] = await Promise.all([
    prisma.user.count(), prisma.order.count(), prisma.payment.count(),
    prisma.providerEvent.count(), prisma.notificationEvent.count(),
  ]);
  return { users, orders, payments, providerEvents, notificationEvents };
}

function plusOneEach(value: V1Counts): V1Counts {
  return {
    users: value.users + 1,
    orders: value.orders + 1,
    payments: value.payments + 1,
    providerEvents: value.providerEvents + 1,
    notificationEvents: value.notificationEvents + 1,
  };
}

async function assertBaselineFixturesAbsent() {
  const [user, order, payment, providerEvent, notificationEvent] = await Promise.all([
    prisma.user.count({ where: { OR: [{ id: V1_BASELINE.userId }, { email: V1_BASELINE.userEmail }] } }),
    prisma.order.count({ where: { OR: [{ id: V1_BASELINE.orderId }, { orderNumber: V1_BASELINE.orderNumber }] } }),
    prisma.payment.count({ where: { OR: [{ id: V1_BASELINE.paymentId }, { idempotencyKey: V1_BASELINE.paymentIdempotencyKey }] } }),
    prisma.providerEvent.count({ where: { providerEventId: V1_BASELINE.providerEventId } }),
    prisma.notificationEvent.count({ where: { OR: [
      { id: V1_BASELINE.notificationEventId }, { providerEventId: V1_BASELINE.notificationProviderEventId },
    ] } }),
  ]);
  assert.deepEqual(
    { user, order, payment, providerEvent, notificationEvent },
    { user: 0, order: 0, payment: 0, providerEvent: 0, notificationEvent: 0 },
  );
}

async function createV1BaselineFixture() {
  const now = new Date();
  await prisma.$transaction(async (transaction) => {
    await transaction.user.create({ data: {
      id: V1_BASELINE.userId, email: V1_BASELINE.userEmail,
      displayName: "Shop Phase 2 migration baseline", role: "MEMBER", status: "ACTIVE",
      emailVerified: true, emailVerifiedAt: now,
    } });
    await transaction.order.create({ data: {
      id: V1_BASELINE.orderId, orderNumber: V1_BASELINE.orderNumber, userId: V1_BASELINE.userId,
      customerEmail: V1_BASELINE.userEmail, customerName: "Migration baseline",
      status: "AWAITING_PAYMENT", title: "Shop Phase 2 migration baseline",
      brief: "Fixture V1 fictive destinée uniquement à la parité de migration locale.",
      totalCents: 5_000, submittedAt: now,
    } });
    await transaction.payment.create({ data: {
      id: V1_BASELINE.paymentId, orderId: V1_BASELINE.orderId, provider: "STRIPE", mode: "TEST",
      status: "CREATED", amountCents: 5_000, currency: "EUR", pricingVersion: "2026-08-v1",
      idempotencyKey: V1_BASELINE.paymentIdempotencyKey,
    } });
    await transaction.providerEvent.create({ data: {
      provider: "STRIPE", providerEventId: V1_BASELINE.providerEventId,
      type: "shop.phase2.migration.baseline", livemode: false, outcome: "IGNORED",
      paymentId: V1_BASELINE.paymentId, processedAt: now,
    } });
    await transaction.notificationEvent.create({ data: {
      id: V1_BASELINE.notificationEventId,
      providerEventId: V1_BASELINE.notificationProviderEventId,
      providerEventType: "shop.phase2.migration.baseline", outcome: "IGNORED",
      code: "MIGRATION_BASELINE", actorUserId: V1_BASELINE.userId, occurredAt: now,
    } });
  });
}

async function assertV1BaselineFixturePreserved() {
  const [user, order, payment, providerEvent, notificationEvent] = await Promise.all([
    prisma.user.findUnique({ where: { id: V1_BASELINE.userId } }),
    prisma.order.findUnique({ where: { id: V1_BASELINE.orderId } }),
    prisma.payment.findUnique({ where: { id: V1_BASELINE.paymentId } }),
    prisma.providerEvent.findUnique({
      where: { provider_providerEventId: { provider: "STRIPE", providerEventId: V1_BASELINE.providerEventId } },
    }),
    prisma.notificationEvent.findUnique({ where: { id: V1_BASELINE.notificationEventId } }),
  ]);
  assert.deepEqual(user && {
    id: user.id, email: user.email, displayName: user.displayName,
    role: user.role, status: user.status, emailVerified: user.emailVerified,
  }, {
    id: V1_BASELINE.userId, email: V1_BASELINE.userEmail,
    displayName: "Shop Phase 2 migration baseline", role: "MEMBER", status: "ACTIVE", emailVerified: true,
  });
  assert.deepEqual(order && {
    id: order.id, orderNumber: order.orderNumber, userId: order.userId,
    customerEmail: order.customerEmail, status: order.status, totalCents: order.totalCents,
  }, {
    id: V1_BASELINE.orderId, orderNumber: V1_BASELINE.orderNumber, userId: V1_BASELINE.userId,
    customerEmail: V1_BASELINE.userEmail, status: "AWAITING_PAYMENT", totalCents: 5_000,
  });
  assert.deepEqual(payment && {
    id: payment.id, orderId: payment.orderId, provider: payment.provider, mode: payment.mode,
    status: payment.status, amountCents: payment.amountCents, currency: payment.currency,
    pricingVersion: payment.pricingVersion, idempotencyKey: payment.idempotencyKey,
  }, {
    id: V1_BASELINE.paymentId, orderId: V1_BASELINE.orderId, provider: "STRIPE", mode: "TEST",
    status: "CREATED", amountCents: 5_000, currency: "EUR", pricingVersion: "2026-08-v1",
    idempotencyKey: V1_BASELINE.paymentIdempotencyKey,
  });
  assert.deepEqual(providerEvent && {
    provider: providerEvent.provider, providerEventId: providerEvent.providerEventId,
    type: providerEvent.type, livemode: providerEvent.livemode,
    outcome: providerEvent.outcome, paymentId: providerEvent.paymentId,
  }, {
    provider: "STRIPE", providerEventId: V1_BASELINE.providerEventId,
    type: "shop.phase2.migration.baseline", livemode: false,
    outcome: "IGNORED", paymentId: V1_BASELINE.paymentId,
  });
  assert.deepEqual(notificationEvent && {
    id: notificationEvent.id, providerEventId: notificationEvent.providerEventId,
    providerEventType: notificationEvent.providerEventType, outcome: notificationEvent.outcome,
    code: notificationEvent.code, actorUserId: notificationEvent.actorUserId,
  }, {
    id: V1_BASELINE.notificationEventId,
    providerEventId: V1_BASELINE.notificationProviderEventId,
    providerEventType: "shop.phase2.migration.baseline", outcome: "IGNORED",
    code: "MIGRATION_BASELINE", actorUserId: V1_BASELINE.userId,
  });
}

async function cleanupV1BaselineFixture() {
  await prisma.$transaction(async (transaction) => {
    await transaction.notificationEvent.deleteMany({ where: { id: V1_BASELINE.notificationEventId } });
    await transaction.providerEvent.deleteMany({ where: { providerEventId: V1_BASELINE.providerEventId } });
    await transaction.payment.deleteMany({ where: { id: V1_BASELINE.paymentId } });
    await transaction.order.deleteMany({ where: { id: V1_BASELINE.orderId } });
    await transaction.user.deleteMany({ where: { id: V1_BASELINE.userId } });
  });
}

function assertV1Counts(value: unknown): asserts value is V1Counts {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  for (const key of ["users", "orders", "payments", "providerEvents", "notificationEvents"] as const) {
    assert.ok(Number.isInteger((value as V1Counts)[key]) && (value as V1Counts)[key] >= 0);
  }
}

function assertMigrationBaseline(value: unknown): asserts value is MigrationBaseline {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  const baseline = value as Partial<MigrationBaseline>;
  assert.equal(baseline.version, MIGRATION_BASELINE_VERSION);
  assert.equal(baseline.target, SHOP_PHASE2_QA_TARGET);
  assert.ok(Number.isInteger(baseline.proofPid) && Number(baseline.proofPid) > 0);
  assert.equal(baseline.migrationCount, EXPECTED_BASELINE_MIGRATION_COUNT);
  assert.ok(baseline.identity && typeof baseline.identity === "object");
  assert.equal(baseline.identity.database, TECHNICAL_DATABASE);
  assert.equal(baseline.identity.schema, "public");
  const hasTcpIdentity = baseline.identity.serverAddress !== null || baseline.identity.serverPort !== null;
  if (hasTcpIdentity) {
    assert.ok(
      baseline.identity.serverAddress !== null
        && ["127.0.0.1", "::1"].includes(baseline.identity.serverAddress),
    );
    assert.ok(Number.isInteger(baseline.identity.serverPort) && Number(baseline.identity.serverPort) > 0);
  } else {
    assert.equal(baseline.identity.serverAddress, null);
    assert.equal(baseline.identity.serverPort, null);
  }
  assert.ok(typeof baseline.identity.postmasterStartedAt === "string");
  assertV1Counts(baseline.beforeFixture);
  assertV1Counts(baseline.withFixture);
  assert.deepEqual(baseline.withFixture, plusOneEach(baseline.beforeFixture));
}

async function createMigrationBaseline(runtime: GuardedRuntime, identity: RuntimeIdentity) {
  await assertRuntimeMigrationCount(EXPECTED_BASELINE_MIGRATION_COUNT);
  await assert.rejects(access(MIGRATION_BASELINE_PATH), { code: "ENOENT" });
  await assertBaselineFixturesAbsent();
  const beforeFixture = await v1Counts();
  let fixtureCreated = false;
  try {
    await createV1BaselineFixture();
    fixtureCreated = true;
    const withFixture = await v1Counts();
    assert.deepEqual(withFixture, plusOneEach(beforeFixture));
    await assertV1BaselineFixturePreserved();
    await writeFile(MIGRATION_BASELINE_PATH, `${JSON.stringify({
      version: MIGRATION_BASELINE_VERSION, target: runtime.target, proofPid: runtime.proofPid,
      identity, migrationCount: EXPECTED_BASELINE_MIGRATION_COUNT, beforeFixture, withFixture,
    } satisfies MigrationBaseline)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (fixtureCreated) await cleanupV1BaselineFixture();
    throw error;
  }
  console.info(JSON.stringify({
    event: "shop.order.migration-baseline.created", outcome: "passed",
    target: runtime.target, migrations: EXPECTED_BASELINE_MIGRATION_COUNT,
  }));
}

async function assertMigrationParity(runtime: GuardedRuntime, identity: RuntimeIdentity) {
  await assertRuntimeMigrationCount(EXPECTED_MIGRATION_COUNT);
  const value: unknown = JSON.parse(await readFile(MIGRATION_BASELINE_PATH, "utf8"));
  assertMigrationBaseline(value);
  assert.equal(value.proofPid, runtime.proofPid);
  assert.deepEqual(value.identity, identity, "The migration baseline belongs to another PostgreSQL runtime.");
  assert.deepEqual(await v1Counts(), value.withFixture);
  await assertV1BaselineFixturePreserved();
  assert.deepEqual({
    shopOrders: await prisma.shopOrder.count(), shopItems: await prisma.shopOrderItem.count(),
    reservations: await prisma.stockReservation.count(), shopEvents: await prisma.shopOrderEvent.count(),
  }, { shopOrders: 0, shopItems: 0, reservations: 0, shopEvents: 0 });
  await cleanupV1BaselineFixture();
  assert.deepEqual(await v1Counts(), value.beforeFixture);
  await unlink(MIGRATION_BASELINE_PATH);
  return value.beforeFixture;
}

async function fixtureIds() {
  const [users, products, assets] = await Promise.all([
    prisma.user.findMany({ where: { email: { in: [...FIXTURE_EMAILS] } }, select: { id: true } }),
    prisma.product.findMany({ where: { slug: { in: [...FIXTURE_PRODUCT_SLUGS] } }, select: { id: true } }),
    prisma.asset.findMany({ where: { storageKey: { in: [...FIXTURE_STORAGE_KEYS] } }, select: { id: true } }),
  ]);
  return {
    userIds: users.map(({ id }) => id), productIds: products.map(({ id }) => id),
    assetIds: assets.map(({ id }) => id),
  };
}

async function cleanupFixtures() {
  const { userIds, productIds, assetIds } = await fixtureIds();
  await prisma.$transaction(async (transaction) => {
    const orderIds = userIds.length || productIds.length
      ? (await transaction.shopOrder.findMany({
        where: { OR: [
          ...(userIds.length ? [{ userId: { in: userIds } }] : []),
          ...(productIds.length ? [{ items: { some: { productId: { in: productIds } } } }] : []),
        ] }, select: { id: true },
      })).map(({ id }) => id)
      : [];
    if (orderIds.length) {
      await transaction.shopOrderEvent.deleteMany({ where: { shopOrderId: { in: orderIds } } });
      await transaction.stockReservation.deleteMany({ where: { shopOrderId: { in: orderIds } } });
      await transaction.shopOrderItem.deleteMany({ where: { shopOrderId: { in: orderIds } } });
      await transaction.shopOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productIds.length) {
      await transaction.productAsset.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.productStockAdjustment.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.productAuditEvent.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (assetIds.length) await transaction.asset.deleteMany({ where: { id: { in: assetIds } } });
    if (userIds.length) {
      await transaction.rateLimit.deleteMany({ where: { key: { in: userIds.map((id) => `shop:orders:create:${id}`) } } });
      await transaction.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });
}

async function assertNoShopRuntimeFixtures(stage: string) {
  const { userIds, productIds, assetIds } = await fixtureIds();
  const [shopOrders, shopItems, reservations, shopEvents] = await Promise.all([
    prisma.shopOrder.count(), prisma.shopOrderItem.count(),
    prisma.stockReservation.count(), prisma.shopOrderEvent.count(),
  ]);
  assert.deepEqual({
    fixtureUsers: userIds.length, fixtureProducts: productIds.length, fixtureAssets: assetIds.length,
    shopOrders, shopItems, reservations, shopEvents,
  }, {
    fixtureUsers: 0, fixtureProducts: 0, fixtureAssets: 0,
    shopOrders: 0, shopItems: 0, reservations: 0, shopEvents: 0,
  }, `${stage}: the dedicated runtime must contain no Shop fixture.`);
}

async function createFixtures() {
  const now = new Date();
  return prisma.$transaction(async (transaction) => {
    const users = [];
    for (const [index, email] of FIXTURE_EMAILS.entries()) {
      users.push(await transaction.user.create({
        data: {
          email, displayName: `Shop Phase 2 Runtime ${index + 1}`,
          role: index === FIXTURE_EMAILS.length - 1 ? "ADMIN" : "MEMBER",
          status: "ACTIVE", emailVerified: true, emailVerifiedAt: now,
        }, select: { id: true },
      }));
    }
    const asset = await transaction.asset.create({ data: {
      type: "IMAGE", storageKey: FIXTURE_STORAGE_KEYS[0], storageBackend: "LOCAL",
      storageProvider: "local", visibility: "PUBLIC", filename: "lnx-v110-phase2-stock-one.webp",
      mimeType: "image/webp", sizeBytes: 1n, width: 1, height: 1,
      alt: "Visuel fictif du test PostgreSQL Boutique Phase 2", rightsStatus: "CLEARED",
      rightsNote: "Fixture locale jetable, aucun objet de stockage n’est créé.", confidence: "CONFIRMED",
    } });
    const product = await transaction.product.create({ data: {
      slug: FIXTURE_PRODUCT_SLUGS[0], title: "Exemplaire unique Phase 2",
      description: "Produit fictif réservé au runtime PostgreSQL jetable.", status: "PUBLISHED",
      priceCents: 2_500, currency: "EUR", trackInventory: true, stock: 1,
      shippingRequired: true, shippingPriceCents: 500, position: 0, publishedAt: now,
      assets: { create: { assetId: asset.id, position: 0 } },
    } });
    const untrackedAsset = await transaction.asset.create({ data: {
      type: "IMAGE", storageKey: FIXTURE_STORAGE_KEYS[1], storageBackend: "LOCAL",
      storageProvider: "local", visibility: "PUBLIC", filename: "lnx-v110-phase2-untracked.webp",
      mimeType: "image/webp", sizeBytes: 1n, width: 1, height: 1,
      alt: "Visuel fictif du produit sans suivi de stock Phase 2", rightsStatus: "CLEARED",
      rightsNote: "Fixture locale jetable, aucun objet de stockage n’est créé.", confidence: "CONFIRMED",
    } });
    const untrackedProduct = await transaction.product.create({ data: {
      slug: FIXTURE_PRODUCT_SLUGS[1], title: "Produit sans suivi Phase 2",
      description: "Produit fictif non expédié et sans suivi de stock.", status: "PUBLISHED",
      priceCents: 1_500, currency: "EUR", trackInventory: false, stock: null,
      shippingRequired: false, shippingPriceCents: 0, position: 1, publishedAt: now,
      assets: { create: { assetId: untrackedAsset.id, position: 0 } },
    } });
    return { users, product, untrackedProduct };
  });
}

const ADDRESS = {
  firstName: "Élise", lastName: "O’Connor-Test", addressLine1: "12 avenue de l’Opéra",
  addressLine2: "Bâtiment B", postalCode: "75001", city: "Paris", countryCode: "FR",
} as const;

function productUpdateInput(product: {
  slug: string; title: string; description: string; priceCents: number | null; currency: string;
  trackInventory: boolean; stock: number | null; shippingRequired: boolean;
  shippingPriceCents: number; position: number;
}, overrides: Record<string, unknown> = {}) {
  return {
    slug: product.slug, title: product.title, description: product.description,
    priceCents: product.priceCents, currency: product.currency,
    trackInventory: product.trackInventory, stock: product.stock,
    shippingRequired: product.shippingRequired, shippingPriceCents: product.shippingPriceCents,
    position: product.position, ...overrides,
  };
}

async function runtimeProof(passed: string[], originalV1Counts: V1Counts) {
  const { users, product, untrackedProduct } = await createFixtures();
  const members = users.slice(0, 3).map(({ id }) => ({ id, role: "MEMBER" as const }));
  const adminId = users[3]!.id;
  const startedAt = new Date();
  const intent = parseShopOrderIntent({
    items: [{ productId: product.id, quantity: 1, observedLockVersion: product.lockVersion }],
    shippingAddress: ADDRESS,
  });
  assert.throws(() => parseShopOrderIntent({
    items: [{
      productId: product.id,
      quantity: 1,
      observedLockVersion: product.lockVersion,
      unitPriceCents: 1,
    }],
    shippingAddress: ADDRESS,
  }));
  assert.throws(() => parseShopOrderIntent({
    items: [{ productId: product.id, quantity: 1, observedLockVersion: product.lockVersion }],
    shippingAddress: ADDRESS,
    shippingCents: 1, totalCents: 2,
  }));

  const attempts = [
    { actor: members[0]!, token: CREATION_TOKENS[0]! },
    { actor: members[1]!, token: CREATION_TOKENS[1]! },
  ];
  const concurrent = await Promise.allSettled(
    attempts.map(({ actor, token }) => createShopOrder(actor, intent, token, startedAt)),
  );
  assert.equal(concurrent.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(concurrent.filter(({ status }) => status === "rejected").length, 1);
  const loser = concurrent.find(({ status }) => status === "rejected");
  assert.ok(loser?.status === "rejected");
  assert.ok(loser.reason instanceof ShopServiceError);
  assert.equal(loser.reason.code, "OUT_OF_STOCK");
  const winnerIndex = concurrent.findIndex(({ status }) => status === "fulfilled");
  assert.notEqual(winnerIndex, -1);
  const winner = concurrent[winnerIndex]!;
  assert.ok(winner.status === "fulfilled");
  const winnerAttempt = attempts[winnerIndex]!;
  assert.deepEqual({
    orders: await prisma.shopOrder.count(),
    activeReservations: await prisma.stockReservation.count({ where: { status: "ACTIVE" } }),
    reservedUnits: (await prisma.stockReservation.aggregate({ where: { status: "ACTIVE" }, _sum: { quantity: true } }))._sum.quantity,
    physicalStock: (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock,
    availableStock: (await getPublicShopProduct(product.slug, startedAt))?.availableQuantity,
  }, { orders: 1, activeReservations: 1, reservedUnits: 1, physicalStock: 1, availableStock: 0 });
  passed.push("last item concurrency: one success, one OUT_OF_STOCK, one reservation, zero available");

  const persisted = await prisma.shopOrder.findUniqueOrThrow({
    where: { id: winner.value.id }, include: { items: { include: { reservation: true } } },
  });
  assert.match(persisted.orderNumber, /^LNX-SHOP-[0-9]{4}-[0-9]{6,}$/);
  assert.deepEqual({
    status: persisted.status, paymentStatus: persisted.paymentStatus,
    fulfillmentStatus: persisted.fulfillmentStatus, currency: persisted.currency,
    subtotalCents: persisted.subtotalCents, shippingCents: persisted.shippingCents,
    totalCents: persisted.totalCents, shippingRequired: persisted.shippingRequired,
    address: {
      firstName: persisted.shippingFirstName, lastName: persisted.shippingLastName,
      addressLine1: persisted.shippingAddressLine1, addressLine2: persisted.shippingAddressLine2,
      postalCode: persisted.shippingPostalCode, city: persisted.shippingCity,
      countryCode: persisted.shippingCountryCode,
    },
    line: persisted.items.map((item) => ({
      productId: item.productId, productTitle: item.productTitle,
      inventoryTracked: item.inventoryTracked, unitPriceCents: item.unitPriceCents,
      quantity: item.quantity, lineTotalCents: item.lineTotalCents,
      shippingRequired: item.shippingRequired, unitShippingCents: item.unitShippingCents,
      lineShippingCents: item.lineShippingCents, currency: item.currency,
      reservationQuantity: item.reservation?.quantity,
    })),
  }, {
    status: "OPEN", paymentStatus: "AWAITING_PAYMENT", fulfillmentStatus: "PENDING", currency: "EUR",
    subtotalCents: 2_500, shippingCents: 500, totalCents: 3_000, shippingRequired: true,
    address: ADDRESS,
    line: [{
      productId: product.id, productTitle: product.title, inventoryTracked: true,
      unitPriceCents: 2_500, quantity: 1, lineTotalCents: 2_500, shippingRequired: true,
      unitShippingCents: 500, lineShippingCents: 500, currency: "EUR", reservationQuantity: 1,
    }],
  });
  passed.push("DB price/shipping plus complete line/address snapshots defeat forged client money");

  const otherActor = attempts[(winnerIndex + 1) % attempts.length]!.actor;
  assert.equal(await getMemberShopOrder(otherActor.id, persisted.orderNumber), null);
  assert.equal((await getMemberShopOrder(winnerAttempt.actor.id, persisted.orderNumber))?.id, persisted.id);
  const adminView = await getAdminShopOrder(persisted.orderNumber);
  assert.equal(adminView?.id, persisted.id);
  assert.equal(adminView?.shippingAddressLine1, ADDRESS.addressLine1);
  passed.push("member IDOR is hidden while Admin read-only detail sees the order");

  const [replayA, replayB] = await Promise.all([
    createShopOrder(winnerAttempt.actor, intent, winnerAttempt.token, new Date(startedAt.getTime() + 1_000)),
    createShopOrder(winnerAttempt.actor, intent, winnerAttempt.token, new Date(startedAt.getTime() + 1_000)),
  ]);
  assert.equal(replayA.id, persisted.id);
  assert.equal(replayB.id, persisted.id);
  assert.equal(await prisma.shopOrder.count(), 1);
  assert.equal(await prisma.stockReservation.count(), 1);
  assert.equal(await prisma.shopOrderEvent.count({ where: { type: "SHOP_ORDER_CREATED" } }), 1);
  assert.equal(await prisma.shopOrderEvent.count({ where: { type: "STOCK_RESERVED" } }), 1);
  await assert.rejects(createShopOrder(
    winnerAttempt.actor,
    parseShopOrderIntent({
      items: [{ productId: product.id, quantity: 2, observedLockVersion: product.lockVersion }],
      shippingAddress: ADDRESS,
    }),
    winnerAttempt.token,
    new Date(startedAt.getTime() + 2_000),
  ), (error: unknown) => error instanceof ShopServiceError && error.code === "IDEMPOTENCY_CONFLICT");
  passed.push("double click/refresh replay one order; same token with another payload conflicts");

  const beforeAdminChange = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  await assert.rejects(adjustAdminProductStock(
    product.id, beforeAdminChange.lockVersion,
    { delta: "-1", reason: "Runtime active reservation guard" }, adminId,
  ), (error: unknown) => error instanceof ProductServiceError && error.code === "ACTIVE_RESERVATIONS");
  await assert.rejects(updateAdminProduct(
    product.id, beforeAdminChange.lockVersion,
    productUpdateInput(beforeAdminChange, { stock: 0 }), adminId, { stockChangeConfirmed: true },
  ), (error: unknown) => error instanceof ProductServiceError && error.code === "ACTIVE_RESERVATIONS");
  passed.push("Admin cannot reduce stock below active reservations");

  const expiryNow = new Date(winner.value.reservationExpiresAt.getTime() + 1_000);
  const savedEnabled = process.env.SHOP_ENABLED;
  process.env.SHOP_ENABLED = "false";
  try {
    assert.equal(await expireShopOrderReservations(expiryNow), 1);
    assert.equal(await expireShopOrderReservations(expiryNow), 0);
    await assert.rejects(
      createShopOrder(winnerAttempt.actor, intent, CREATION_TOKENS[3]!, new Date(expiryNow.getTime() + 1_000)),
      (error: unknown) => error instanceof ShopServiceError && error.code === "SHOP_DISABLED",
    );
  } finally {
    if (savedEnabled === undefined) delete process.env.SHOP_ENABLED;
    else process.env.SHOP_ENABLED = savedEnabled;
  }
  const expired = await prisma.shopOrder.findUniqueOrThrow({
    where: { id: winner.value.id },
    include: { items: { include: { reservation: true } }, events: true },
  });
  assert.equal(expired.status, "EXPIRED");
  assert.equal(expired.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(expired.items[0]?.reservation?.status, "EXPIRED");
  assert.equal(expired.events.filter(({ type }) => type === "SHOP_ORDER_EXPIRED").length, 1);
  assert.equal(expired.events.filter(({ type }) => type === "STOCK_RESERVATION_EXPIRED").length, 1);
  assert.equal((await getPublicShopProduct(product.slug, expiryNow))?.availableQuantity, 1);
  passed.push("expiry is idempotent and allowed with SHOP_ENABLED=false while creation is closed");

  const oldSnapshot = await prisma.shopOrder.findUniqueOrThrow({
    where: { id: expired.id }, include: { items: true },
  });
  const editable = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  const changedProduct = await updateAdminProduct(
    product.id, editable.lockVersion,
    productUpdateInput(editable, {
      title: "Exemplaire unique Phase 2 — nouveau prix", priceCents: 3_100, shippingPriceCents: 700,
    }), adminId,
  );
  const oldAfterChange = await prisma.shopOrder.findUniqueOrThrow({
    where: { id: expired.id }, include: { items: true },
  });
  assert.deepEqual({
    subtotalCents: oldAfterChange.subtotalCents, shippingCents: oldAfterChange.shippingCents,
    totalCents: oldAfterChange.totalCents, productTitle: oldAfterChange.items[0]?.productTitle,
    unitPriceCents: oldAfterChange.items[0]?.unitPriceCents,
    unitShippingCents: oldAfterChange.items[0]?.unitShippingCents,
  }, {
    subtotalCents: oldSnapshot.subtotalCents, shippingCents: oldSnapshot.shippingCents,
    totalCents: oldSnapshot.totalCents, productTitle: oldSnapshot.items[0]?.productTitle,
    unitPriceCents: oldSnapshot.items[0]?.unitPriceCents,
    unitShippingCents: oldSnapshot.items[0]?.unitShippingCents,
  });
  const changedIntent = parseShopOrderIntent({
    items: [{
      productId: product.id,
      quantity: 1,
      observedLockVersion: changedProduct.lockVersion,
    }],
    shippingAddress: ADDRESS,
  });
  await assert.rejects(
    createShopOrder(
      members[1]!,
      intent,
      CREATION_TOKENS[4]!,
      new Date(expiryNow.getTime() + 2_000),
    ),
    (error: unknown) => error instanceof ShopServiceError && error.code === "PRODUCT_CHANGED",
  );
  const releasedOrder = await createShopOrder(
    members[1]!, changedIntent, CREATION_TOKENS[4]!, new Date(expiryNow.getTime() + 2_001),
  );
  assert.deepEqual({
    subtotalCents: releasedOrder.subtotalCents, shippingCents: releasedOrder.shippingCents,
    totalCents: releasedOrder.totalCents, productTitle: releasedOrder.items[0]?.productTitle,
    unitPriceCents: releasedOrder.items[0]?.unitPriceCents,
    unitShippingCents: releasedOrder.items[0]?.unitShippingCents,
  }, {
    subtotalCents: 3_100, shippingCents: 700, totalCents: 3_800,
    productTitle: changedProduct.title, unitPriceCents: 3_100, unitShippingCents: 700,
  });
  assert.notEqual(releasedOrder.orderNumber, expired.orderNumber);
  passed.push("old snapshots survive product changes; new orders use new price/shipping");

  assert.deepEqual(await releaseShopOrderReservation(
    releasedOrder.id, new Date(expiryNow.getTime() + 3_000)), { released: 1 });
  assert.deepEqual(await releaseShopOrderReservation(
    releasedOrder.id, new Date(expiryNow.getTime() + 4_000)), { released: 0 });
  const released = await prisma.shopOrder.findUniqueOrThrow({
    where: { id: releasedOrder.id },
    include: { items: { include: { reservation: true } }, events: true },
  });
  assert.equal(released.status, "CANCELLED");
  assert.equal(released.paymentStatus, "CANCELLED");
  assert.equal(released.items[0]?.reservation?.status, "RELEASED");
  assert.equal(released.events.filter(({ type }) => type === "STOCK_RELEASED").length, 1);
  assert.equal(released.events.filter(({ type }) => type === "SHOP_ORDER_CANCELLED").length, 1);
  passed.push("explicit release is idempotent and emits each event once");

  const mixedIntent = parseShopOrderIntent({
    items: [
      { productId: product.id, quantity: 1, observedLockVersion: changedProduct.lockVersion },
      {
        productId: untrackedProduct.id,
        quantity: 2,
        observedLockVersion: untrackedProduct.lockVersion,
      },
    ], shippingAddress: ADDRESS,
  });
  const confirmable = await createShopOrder(
    members[2]!, mixedIntent, CREATION_TOKENS[5]!, new Date(expiryNow.getTime() + 5_000),
  );
  assert.equal(confirmable.items.length, 2);
  assert.equal(confirmable.subtotalCents, 6_100);
  assert.equal(confirmable.shippingCents, 700);
  assert.equal(confirmable.totalCents, 6_800);
  assert.equal(await prisma.stockReservation.count({ where: { shopOrderId: confirmable.id } }), 1);
  assert.equal(confirmable.items.find(({ productId }) => productId === untrackedProduct.id)?.reservation, null);
  passed.push("mixed cart sums shipping and creates no reservation for untracked stock");

  const confirmedAt = new Date(expiryNow.getTime() + 6_000);
  await confirmShopOrderPayment(confirmable.id, confirmedAt);
  await confirmShopOrderPayment(confirmable.id, new Date(confirmedAt.getTime() + 1_000));
  const confirmed = await prisma.shopOrder.findUniqueOrThrow({
    where: { id: confirmable.id },
    include: { items: { include: { reservation: true } }, events: true },
  });
  assert.equal(confirmed.paymentStatus, "PAID");
  assert.equal(confirmed.paidAt?.toISOString(), confirmedAt.toISOString());
  assert.equal(confirmed.items.find(({ productId }) => product.id === productId)?.reservation?.status, "CONFIRMED");
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 0);
  assert.equal(await prisma.productStockAdjustment.count({ where: { productId: product.id, delta: -1 } }), 1);
  assert.equal(confirmed.events.filter(({ type }) => type === "STOCK_CONFIRMED").length, 1);
  await assert.rejects(
    releaseShopOrderReservation(confirmable.id, new Date(confirmedAt.getTime() + 2_000)),
    (error: unknown) => error instanceof ShopServiceError && error.code === "RESERVATION_CONFIRMED",
  );
  assert.equal(await expireShopOrderReservations(new Date(confirmable.reservationExpiresAt.getTime() + 1_000)), 0);
  passed.push("fake internal confirmation is idempotent and sells stock once");

  const noShippingIntent = parseShopOrderIntent({
    items: [{
      productId: untrackedProduct.id,
      quantity: 1,
      observedLockVersion: untrackedProduct.lockVersion,
    }],
    shippingAddress: null,
  });
  const numbered = await Promise.all(members.map((actor, index) =>
    createShopOrder(actor, noShippingIntent, CREATION_TOKENS[index + 6]!, new Date(confirmedAt.getTime() + 3_000))));
  const numbers = numbered.map(({ orderNumber }) => orderNumber);
  assert.equal(new Set(numbers).size, numbered.length);
  assert.ok(numbers.every((value) => /^LNX-SHOP-[0-9]{4}-[0-9]{6,}$/.test(value)));
  assert.ok(numbered.every((order) => !order.shippingRequired && order.shippingFirstName === null));
  passed.push("concurrent sequence numbers are unique; unshipped orders need no address");

  assert.deepEqual(await v1Counts(), {
    ...originalV1Counts, users: originalV1Counts.users + FIXTURE_EMAILS.length,
  });
  passed.push("Shop runtime creates no musical Order, Payment, ProviderEvent or NotificationEvent");
}

async function removeBaselineProofIfPresent() {
  await unlink(MIGRATION_BASELINE_PATH).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function main() {
  const mode = process.argv[2] ?? "runtime";
  assert.ok(mode === "runtime" || mode === BASELINE_MODE, `Use ${BASELINE_MODE} or no argument.`);
  let mutationsAuthorized = false;
  let normalRuntime = false;
  let originalV1Counts: V1Counts | null = null;
  const passed: string[] = [];
  try {
    const runtime = await loadAndAssertShopPhase2QaEnvironment();
    const identity = await assertExactRuntimeDatabase(runtime);
    mutationsAuthorized = true;
    if (mode === BASELINE_MODE) {
      await createMigrationBaseline(runtime, identity);
      return;
    }
    normalRuntime = true;
    originalV1Counts = await assertMigrationParity(runtime, identity);
    passed.push("19→20 migration preserves V1 fixture and all five requested counters");
    await cleanupFixtures();
    await assertNoShopRuntimeFixtures("before runtime");
    await runtimeProof(passed, originalV1Counts);
  } finally {
    if (mutationsAuthorized && normalRuntime) {
      await cleanupFixtures();
      await cleanupV1BaselineFixture();
      await removeBaselineProofIfPresent();
      await assertNoShopRuntimeFixtures("after cleanup");
      if (originalV1Counts) assert.deepEqual(await v1Counts(), originalV1Counts);
    }
  }
  console.info(JSON.stringify({
    event: "shop.order.runtime.completed", outcome: "passed",
    migrations: EXPECTED_MIGRATION_COUNT, checks: passed,
  }));
}

function safeFailureCode(error: unknown) {
  if (error instanceof ShopServiceError || error instanceof ProductServiceError) return error.code;
  return "RUNTIME_ASSERTION_FAILED";
}

main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({
      event: "shop.order.runtime.failed", outcome: "failed", code: safeFailureCode(error),
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      console.error(JSON.stringify({
        event: "shop.order.runtime.disconnect.failed", outcome: "failed",
        code: "DATABASE_DISCONNECT_FAILED",
      }));
      process.exitCode = 1;
    }
  });
