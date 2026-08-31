import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { prisma } from "@/lib/prisma";
import { markShopOrderShipped, recordShopOrderTracking } from "@/lib/shop/fulfillment-service";
import { getAdminShopOrder, getMemberShopOrder } from "@/lib/shop/order-service";
import {
  createShopShippingProviderAttempt,
  reconcileShopShippingProviderAttempt,
  ShopShippingProviderError,
} from "@/lib/shop/shipping-provider-service";
import {
  assertShopShippingProviderQaEnabled,
  SHOP_SHIPPING_PROVIDER_RUNTIME_QA_TARGET,
} from "@/lib/shop/shipping-provider-config";

const ORDER_NUMBERS = {
  success: "LNX-SHOP-2026-591001",
  pending: "LNX-SHOP-2026-591002",
  failed: "LNX-SHOP-2026-591003",
  ambiguous: "LNX-SHOP-2026-591004",
  manual: "LNX-SHOP-2026-591005",
  shippedRace: "LNX-SHOP-2026-591006",
} as const;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function guard() {
  assertShopShippingProviderQaEnabled();
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, SHOP_SHIPPING_PROVIDER_RUNTIME_QA_TARGET);
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
  assert.equal(proof.name, SHOP_SHIPPING_PROVIDER_RUNTIME_QA_TARGET);
  const proofUrl = assertSafeLocalPostgresUrl(proof.exports?.database?.connectionString ?? "");
  assert.equal(proofUrl.port, databaseUrl.port);
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
    .map(async (name) => ({ name, checksum: digest(await readFile(path.join(root, name, "migration.sql"), "utf8")) })));
  const applied = await prisma.$queryRaw<Array<{ name: string; checksum: string; finishedAt: Date | null; rolledBackAt: Date | null }>>`
    SELECT "migration_name" AS name, checksum, "finished_at" AS "finishedAt", "rolled_back_at" AS "rolledBackAt"
    FROM "_prisma_migrations" ORDER BY "migration_name", "started_at"
  `;
  assert.equal(expected.length, 27);
  assert.equal(expected.at(-1)?.name, "20260831200000_shop_shipping_provider_foundation");
  assert.ok(applied.every(({ finishedAt, rolledBackAt }) => finishedAt && !rolledBackAt));
  assert.deepEqual(applied.map(({ name, checksum }) => ({ name, checksum })), expected);
  return { migrationCount: expected.length, databasePort: databaseUrl.port, prismaPid: Number(proof.pid) };
}

async function createFixtures() {
  const createdAt = new Date(Date.now() - 60_000);
  const paidAt = new Date(createdAt.getTime() + 1_000);
  const preparingAt = new Date(createdAt.getTime() + 2_000);
  const readyToShipAt = new Date(createdAt.getTime() + 3_000);
  const [member, adminA, adminB] = await Promise.all([
    prisma.user.create({ data: { email: "lnx-v110-phase5d-runtime-member@example.invalid", displayName: "Membre provider runtime", role: "MEMBER", status: "ACTIVE", emailVerified: true, emailVerifiedAt: createdAt, createdAt } }),
    prisma.user.create({ data: { email: "lnx-v110-phase5d-runtime-admin-a@example.invalid", displayName: "Admin A provider runtime", role: "ADMIN", status: "ACTIVE", emailVerified: true, emailVerifiedAt: createdAt, createdAt } }),
    prisma.user.create({ data: { email: "lnx-v110-phase5d-runtime-admin-b@example.invalid", displayName: "Admin B provider runtime", role: "ADMIN", status: "ACTIVE", emailVerified: true, emailVerifiedAt: createdAt, createdAt } }),
  ]);
  const product = await prisma.product.create({ data: {
    slug: "lnx-v110-phase5d-runtime-cd", title: "CD QA — Runtime provider", description: "Produit physique fictif jetable Phase 5D.",
    status: "PUBLISHED", priceCents: 2_500, currency: "EUR", trackInventory: true, stock: 30,
    shippingRequired: true, shippingPriceCents: 800, shippingWeightGrams: 120, publishedAt: createdAt,
    createdByAdminId: adminA.id, updatedByAdminId: adminA.id, createdAt,
  } });
  const rate = await prisma.shippingRateVersion.create({ data: {
    version: "phase5d-runtime-snapshot-v1", status: "ACTIVE", scope: "INTERNAL_QA",
    service: "STANDARD_TRACKED_SIGNATURE", currency: "EUR", countryCode: "FR",
    minimumBillableWeightGrams: 150, packagingWeightGrams: 150, activatedAt: createdAt, createdAt,
    tiers: { create: [{ position: 0, maxWeightGrams: 500, priceCents: 800, createdAt }] },
  } });
  let sequence = 99_100n;
  async function createReadyOrder(orderNumber: string) {
    const order = await prisma.shopOrder.create({ data: {
      orderNumber, userId: member.id, creationToken: randomUUID(), requestFingerprintSha256: digest(orderNumber),
      status: "OPEN", paymentStatus: "PAID", fulfillmentStatus: "READY_TO_SHIP", currency: "EUR",
      subtotalCents: 2_500, shippingCents: 800, totalCents: 3_300, shippingRequired: true,
      shippingFirstName: "Membre", shippingLastName: "Provider Runtime", shippingAddressLine1: "5 rue du Test local",
      shippingPostalCode: "75005", shippingCity: "Paris", shippingCountryCode: "FR", shippingRateVersionId: rate.id,
      shippingQuoteVersion: "phase5d-runtime-snapshot-v1", shippingMethod: "STANDARD_TRACKED_SIGNATURE",
      shippingWeightGrams: 120, shippingPackagingGrams: 150, shippingBillableGrams: 270,
      termsVersion: "shop-cgv-phase4c-candidate-v1", termsHashSha256: digest("shop-cgv-phase4c-candidate-v1"), termsAcceptedAt: createdAt,
      reservationExpiresAt: new Date(createdAt.getTime() + 60 * 60_000), paidAt, preparingAt, readyToShipAt, createdAt,
      items: { create: [{ productId: product.id, position: 0, productTitle: product.title, inventoryTracked: true,
        unitPriceCents: 2_500, quantity: 1, lineTotalCents: 2_500, shippingRequired: true, unitShippingCents: 0,
        lineShippingCents: 0, unitShippingWeightGrams: 120, lineShippingWeightGrams: 120, currency: "EUR", createdAt }] },
    } });
    await prisma.stockReservation.create({ data: {
      shopOrderId: order.id, productId: product.id, quantity: 1, status: "CONFIRMED",
      expiresAt: order.reservationExpiresAt, confirmedAt: paidAt, createdAt,
    } });
    const payment = await prisma.payment.create({ data: {
      shopOrderId: order.id, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 3_300,
      currency: "EUR", pricingVersion: "shop-order-snapshot-v1", idempotencyKey: `phase5d-runtime-payment:${order.id}`,
      providerCheckoutId: `cs_test_phase5d_${order.id}`, providerPaymentId: `pi_test_phase5d_${order.id}`,
      paymentMethod: "CARD", paidAt, createdAt,
    } });
    sequence += 1n;
    await prisma.invoice.create({ data: {
      invoiceNumber: `LNX-20260831-${sequence}`, sequenceNumber: sequence, issuedAt: paidAt, documentType: "SHOP",
      operationCategory: "GOODS", shopOrderId: order.id, paymentId: payment.id, orderNumberSnapshot: order.orderNumber,
      customerType: "INDIVIDUAL", customerNameSearch: "Membre Provider Runtime", customerEmailSearch: member.email,
      sellerSnapshot: { name: "LNX Beats QA" }, customerSnapshot: { email: member.email },
      lineItemsSnapshot: [{ title: product.title, quantity: 1, unitPriceCents: 2_500 }], currency: "EUR",
      subtotalCents: 2_500, shippingCents: 800, totalCents: 3_300, vatRegime: "FRANCHISE_EN_BASE_TVA",
      vatAmountCents: 0, vatLegalNotice: "TVA non applicable — fixture QA", paymentMethodLabel: "Carte test", paidAt,
      termsVersion: "shop-cgv-phase4c-candidate-v1", termsHashSha256: digest("shop-cgv-phase4c-candidate-v1"),
      snapshotHashSha256: digest(`invoice:${order.id}`), createdAt,
    } });
    return order;
  }
  const orders = {
    success: await createReadyOrder(ORDER_NUMBERS.success),
    pending: await createReadyOrder(ORDER_NUMBERS.pending),
    failed: await createReadyOrder(ORDER_NUMBERS.failed),
    ambiguous: await createReadyOrder(ORDER_NUMBERS.ambiguous),
    manual: await createReadyOrder(ORDER_NUMBERS.manual),
    shippedRace: await createReadyOrder(ORDER_NUMBERS.shippedRace),
  };
  return { member, adminA, adminB, product, orders, createdAt };
}

async function run() {
  const runtime = await guard();
  const fixture = await createFixtures();
  const passed: string[] = [];
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } })).stock;
  const invoiceCountBefore = await prisma.invoice.count({ where: { shopOrderId: { in: Object.values(fixture.orders).map(({ id }) => id) } } });
  const creditCountBefore = await prisma.creditNote.count();
  const returnCountBefore = await prisma.shopReturnRequest.count();

  await assert.rejects(
    () => createShopShippingProviderAttempt(ORDER_NUMBERS.success, fixture.member.id, "SUCCEEDED"),
    (error: unknown) => error instanceof ShopShippingProviderError && error.code === "ACTOR_NOT_ADMIN",
  );
  passed.push("MEMBER cannot invoke the shipping provider");

  await Promise.all([
    createShopShippingProviderAttempt(ORDER_NUMBERS.success, fixture.adminA.id, "SUCCEEDED"),
    createShopShippingProviderAttempt(ORDER_NUMBERS.success, fixture.adminB.id, "SUCCEEDED"),
  ]);
  await createShopShippingProviderAttempt(ORDER_NUMBERS.success, fixture.adminA.id, "SUCCEEDED");
  const successOrder = await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.orders.success.id } });
  assert.deepEqual([successOrder.fulfillmentStatus, successOrder.trackingSource, successOrder.trackingRevision], ["READY_TO_SHIP", "PROVIDER", 1]);
  assert.equal(await prisma.shopShippingProviderAttempt.count({ where: { shopOrderId: successOrder.id } }), 1);
  assert.equal((await prisma.shopShippingProviderAttempt.findFirstOrThrow({ where: { shopOrderId: successOrder.id } })).status, "SUCCEEDED");
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: successOrder.id, kind: "CUSTOMER_SHOP_SHIPPED" } }), 0);
  passed.push("concurrent create and replay yield one SUCCEEDED intent without SHIPPED");

  const pending = await createShopShippingProviderAttempt(ORDER_NUMBERS.pending, fixture.adminA.id, "PENDING");
  assert.equal(pending.status, "PENDING");
  assert.equal((await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.orders.pending.id } })).trackingNumber, null);
  await Promise.all([
    reconcileShopShippingProviderAttempt(ORDER_NUMBERS.pending, pending.id, fixture.adminA.id),
    reconcileShopShippingProviderAttempt(ORDER_NUMBERS.pending, pending.id, fixture.adminB.id),
  ]);
  await reconcileShopShippingProviderAttempt(ORDER_NUMBERS.pending, pending.id, fixture.adminA.id);
  const reconciled = await prisma.shopShippingProviderAttempt.findUniqueOrThrow({ where: { id: pending.id } });
  assert.deepEqual([reconciled.status, reconciled.reconciliationCount], ["SUCCEEDED", 1]);
  assert.equal((await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.orders.pending.id } })).trackingSource, "PROVIDER");
  passed.push("PENDING reconciles once to SUCCEEDED with replay-safe provider tracking");

  const failed = await createShopShippingProviderAttempt(ORDER_NUMBERS.failed, fixture.adminA.id, "FAILED");
  assert.deepEqual([failed.status, failed.trackingNumber], ["FAILED", null]);
  assert.equal((await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.orders.failed.id } })).trackingNumber, null);
  await createShopShippingProviderAttempt(ORDER_NUMBERS.failed, fixture.adminB.id, "FAILED");
  assert.equal(await prisma.shopShippingProviderAttempt.count({ where: { shopOrderId: fixture.orders.failed.id } }), 1);
  passed.push("FAILED is terminal with no tracking and no blind retry");

  const ambiguous = await createShopShippingProviderAttempt(ORDER_NUMBERS.ambiguous, fixture.adminA.id, "AMBIGUOUS");
  assert.deepEqual([ambiguous.status, ambiguous.errorCode], ["REQUIRES_REVIEW", "AMBIGUOUS_PROVIDER_ACCEPTANCE"]);
  await reconcileShopShippingProviderAttempt(ORDER_NUMBERS.ambiguous, ambiguous.id, fixture.adminB.id);
  const ambiguousAfter = await prisma.shopShippingProviderAttempt.findUniqueOrThrow({ where: { id: ambiguous.id } });
  assert.deepEqual([ambiguousAfter.status, ambiguousAfter.reconciliationCount], ["REQUIRES_REVIEW", 0]);
  assert.equal((await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.orders.ambiguous.id } })).trackingNumber, null);
  passed.push("AMBIGUOUS fails closed to REQUIRES_REVIEW without automatic reconciliation");

  const manualTracking = { carrier: "Transporteur manuel QA", trackingNumber: "MANUAL-QA-591005", trackingUrl: "https://example.invalid/manual/MANUAL-QA-591005" } as const;
  await recordShopOrderTracking(ORDER_NUMBERS.manual, fixture.adminA.id, manualTracking, new Date(fixture.createdAt.getTime() + 4_000));
  const conflict = await createShopShippingProviderAttempt(ORDER_NUMBERS.manual, fixture.adminB.id, "SUCCEEDED");
  const manualOrder = await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.orders.manual.id } });
  assert.deepEqual([conflict.status, conflict.errorCode], ["REQUIRES_REVIEW", "MANUAL_TRACKING_CONFLICT"]);
  assert.deepEqual([manualOrder.trackingSource, manualOrder.trackingNumber, manualOrder.trackingRevision], ["MANUAL", manualTracking.trackingNumber, 1]);
  passed.push("manual tracking remains authoritative and provider conflict requires review");

  for (const order of Object.values(fixture.orders)) {
    const current = await prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(current.fulfillmentStatus, "READY_TO_SHIP");
    assert.equal(current.paymentStatus, "PAID");
  }
  assert.equal(await prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } }).then(({ stock }) => stock), stockBefore);
  assert.equal(await prisma.invoice.count({ where: { shopOrderId: { in: Object.values(fixture.orders).map(({ id }) => id) } } }), invoiceCountBefore);
  assert.equal(await prisma.creditNote.count(), creditCountBefore);
  assert.equal(await prisma.shopReturnRequest.count(), returnCountBefore);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: { in: Object.values(fixture.orders).map(({ id }) => id) }, kind: "CUSTOMER_SHOP_SHIPPED" } }), 0);
  passed.push("provider operations leave physical status, stock, billing, notifications and SAV unchanged");

  const memberView = await getMemberShopOrder(fixture.member.id, ORDER_NUMBERS.success);
  const adminView = await getAdminShopOrder(ORDER_NUMBERS.success);
  assert.ok(memberView && !("shippingProviderAttempts" in memberView));
  assert.equal(memberView.trackingSource, "PROVIDER");
  assert.equal(adminView?.shippingProviderAttempts.length, 1);
  passed.push("MEMBER projection hides provider internals while ADMIN retains the audit ledger");

  const shippedRaceKey = `shop-order:${fixture.orders.shippedRace.id}:shipping-provider:1:v1`;
  const shippedRaceAttempt = await prisma.shopShippingProviderAttempt.create({ data: {
    shopOrderId: fixture.orders.shippedRace.id,
    provider: "FAKE_LOCAL",
    scenario: "SUCCEEDED",
    status: "REQUESTED",
    attemptNumber: 1,
    idempotencyKey: shippedRaceKey,
    createdByUserId: fixture.adminA.id,
    requestedAt: new Date(fixture.createdAt.getTime() + 4_000),
  } });
  const shippedRaceTracking = {
    carrier: "Transporteur manuel QA",
    trackingNumber: "MANUAL-QA-591006",
    trackingUrl: "https://example.invalid/manual/MANUAL-QA-591006",
  } as const;
  await recordShopOrderTracking(ORDER_NUMBERS.shippedRace, fixture.adminA.id, shippedRaceTracking, new Date(fixture.createdAt.getTime() + 5_000));
  await markShopOrderShipped(ORDER_NUMBERS.shippedRace, fixture.adminA.id, new Date(fixture.createdAt.getTime() + 6_000));
  const shippedRaceResult = await reconcileShopShippingProviderAttempt(
    ORDER_NUMBERS.shippedRace,
    shippedRaceAttempt.id,
    fixture.adminB.id,
    new Date(fixture.createdAt.getTime() + 7_000),
  );
  const shippedRaceOrder = await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.orders.shippedRace.id } });
  assert.deepEqual([shippedRaceResult.status, shippedRaceResult.errorCode], ["REQUIRES_REVIEW", "ORDER_ALREADY_SHIPPED"]);
  assert.deepEqual(
    [shippedRaceOrder.fulfillmentStatus, shippedRaceOrder.trackingSource, shippedRaceOrder.trackingNumber],
    ["SHIPPED", "MANUAL", shippedRaceTracking.trackingNumber],
  );
  assert.equal(await prisma.shopShippingProviderAttempt.count({ where: { shopOrderId: fixture.orders.shippedRace.id } }), 1);
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: fixture.orders.shippedRace.id, kind: "CUSTOMER_SHOP_SHIPPED" } }), 1);
  const shippedRaceReplay = await createShopShippingProviderAttempt(ORDER_NUMBERS.shippedRace, fixture.adminA.id, "SUCCEEDED");
  assert.deepEqual([shippedRaceReplay.id, shippedRaceReplay.status], [shippedRaceAttempt.id, "REQUIRES_REVIEW"]);
  await reconcileShopShippingProviderAttempt(ORDER_NUMBERS.shippedRace, shippedRaceAttempt.id, fixture.adminA.id);
  assert.equal((await prisma.shopShippingProviderAttempt.findUniqueOrThrow({ where: { id: shippedRaceAttempt.id } })).reconciliationCount, 1);
  passed.push("physical SHIPPED race preserves one provider ledger result for review without replacing manual tracking");

  await markShopOrderShipped(ORDER_NUMBERS.success, fixture.adminA.id, new Date(fixture.createdAt.getTime() + 5_000));
  await markShopOrderShipped(ORDER_NUMBERS.success, fixture.adminB.id, new Date(fixture.createdAt.getTime() + 5_000));
  const shipped = await prisma.shopOrder.findUniqueOrThrow({ where: { id: fixture.orders.success.id } });
  assert.equal(shipped.fulfillmentStatus, "SHIPPED");
  assert.equal(await prisma.orderNotification.count({ where: { shopOrderId: shipped.id, kind: "CUSTOMER_SHOP_SHIPPED" } }), 1);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } })).stock, stockBefore);
  passed.push("only the distinct Phase 5C physical confirmation marks SHIPPED exactly once");

  console.info(JSON.stringify({
    event: "shop.shipping-provider.runtime.completed",
    outcome: "passed",
    passed: passed.length,
    failed: 0,
    migrationCount: runtime.migrationCount,
    database: "template1",
    databaseHost: "127.0.0.1",
    databasePort: runtime.databasePort,
    prismaPid: runtime.prismaPid,
    stockBefore,
    stockAfter: (await prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } })).stock,
    invoiceCountBefore,
    invoiceCountAfter: await prisma.invoice.count({ where: { shopOrderId: { in: Object.values(fixture.orders).map(({ id }) => id) } } }),
    creditCountBefore,
    creditCountAfter: await prisma.creditNote.count(),
    returnCountBefore,
    returnCountAfter: await prisma.shopReturnRequest.count(),
    scenarios: passed,
  }));
}

run().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "shop.shipping-provider.runtime.failed", outcome: "failed" }));
  if (error instanceof Error) console.error(error.stack ?? error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
