import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { prisma } from "@/lib/prisma";
import { parseShopOrderIntent } from "@/lib/shop/order-domain";
import {
  createShopOrder,
  quoteShopOrderShipping,
} from "@/lib/shop/order-service";
import { createShopPaymentDatabaseRepository } from "@/lib/shop/payment-repository";
import type { ShopPaymentProviderEvent } from "@/lib/shop/payment-types";
import { ensurePhase5AQaShippingRate } from "@/lib/shop/shipping-service";

const QA_TARGET = "lnx-studio-v110-logistics-final-test";
const TECHNICAL_DATABASE = "template1";
const FIXTURE_PREFIX = "lnx-v110-phase5a-runtime";
const EMAILS = [
  `${FIXTURE_PREFIX}-member-a@example.invalid`,
  `${FIXTURE_PREFIX}-member-b@example.invalid`,
] as const;
const PRODUCT_SLUGS = [
  `${FIXTURE_PREFIX}-history`,
  `${FIXTURE_PREFIX}-race`,
] as const;
const RATE_V2 = "phase5a-runtime-v2";
let overlappingTransactionQueryWarning: Error | null = null;
process.on("warning", (warning) => {
  if (warning.message.includes("client.query() when the client is already executing a query")) {
    overlappingTransactionQueryWarning = warning;
  }
});
const ADDRESS = {
  firstName: "Membre",
  lastName: "Logistique QA",
  addressLine1: "5 rue du Test local",
  addressLine2: null,
  postalCode: "75005",
  city: "Paris",
  countryCode: "FR",
} as const;

async function assertGuardedRuntime() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, QA_TARGET);
  assert.equal(process.env.SHOP_ENABLED, "true");
  assert.equal(process.env.SHOP_SHIPPING_ENABLED, "true");
  assert.equal(process.env.SHOP_SHIPPING_QA_CONFIRM, "enable-internal-shop-shipping-qa");
  assert.equal(process.env.EMAIL_PROVIDER, "capture");
  assert.ok(!process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_ENVIRONMENT_NAME);
  for (const key of [
    "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET",
    "RESEND_API_KEY", "MEDIA_S3_ACCESS_KEY_ID", "MEDIA_S3_SECRET_ACCESS_KEY",
  ]) assert.ok(!process.env[key], `${key} is forbidden in the logistics runtime.`);

  const databaseUrl = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  assert.equal(decodeURIComponent(databaseUrl.pathname.slice(1)), TECHNICAL_DATABASE);
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath);
  assert.match(proofPath, /[/\\]prisma-dev-nodejs[/\\]lnx-studio-v110-logistics-final-test[/\\]server\.json$/);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as {
    name?: string;
    pid?: number;
    exports?: { database?: { connectionString?: string } };
  };
  assert.equal(proof.name, QA_TARGET);
  const proofDatabaseUrl = assertSafeLocalPostgresUrl(proof.exports?.database?.connectionString ?? "");
  assert.equal(proofDatabaseUrl.hostname, databaseUrl.hostname);
  assert.equal(proofDatabaseUrl.port, databaseUrl.port);
  assert.ok(Number.isInteger(proof.pid) && Number(proof.pid) > 0);
  process.kill(Number(proof.pid), 0);

  const identity = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
    SELECT current_database() AS database, current_schema() AS schema
  `;
  assert.deepEqual(identity[0], { database: TECHNICAL_DATABASE, schema: "public" });

  const migrationRoot = path.join(process.cwd(), "prisma", "migrations");
  const expected = await Promise.all((await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map(async (name) => ({
      name,
      checksum: createHash("sha256").update(await readFile(path.join(migrationRoot, name, "migration.sql"))).digest("hex"),
    })));
  const applied = await prisma.$queryRaw<Array<{
    name: string;
    checksum: string;
    finishedAt: Date | null;
    rolledBackAt: Date | null;
  }>>`
    SELECT "migration_name" AS name, checksum, "finished_at" AS "finishedAt", "rolled_back_at" AS "rolledBackAt"
    FROM "_prisma_migrations" ORDER BY "migration_name", "started_at"
  `;
  assert.ok(expected.some(({ name }) => name === "20260828220000_shop_shipping_quotes"));
  assert.ok(applied.every(({ finishedAt, rolledBackAt }) => finishedAt !== null && rolledBackAt === null));
  assert.deepEqual(applied.map(({ name, checksum }) => ({ name, checksum })), expected);
  return expected.length;
}

async function fixtureIds() {
  const [users, products, rates, assets] = await Promise.all([
    prisma.user.findMany({ where: { email: { in: [...EMAILS] } }, select: { id: true } }),
    prisma.product.findMany({ where: { slug: { in: [...PRODUCT_SLUGS] } }, select: { id: true } }),
    prisma.shippingRateVersion.findMany({ where: { version: { in: ["phase5a-qa-internal-v1", RATE_V2] } }, select: { id: true } }),
    prisma.asset.findMany({ where: { filename: { startsWith: FIXTURE_PREFIX } }, select: { id: true } }),
  ]);
  const userIds = users.map(({ id }) => id);
  const orders = userIds.length
    ? await prisma.shopOrder.findMany({ where: { userId: { in: userIds } }, select: { id: true } })
    : [];
  return {
    userIds,
    productIds: products.map(({ id }) => id),
    orderIds: orders.map(({ id }) => id),
    rateIds: rates.map(({ id }) => id),
    assetIds: assets.map(({ id }) => id),
  };
}

async function setup() {
  const now = new Date();
  const users = await Promise.all(EMAILS.map((email, index) => prisma.user.create({
    data: {
      email,
      displayName: `Membre logistique ${index + 1}`,
      role: "MEMBER",
      status: "ACTIVE",
      emailVerified: true,
      emailVerifiedAt: now,
    },
  })));
  async function product(slug: string, title: string, weight: number, stock: number) {
    const asset = await prisma.asset.create({ data: {
      type: "IMAGE",
      storageKey: `shop/runtime/${slug}.webp`,
      storageBackend: "LOCAL",
      storageProvider: "local",
      visibility: "PUBLIC",
      filename: `${FIXTURE_PREFIX}-${slug}.webp`,
      mimeType: "image/webp",
      sizeBytes: 1n,
      width: 1,
      height: 1,
      alt: `Visuel fictif ${title}`,
      rightsStatus: "CLEARED",
      confidence: "CONFIRMED",
    } });
    return prisma.product.create({ data: {
      slug,
      title,
      description: "Fixture PostgreSQL jetable Phase 5A.",
      status: "PUBLISHED",
      priceCents: 2_000,
      currency: "EUR",
      trackInventory: true,
      stock,
      shippingRequired: true,
      shippingPriceCents: 999,
      shippingWeightGrams: weight,
      publishedAt: now,
      assets: { create: { assetId: asset.id, position: 0 } },
    } });
  }
  return {
    users,
    history: await product(PRODUCT_SLUGS[0], "Produit historique logistique", 100, 4),
    race: await product(PRODUCT_SLUGS[1], "Dernier exemplaire logistique", 200, 1),
  };
}

async function createQuotedOrder(userId: string, product: { id: string; lockVersion: number }, quantity = 1) {
  const actor = { id: userId, role: "MEMBER" as const };
  const base = parseShopOrderIntent({
    items: [{ productId: product.id, quantity, observedLockVersion: product.lockVersion }],
    shippingAddress: ADDRESS,
    shippingQuoteVersion: null,
  });
  const quote = await quoteShopOrderShipping(actor, base);
  const intent = parseShopOrderIntent({ ...base, shippingQuoteVersion: quote.shippingQuoteVersion });
  const order = await createShopOrder(actor, intent, randomUUID());
  await prisma.shopOrderEvent.updateMany({
    where: { shopOrderId: order.id, type: "SHOP_ORDER_CREATED" },
    data: { metadata: { source: FIXTURE_PREFIX, shippingQuoteVersion: quote.shippingQuoteVersion } },
  });
  return { order, quote };
}

async function assertUsedShippingRateIsImmutable(shippingRateVersionId: string) {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString);
  const isolatedClient = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await assert.rejects(
      () => isolatedClient.shippingRateTier.updateMany({
        where: { shippingRateVersionId },
        data: { priceCents: 401 },
      }),
      (error: unknown) => error !== null,
    );
  } finally {
    // A PostgreSQL trigger rejection can leave the adapter connection that
    // received it unusable. This client exists only for that negative proof.
    await isolatedClient.$disconnect();
  }
}

async function confirmSyntheticPayment(order: Awaited<ReturnType<typeof createShopOrder>>) {
  const repository = createShopPaymentDatabaseRepository(prisma, "TEST");
  const attempt = await repository.reserveAttempt(order.userId, order.orderNumber, "STRIPE", "TEST", true);
  const checkoutId = `cs_phase5a_${attempt.paymentId}`;
  await repository.recordSession(attempt.paymentId, "STRIPE", { id: checkoutId, url: "http://127.0.0.1:31760/fake" });
  const event: ShopPaymentProviderEvent = {
    eventId: `${FIXTURE_PREFIX}:payment:${attempt.paymentId}`,
    type: "checkout.session.completed",
    provider: "STRIPE",
    livemode: false,
    paymentId: attempt.paymentId,
    providerCheckoutId: checkoutId,
    providerPaymentId: `pi_phase5a_${attempt.paymentId}`,
    amountCents: order.totalCents,
    currency: "EUR",
    status: "SUCCEEDED",
    occurredAt: new Date(),
    paymentMethod: "CARD",
  };
  const first = await repository.reconcile(event);
  const replay = await repository.reconcile(event);
  assert.equal(first.shopOrderPaid, true);
  assert.equal(replay.duplicate, true);
}

async function run() {
  const migrationCount = await assertGuardedRuntime();
  try {
    assert.deepEqual(
      await fixtureIds(),
      { userIds: [], productIds: [], orderIds: [], rateIds: [], assetIds: [] },
      "The disposable Phase 5A database must start empty for this runtime.",
    );
    const proofs: string[] = [];
    const fixture = await setup();
    const v1 = await ensurePhase5AQaShippingRate();
    const first = await createQuotedOrder(fixture.users[0]!.id, fixture.history);
    assert.equal(first.quote.shippingCents, 400);
    assert.equal(first.order.shippingCents, 400);
    assert.equal(first.order.totalCents, 2_400);
    assert.equal(first.order.shippingQuoteVersion, v1.version);
    assert.equal(first.order.items[0]?.unitShippingCents, 0);
    assert.equal(first.order.items[0]?.lineShippingCents, 0);
    assert.equal(first.order.items[0]?.unitShippingWeightGrams, 100);
    proofs.push("first server quote snapshots 150 g minimum and never adds the legacy 999 cents");

    await assertUsedShippingRateIsImmutable(v1.id);
    await prisma.product.update({ where: { id: fixture.history.id }, data: {
      priceCents: 3_000,
      shippingWeightGrams: 300,
      lockVersion: { increment: 1 },
    } });
    await prisma.shippingRateVersion.update({ where: { id: v1.id }, data: { status: "RETIRED", retiredAt: new Date() } });
    await prisma.shippingRateVersion.create({ data: {
      version: RATE_V2,
      status: "ACTIVE",
      scope: "INTERNAL_QA",
      service: "STANDARD_TRACKED_SIGNATURE",
      currency: "EUR",
      countryCode: "FR",
      minimumBillableWeightGrams: 150,
      packagingWeightGrams: 0,
      activatedAt: new Date(),
      tiers: { create: [
        { position: 0, maxWeightGrams: 250, priceCents: 500 },
        { position: 1, maxWeightGrams: 500, priceCents: 700 },
        { position: 2, maxWeightGrams: 30_000, priceCents: 2_100 },
      ] },
    } });
    const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: fixture.history.id } });
    const second = await createQuotedOrder(fixture.users[0]!.id, updatedProduct);
    assert.equal(second.quote.shippingCents, 700);
    assert.equal(second.order.totalCents, 3_700);
    const immutableFirst = await prisma.shopOrder.findUniqueOrThrow({ where: { id: first.order.id } });
    assert.deepEqual({
      subtotal: immutableFirst.subtotalCents,
      shipping: immutableFirst.shippingCents,
      total: immutableFirst.totalCents,
      version: immutableFirst.shippingQuoteVersion,
      weight: immutableFirst.shippingWeightGrams,
    }, { subtotal: 2_000, shipping: 400, total: 2_400, version: v1.version, weight: 100 });
    proofs.push("V2 and product edits leave the V1 ShopOrder snapshot unchanged");

    await confirmSyntheticPayment(first.order);
    const [paid, reservation, invoice, notifications, adjustments] = await Promise.all([
      prisma.shopOrder.findUniqueOrThrow({ where: { id: first.order.id } }),
      prisma.stockReservation.findFirstOrThrow({ where: { shopOrderId: first.order.id } }),
      prisma.invoice.findFirstOrThrow({ where: { shopOrderId: first.order.id } }),
      prisma.orderNotification.count({ where: { shopOrderId: first.order.id } }),
      prisma.productStockAdjustment.count({ where: { productId: fixture.history.id } }),
    ]);
    assert.equal(paid.paymentStatus, "PAID");
    assert.equal(reservation.status, "CONFIRMED");
    assert.deepEqual({ subtotal: invoice.subtotalCents, shipping: invoice.shippingCents, total: invoice.totalCents }, {
      subtotal: 2_000, shipping: 400, total: 2_400,
    });
    assert.equal(notifications, 2);
    assert.equal(adjustments, 1);
    proofs.push("synthetic confirmation and replay produce one stock adjustment, one invoice and two captured notifications");

    const raceProduct = await prisma.product.findUniqueOrThrow({ where: { id: fixture.race.id } });
    const results = await Promise.allSettled([
      createQuotedOrder(fixture.users[0]!.id, raceProduct),
      createQuotedOrder(fixture.users[1]!.id, raceProduct),
    ]);
    assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(await prisma.stockReservation.count({ where: { productId: raceProduct.id, status: "ACTIVE" } }), 1);
    proofs.push("concurrent checkout of the final item creates exactly one active reservation");

    assert.equal(
      overlappingTransactionQueryWarning,
      null,
      "The Phase 5A runtime must not overlap queries on one transactional PostgreSQL client.",
    );

    console.info(JSON.stringify({
      event: "shop.logistics.runtime.completed",
      outcome: "passed",
      migrations: migrationCount,
      checks: proofs,
    }));
  } finally {
    // Invoices are deliberately immutable at PostgreSQL level. Keep the
    // complete proof set in this disposable instance and remove the instance
    // as one unit after QA instead of weakening document immutability.
    await prisma.$disconnect();
  }
}

run().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "shop.logistics.runtime.failed", outcome: "failed", code: "RUNTIME_ASSERTION_FAILED" }));
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
});
