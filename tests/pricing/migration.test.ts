import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { orderPricingVersions } from "../../data/order-offer";

const MIGRATIONS_DIRECTORY = path.join(process.cwd(), "prisma", "migrations");
const NOTIFICATION_ENUM_MIGRATION = "20260821120000_transactional_notifications";
const PRICING_MIGRATION = "20260827120000_shop_pricing_foundation";
const SHOP_COMMERCE_MIGRATION = "20260827180000_shop_commerce_foundation";
const SHOP_PAYMENT_MIGRATION = "20260827220000_shop_payment_fulfillment_foundation";
const LEGAL_COMPLIANCE_MIGRATION = "20260828120000_legal_compliance_foundation";
const INVOICING_MIGRATION = "20260828180000_invoicing_foundation";
const SHIPPING_MIGRATION = "20260828220000_shop_shipping_quotes";
const AFTER_SALES_MIGRATION = "20260830120000_shop_after_sales_foundation";
const SHIPPING_OPERATIONS_MIGRATION = "20260830220000_shop_shipping_operations";
const SHIPPING_PROVIDER_MIGRATION = "20260831200000_shop_shipping_provider_foundation";

async function applyMigration(database: PGlite, directory: string, sql: string) {
  if (directory !== NOTIFICATION_ENUM_MIGRATION) {
    await database.exec(sql);
    return;
  }

  // PGlite executes one multi-statement string atomically. PostgreSQL requires
  // ALTER TYPE ... ADD VALUE to commit before a new enum value is used later
  // in this historical migration, so reproduce Prisma's statement boundaries.
  const remainingSqlMarker = 'CREATE TYPE "NotificationProvider"';
  const remainingSqlOffset = sql.indexOf(remainingSqlMarker);
  assert.notEqual(remainingSqlOffset, -1, "notification enum migration marker is missing");

  const enumStatements = sql
    .slice(0, remainingSqlOffset)
    .match(/ALTER TYPE[\s\S]*?;/g) ?? [];
  assert.equal(enumStatements.length, 10, "notification enum migration statement count changed");
  for (const statement of enumStatements) await database.exec(statement);
  await database.exec(sql.slice(remainingSqlOffset));
}

async function readMigrationDirectories() {
  return (await readdir(MIGRATIONS_DIRECTORY, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function applyMigrationDirectory(database: PGlite, directory: string) {
  const sql = await readFile(path.join(MIGRATIONS_DIRECTORY, directory, "migration.sql"), "utf8");
  await applyMigration(database, directory, sql);
}

async function applyAllMigrations(database: PGlite) {
  const directories = await readMigrationDirectories();
  assert.ok(directories.includes(PRICING_MIGRATION), "V1.1.0 pricing migration is missing");
  assert.ok(directories.includes(SHOP_COMMERCE_MIGRATION), "V1.1.0 Shop commerce migration is missing");
  assert.ok(directories.includes(SHOP_PAYMENT_MIGRATION), "V1.1.0 Shop payment migration is missing");
  assert.ok(directories.includes(LEGAL_COMPLIANCE_MIGRATION), "V1.1.0 legal compliance migration is missing");
  assert.ok(directories.includes(INVOICING_MIGRATION), "V1.1.0 invoicing migration is missing");

  for (const directory of directories) {
    await applyMigrationDirectory(database, directory);
  }

  return directories;
}

async function readProtectedCommerceSnapshot(database: PGlite) {
  const orders = await database.query<{ snapshot: unknown }>(`
    SELECT to_jsonb(protected_order) AS "snapshot"
    FROM (SELECT * FROM "orders" ORDER BY "id") AS protected_order
  `);
  const payments = await database.query<{ snapshot: unknown }>(`
    SELECT to_jsonb(protected_payment) AS "snapshot"
    FROM (SELECT * FROM "payments" ORDER BY "id") AS protected_payment
  `);
  const providerEvents = await database.query<{ snapshot: unknown }>(`
    SELECT to_jsonb(protected_event) AS "snapshot"
    FROM (SELECT * FROM "provider_events" ORDER BY "id") AS protected_event
  `);
  const counts = await database.query<{
    orders: number;
    payments: number;
    providerEvents: number;
  }>(`
    SELECT
      (SELECT count(*)::int FROM "orders") AS "orders",
      (SELECT count(*)::int FROM "payments") AS "payments",
      (SELECT count(*)::int FROM "provider_events") AS "providerEvents"
  `);

  return {
    counts: counts.rows[0],
    orders: orders.rows.map((row) => row.snapshot),
    payments: payments.rows.map((row) => row.snapshot),
    providerEvents: providerEvents.rows.map((row) => row.snapshot),
  };
}

function expectPostgresError(error: unknown, expected: { code: string; constraint?: string }) {
  assert.ok(error instanceof Error, "a PostgreSQL error was expected");
  const postgresError = error as Error & { code?: string; constraint?: string };
  assert.equal(postgresError.code, expected.code);
  if (expected.constraint) assert.equal(postgresError.constraint, expected.constraint);
  return true;
}

test("V1.1.0 migration preserves existing Order, Payment and ProviderEvent snapshots", async () => {
  const database = new PGlite();
  try {
    const migrations = await readMigrationDirectories();
    const pricingIndex = migrations.indexOf(PRICING_MIGRATION);
    assert.ok(pricingIndex > 0);
    assert.deepEqual(migrations.slice(pricingIndex, pricingIndex + 6), [
      PRICING_MIGRATION,
      SHOP_COMMERCE_MIGRATION,
      SHOP_PAYMENT_MIGRATION,
      LEGAL_COMPLIANCE_MIGRATION,
      INVOICING_MIGRATION,
      SHIPPING_MIGRATION,
    ]);

    for (const directory of migrations.slice(0, pricingIndex)) {
      await applyMigrationDirectory(database, directory);
    }

    await database.exec(`
      INSERT INTO "orders" (
        "id", "orderNumber", "customerEmail", "customerName", "status",
        "title", "brief", "coverIncluded", "priorityProcessing",
        "basePriceCents", "coverPriceCents", "priorityPriceCents", "totalCents",
        "currency", "pricingVersion", "personalUseTermsVersion",
        "personalUseTermsHashSha256", "personalUseTermsAcceptedAt",
        "illustrationFormat", "createdAt", "updatedAt"
      ) VALUES (
        '10000000-0000-4000-8000-000000000001',
        'LNX-2026-900001',
        'migration-preservation@example.invalid',
        'Migration preservation fixture',
        'PAYMENT_CONFIRMED',
        'Existing paid V1 order',
        'This fixture proves that V1.1.0 does not rewrite a historical order.',
        true,
        true,
        2000,
        1000,
        3000,
        6000,
        'EUR',
        '2026-08-v2',
        'personal-use-v1',
        repeat('a', 64),
        '2026-08-26T10:00:00.000Z',
        'SQUARE',
        '2026-08-26T09:55:00.000Z',
        '2026-08-26T10:00:00.000Z'
      );

      INSERT INTO "payments" (
        "id", "orderId", "provider", "mode", "status", "amountCents",
        "currency", "pricingVersion", "idempotencyKey", "providerCheckoutId",
        "providerPaymentId", "paymentMethod", "paidAt", "refundedAmountCents",
        "createdAt", "updatedAt"
      ) VALUES (
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'STRIPE',
        'TEST',
        'SUCCEEDED',
        6000,
        'EUR',
        '2026-08-v2',
        'migration:payment:preservation:v110',
        'cs_test_migration_preservation',
        'pi_test_migration_preservation',
        'CARD',
        '2026-08-26T10:00:00.000Z',
        0,
        '2026-08-26T09:58:00.000Z',
        '2026-08-26T10:00:00.000Z'
      );

      INSERT INTO "provider_events" (
        "id", "provider", "providerEventId", "type", "livemode", "objectId",
        "outcome", "paymentId", "processedAt", "createdAt"
      ) VALUES (
        '30000000-0000-4000-8000-000000000001',
        'STRIPE',
        'evt_test_migration_preservation',
        'checkout.session.completed',
        false,
        'cs_test_migration_preservation',
        'PROCESSED',
        '20000000-0000-4000-8000-000000000001',
        '2026-08-26T10:00:01.000Z',
        '2026-08-26T10:00:01.000Z'
      );
    `);

    const before = await readProtectedCommerceSnapshot(database);
    assert.deepEqual(before.counts, { orders: 1, payments: 1, providerEvents: 1 });

    await applyMigrationDirectory(database, PRICING_MIGRATION);
    await applyMigrationDirectory(database, SHOP_COMMERCE_MIGRATION);
    await applyMigrationDirectory(database, SHOP_PAYMENT_MIGRATION);
    await applyMigrationDirectory(database, LEGAL_COMPLIANCE_MIGRATION);
    await applyMigrationDirectory(database, INVOICING_MIGRATION);
    await applyMigrationDirectory(database, SHIPPING_MIGRATION);

    const after = await readProtectedCommerceSnapshot(database);
    assert.deepEqual(after.counts, before.counts, "protected table counts must remain unchanged");
    assert.deepEqual(after.orders, before.orders, "Order rows and price snapshots must remain unchanged");
    const legacyPaymentSnapshots = after.payments.map((snapshot) => {
      assert.ok(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot));
      const { shopOrderId, ...legacySnapshot } = snapshot as Record<string, unknown>;
      assert.equal(shopOrderId, null, "the additive Shop parent must remain null for every historical music Payment");
      return legacySnapshot;
    });
    assert.deepEqual(legacyPaymentSnapshots, before.payments, "Payment rows and amounts must remain unchanged");
    assert.deepEqual(
      after.providerEvents,
      before.providerEvents,
      "ProviderEvent receipt evidence must remain unchanged",
    );
  } finally {
    await database.close();
  }
});

test("all migrations apply and seed the immutable V1 pricing parity", async () => {
  const database = new PGlite();
  try {
    const migrations = await applyAllMigrations(database);
    assert.ok(migrations.includes(PRICING_MIGRATION));
    assert.ok(migrations.indexOf(AFTER_SALES_MIGRATION) < migrations.indexOf(SHIPPING_OPERATIONS_MIGRATION));
    assert.ok(migrations.indexOf(SHIPPING_OPERATIONS_MIGRATION) < migrations.indexOf(SHIPPING_PROVIDER_MIGRATION));
    assert.equal(migrations.at(-1), SHIPPING_PROVIDER_MIGRATION);

    const pricing = await database.query<{
      version: string;
      status: string;
      basePriceCents: number;
      coverPriceCents: number;
      priorityPriceCents: number;
    }>(`
      SELECT
        "version", "status", "basePriceCents", "coverPriceCents", "priorityPriceCents"
      FROM "music_pricing_versions"
      ORDER BY "version"
    `);
    assert.deepEqual(pricing.rows, [
      {
        version: "2026-08-v1",
        status: "RETIRED",
        basePriceCents: 5000,
        coverPriceCents: 1000,
        priorityPriceCents: 3000,
      },
      {
        version: "2026-08-v2",
        status: "ACTIVE",
        basePriceCents: 2000,
        coverPriceCents: 1000,
        priorityPriceCents: 3000,
      },
    ]);
    assert.deepEqual(orderPricingVersions, {
      "2026-08-v1": {
        currency: "EUR",
        personalBaseCents: 5_000,
        coverCents: 1_000,
        priorityCents: 3_000,
      },
      "2026-08-v2": {
        currency: "EUR",
        personalBaseCents: 2_000,
        coverCents: 1_000,
        priorityCents: 3_000,
      },
    }, "the immutable V1 runtime registry must retain both historical grids");
    assert.deepEqual(
      pricing.rows.map((version) => ({
        version: version.version,
        currency: orderPricingVersions[version.version as keyof typeof orderPricingVersions]?.currency,
        personalBaseCents: version.basePriceCents,
        coverCents: version.coverPriceCents,
        priorityCents: version.priorityPriceCents,
      })),
      Object.entries(orderPricingVersions).map(([version, values]) => ({ version, ...values })),
      "the database import must be byte-for-value equivalent to the live V1 pricing registry",
    );

    const configuration = await database.query<{
      key: string;
      revision: number;
      version: string;
      status: string;
    }>(`
      SELECT configuration."key", configuration."revision", version."version", version."status"
      FROM "music_pricing_configurations" AS configuration
      INNER JOIN "music_pricing_versions" AS version
        ON version."id" = configuration."activeVersionId"
    `);
    assert.deepEqual(configuration.rows, [{
      key: "music-order",
      revision: 1,
      version: "2026-08-v2",
      status: "ACTIVE",
    }]);

    const activations = await database.query<{ count: number }>(`
      SELECT count(*)::int AS "count" FROM "music_pricing_activations"
    `);
    assert.equal(activations.rows[0]?.count, 1);

    const products = await database.query<{ count: number }>(`
      SELECT count(*)::int AS "count" FROM "products"
    `);
    assert.equal(products.rows[0]?.count, 0, "the migration must not publish or seed products");

    await assert.rejects(
      database.exec(`
        INSERT INTO "music_pricing_versions" (
          "id", "version", "status", "currency", "basePriceCents",
          "coverPriceCents", "priorityPriceCents", "source", "updatedAt"
        ) VALUES (
          gen_random_uuid(), 'admin-without-actor', 'RETIRED', 'EUR',
          2000, 1000, 3000, 'ADMIN', CURRENT_TIMESTAMP
        )
      `),
      (error) => expectPostgresError(error, {
        code: "23514",
        constraint: "music_pricing_versions_admin_actor_required",
      }),
    );

    await assert.rejects(
      database.exec(`
        INSERT INTO "music_pricing_versions" (
          "id", "version", "status", "currency", "basePriceCents",
          "coverPriceCents", "priorityPriceCents", "source", "activatedAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(), 'second-active', 'ACTIVE', 'EUR',
          2000, 1000, 3000, 'IMPORTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `),
      (error) => expectPostgresError(error, { code: "23505" }),
    );

    await assert.rejects(
      database.exec(`
        INSERT INTO "products" (
          "id", "slug", "title", "description", "status", "currency",
          "trackInventory", "stock", "shippingRequired", "shippingPriceCents",
          "position", "lockVersion", "updatedAt"
        ) VALUES (
          gen_random_uuid(), 'invalid-stock', 'Stock invalide', 'Test de contrainte',
          'DRAFT', 'EUR', true, 1000001, false, 0, 0, 1, CURRENT_TIMESTAMP
        )
      `),
      (error) => expectPostgresError(error, {
        code: "23514",
        constraint: "products_inventory_consistent",
      }),
    );

    await database.exec(`
      UPDATE "music_pricing_versions"
      SET "basePriceCents" = 4999
      WHERE "version" = '2026-08-v1'
    `);
    const pricingMigrationSql = await readFile(
      path.join(MIGRATIONS_DIRECTORY, PRICING_MIGRATION, "migration.sql"),
      "utf8",
    );
    const guardCommentOffset = pricingMigrationSql.indexOf("-- Fail closed if these canonical");
    const guardStart = pricingMigrationSql.indexOf("DO $$", guardCommentOffset);
    const guardEnd = pricingMigrationSql.indexOf(
      'INSERT INTO "music_pricing_versions"',
      guardStart,
    );
    assert.ok(guardCommentOffset >= 0 && guardStart >= 0 && guardEnd > guardStart);
    await assert.rejects(
      database.exec(pricingMigrationSql.slice(guardStart, guardEnd)),
      (error) => {
        const accepted = expectPostgresError(error, { code: "P0001" });
        assert.match((error as Error).message, /MUSIC_PRICING_SEED_CONFLICT_2026_08_V1/);
        return accepted;
      },
    );
  } finally {
    await database.close();
  }
});
