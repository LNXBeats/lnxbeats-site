import assert from "node:assert/strict";
import type { Client } from "pg";

import { assertSqlIdentifier, quoteSqlIdentifier } from "@/lib/database/creations-runtime-privileges";

export const EXTERNAL_PRODUCT_RUNTIME_GROUP = "lnx_external_shop_runtime";
export const EXTERNAL_PRODUCT_TABLE = "external_shop_products";
export const EXTERNAL_PRODUCT_AUDIT_TABLE = "external_shop_product_audit_events";

export async function provisionExternalProductRuntimePrivileges(client: Client, runtimeRole: string) {
  assertSqlIdentifier(runtimeRole, "Runtime role");
  const runtime = await client.query<{ safe: boolean }>(`SELECT rolcanlogin AND rolinherit
    AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
    AND NOT rolbypassrls AND rolname <> current_user AS safe FROM pg_roles WHERE rolname = $1`, [runtimeRole]);
  assert.equal(runtime.rows[0]?.safe, true, "External product runtime must be a distinct, unprivileged LOGIN role.");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lnx-external-shop-runtime-privileges'))");
    const relations = await client.query<{ name: string; owned: boolean }>(`SELECT c.relname AS name, c.relowner = current_user::regrole AS owned
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`, [[EXTERNAL_PRODUCT_TABLE, EXTERNAL_PRODUCT_AUDIT_TABLE]]);
    assert.equal(relations.rows.length, 2, "External product tables must exist before provisioning.");
    assert.ok(relations.rows.every((row) => row.owned), "External product tables must be owned by the migration role.");
    const group = await client.query<{ safe: boolean }>(`SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS safe FROM pg_roles WHERE rolname = $1`, [EXTERNAL_PRODUCT_RUNTIME_GROUP]);
    if (!group.rows.length) await client.query(`CREATE ROLE ${quoteSqlIdentifier(EXTERNAL_PRODUCT_RUNTIME_GROUP)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    else assert.equal(group.rows[0].safe, true, "External product group must remain an unprivileged NOLOGIN role.");
    for (const table of [EXTERNAL_PRODUCT_TABLE, EXTERNAL_PRODUCT_AUDIT_TABLE]) {
      await client.query(`REVOKE ALL PRIVILEGES ON TABLE public.${quoteSqlIdentifier(table)} FROM ${quoteSqlIdentifier(EXTERNAL_PRODUCT_RUNTIME_GROUP)}`);
      await client.query(`GRANT SELECT, INSERT ON TABLE public.${quoteSqlIdentifier(table)} TO ${quoteSqlIdentifier(EXTERNAL_PRODUCT_RUNTIME_GROUP)}`);
    }
    await client.query(`GRANT UPDATE ON TABLE public.${quoteSqlIdentifier(EXTERNAL_PRODUCT_TABLE)} TO ${quoteSqlIdentifier(EXTERNAL_PRODUCT_RUNTIME_GROUP)}`);
    await client.query(`GRANT ${quoteSqlIdentifier(EXTERNAL_PRODUCT_RUNTIME_GROUP)} TO ${quoteSqlIdentifier(runtimeRole)} WITH ADMIN FALSE, INHERIT TRUE, SET FALSE`);
    const external = await client.query<{ select_ok: boolean; insert_ok: boolean; update_ok: boolean; destructive: boolean }>(`SELECT
      has_table_privilege($1,$2,'SELECT') select_ok, has_table_privilege($1,$2,'INSERT') insert_ok,
      has_table_privilege($1,$2,'UPDATE') update_ok,
      has_table_privilege($1,$2,'DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') destructive`, [runtimeRole, `public.${EXTERNAL_PRODUCT_TABLE}`]);
    const audit = await client.query<{ select_ok: boolean; insert_ok: boolean; update_ok: boolean; destructive: boolean }>(`SELECT
      has_table_privilege($1,$2,'SELECT') select_ok, has_table_privilege($1,$2,'INSERT') insert_ok,
      has_table_privilege($1,$2,'UPDATE') update_ok,
      has_table_privilege($1,$2,'DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') destructive`, [runtimeRole, `public.${EXTERNAL_PRODUCT_AUDIT_TABLE}`]);
    assert.deepEqual(external.rows[0], { select_ok: true, insert_ok: true, update_ok: true, destructive: false });
    assert.deepEqual(audit.rows[0], { select_ok: true, insert_ok: true, update_ok: false, destructive: false });
    await client.query("COMMIT");
    return { group: EXTERNAL_PRODUCT_RUNTIME_GROUP, externalProduct: external.rows[0], appendOnlyAudit: audit.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
