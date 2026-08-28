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

test("Shop payments are the twenty-first migration and preserve existing ledgers", async () => {
  const migrationDirectories = await directories();
  assert.equal(migrationDirectories.length, 22);
  assert.equal(migrationDirectories.at(-2), SHOP_PAYMENT_MIGRATION);
  assert.equal(migrationDirectories.at(-1), LEGAL_COMPLIANCE_MIGRATION);
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

test("fresh migrations enforce ShopOrder totals, address and reservation lifecycle", async () => {
  const { database, migrationDirectories } = await migratedDatabase();
  try {
    assert.equal(migrationDirectories.length, 22);
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
    assert.equal(migrationDirectories.length, 22);
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
