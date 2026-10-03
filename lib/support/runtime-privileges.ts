import assert from "node:assert/strict";
import type { Client } from "pg";
import { CREATIONS_RUNTIME_GROUP, quoteSqlIdentifier } from "@/lib/database/creations-runtime-privileges";

export const SUPPORT_RUNTIME_TABLES = ["support_contributions", "support_contribution_attempts", "support_contribution_events"] as const;
/** Called only after the existing provisioner verified the migration owner,
 * rotating runtime identity and stable NOLOGIN, non-privileged group. */
export async function provisionSupportRuntimePrivileges(client: Client) {
  const group = await client.query<{ safe: boolean }>(`SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS safe FROM pg_roles WHERE rolname = $1`, [CREATIONS_RUNTIME_GROUP]);
  assert.equal(group.rows[0]?.safe, true, "Scoped runtime group must exist and remain unprivileged.");
  const relations = await client.query<{ name: string; owned: boolean }>(`SELECT c.relname AS name, c.relowner = current_user::regrole AS owned
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`, [SUPPORT_RUNTIME_TABLES]);
  assert.equal(relations.rows.length, SUPPORT_RUNTIME_TABLES.length, "All support tables must exist before granting privileges.");
  assert.ok(relations.rows.every((row) => row.owned), "Support tables must be owned by the migration role.");
  for (const table of SUPPORT_RUNTIME_TABLES) {
    const permissions = table === "support_contribution_events" ? "SELECT, INSERT" : "SELECT, INSERT, UPDATE";
    await client.query(`GRANT ${permissions} ON TABLE public.${quoteSqlIdentifier(table)} TO ${quoteSqlIdentifier(CREATIONS_RUNTIME_GROUP)}`);
  }
  return { tables: [...SUPPORT_RUNTIME_TABLES], audit: "SELECT, INSERT", ledger: "SELECT, INSERT, UPDATE", deleteGranted: false };
}
