import assert from "node:assert/strict";
import type { Client } from "pg";
import { assertSqlIdentifier, CREATIONS_RUNTIME_GROUP, quoteSqlIdentifier } from "@/lib/database/creations-runtime-privileges";

export const SUPPORT_RUNTIME_GROUP = "lnx_support_readonly";
export const SUPPORT_RUNTIME_TABLES = ["support_contributions", "support_contribution_attempts", "support_contribution_events"] as const;
// Closed Admin queries read the register and audit, never provider attempts.
export const SUPPORT_RUNTIME_READ_TABLES = ["support_contributions", "support_contribution_events"] as const;

/** Read-only, separate domain group. This is not a TEST/LIVE write provisioner. */
export async function provisionSupportRuntimePrivileges(client: Client, runtimeRole: string) {
  assertSqlIdentifier(runtimeRole, "Runtime role");
  const runtime = await client.query<{ safe: boolean }>(`SELECT rolcanlogin AND rolinherit
    AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
    AND NOT rolbypassrls AND rolname <> current_user AS safe FROM pg_roles WHERE rolname = $1`, [runtimeRole]);
  assert.equal(runtime.rows[0]?.safe, true, "Support runtime must be a distinct, unprivileged LOGIN role.");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lnx-support-readonly-privileges'))");
    const relations = await client.query<{ name: string; owned: boolean }>(`SELECT c.relname AS name, c.relowner = current_user::regrole AS owned
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`, [SUPPORT_RUNTIME_TABLES]);
    assert.equal(relations.rows.length, SUPPORT_RUNTIME_TABLES.length, "All support tables must exist before provisioning.");
    assert.ok(relations.rows.every((row) => row.owned), "Support tables must be owned by the migration role.");
    const group = await client.query<{ safe: boolean }>(`SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
      AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS safe FROM pg_roles WHERE rolname = $1`, [SUPPORT_RUNTIME_GROUP]);
    if (!group.rows.length) {
      await client.query(`CREATE ROLE ${quoteSqlIdentifier(SUPPORT_RUNTIME_GROUP)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    } else {
      assert.equal(group.rows[0].safe, true, "Support group must remain a non-privileged NOLOGIN role.");
    }
    // Only withdraw former grants on the three support tables. Creations and
    // order visibility privileges are never touched; the caller verifies that group.
    for (const table of SUPPORT_RUNTIME_TABLES) {
      const relation = `public.${quoteSqlIdentifier(table)}`;
      await client.query(`REVOKE ALL PRIVILEGES ON TABLE ${relation} FROM ${quoteSqlIdentifier(CREATIONS_RUNTIME_GROUP)}`);
      await client.query(`REVOKE ALL PRIVILEGES ON TABLE ${relation} FROM ${quoteSqlIdentifier(SUPPORT_RUNTIME_GROUP)}`);
      if ((SUPPORT_RUNTIME_READ_TABLES as readonly string[]).includes(table)) {
        await client.query(`GRANT SELECT ON TABLE ${relation} TO ${quoteSqlIdentifier(SUPPORT_RUNTIME_GROUP)}`);
      }
    }
    await client.query(`GRANT ${quoteSqlIdentifier(SUPPORT_RUNTIME_GROUP)} TO ${quoteSqlIdentifier(runtimeRole)} WITH ADMIN FALSE, INHERIT TRUE, SET FALSE`);
    for (const table of SUPPORT_RUNTIME_TABLES) {
      const actual = await client.query<{ readable: boolean; excessive: boolean }>(`SELECT
        has_table_privilege($1,$2,'SELECT') AS readable,
        has_table_privilege($1,$2,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          OR has_table_privilege($1,$2,'SELECT WITH GRANT OPTION') AS excessive`, [runtimeRole, `public.${table}`]);
      assert.equal(actual.rows[0]?.readable, (SUPPORT_RUNTIME_READ_TABLES as readonly string[]).includes(table), "Support reads must match the closed Admin queries.");
      assert.equal(actual.rows[0]?.excessive, false, "Support runtime must have no write, maintenance or grant privileges.");
    }
    await client.query("COMMIT");
    return { group: SUPPORT_RUNTIME_GROUP, readTables: [...SUPPORT_RUNTIME_READ_TABLES], attempts: "NO PRIVILEGES", writesGranted: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
