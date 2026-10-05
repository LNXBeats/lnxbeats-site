import assert from "node:assert/strict";
import type { Client } from "pg";
import { CREATIONS_RUNTIME_GROUP, assertSqlIdentifier, quoteSqlIdentifier } from "@/lib/database/creations-runtime-privileges";

export const FINANCIAL_REVIEW_TABLE = "provider_event_technical_reviews";
export async function provisionFinancialReviewPrivileges(client: Client, runtimeRole: string) {
  assertSqlIdentifier(runtimeRole, "Runtime role");
  const identity = await client.query<{ safe: boolean }>(`SELECT rolcanlogin AND rolinherit AND NOT rolsuper
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
    AND rolname <> current_user AS safe FROM pg_roles WHERE rolname=$1`, [runtimeRole]);
  assert.equal(identity.rows[0]?.safe, true, "Runtime must be distinct and unprivileged.");
  const group = await client.query<{ safe: boolean }>(`SELECT NOT rolcanlogin AND rolinherit AND NOT rolsuper
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS safe
    FROM pg_roles WHERE rolname=$1`, [CREATIONS_RUNTIME_GROUP]);
  assert.equal(group.rows[0]?.safe, true, "Stable runtime group must already be safe.");
  const relation = await client.query<{ owned: boolean }>(`SELECT c.relowner=current_user::regrole AS owned
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=$1 AND c.relkind='r'`, [FINANCIAL_REVIEW_TABLE]);
  assert.equal(relation.rows[0]?.owned, true, "Review audit must belong to the migration role.");
  await client.query(`GRANT SELECT, INSERT ON TABLE public.${quoteSqlIdentifier(FINANCIAL_REVIEW_TABLE)} TO ${quoteSqlIdentifier(CREATIONS_RUNTIME_GROUP)}`);
  const actual = await client.query<{ read: boolean; append: boolean; excessive: boolean }>(`SELECT
    has_table_privilege($1,$2,'SELECT') AS read, has_table_privilege($1,$2,'INSERT') AS append,
    has_table_privilege($1,$2,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege($1,$2,'SELECT WITH GRANT OPTION')
      OR has_table_privilege($1,$2,'INSERT WITH GRANT OPTION')
      OR has_any_column_privilege($1,$2,'UPDATE') AS excessive`, [runtimeRole, `public.${FINANCIAL_REVIEW_TABLE}`]);
  assert.deepEqual(actual.rows[0], { read: true, append: true, excessive: false }, "Audit must be append-only for runtime.");
  return { table: FINANCIAL_REVIEW_TABLE, privileges: ["SELECT", "INSERT"] };
}
