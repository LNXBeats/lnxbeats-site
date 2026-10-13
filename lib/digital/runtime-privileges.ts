import assert from "node:assert/strict";
import type { Client } from "pg";
import { assertSqlIdentifier,quoteSqlIdentifier } from "@/lib/database/creations-runtime-privileges";
export const DIGITAL_RUNTIME_GROUP="lnx_digital_runtime";
export const DIGITAL_UPDATE_COLUMNS={
  digital_offers:["priceCents","active","rightsConfirmed","distribution","version","updatedAt"],
  digital_masters:[],digital_uploads:["providerUploadId","status","errorCode","leaseUntil","updatedAt"],
  digital_carts:["revision","updatedAt"],digital_cart_lines:["offerVersion","priceCents","selectionHash","removed"],
  digital_orders:["status","updatedAt"],digital_order_lines:[],
  digital_payment_attempts:["operation","status","providerReference","paymentReference","checkoutUrl","leaseUntil","updatedAt"],
  digital_entitlements:["status"],digital_events:[],digital_download_tickets:["usesLeft"],
} as const;
export const DIGITAL_RUNTIME_TABLES=Object.keys(DIGITAL_UPDATE_COLUMNS) as Array<keyof typeof DIGITAL_UPDATE_COLUMNS>;
export async function provisionDigitalRuntime(client:Client,role:string){assertSqlIdentifier(role,"Runtime role");
  const r=await client.query<{safe:boolean}>("SELECT rolcanlogin AND rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolname<>current_user AS safe FROM pg_roles WHERE rolname=$1",[role]);assert.equal(r.rows[0]?.safe,true);
  await client.query("BEGIN");try{await client.query("SELECT pg_advisory_xact_lock(hashtext('digital-runtime-privileges'))");
    const existing=await client.query<{safe:boolean}>("SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS safe FROM pg_roles WHERE rolname=$1",[DIGITAL_RUNTIME_GROUP]);
    if(!existing.rows.length)await client.query(`CREATE ROLE ${quoteSqlIdentifier(DIGITAL_RUNTIME_GROUP)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);else assert.equal(existing.rows[0].safe,true);
    const owned=await client.query<{relname:string;owned:boolean}>("SELECT relname,relowner=current_user::regrole AS owned FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname=ANY($1::text[])",[DIGITAL_RUNTIME_TABLES]);
    assert.equal(owned.rows.length,DIGITAL_RUNTIME_TABLES.length);assert.ok(owned.rows.every(r=>r.owned));
    for(const table of DIGITAL_RUNTIME_TABLES){const relation=`public.${quoteSqlIdentifier(table)}`,group=quoteSqlIdentifier(DIGITAL_RUNTIME_GROUP);
      await client.query(`REVOKE ALL ON TABLE ${relation} FROM ${group}`);
      const cols=await client.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",[table]);
      for(const c of cols.rows)await client.query(`REVOKE UPDATE ("${c.column_name.replaceAll('"','""')}") ON ${relation} FROM ${group}`);
      await client.query(`GRANT SELECT,INSERT ON ${relation} TO ${group}`);
      const allowed:DIGITAL_COLUMNS= DIGITAL_UPDATE_COLUMNS[table];
      if(allowed.length)await client.query(`GRANT UPDATE (${allowed.map(c=>`"${c}"`).join(",")}) ON ${relation} TO ${group}`);
    }
    await client.query(`GRANT USAGE ON SCHEMA public TO ${quoteSqlIdentifier(DIGITAL_RUNTIME_GROUP)}`);
    await client.query(`GRANT ${quoteSqlIdentifier(DIGITAL_RUNTIME_GROUP)} TO ${quoteSqlIdentifier(role)} WITH ADMIN FALSE, INHERIT TRUE, SET FALSE`);
    for(const table of DIGITAL_RUNTIME_TABLES){const p=await client.query<{bad:boolean}>("SELECT has_table_privilege($1,$2,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege($1,$2,'INSERT WITH GRANT OPTION') AS bad",[role,`public.${table}`]);assert.equal(p.rows[0].bad,false);}
    await client.query("COMMIT");return{tables:DIGITAL_RUNTIME_TABLES,appendOnlyEvents:true};
  }catch(e){await client.query("ROLLBACK");throw e;}}
type DIGITAL_COLUMNS=readonly string[];
