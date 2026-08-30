import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIRECTORY = path.join(process.cwd(), "prisma", "migrations");
const NOTIFICATION_ENUM_MIGRATION = "20260821120000_transactional_notifications";
const SHOP_MIGRATION = "20260827180000_shop_commerce_foundation";
const SHOP_PAYMENT_MIGRATION = "20260827220000_shop_payment_fulfillment_foundation";
const LEGAL_COMPLIANCE_MIGRATION = "20260828120000_legal_compliance_foundation";
const INVOICING_MIGRATION = "20260828180000_invoicing_foundation";
const SHIPPING_MIGRATION = "20260828220000_shop_shipping_quotes";
const AFTER_SALES_MIGRATION = "20260830120000_shop_after_sales_foundation";
const SHIPPING_OPERATIONS_MIGRATION = "20260830220000_shop_shipping_operations";

async function directories() {
  return (await readdir(MIGRATIONS_DIRECTORY, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function apply(database: PGlite, directory: string) {
  const sql = await readFile(path.join(MIGRATIONS_DIRECTORY, directory, "migration.sql"), "utf8");
  if (directory !== NOTIFICATION_ENUM_MIGRATION) {
    await database.exec(sql);
    return;
  }
  const marker = 'CREATE TYPE "NotificationProvider"';
  const offset = sql.indexOf(marker);
  assert.notEqual(offset, -1);
  for (const statement of sql.slice(0, offset).match(/ALTER TYPE[\s\S]*?;/g) ?? []) {
    await database.exec(statement);
  }
  await database.exec(sql.slice(offset));
}

async function migratedDatabase() {
  const database = new PGlite();
  const migrationDirectories = await directories();
  for (const directory of migrationDirectories) await apply(database, directory);
  return { database, migrationDirectories };
}

test("Shop commerce is the twentieth additive migration and contains no destructive SQL", async () => {
  const migrationDirectories = await directories();
  assert.equal(migrationDirectories[19], SHOP_MIGRATION);
  const sql = await readFile(path.join(MIGRATIONS_DIRECTORY, SHOP_MIGRATION, "migration.sql"), "utf8");
  assert.doesNotMatch(sql, /\bDROP\b/i);
  assert.doesNotMatch(sql, /ALTER\s+TABLE\s+"(?:orders|payments|provider_events)"/i);
  for (const table of ["shop_orders", "shop_order_items", "stock_reservations", "shop_order_events"]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
  }
});

test("Shop payments and its dependent additive migrations preserve their ordering and existing ledgers", async () => {
  const migrationDirectories = await directories();
  assert.ok(migrationDirectories.includes(SHOP_PAYMENT_MIGRATION));
  assert.ok(migrationDirectories.indexOf(SHOP_PAYMENT_MIGRATION) < migrationDirectories.indexOf(LEGAL_COMPLIANCE_MIGRATION));
  assert.ok(migrationDirectories.indexOf(LEGAL_COMPLIANCE_MIGRATION) < migrationDirectories.indexOf(INVOICING_MIGRATION));
  assert.ok(migrationDirectories.indexOf(INVOICING_MIGRATION) < migrationDirectories.indexOf(SHIPPING_MIGRATION));
  const sql = await readFile(
    path.join(MIGRATIONS_DIRECTORY, SHOP_PAYMENT_MIGRATION, "migration.sql"),
    "utf8",
  );
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT|INDEX)\b/i);
  assert.doesNotMatch(sql, /(?:^|\n)\s*(?:TRUNCATE|DELETE\s+FROM|UPDATE\s+")/i);
  assert.match(sql, /ALTER COLUMN "orderId" DROP NOT NULL/);
  assert.match(sql, /CONSTRAINT "payments_parent_xor"/);
  assert.match(sql, /CONSTRAINT "order_notifications_parent_xor"/);
  assert.match(sql, /payments_one_succeeded_per_shop_order_idx/);
  assert.match(sql, /CREATE TABLE "shop_order_lifecycle_events"/);
});

test("Phase 5A shipping migration is additive, preserves legacy nulls and freezes used rate definitions", async () => {
  const { database, migrationDirectories } = await migratedDatabase();
  try {
    assert.ok(migrationDirectories.indexOf(SHIPPING_MIGRATION) < migrationDirectories.indexOf(AFTER_SALES_MIGRATION));
    const sql = await readFile(path.join(MIGRATIONS_DIRECTORY, SHIPPING_MIGRATION, "migration.sql"), "utf8");
    assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

    await database.exec(`
      INSERT INTO "users" ("id", "email", "displayName", "role", "status", "emailVerified", "createdAt", "updatedAt")
      VALUES ('15000000-0000-4000-8000-000000000001', 'shipping-migration@example.invalid', 'Shipping migration', 'MEMBER', 'ACTIVE', true, now(), now());
      INSERT INTO "products" (
        "id", "slug", "title", "description", "status", "priceCents", "currency",
        "trackInventory", "stock", "shippingRequired", "shippingPriceCents", "shippingWeightGrams", "publishedAt", "createdAt", "updatedAt"
      ) VALUES (
        '25000000-0000-4000-8000-000000000001', 'shipping-migration-product', 'Produit logistique',
        'Produit fictif Phase 5A.', 'PUBLISHED', 2000, 'EUR', true, 2, true, 999, 100, now(), now(), now()
      );
      INSERT INTO "shipping_rate_versions" (
        "id", "version", "status", "scope", "service", "currency", "countryCode",
        "minimumBillableWeightGrams", "packagingWeightGrams", "activatedAt", "createdAt", "updatedAt"
      ) VALUES (
        '35000000-0000-4000-8000-000000000001', 'phase5a-migration-v1', 'ACTIVE', 'INTERNAL_QA',
        'STANDARD_TRACKED_SIGNATURE', 'EUR', 'FR', 150, 0, now(), now(), now()
      );
      INSERT INTO "shipping_rate_tiers" (
        "id", "shippingRateVersionId", "position", "maxWeightGrams", "priceCents", "createdAt"
      ) VALUES (
        '45000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001', 0, 250, 400, now()
      );
      INSERT INTO "shop_orders" (
        "id", "orderNumber", "userId", "creationToken", "requestFingerprintSha256",
        "subtotalCents", "shippingCents", "totalCents", "shippingRequired",
        "shippingFirstName", "shippingLastName", "shippingAddressLine1", "shippingPostalCode", "shippingCity", "shippingCountryCode",
        "shippingRateVersionId", "shippingQuoteVersion", "shippingMethod", "shippingWeightGrams",
        "shippingPackagingGrams", "shippingBillableGrams", "reservationExpiresAt", "createdAt", "updatedAt"
      ) VALUES (
        '55000000-0000-4000-8000-000000000001', 'LNX-SHOP-2026-500001',
        '15000000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', repeat('5', 64),
        2000, 400, 2400, true, 'QA', 'Shipping', '1 rue locale', '75001', 'Paris', 'FR',
        '35000000-0000-4000-8000-000000000001', 'phase5a-migration-v1', 'STANDARD_TRACKED_SIGNATURE',
        100, 0, 150, now() + interval '30 minutes', now(), now()
      );
      INSERT INTO "shop_order_items" (
        "shopOrderId", "productId", "position", "productTitle", "inventoryTracked", "unitPriceCents",
        "quantity", "lineTotalCents", "shippingRequired", "unitShippingCents", "lineShippingCents",
        "unitShippingWeightGrams", "lineShippingWeightGrams", "currency", "createdAt"
      ) VALUES (
        '55000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001', 0,
        'Produit logistique', true, 2000, 1, 2000, true, 0, 0, 100, 100, 'EUR', now()
      );
    `);

    const snapshot = (await database.query<{
      shippingCents: number;
      totalCents: number;
      shippingQuoteVersion: string;
      shippingBillableGrams: number;
    }>(`
      SELECT "shippingCents", "totalCents", "shippingQuoteVersion", "shippingBillableGrams"
      FROM "shop_orders" WHERE "id" = '55000000-0000-4000-8000-000000000001'
    `)).rows[0]!;
    assert.deepEqual(snapshot, {
      shippingCents: 400,
      totalCents: 2400,
      shippingQuoteVersion: "phase5a-migration-v1",
      shippingBillableGrams: 150,
    });
    await assert.rejects(
      database.exec(`UPDATE "shipping_rate_tiers" SET "priceCents" = 401 WHERE "id" = '45000000-0000-4000-8000-000000000001'`),
      (error: unknown) => (error as { code?: string }).code === "23514",
    );
    await assert.rejects(
      database.exec(`UPDATE "shipping_rate_versions" SET "packagingWeightGrams" = 1, "updatedAt" = now() WHERE "id" = '35000000-0000-4000-8000-000000000001'`),
      (error: unknown) => (error as { code?: string }).code === "23514",
    );
    await database.exec(`UPDATE "shipping_rate_versions" SET "status" = 'RETIRED', "retiredAt" = now(), "updatedAt" = now() WHERE "id" = '35000000-0000-4000-8000-000000000001'`);
    assert.equal((await database.query<{ status: string }>(`SELECT "status" FROM "shipping_rate_versions" WHERE "id" = '35000000-0000-4000-8000-000000000001'`)).rows[0]?.status, "RETIRED");
  } finally {
    await database.close();
  }
});

test("Phase 5B after-sales migration is additive and separates refund from restock", async () => {
  const migrationDirectories = await directories();
  assert.ok(migrationDirectories.indexOf(AFTER_SALES_MIGRATION) < migrationDirectories.indexOf(SHIPPING_OPERATIONS_MIGRATION));
  const sql = await readFile(path.join(MIGRATIONS_DIRECTORY, AFTER_SALES_MIGRATION, "migration.sql"), "utf8");
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
  for (const table of ["shop_return_requests", "shop_return_items", "shop_return_audit_events"]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.match(sql, /shop_return_items_quantities_bounded/);
  assert.match(sql, /enforce_shop_return_item_limits/);
  assert.match(sql, /shopReturnRequestId/);
  assert.match(sql, /product_stock_adjustments_idempotencyKey_key/);
});

test("Phase 5C shipping operations migration is additive and preserves legacy shipment snapshots", async () => {
  const migrationDirectories = await directories();
  assert.equal(migrationDirectories.at(-1), SHIPPING_OPERATIONS_MIGRATION);
  const sql = await readFile(path.join(MIGRATIONS_DIRECTORY, SHIPPING_OPERATIONS_MIGRATION, "migration.sql"), "utf8");
  assert.doesNotMatch(sql, /\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO)\b/i);
  assert.match(sql, /READY_TO_SHIP/);
  assert.match(sql, /CREATE TYPE "ShopTrackingSource" AS ENUM \('MANUAL', 'PROVIDER'\)/);
  assert.match(sql, /"trackingRevision" INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /Compatibility for ShopOrders shipped before Phase 5C/);
  assert.match(sql, /SHIPMENT_READY/);
  assert.match(sql, /TRACKING_RECORDED/);
});

test("the 20 to 21 migration preserves Phase 2 Product, ShopOrder and NotificationEvent rows", async () => {
  const database = new PGlite();
  try {
    const migrationDirectories = await directories();
    const shopPaymentMigrationIndex = migrationDirectories.indexOf(SHOP_PAYMENT_MIGRATION);
    assert.equal(shopPaymentMigrationIndex, 20);
    for (const directory of migrationDirectories.slice(0, shopPaymentMigrationIndex)) await apply(database, directory);

    await database.exec(`
      INSERT INTO "users" (
        "id", "email", "displayName", "role", "status", "emailVerified", "emailVerifiedAt", "createdAt", "updatedAt"
      ) VALUES (
        '12000000-0000-4000-8000-000000000001', 'shop-preservation@example.invalid',
        'Shop preservation', 'MEMBER', 'ACTIVE', true,
        '2026-08-27T18:00:00.000Z', '2026-08-27T18:00:00.000Z', '2026-08-27T18:00:00.000Z'
      );
      INSERT INTO "products" (
        "id", "slug", "title", "description", "status", "priceCents", "currency",
        "trackInventory", "stock", "shippingRequired", "shippingPriceCents", "position",
        "publishedAt", "createdAt", "updatedAt"
      ) VALUES (
        '22000000-0000-4000-8000-000000000001', 'shop-preservation-product',
        'Produit préservé', 'Fixture Phase 2 préservée par la migration Phase 3.',
        'PUBLISHED', 2500, 'EUR', true, 7, false, 0, 1,
        '2026-08-27T18:00:00.000Z', '2026-08-27T18:00:00.000Z', '2026-08-27T18:00:00.000Z'
      );
      INSERT INTO "shop_orders" (
        "id", "orderNumber", "userId", "creationToken", "requestFingerprintSha256",
        "subtotalCents", "shippingCents", "totalCents", "shippingRequired",
        "reservationExpiresAt", "createdAt", "updatedAt"
      ) VALUES (
        '32000000-0000-4000-8000-000000000001', 'LNX-SHOP-2026-200001',
        '12000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
        repeat('b', 64), 2500, 0, 2500, false,
        '2026-08-27T18:30:00.000Z', '2026-08-27T18:00:00.000Z', '2026-08-27T18:00:00.000Z'
      );
      INSERT INTO "orders" (
        "id", "orderNumber", "customerEmail", "customerName", "status", "title", "brief",
        "coverIncluded", "priorityProcessing", "basePriceCents", "coverPriceCents",
        "priorityPriceCents", "totalCents", "currency", "pricingVersion",
        "personalUseTermsVersion", "personalUseTermsHashSha256", "personalUseTermsAcceptedAt",
        "illustrationFormat", "createdAt", "updatedAt"
      ) VALUES (
        '72000000-0000-4000-8000-000000000001', 'LNX-2026-920001',
        'notification-preservation@example.invalid', 'Notification preservation',
        'PAYMENT_CONFIRMED', 'Commande musique préservée', 'Fixture NotificationEvent.',
        false, false, 2000, 0, 0, 2000, 'EUR', '2026-08-v2',
        'personal-use-v1', repeat('c', 64), '2026-08-27T18:00:00.000Z',
        NULL, '2026-08-27T18:00:00.000Z', '2026-08-27T18:00:00.000Z'
      );
      INSERT INTO "order_notifications" (
        "id", "orderId", "kind", "channel", "recipient", "idempotencyKey", "createdAt", "updatedAt"
      ) VALUES (
        '92000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001',
        'CUSTOMER_PAYMENT_CONFIRMED', 'EMAIL', 'notification-preservation@example.invalid',
        'migration:notification:preservation:v110',
        '2026-08-27T18:00:00.000Z', '2026-08-27T18:00:00.000Z'
      );
      INSERT INTO "notification_events" (
        "id", "notificationId", "providerEventId", "providerMessageId", "providerEventType",
        "outcome", "occurredAt", "createdAt"
      ) VALUES (
        '93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001',
        'notification-event-preservation-v110', 'capture-preservation-v110', 'email.delivered',
        'PROCESSED', '2026-08-27T18:01:00.000Z', '2026-08-27T18:01:00.000Z'
      );
    `);

    const before = {
      product: (await database.query<{ snapshot: Record<string, unknown> }>(
        'SELECT to_jsonb(p) AS snapshot FROM "products" p WHERE "id" = \'22000000-0000-4000-8000-000000000001\'',
      )).rows[0]!.snapshot,
      shopOrder: (await database.query<{ snapshot: Record<string, unknown> }>(
        'SELECT to_jsonb(o) AS snapshot FROM "shop_orders" o WHERE "id" = \'32000000-0000-4000-8000-000000000001\'',
      )).rows[0]!.snapshot,
      notificationEvent: (await database.query<{ snapshot: Record<string, unknown> }>(
        'SELECT to_jsonb(e) AS snapshot FROM "notification_events" e WHERE "id" = \'93000000-0000-4000-8000-000000000001\'',
      )).rows[0]!.snapshot,
    };

    await apply(database, SHOP_PAYMENT_MIGRATION);

    const product = (await database.query<{ snapshot: Record<string, unknown> }>(
      'SELECT to_jsonb(p) AS snapshot FROM "products" p WHERE "id" = \'22000000-0000-4000-8000-000000000001\'',
    )).rows[0]!.snapshot;
    const notificationEvent = (await database.query<{ snapshot: Record<string, unknown> }>(
      'SELECT to_jsonb(e) AS snapshot FROM "notification_events" e WHERE "id" = \'93000000-0000-4000-8000-000000000001\'',
    )).rows[0]!.snapshot;
    const shopOrderAfter = (await database.query<{ snapshot: Record<string, unknown> }>(
      'SELECT to_jsonb(o) AS snapshot FROM "shop_orders" o WHERE "id" = \'32000000-0000-4000-8000-000000000001\'',
    )).rows[0]!.snapshot;
    const additiveShopFields = [
      "termsVersion", "termsHashSha256", "termsAcceptedAt", "paymentReviewAt", "paymentReviewCode",
      "preparingAt", "shippedAt", "shippingCarrier", "trackingNumber", "trackingUrl",
    ] as const;
    for (const field of additiveShopFields) {
      assert.equal(shopOrderAfter[field], null, `${field} must be null on a historical ShopOrder`);
      delete shopOrderAfter[field];
    }

    assert.deepEqual(product, before.product, "the Product snapshot must remain byte-for-byte equivalent");
    assert.deepEqual(shopOrderAfter, before.shopOrder, "the existing ShopOrder fields must remain unchanged");
    assert.deepEqual(notificationEvent, before.notificationEvent, "the NotificationEvent receipt must remain unchanged");
  } finally {
    await database.close();
  }
});

test("the additive invoicing migration preserves existing Order, Payment, ProviderEvent, Notification and ShopOrder rows", async () => {
  const database = new PGlite();
  try {
    const migrationDirectories = await directories();
    const invoicingIndex = migrationDirectories.indexOf(INVOICING_MIGRATION);
    assert.equal(invoicingIndex, 22);
    for (const directory of migrationDirectories.slice(0, invoicingIndex)) await apply(database, directory);
    await database.exec(`
      INSERT INTO "users" ("id", "email", "emailVerified", "displayName", "role", "status", "createdAt", "updatedAt")
      VALUES ('14000000-0000-4000-8000-000000000001', 'billing-preservation@example.invalid', true, 'Billing preservation', 'MEMBER', 'ACTIVE', now(), now());
      INSERT INTO "orders" ("id", "orderNumber", "userId", "customerEmail", "customerName", "status", "brief", "basePriceCents", "totalCents", "currency", "createdAt", "updatedAt")
      VALUES ('24000000-0000-4000-8000-000000000001', 'LNX-2099-940001', '14000000-0000-4000-8000-000000000001', 'billing-preservation@example.invalid', 'Billing preservation', 'PAYMENT_CONFIRMED', 'Fixture historique.', 2000, 2000, 'EUR', now(), now());
      INSERT INTO "payments" ("id", "orderId", "provider", "mode", "status", "amountCents", "currency", "pricingVersion", "idempotencyKey", "providerCheckoutId", "paidAt", "createdAt", "updatedAt")
      VALUES ('34000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001', 'STRIPE', 'TEST', 'SUCCEEDED', 2000, 'EUR', 'historical', 'billing-preservation-payment', 'cs-billing-preservation', now(), now(), now());
      INSERT INTO "provider_events" ("id", "provider", "providerEventId", "type", "livemode", "objectId", "outcome", "paymentId", "processedAt", "createdAt")
      VALUES ('44000000-0000-4000-8000-000000000001', 'STRIPE', 'evt-billing-preservation', 'checkout.session.completed', false, 'cs-billing-preservation', 'PROCESSED', '34000000-0000-4000-8000-000000000001', now(), now());
      INSERT INTO "order_notifications" ("id", "orderId", "kind", "channel", "recipient", "idempotencyKey", "createdAt", "updatedAt")
      VALUES ('54000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001', 'CUSTOMER_PAYMENT_CONFIRMED', 'EMAIL', 'billing-preservation@example.invalid', 'billing-preservation-notification', now(), now());
      INSERT INTO "shop_orders" ("id", "orderNumber", "userId", "creationToken", "requestFingerprintSha256", "subtotalCents", "shippingCents", "totalCents", "shippingRequired", "termsVersion", "termsHashSha256", "termsAcceptedAt", "reservationExpiresAt", "createdAt", "updatedAt")
      VALUES ('64000000-0000-4000-8000-000000000001', 'LNX-SHOP-2099-940001', '14000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', repeat('9', 64), 3000, 0, 3000, false, 'shop-cgv-phase3-qa-v1', repeat('8', 64), now(), now() + interval '30 minutes', now(), now());
    `);
    const tableIds = {
      orders: "24000000-0000-4000-8000-000000000001",
      payments: "34000000-0000-4000-8000-000000000001",
      provider_events: "44000000-0000-4000-8000-000000000001",
      order_notifications: "54000000-0000-4000-8000-000000000001",
      shop_orders: "64000000-0000-4000-8000-000000000001",
    } as const;
    const before = Object.fromEntries(await Promise.all(Object.entries(tableIds).map(async ([table, id]) => [
      table,
      (await database.query<{ snapshot: Record<string, unknown> }>(`SELECT to_jsonb(row) AS snapshot FROM "${table}" row WHERE "id" = '${id}'`)).rows[0]!.snapshot,
    ])));
    await apply(database, INVOICING_MIGRATION);
    for (const [table, id] of Object.entries(tableIds)) {
      const after = (await database.query<{ snapshot: Record<string, unknown> }>(`SELECT to_jsonb(row) AS snapshot FROM "${table}" row WHERE "id" = '${id}'`)).rows[0]!.snapshot;
      assert.deepEqual(after, before[table], `${table} must remain byte-for-byte equivalent`);
    }
    assert.equal((await database.query<{ count: number }>('SELECT count(*)::int AS count FROM "invoices"')).rows[0]?.count, 0);
    assert.equal((await database.query<{ count: number }>('SELECT count(*)::int AS count FROM "credit_notes"')).rows[0]?.count, 0);
  } finally {
    await database.close();
  }
});

test("fresh migrations enforce ShopOrder totals, address and reservation lifecycle", async () => {
  const { database, migrationDirectories } = await migratedDatabase();
  try {
    assert.ok(migrationDirectories.includes(SHIPPING_MIGRATION));
    const tables = await database.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('shop_orders', 'shop_order_items', 'stock_reservations', 'shop_order_events')
      ORDER BY table_name
    `);
    assert.deepEqual(tables.rows.map(({ table_name }) => table_name), [
      "shop_order_events",
      "shop_order_items",
      "shop_orders",
      "stock_reservations",
    ]);

    await database.exec(`
      INSERT INTO "users" (
        "id", "email", "displayName", "role", "status", "emailVerified", "emailVerifiedAt", "createdAt", "updatedAt"
      ) VALUES (
        '10000000-0000-4000-8000-000000000001', 'shop-migration@example.invalid', 'Shop migration',
        'MEMBER', 'ACTIVE', true, now(), now(), now()
      );
      INSERT INTO "products" (
        "id", "slug", "title", "description", "status", "priceCents", "currency",
        "trackInventory", "stock", "shippingRequired", "shippingPriceCents", "position",
        "publishedAt", "lockVersion", "createdAt", "updatedAt"
      ) VALUES (
        '20000000-0000-4000-8000-000000000001', 'shop-migration-product', 'Produit migration',
        'Produit fictif de migration Boutique.', 'PUBLISHED', 2000, 'EUR', true, 1, true, 500,
        0, now(), 1, now(), now()
      );
      INSERT INTO "shop_orders" (
        "id", "orderNumber", "userId", "creationToken", "requestFingerprintSha256",
        "subtotalCents", "shippingCents", "totalCents", "shippingRequired",
        "shippingFirstName", "shippingLastName", "shippingAddressLine1", "shippingPostalCode",
        "shippingCity", "shippingCountryCode", "reservationExpiresAt", "createdAt", "updatedAt"
      ) VALUES (
        '30000000-0000-4000-8000-000000000001', 'LNX-SHOP-2026-000001',
        '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
        repeat('a', 64), 2000, 500, 2500, true, 'Camille', 'Test', '1 rue Locale', '75001',
        'Paris', 'FR', now() + interval '30 minutes', now(), now()
      );
      INSERT INTO "shop_order_items" (
        "shopOrderId", "productId", "position", "productTitle", "inventoryTracked",
        "unitPriceCents", "quantity", "lineTotalCents", "shippingRequired",
        "unitShippingCents", "lineShippingCents", "currency", "createdAt"
      ) VALUES (
        '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
        0, 'Produit migration', true, 2000, 1, 2000, true, 500, 500, 'EUR', now()
      );
      INSERT INTO "stock_reservations" (
        "id", "shopOrderId", "productId", "quantity", "status", "expiresAt", "createdAt", "updatedAt"
      ) VALUES (
        '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001', 1, 'ACTIVE', now() + interval '30 minutes', now(), now()
      );
    `);

    await assert.rejects(
      database.exec(`
        INSERT INTO "shop_orders" (
          "id", "orderNumber", "userId", "creationToken", "requestFingerprintSha256",
          "subtotalCents", "shippingCents", "totalCents", "shippingRequired",
          "reservationExpiresAt", "createdAt", "updatedAt"
        ) VALUES (
          '30000000-0000-4000-8000-000000000002', 'LNX-SHOP-2026-000002',
          '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002',
          repeat('b', 64), 2000, 500, 1, false, now() + interval '30 minutes', now(), now()
        )
      `),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "23514");
        return true;
      },
    );
    await assert.rejects(
      database.exec(`
        UPDATE "stock_reservations"
        SET "status" = 'EXPIRED', "expiredAt" = now(), "releasedAt" = now(), "updatedAt" = now()
        WHERE "id" = '50000000-0000-4000-8000-000000000001'
      `),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "23514");
        return true;
      },
    );
    await database.exec(`
      UPDATE "stock_reservations"
      SET "status" = 'EXPIRED', "expiredAt" = "expiresAt", "updatedAt" = "expiresAt"
      WHERE "id" = '50000000-0000-4000-8000-000000000001'
    `);
    const reservation = await database.query<{ status: string; releasedAt: Date | null; expiredAt: Date | null }>(`
      SELECT "status", "releasedAt", "expiredAt" FROM "stock_reservations"
      WHERE "id" = '50000000-0000-4000-8000-000000000001'
    `);
    assert.equal(reservation.rows[0]?.status, "EXPIRED");
    assert.equal(reservation.rows[0]?.releasedAt, null);
    assert.ok(reservation.rows[0]?.expiredAt);
  } finally {
    await database.close();
  }
});

test("Phase 3 enforces Shop payment parents, winner, terms and lifecycle audit", async () => {
  const { database, migrationDirectories } = await migratedDatabase();
  try {
    assert.ok(migrationDirectories.includes(SHIPPING_MIGRATION));
    await database.exec(`
      INSERT INTO "users" (
        "id", "email", "displayName", "role", "status", "emailVerified", "emailVerifiedAt", "createdAt", "updatedAt"
      ) VALUES (
        '11000000-0000-4000-8000-000000000001', 'shop-phase3@example.invalid', 'Shop Phase 3',
        'MEMBER', 'ACTIVE', true, now(), now(), now()
      );
      INSERT INTO "shop_orders" (
        "id", "orderNumber", "userId", "creationToken", "requestFingerprintSha256",
        "subtotalCents", "shippingCents", "totalCents", "shippingRequired",
        "reservationExpiresAt", "createdAt", "updatedAt"
      ) VALUES
      (
        '31000000-0000-4000-8000-000000000001', 'LNX-SHOP-2026-100001',
        '11000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
        repeat('c', 64), 2000, 0, 2000, false, now() + interval '30 minutes', now(), now()
      ),
      (
        '31000000-0000-4000-8000-000000000002', 'LNX-SHOP-2026-100002',
        '11000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002',
        repeat('d', 64), 2000, 0, 2000, false, now() + interval '30 minutes', now(), now()
      );
    `);

    await assert.rejects(
      database.exec(`
        INSERT INTO "payments" (
          "id", "provider", "mode", "status", "amountCents", "currency", "pricingVersion",
          "idempotencyKey", "createdAt", "updatedAt"
        ) VALUES (
          '61000000-0000-4000-8000-000000000001', 'STRIPE', 'TEST', 'CREATED', 2000,
          'EUR', 'shop-snapshot-v1', 'shop-payment:no-parent', now(), now()
        )
      `),
      (error: unknown) => (error as { code?: string }).code === "23514",
    );
    await assert.rejects(
      database.exec(`
        INSERT INTO "payments" (
          "id", "orderId", "shopOrderId", "provider", "mode", "status", "amountCents", "currency",
          "pricingVersion", "idempotencyKey", "createdAt", "updatedAt"
        ) VALUES (
          '61000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001',
          '31000000-0000-4000-8000-000000000001', 'STRIPE', 'TEST', 'CREATED', 2000,
          'EUR', 'shop-snapshot-v1', 'shop-payment:two-parents', now(), now()
        )
      `),
      (error: unknown) => (error as { code?: string }).code === "23514",
    );

    await database.exec(`
      INSERT INTO "payments" (
        "id", "shopOrderId", "provider", "mode", "status", "amountCents", "currency",
        "pricingVersion", "idempotencyKey", "paidAt", "createdAt", "updatedAt"
      ) VALUES (
        '61000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000001',
        'STRIPE', 'TEST', 'SUCCEEDED', 2000, 'EUR', 'shop-snapshot-v1',
        'shop-payment:winner', now(), now(), now()
      )
    `);
    await assert.rejects(
      database.exec(`
        INSERT INTO "payments" (
          "id", "shopOrderId", "provider", "mode", "status", "amountCents", "currency",
          "pricingVersion", "idempotencyKey", "paidAt", "createdAt", "updatedAt"
        ) VALUES (
          '61000000-0000-4000-8000-000000000004', '31000000-0000-4000-8000-000000000001',
          'PAYPAL', 'TEST', 'SUCCEEDED', 2000, 'EUR', 'shop-snapshot-v1',
          'shop-payment:loser', now(), now(), now()
        )
      `),
      (error: unknown) => (error as { code?: string }).code === "23505",
    );

    await assert.rejects(
      database.exec(`
        UPDATE "shop_orders"
        SET "termsVersion" = 'shop-cgv-phase3-qa-v1', "updatedAt" = now()
        WHERE "id" = '31000000-0000-4000-8000-000000000001'
      `),
      (error: unknown) => (error as { code?: string }).code === "23514",
    );
    await database.exec(`
      UPDATE "shop_orders"
      SET "termsVersion" = 'shop-cgv-phase3-qa-v1',
          "termsHashSha256" = repeat('e', 64),
          "termsAcceptedAt" = now(),
          "paymentStatus" = 'PAID',
          "paidAt" = now(),
          "fulfillmentStatus" = 'PREPARING',
          "preparingAt" = now(),
          "updatedAt" = now()
      WHERE "id" = '31000000-0000-4000-8000-000000000001'
    `);
    await assert.rejects(
      database.exec(`
        UPDATE "shop_orders"
        SET "fulfillmentStatus" = 'SHIPPED', "shippedAt" = now(),
            "trackingUrl" = 'http://insecure.example.invalid/track', "updatedAt" = now()
        WHERE "id" = '31000000-0000-4000-8000-000000000001'
      `),
      (error: unknown) => (error as { code?: string }).code === "23514",
    );
    await assert.rejects(
      database.exec(`
        UPDATE "shop_orders"
        SET "paymentReviewAt" = now(), "updatedAt" = now()
        WHERE "id" = '31000000-0000-4000-8000-000000000002'
      `),
      (error: unknown) => (error as { code?: string }).code === "23514",
    );

    await database.exec(`
      INSERT INTO "shop_order_lifecycle_events" (
        "id", "shopOrderId", "paymentId", "type", "idempotencyKey", "metadata", "occurredAt"
      ) VALUES (
        '81000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000003', 'SHOP_PAYMENT_CONFIRMED',
        'shop-order:100001:payment-confirmed', '{}', now()
      );
      INSERT INTO "shop_order_lifecycle_events" (
        "id", "shopOrderId", "type", "idempotencyKey", "metadata", "occurredAt"
      ) VALUES (
        '81000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001',
        'SHOP_TERMS_ACCEPTED', 'shop-order:100001:terms:phase3-qa-v1', '{}', now()
      )
    `);
    await assert.rejects(
      database.exec(`
        INSERT INTO "shop_order_lifecycle_events" (
          "id", "shopOrderId", "paymentId", "type", "idempotencyKey", "metadata", "occurredAt"
        ) VALUES (
          '81000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000002',
          '61000000-0000-4000-8000-000000000003', 'SHOP_PAYMENT_CONFIRMED',
          'shop-order:100002:mismatched-payment', '{}', now()
        )
      `),
      (error: unknown) => (error as { code?: string }).code === "23503",
    );
    await assert.rejects(
      database.exec(`
        INSERT INTO "shop_order_lifecycle_events" (
          "id", "shopOrderId", "type", "idempotencyKey", "metadata", "occurredAt"
        ) VALUES (
          '81000000-0000-4000-8000-000000000004', '31000000-0000-4000-8000-000000000001',
          'SHOP_TERMS_ACCEPTED', 'shop-order:100001:terms:phase3-qa-v1', '{}', now()
        )
      `),
      (error: unknown) => (error as { code?: string }).code === "23505",
    );

    await database.exec(`
      INSERT INTO "order_notifications" (
        "id", "shopOrderId", "kind", "channel", "priority", "recipient", "idempotencyKey",
        "resourceType", "resourceId", "resourceReference", "deploymentEnvironment", "createdAt", "updatedAt"
      ) VALUES (
        '91000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
        'OWNER_SHOP_ORDER_PAID', 'EMAIL', 'CRITICAL', 'owner@example.invalid',
        'shop-order:100001:owner-paid:email', 'SHOP_ORDER',
        '31000000-0000-4000-8000-000000000001', 'LNX-SHOP-2026-100001',
        'development', now(), now()
      )
    `);
    await assert.rejects(
      database.exec(`
        INSERT INTO "order_notifications" (
          "id", "kind", "channel", "idempotencyKey", "resourceType", "createdAt", "updatedAt"
        ) VALUES (
          '91000000-0000-4000-8000-000000000002', 'CUSTOMER_SHOP_PAYMENT_CONFIRMED',
          'EMAIL', 'shop-order:no-parent', 'SHOP_ORDER', now(), now()
        )
      `),
      (error: unknown) => (error as { code?: string }).code === "23514",
    );
  } finally {
    await database.close();
  }
});
