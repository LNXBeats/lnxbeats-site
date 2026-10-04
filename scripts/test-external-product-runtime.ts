import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Client } from "pg";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import {
  EXTERNAL_PRODUCT_AUDIT_TABLE,
  EXTERNAL_PRODUCT_RUNTIME_GROUP,
  EXTERNAL_PRODUCT_TABLE,
  provisionExternalProductRuntimePrivileges,
} from "@/lib/shop/external-product-runtime-privileges";

const migrationValue = process.env.MIGRATION_DATABASE_URL;
assert.ok(migrationValue, "MIGRATION_DATABASE_URL is required.");
const migrationUrl = assertSafeLocalPostgresUrl(migrationValue, "MIGRATION_DATABASE_URL");
assert.match(migrationUrl.pathname, /_test$/, "The runtime ACL test requires an explicit *_test database.");

const runtimeRole = `external_shop_runtime_${randomUUID().replaceAll("-", "")}`;
const runtimePassword = randomUUID();
const runtimeUrl = new URL(migrationUrl);
runtimeUrl.username = runtimeRole;
runtimeUrl.password = runtimePassword;
const migration = new Client({ connectionString: migrationUrl.toString(), application_name: "external-shop-role-qa-owner" });
const runtime = new Client({ connectionString: runtimeUrl.toString(), application_name: "external-shop-role-qa-runtime" });
const productId = randomUUID();
const assetId = randomUUID();
const auditId = randomUUID();

function quote(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

let denialIndex = 0;
async function denied(sql: string) {
  denialIndex += 1;
  const savepoint = `external_denial_${denialIndex}`;
  await runtime.query(`SAVEPOINT ${savepoint}`);
  try {
    await runtime.query(sql);
    assert.fail(`Operation unexpectedly allowed: ${sql}`);
  } catch (error) {
    assert.equal(error && typeof error === "object" && "code" in error ? error.code : null, "42501");
  } finally {
    await runtime.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await runtime.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

try {
  await migration.connect();
  await migration.query(`CREATE ROLE ${quote(runtimeRole)} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(runtimePassword)}`);
  await migration.query(
    `INSERT INTO assets (id, type, "storageKey", "storageBackend", "storageProvider", visibility, filename, "mimeType", "sizeBytes", width, height, alt, "rightsStatus", "updatedAt")
     VALUES ($1, 'IMAGE', $2, 'LOCAL', 'local', 'PUBLIC', 'mug.webp', 'image/webp', 1024, 1600, 1600, 'Mug Vie de chien', 'CLEARED', now())`,
    [assetId, `qa/external-shop/${assetId}.webp`],
  );
  await migration.query("CREATE TABLE external_shop_unrelated_probe (id integer)");
  const grants = await provisionExternalProductRuntimePrivileges(migration, runtimeRole);
  assert.deepEqual(grants.externalProduct, { select_ok: true, insert_ok: true, update_ok: true, destructive: false });
  assert.deepEqual(grants.appendOnlyAudit, { select_ok: true, insert_ok: true, update_ok: false, destructive: false });

  await runtime.connect();
  await runtime.query("BEGIN");
  await runtime.query(
    `INSERT INTO ${EXTERNAL_PRODUCT_TABLE} (id, title, "externalUrl", "priceCents", position, status, "imageAssetId", "updatedAt")
     VALUES ($1, 'Vie de chien — Mug céramique', 'https://direct.distrokid.com/lnxbeats2/product/1407201-vie-de-chien-ceramic-mug', 1700, 3, 'DRAFT', $2, now())`,
    [productId, assetId],
  );
  await runtime.query(`INSERT INTO ${EXTERNAL_PRODUCT_AUDIT_TABLE} (id, "externalShopProductId", action) VALUES ($1, $2, 'CREATED')`, [auditId, productId]);
  await runtime.query(`UPDATE ${EXTERNAL_PRODUCT_TABLE} SET position = 4, "lockVersion" = "lockVersion" + 1, "updatedAt" = now() WHERE id = $1`, [productId]);
  assert.equal((await runtime.query<{ position: number }>(`SELECT position FROM ${EXTERNAL_PRODUCT_TABLE} WHERE id = $1`, [productId])).rows[0]?.position, 4);
  await denied(`UPDATE ${EXTERNAL_PRODUCT_AUDIT_TABLE} SET action = 'UPDATED' WHERE id = '${auditId}'`);
  await denied(`DELETE FROM ${EXTERNAL_PRODUCT_TABLE} WHERE id = '${productId}'`);
  await denied("SELECT * FROM external_shop_unrelated_probe");
  await denied("CREATE TABLE external_shop_ddl_probe(id integer)");
  await runtime.query("ROLLBACK");

  console.log(JSON.stringify({
    runtimeRole: "PASS",
    externalProductReadInsertUpdate: "PASS",
    auditAppendOnly: "PASS",
    deleteDenied: true,
    unrelatedTableDenied: true,
    ddlDenied: true,
  }, null, 2));
} finally {
  await runtime.end().catch(() => undefined);
  await migration.query(`DELETE FROM ${EXTERNAL_PRODUCT_AUDIT_TABLE} WHERE "externalShopProductId" = $1`, [productId]).catch(() => undefined);
  await migration.query(`DELETE FROM ${EXTERNAL_PRODUCT_TABLE} WHERE id = $1`, [productId]).catch(() => undefined);
  await migration.query("DELETE FROM assets WHERE id = $1", [assetId]).catch(() => undefined);
  await migration.query("DROP TABLE IF EXISTS external_shop_unrelated_probe").catch(() => undefined);
  await migration.query(`REVOKE ${quote(EXTERNAL_PRODUCT_RUNTIME_GROUP)} FROM ${quote(runtimeRole)}`).catch(() => undefined);
  await migration.query(`DROP ROLE IF EXISTS ${quote(runtimeRole)}`).catch(() => undefined);
  await migration.end().catch(() => undefined);
}
