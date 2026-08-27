import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIRECTORY = path.join(process.cwd(), "prisma", "migrations");
const NOTIFICATION_ENUM_MIGRATION = "20260821120000_transactional_notifications";
const SHOP_MIGRATION = "20260827180000_shop_commerce_foundation";

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
  assert.equal(migrationDirectories.length, 20);
  assert.equal(migrationDirectories.at(-1), SHOP_MIGRATION);
  const sql = await readFile(path.join(MIGRATIONS_DIRECTORY, SHOP_MIGRATION, "migration.sql"), "utf8");
  assert.doesNotMatch(sql, /\bDROP\b/i);
  assert.doesNotMatch(sql, /ALTER\s+TABLE\s+"(?:orders|payments|provider_events)"/i);
  for (const table of ["shop_orders", "shop_order_items", "stock_reservations", "shop_order_events"]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
  }
});

test("fresh migrations enforce ShopOrder totals, address and reservation lifecycle", async () => {
  const { database, migrationDirectories } = await migratedDatabase();
  try {
    assert.equal(migrationDirectories.length, 20);
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
