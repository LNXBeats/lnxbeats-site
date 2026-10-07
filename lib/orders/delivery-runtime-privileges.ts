import assert from "node:assert/strict";
import type { Client } from "pg";
import { assertSqlIdentifier, quoteSqlIdentifier } from "@/lib/database/creations-runtime-privileges";

export const DELIVERY_UPLOAD_RUNTIME_GROUP = "lnx_delivery_upload_runtime";
export async function provisionDeliveryUploadPrivileges(client: Client, runtimeRole: string) {
  assertSqlIdentifier(runtimeRole, "Runtime role");
  const role = await client.query<{ safe: boolean }>(`SELECT rolcanlogin AND rolinherit AND NOT rolsuper AND NOT rolcreatedb
    AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolname <> current_user AS safe FROM pg_roles WHERE rolname=$1`, [runtimeRole]);
  assert.equal(role.rows[0]?.safe, true, "Delivery runtime must be a distinct unprivileged LOGIN role.");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lnx-delivery-upload-runtime'))");
    const relation = await client.query<{ owned: boolean }>(`SELECT relowner=current_user::regrole AS owned FROM pg_class
      WHERE oid=to_regclass('public.order_delivery_upload_sessions')`);
    assert.equal(relation.rows[0]?.owned, true, "Delivery session table must be migration-owned.");
    const group = await client.query<{ safe: boolean }>(`SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
      AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS safe FROM pg_roles WHERE rolname=$1`, [DELIVERY_UPLOAD_RUNTIME_GROUP]);
    if (!group.rows.length) await client.query(`CREATE ROLE ${quoteSqlIdentifier(DELIVERY_UPLOAD_RUNTIME_GROUP)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    else assert.equal(group.rows[0].safe, true, "Delivery group must remain unprivileged.");
    await client.query(`REVOKE ALL PRIVILEGES ON TABLE public.order_delivery_upload_sessions FROM ${quoteSqlIdentifier(DELIVERY_UPLOAD_RUNTIME_GROUP)}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE ON TABLE public.order_delivery_upload_sessions TO ${quoteSqlIdentifier(DELIVERY_UPLOAD_RUNTIME_GROUP)}`);
    await client.query(`GRANT ${quoteSqlIdentifier(DELIVERY_UPLOAD_RUNTIME_GROUP)} TO ${quoteSqlIdentifier(runtimeRole)} WITH ADMIN FALSE, INHERIT TRUE, SET FALSE`);
    const effective = await client.query<{ read: boolean; insert: boolean; update: boolean; destructive: boolean }>(`SELECT
      has_table_privilege($1,'public.order_delivery_upload_sessions','SELECT') AS read,
      has_table_privilege($1,'public.order_delivery_upload_sessions','INSERT') AS insert,
      has_table_privilege($1,'public.order_delivery_upload_sessions','UPDATE') AS update,
      has_table_privilege($1,'public.order_delivery_upload_sessions','DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS destructive`, [runtimeRole]);
    assert.deepEqual(effective.rows[0], { read: true, insert: true, update: true, destructive: false });
    await client.query("COMMIT");
    return { table: "order_delivery_upload_sessions", privileges: ["SELECT", "INSERT", "UPDATE"], effective: effective.rows[0] };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
}
