import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { prisma } from "@/lib/prisma";
import {
  markShopOrderPreparing,
  markShopOrderReadyToShip,
  markShopOrderShipped,
  recordShopOrderTracking,
  ShopFulfillmentError,
} from "@/lib/shop/fulfillment-service";
import { getAdminShopOrder, getMemberShopOrder } from "@/lib/shop/order-service";
import {
  assertShopShippingOperationsQaEnabled,
  SHOP_SHIPPING_OPERATIONS_RUNTIME_QA_TARGET,
} from "@/lib/shop/shipping-operations-config";

const MEMBER_EMAIL = "lnx-v110-phase5c-runtime-member@example.invalid";
const OTHER_EMAIL = "lnx-v110-phase5c-runtime-other@example.invalid";
const ADMIN_A_EMAIL = "lnx-v110-phase5c-runtime-admin-a@example.invalid";
const ADMIN_B_EMAIL = "lnx-v110-phase5c-runtime-admin-b@example.invalid";
const ORDER_NUMBER = "LNX-SHOP-2026-590001";
const UNPAID_ORDER_NUMBER = "LNX-SHOP-2026-590002";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function guard() {
  assertShopShippingOperationsQaEnabled();
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, SHOP_SHIPPING_OPERATIONS_RUNTIME_QA_TARGET);
  assert.ok(!process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_ENVIRONMENT_NAME);
  const databaseUrl = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  assert.equal(databaseUrl.hostname, "127.0.0.1");
  assert.notEqual(databaseUrl.port, "5432");
  assert.equal(decodeURIComponent(databaseUrl.pathname), "/template1");

  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as {
    name?: string;
    pid?: number;
    exports?: { database?: { connectionString?: string } };
  };
  assert.equal(proof.name, SHOP_SHIPPING_OPERATIONS_RUNTIME_QA_TARGET);
  const proofUrl = assertSafeLocalPostgresUrl(proof.exports?.database?.connectionString ?? "");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(proofUrl.hostname));
  assert.equal(proofUrl.port, databaseUrl.port);
  assert.ok(Number.isInteger(proof.pid) && Number(proof.pid) > 0);
  process.kill(Number(proof.pid), 0);

  const identity = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
    SELECT current_database() AS database, current_schema() AS schema
  `;
  assert.deepEqual(identity[0], { database: "template1", schema: "public" });

  const root = path.join(process.cwd(), "prisma", "migrations");
  const expected = await Promise.all((await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map(async (name) => ({
      name,
      checksum: digest(await readFile(path.join(root, name, "migration.sql"), "utf8")),
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
  assert.equal(expected.length, 26);
  assert.equal(expected.at(-1)?.name, "20260830220000_shop_shipping_operations");
  assert.ok(applied.every(({ finishedAt, rolledBackAt }) => finishedAt && !rolledBackAt));
  assert.deepEqual(applied.map(({ name, checksum }) => ({ name, checksum })), expected);
  return { migrationCount: expected.length, databasePort: databaseUrl.port, prismaPid: Number(proof.pid) };
}

async function createFixtures() {
  const createdAt = new Date(Date.now() - 30_000);
  const paidAt = new Date(createdAt.getTime() + 1_000);
  const [member, other, adminA, adminB] = await Promise.all([
    prisma.user.create({ data: { email: MEMBER_EMAIL, displayName: "Membre expédition runtime", role: "MEMBER", status: "ACTIVE", emailVerified: true, emailVerifiedAt: createdAt, createdAt } }),
    prisma.user.create({ data: { email: OTHER_EMAIL, displayName: "Autre membre expédition runtime", role: "MEMBER", status: "ACTIVE", emailVerified: true, emailVerifiedAt: createdAt, createdAt } }),
    prisma.user.create({ data: { email: ADMIN_A_EMAIL, displayName: "Admin A expédition runtime", role: "ADMIN", status: "ACTIVE", emailVerified: true, emailVerifiedAt: createdAt, createdAt } }),
    prisma.user.create({ data: { email: ADMIN_B_EMAIL, displayName: "Admin B expédition runtime", role: "ADMIN", status: "ACTIVE", emailVerified: true, emailVerifiedAt: createdAt, createdAt } }),
  ]);
  const product = await prisma.product.create({ data: {
    slug: "lnx-v110-phase5c-runtime-cd", title: "CD QA — Runtime expédition", description: "Produit physique fictif jetable.",
    status: "PUBLISHED", priceCents: 2_500, currency: "EUR", trackInventory: true, stock: 9,
    shippingRequired: true, shippingPriceCents: 800, shippingWeightGrams: 120, publishedAt: createdAt,
    createdByAdminId: adminA.id, updatedByAdminId: adminA.id, createdAt,
  } });
  const rate = await prisma.shippingRateVersion.create({ data: {
    version: "phase5c-runtime-snapshot-v1", status: "ACTIVE", scope: "INTERNAL_QA",
    service: "STANDARD_TRACKED_SIGNATURE", currency: "EUR", countryCode: "FR",
    minimumBillableWeightGrams: 150, packagingWeightGrams: 150, activatedAt: createdAt, createdAt,
    tiers: { create: [{ position: 0, maxWeightGrams: 500, priceCents: 800, createdAt }] },
  } });
  const common = {
    userId: member.id,
    status: "OPEN" as const,
    currency: "EUR",
    subtotalCents: 2_500,
    shippingCents: 800,
    totalCents: 3_300,
    shippingRequired: true,
    shippingFirstName: "Membre",
    shippingLastName: "Expédition Runtime",
    shippingAddressLine1: "5 rue du Test local",
    shippingPostalCode: "75005",
    shippingCity: "Paris",
    shippingCountryCode: "FR",
    shippingRateVersionId: rate.id,
    shippingQuoteVersion: "phase5a-runtime-snapshot-v1",
    shippingMethod: "STANDARD_TRACKED_SIGNATURE",
    shippingWeightGrams: 120,
    shippingPackagingGrams: 150,
    shippingBillableGrams: 270,
    termsVersion: "shop-cgv-phase4c-candidate-v1",
    termsHashSha256: digest("shop-cgv-phase4c-candidate-v1"),
    termsAcceptedAt: createdAt,
    reservationExpiresAt: new Date(createdAt.getTime() + 60 * 60_000),
    createdAt,
  };
  const order = await prisma.shopOrder.create({ data: {
    ...common,
    orderNumber: ORDER_NUMBER,
    creationToken: randomUUID(),
    requestFingerprintSha256: digest(ORDER_NUMBER),
    paymentStatus: "PAID",
    fulfillmentStatus: "PENDING",
    paidAt,
    items: { create: [{
      productId: product.id, position: 0, productTitle: product.title, inventoryTracked: true,
      unitPriceCents: 2_500, quantity: 1, lineTotalCents: 2_500, shippingRequired: true,
      unitShippingCents: 0, lineShippingCents: 0, unitShippingWeightGrams: 120,
      lineShippingWeightGrams: 120, currency: "EUR", createdAt,
    }] },
  } });
  const unpaid = await prisma.shopOrder.create({ data: {
    ...common,
    orderNumber: UNPAID_ORDER_NUMBER,
    creationToken: randomUUID(),
    requestFingerprintSha256: digest(UNPAID_ORDER_NUMBER),
    paymentStatus: "AWAITING_PAYMENT",
    fulfillmentStatus: "PENDING",
    paidAt: null,
    items: { create: [{
      productId: product.id, position: 0, productTitle: product.title, inventoryTracked: true,
      unitPriceCents: 2_500, quantity: 1, lineTotalCents: 2_500, shippingRequired: true,
      unitShippingCents: 0, lineShippingCents: 0, unitShippingWeightGrams: 120,
      lineShippingWeightGrams: 120, currency: "EUR", createdAt,
    }] },
  } });
  await Promise.all([
    prisma.stockReservation.create({ data: { shopOrderId: order.id, productId: product.id, quantity: 1, status: "CONFIRMED", expiresAt: common.reservationExpiresAt, confirmedAt: paidAt, createdAt } }),
    prisma.stockReservation.create({ data: { shopOrderId: unpaid.id, productId: product.id, quantity: 1, status: "ACTIVE", expiresAt: common.reservationExpiresAt, createdAt } }),
  ]);
  const payment = await prisma.payment.create({ data: {
    shopOrderId: order.id, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 3_300,
    currency: "EUR", pricingVersion: "shop-order-snapshot-v1", idempotencyKey: `phase5c-runtime-payment:${order.id}`,
    providerCheckoutId: `cs_test_phase5c_${order.id}`, providerPaymentId: `pi_test_phase5c_${order.id}`,
    paymentMethod: "CARD", paidAt, createdAt,
  } });
  await prisma.invoice.create({ data: {
    invoiceNumber: "LNX-20260830-95001", sequenceNumber: 95_001n, issuedAt: paidAt, documentType: "SHOP",
    operationCategory: "GOODS", shopOrderId: order.id, paymentId: payment.id, orderNumberSnapshot: order.orderNumber,
    customerType: "INDIVIDUAL", customerNameSearch: "Membre Expédition Runtime", customerEmailSearch: MEMBER_EMAIL,
    sellerSnapshot: { name: "LNX Beats QA" }, customerSnapshot: { email: MEMBER_EMAIL },
    lineItemsSnapshot: [{ title: product.title, quantity: 1, unitPriceCents: 2_500 }], currency: "EUR",
    subtotalCents: 2_500, shippingCents: 800, totalCents: 3_300, vatRegime: "FRANCHISE_EN_BASE_TVA",
    vatAmountCents: 0, vatLegalNotice: "TVA non applicable — fixture QA", paymentMethodLabel: "Carte test",
    paidAt, termsVersion: common.termsVersion, termsHashSha256: common.termsHashSha256,
    snapshotHashSha256: digest(`invoice:${order.id}`), createdAt,
  } });
  return { member, other, adminA, adminB, product, order, unpaid, createdAt };
}

async function run() {
  const runtime = await guard();
  const fixture = await createFixtures();
  const passed: string[] = [];

  await assert.rejects(
    () => markShopOrderPreparing(fixture.order.orderNumber, fixture.member.id),
    (error: unknown) => error instanceof ShopFulfillmentError && error.code === "ACTOR_NOT_ADMIN",
  );
  passed.push("MEMBER cannot mutate shipping operations");

  await assert.rejects(
    () => markShopOrderPreparing(fixture.unpaid.orderNumber, fixture.adminA.id),
    (error: unknown) => error instanceof ShopFulfillmentError && error.code === "PAYMENT_REQUIRED",
  );
  passed.push("unpaid ShopOrder cannot enter fulfillment");

  const initial = await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.order.id } });
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } })).stock;
  const invoiceBefore = await prisma.invoice.findUniqueOrThrow({ where: { shopOrderId: fixture.order.id } });
  const reservationBefore = await prisma.stockReservation.findUniqueOrThrow({ where: { shopOrderId_productId: { shopOrderId: fixture.order.id, productId: fixture.product.id } } });

  const preparingAt = new Date(fixture.createdAt.getTime() + 2_000);
  await Promise.all([
    markShopOrderPreparing(fixture.order.orderNumber, fixture.adminA.id, preparingAt),
    markShopOrderPreparing(fixture.order.orderNumber, fixture.adminB.id, preparingAt),
  ]);
  assert.equal(await prisma.shopOrderLifecycleEvent.count({ where: { shopOrderId: fixture.order.id, type: "PREPARATION_STARTED" } }), 1);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.order.id, kind: "CUSTOMER_SHOP_PREPARING" } }), 1);
  passed.push("concurrent preparation replay is exactly once");

  const readyAt = new Date(fixture.createdAt.getTime() + 3_000);
  await markShopOrderReadyToShip(fixture.order.orderNumber, fixture.adminA.id, readyAt);
  assert.equal((await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).fulfillmentStatus, "READY_TO_SHIP");
  assert.equal(await prisma.shopOrderLifecycleEvent.count({ where: { shopOrderId: fixture.order.id, type: "SHIPMENT_READY" } }), 1);
  passed.push("PREPARING transitions atomically to READY_TO_SHIP");

  const firstTracking = { carrier: "Transporteur QA", trackingNumber: "QA-RUNTIME-0001", trackingUrl: null } as const;
  const correctedTracking = { carrier: "Transporteur QA", trackingNumber: "QA-RUNTIME-0001-B", trackingUrl: "https://tracking.example.invalid/QA-RUNTIME-0001-B" } as const;
  const trackingAt = new Date(fixture.createdAt.getTime() + 4_000);
  await Promise.all([
    recordShopOrderTracking(fixture.order.orderNumber, fixture.adminA.id, firstTracking, trackingAt),
    recordShopOrderTracking(fixture.order.orderNumber, fixture.adminB.id, firstTracking, trackingAt),
  ]);
  assert.equal(await prisma.shopOrderLifecycleEvent.count({ where: { shopOrderId: fixture.order.id, type: "TRACKING_RECORDED" } }), 1);
  await recordShopOrderTracking(fixture.order.orderNumber, fixture.adminB.id, correctedTracking, new Date(fixture.createdAt.getTime() + 5_000));
  await recordShopOrderTracking(fixture.order.orderNumber, fixture.adminA.id, correctedTracking, new Date(fixture.createdAt.getTime() + 5_000));
  const tracked = await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.order.id } });
  assert.deepEqual(
    [tracked.trackingSource, tracked.trackingRevision, tracked.shippingCarrier, tracked.trackingNumber, tracked.trackingUrl],
    ["MANUAL", 2, correctedTracking.carrier, correctedTracking.trackingNumber, correctedTracking.trackingUrl],
  );
  assert.equal(await prisma.shopOrderLifecycleEvent.count({ where: { shopOrderId: fixture.order.id, type: "TRACKING_RECORDED" } }), 2);
  passed.push("manual tracking replay is idempotent and corrections remain audited");

  const stockImmediatelyBeforeShipment = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } })).stock;
  const invoiceImmediatelyBeforeShipment = await prisma.invoice.findUniqueOrThrow({ where: { shopOrderId: fixture.order.id } });
  const shippedAt = new Date(fixture.createdAt.getTime() + 6_000);
  const confirmations = await Promise.all([
    markShopOrderShipped(fixture.order.orderNumber, fixture.adminA.id, shippedAt),
    markShopOrderShipped(fixture.order.orderNumber, fixture.adminB.id, shippedAt),
  ]);
  assert.ok(confirmations.every(({ fulfillmentStatus }) => fulfillmentStatus === "SHIPPED"));
  assert.equal(await prisma.shopOrderLifecycleEvent.count({ where: { shopOrderId: fixture.order.id, type: "ORDER_SHIPPED" } }), 1);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.order.id, kind: "CUSTOMER_SHOP_SHIPPED" } }), 1);
  await markShopOrderShipped(fixture.order.orderNumber, fixture.adminA.id, shippedAt);
  assert.equal(await prisma.shopOrderLifecycleEvent.count({ where: { shopOrderId: fixture.order.id, type: "ORDER_SHIPPED" } }), 1);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.order.id, kind: "CUSTOMER_SHOP_SHIPPED" } }), 1);
  passed.push("concurrent shipment and replay produce one event and one notification");

  const final = await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.order.id } });
  const stockAfter = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } })).stock;
  const invoiceAfter = await prisma.invoice.findUniqueOrThrow({ where: { shopOrderId: fixture.order.id } });
  const reservationAfter = await prisma.stockReservation.findUniqueOrThrow({ where: { shopOrderId_productId: { shopOrderId: fixture.order.id, productId: fixture.product.id } } });
  assert.equal(stockBefore, 9);
  assert.equal(stockImmediatelyBeforeShipment, 9);
  assert.equal(stockAfter, 9);
  assert.equal(reservationBefore.status, "CONFIRMED");
  assert.equal(reservationAfter.status, "CONFIRMED");
  assert.equal(invoiceBefore.id, invoiceImmediatelyBeforeShipment.id);
  assert.equal(invoiceBefore.id, invoiceAfter.id);
  assert.equal(invoiceBefore.snapshotHashSha256, invoiceAfter.snapshotHashSha256);
  assert.equal(await prisma.invoice.count({ where: { shopOrderId: fixture.order.id } }), 1);
  assert.equal(await prisma.creditNote.count({ where: { invoiceId: invoiceAfter.id } }), 0);
  passed.push("shipment leaves stock reservation, invoice and credit notes unchanged");

  await prisma.product.update({ where: { id: fixture.product.id }, data: { shippingWeightGrams: 999, shippingPriceCents: 999 } });
  const historical = await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.order.id } });
  assert.deepEqual(
    [historical.shippingCents, historical.shippingQuoteVersion, historical.shippingMethod, historical.shippingWeightGrams, historical.shippingPackagingGrams, historical.shippingBillableGrams],
    [initial.shippingCents, initial.shippingQuoteVersion, initial.shippingMethod, initial.shippingWeightGrams, initial.shippingPackagingGrams, initial.shippingBillableGrams],
  );
  passed.push("later Product changes do not rewrite shipping snapshots");

  const memberView = await getMemberShopOrder(fixture.member.id, fixture.order.orderNumber);
  const otherView = await getMemberShopOrder(fixture.other.id, fixture.order.orderNumber);
  const adminView = await getAdminShopOrder(fixture.order.orderNumber);
  assert.equal(memberView?.fulfillmentStatus, "SHIPPED");
  assert.equal(memberView?.trackingNumber, correctedTracking.trackingNumber);
  assert.equal(otherView, null);
  assert.equal(adminView?.trackingSource, "MANUAL");
  assert.equal(adminView?.lifecycleEvents.filter(({ type }) => type === "TRACKING_RECORDED").length, 2);
  passed.push("MEMBER ownership and ADMIN audit projection are preserved");

  assert.equal(final.fulfillmentStatus, "SHIPPED");
  assert.equal(final.paymentStatus, "PAID");
  assert.equal(final.trackingRevision, 2);
  assert.equal(await prisma.shopReturnRequest.count({ where: { shopOrderId: fixture.order.id } }), 0);
  passed.push("final paid single-shipment state remains separate from after-sales");

  console.info(JSON.stringify({
    event: "shop.shipping-operations.runtime.completed",
    outcome: "passed",
    passed: passed.length,
    failed: 0,
    migrationCount: runtime.migrationCount,
    database: "template1",
    databaseHost: "127.0.0.1",
    databasePort: runtime.databasePort,
    prismaPid: runtime.prismaPid,
    orderNumber: fixture.order.orderNumber,
    stockBefore,
    stockAfter,
    invoiceCount: 1,
    trackingRevision: final.trackingRevision,
    lifecycleEventCount: await prisma.shopOrderLifecycleEvent.count({ where: { shopOrderId: fixture.order.id } }),
    shippedNotificationCount: await prisma.orderNotification.count({ where: { shopOrderId: fixture.order.id, kind: "CUSTOMER_SHOP_SHIPPED" } }),
    scenarios: passed,
  }));
}

run().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "shop.shipping-operations.runtime.failed", outcome: "failed" }));
  if (error instanceof Error) console.error(error.stack ?? error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
