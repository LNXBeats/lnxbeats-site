import assert from "node:assert/strict";
import type { Client } from "pg";
import { assertSqlIdentifier, quoteSqlIdentifier } from "@/lib/database/creations-runtime-privileges";
import { SUPPORT_UPDATE_COLUMNS } from "@/lib/support/runtime-privileges";

export const SUPPORT_NOTIFICATION_CONSUMER_GROUP = "lnx_support_notification_consumer";
export const SUPPORT_NOTIFICATION_CONSUMER_COLUMNS = SUPPORT_UPDATE_COLUMNS.support_notifications;

/** Consumer only: enqueue remains a Web responsibility. No rotating role is hardcoded. */
export async function provisionSupportNotificationConsumer(client: Client, role: string, webRole: string) {
  assertSqlIdentifier(role, "Notifications runtime role");
  assert.notEqual(role, webRole, "Notifications must remain separate from Web.");
  const identity = await client.query<{ safe: boolean }>(`SELECT rolcanlogin AND rolinherit AND NOT rolsuper
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
    AND rolname<>current_user AS safe FROM pg_roles WHERE rolname=$1`, [role]);
  assert.equal(identity.rows[0]?.safe, true, "Notifications runtime must be unprivileged and distinct from owner.");
  const group = quoteSqlIdentifier(SUPPORT_NOTIFICATION_CONSUMER_GROUP);
  const columns = SUPPORT_NOTIFICATION_CONSUMER_COLUMNS.map(value=>`"${value}"`).join(",");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lnx-support-notification-consumer-acl'))");
    const tables = await client.query<{ owned: boolean }>(`SELECT relowner=current_user::regrole AS owned
      FROM pg_class WHERE oid=ANY(ARRAY['public.support_notifications'::regclass,'public.support_contributions'::regclass])`);
    assert.equal(tables.rows.length,2); assert.ok(tables.rows.every(x=>x.owned), "Migration ownership required.");
    const existing = await client.query<{ safe: boolean }>(`SELECT NOT rolcanlogin AND rolinherit AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS safe
      FROM pg_roles WHERE rolname=$1`, [SUPPORT_NOTIFICATION_CONSUMER_GROUP]);
    if (!existing.rows.length) await client.query(`CREATE ROLE ${group} NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    else assert.equal(existing.rows[0].safe,true,"Unsafe consumer group.");
    for (const table of ["support_contributions","support_notifications"]) {
      await client.query(`REVOKE ALL PRIVILEGES ON TABLE public.${quoteSqlIdentifier(table)} FROM ${group}`);
    }
    await client.query(`REVOKE UPDATE (${columns}) ON public.support_notifications FROM ${group}`);
    await client.query(`GRANT SELECT ON TABLE public.support_contributions, public.support_notifications TO ${group}`);
    await client.query(`GRANT UPDATE (${columns}) ON public.support_notifications TO ${group}`);
    await client.query(`GRANT ${group} TO ${quoteSqlIdentifier(role)} WITH ADMIN FALSE, INHERIT TRUE, SET FALSE`);
    for (const table of ["support_contributions","support_notifications"]) {
      const actual = await client.query<{ read: boolean; excessive: boolean }>(`SELECT
        has_table_privilege($1,$2,'SELECT') AS read,
        has_table_privilege($1,$2,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR has_table_privilege($1,$2,'SELECT WITH GRANT OPTION') AS excessive`, [role,`public.${table}`]);
      assert.deepEqual(actual.rows[0],{read:true,excessive:false},"Consumer table privileges exceeded.");
      const writable = await client.query<{ column_name: string; allowed: boolean }>(`SELECT column_name,
        has_column_privilege($1,table_schema||'.'||table_name,column_name,'UPDATE') AS allowed
        FROM information_schema.columns WHERE table_schema='public' AND table_name=$2`,[role,table]);
      for(const column of writable.rows) assert.equal(column.allowed,
        table==='support_notifications' && (SUPPORT_NOTIFICATION_CONSUMER_COLUMNS as readonly string[]).includes(column.column_name),
        "Consumer column privilege exceeded.");
    }
    await client.query("COMMIT");
    return {group:SUPPORT_NOTIFICATION_CONSUMER_GROUP,contributionPrivileges:["SELECT"],notificationPrivileges:["SELECT","UPDATE (state columns)"],insert:false,delete:false};
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
}
