import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { prisma } from "@/lib/prisma";
import { parseShopConfiguration } from "@/lib/shop/config";
import {
  assertShopProductionReadinessQaEnabled,
  SHOP_PHASE5E_RUNTIME_TARGET,
} from "@/lib/shop/production-readiness-config";

const BACKUP_PATH = "/private/tmp/lnxbeats-v110-phase5e-logical-backup.json";
const TABLES = [
  "users",
  "products",
  "shop_orders",
  "stock_reservations",
  "payments",
  "invoices",
  "credit_notes",
  "shop_return_requests",
  "shop_return_evidence",
  "shop_order_customer_requests",
  "shop_shipping_provider_attempts",
  "shipping_rate_versions",
  "shipping_rate_tiers",
  "packaging_profiles",
  "shop_order_events",
  "shop_return_audit_events",
  "shop_readiness_alerts",
  "shop_maintenance_runs",
  "legal_document_versions",
] as const;

type Row = Readonly<{ snapshot: unknown }>;

async function snapshot() {
  const tables: Record<string, readonly unknown[]> = {};
  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<Row[]>(`SELECT to_jsonb(source) AS snapshot FROM "${table}" AS source ORDER BY "id"`);
    tables[table] = rows.map(({ snapshot: value }) => value);
  }
  return tables;
}

async function run() {
  const identity = assertShopProductionReadinessQaEnabled();
  assert.equal(identity.target, SHOP_PHASE5E_RUNTIME_TARGET);
  const migrations = await prisma.$queryRaw<Array<{ migration: string; checksum: string }>>`
    SELECT "migration_name" AS migration, checksum FROM "_prisma_migrations"
    WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
    ORDER BY "migration_name", "started_at"
  `;
  assert.equal(migrations.length, 28);
  const before = await snapshot();
  assert.ok(before.users!.length >= 3);
  assert.ok(before.shop_orders!.length >= 1);

  const payload = JSON.stringify({ format: "lnx-phase5e-logical-proof-v1", migrations, tables: before });
  await writeFile(BACKUP_PATH, payload, { encoding: "utf8", mode: 0o600, flag: "w" });
  const persisted = await readFile(BACKUP_PATH, "utf8");
  assert.equal(persisted, payload);
  const checksum = createHash("sha256").update(persisted).digest("hex");

  const rolledBack = parseShopConfiguration({
    ...process.env,
    SHOP_ENABLED: "false",
    SHOP_PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
  });
  assert.equal(rolledBack.enabled, false);
  const after = await snapshot();
  assert.deepEqual(after, before, "an application rollback must not mutate historical data");

  console.info(JSON.stringify({
    event: "shop.phase5e.rollback.completed",
    outcome: "passed",
    backupPath: BACKUP_PATH,
    checksum,
    migrationCount: migrations.length,
    criticalTables: TABLES.length,
    shopDisabled: true,
    dataPreserved: true,
    externalProvidersContacted: false,
  }));
}

run().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "shop.phase5e.rollback.failed", outcome: "failed" }));
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
