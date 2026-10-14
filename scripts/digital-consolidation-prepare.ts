/** Local-only upgrade proof. Never alters the persistent DCN review database. */
import assert from "node:assert/strict";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, writeFile, mkdir, chmod, mkdtemp, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { provisionDigitalRuntime, DIGITAL_RUNTIME_TABLES, DIGITAL_UPDATE_COLUMNS } from "@/lib/digital/runtime-privileges";

const privateRoot=".private", name="lnx_dcn_consolidation_test";
const cfg=JSON.parse(await readFile(`${privateRoot}/dcn-review-config.json`,"utf8"));
const source=assertSafeLocalPostgresUrl(cfg.DATABASE_URL);
assert.equal(source.pathname,"/lnx_dcn_runtime_test");assert.equal(source.port,"55473");
const owner=new URL(source);owner.username="dcn_owner";
const controlURL=new URL(owner);controlURL.pathname="/postgres";
const control=new Client({connectionString:controlURL.toString()});await control.connect();
const exists=!!(await control.query("SELECT 1 FROM pg_database WHERE datname=$1",[name])).rowCount;
if(exists){assert.equal(process.argv[2],"--resume-empty","Existing consolidation review must be preserved; do not overwrite it");const u=new URL(owner);u.pathname=`/${name}`;const empty=new Client({connectionString:u.toString()});await empty.connect();assert.equal((await empty.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0,"Resume is permitted only after a failed restore into an empty disposable database");await empty.end();}
const sourceDb=new Client({connectionString:owner.toString()});await sourceDb.connect();
const historical=(await sourceDb.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename as string);
async function fingerprint(db:Client){const out=[];for(const t of historical){const exclusions=t==="digital_masters"?["mp3AssetId","mp3BitrateKbps","encoderVersion"]:t==="digital_order_lines"?["completionSnapshot"]:t==="digital_orders"?["jurisdictionSnapshot"]:t==="digital_archives"||t==="digital_download_tickets"?["format"]:[];
  const q=`SELECT count(*)::int n,md5(coalesce(jsonb_agg((to_jsonb(t)-$1::text[]) ORDER BY (to_jsonb(t)-$1::text[])::text)::text,'[]')) hash FROM "${t.replaceAll('"','""')}" t`;
  out.push({table:t,...(await db.query(q,[exclusions])).rows[0]});}return out;}
const before=await fingerprint(sourceDb), root=await mkdtemp("/private/tmp/lnx-dcn-consolidation-"), dump=`${root}/local.dump`;
const pgEnv=(url:URL)=>({...process.env,PGHOST:url.hostname,PGPORT:url.port,PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)});
execFileSync("pg_dump",["-Fc","--no-owner","--file",dump],{env:pgEnv(owner),stdio:"pipe"});await chmod(dump,0o600);
const bytes=await readFile(dump), sha256=createHash("sha256").update(bytes).digest("hex"), key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
await writeFile(`${root}/local.dump.enc`,Buffer.concat([iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]),{mode:0o600});
const keyPath=`${privateRoot}/dcn-consolidation-backup-key-${root.split("-").at(-1)}.bin`;
await mkdir(privateRoot,{recursive:true,mode:0o700});await writeFile(keyPath,key,{mode:0o600,flag:"wx"});key.fill(0);
const encrypted=await readFile(`${root}/local.dump.enc`),restoreKey=await readFile(keyPath),decipher=createDecipheriv("aes-256-gcm",restoreKey,encrypted.subarray(0,12));
decipher.setAuthTag(encrypted.subarray(-16));const restored=Buffer.concat([decipher.update(encrypted.subarray(12,-16)),decipher.final()]);restoreKey.fill(0);
assert.equal(createHash("sha256").update(restored).digest("hex"),sha256,"Encrypted backup is recoverable using separate private key");await writeFile(dump,restored,{mode:0o600});restored.fill(0);bytes.fill(0);
if(!exists)await control.query(`CREATE DATABASE ${name} OWNER dcn_owner`);
const target=new URL(owner);target.pathname=`/${name}`;
execFileSync("pg_restore",["--exit-on-error","--no-owner","--dbname",name,dump],{env:pgEnv(target),stdio:"pipe"});
const db=new Client({connectionString:target.toString()});await db.connect();assert.deepEqual(await fingerprint(db),before,"Actual restore preserves every source row");
const migrations=["20261015010000_digital_formats","20261015020000_digital_completion_credit","20261015030000_digital_country_tax_rules"];
for(const migration of migrations)await db.query(await readFile(`prisma/migrations/${migration}/migration.sql`,"utf8"));
assert.deepEqual(await fingerprint(db),before,"Upgrade preserves acquisitions, invoices and historical canaries");
const acl=(await db.query("SELECT relname,relacl::text FROM pg_class WHERE relnamespace='public'::regnamespace AND relname NOT LIKE 'digital_%' ORDER BY relname")).rows;
let checks=0;
for(const role of ["dcn_runtime_a","dcn_runtime_b"]){await provisionDigitalRuntime(db,role);await provisionDigitalRuntime(db,role);
  const u=new URL(target);u.username=role;const r=new Client({connectionString:u.toString()});await r.connect();
  assert.equal((await r.query("SELECT current_user<>tableowner::text AS non_owner FROM pg_tables WHERE tablename='digital_orders'")).rows[0].non_owner,true);checks++;
  for(const table of DIGITAL_RUNTIME_TABLES){await r.query(`SELECT * FROM ${table} LIMIT 0`);checks++;
    for(const sql of [`DELETE FROM ${table} WHERE false`,`TRUNCATE ${table}`,`ALTER TABLE ${table} ADD COLUMN forbidden int`]){await assert.rejects(r.query(sql),{code:"42501"});checks++;}
    for(const {column_name:c}of(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",[table])).rows){const q=`UPDATE ${table} SET "${c}"="${c}" WHERE false`;
      if((DIGITAL_UPDATE_COLUMNS[table] as readonly string[]).includes(c))await r.query(q);else await assert.rejects(r.query(q),{code:"42501"});checks++;}
  }
  await assert.rejects(r.query("INSERT INTO digital_country_tax_rules DEFAULT VALUES"),{code:"42501"});checks++;
  await assert.rejects(r.query("SELECT nextval('invoice_sequence')"),{code:"42501"});checks++;
  await r.end();
}
assert.deepEqual((await db.query("SELECT relname,relacl::text FROM pg_class WHERE relnamespace='public'::regnamespace AND relname NOT LIKE 'digital_%' ORDER BY relname")).rows,acl);
await db.query('GRANT SELECT ON users,projects,tracks,assets TO dcn_runtime_a,dcn_runtime_b; GRANT INSERT ON assets TO dcn_runtime_a; GRANT UPDATE ("rightsStatus","updatedAt") ON assets TO dcn_runtime_a');
const runtime=new URL(target);runtime.username="dcn_runtime_a";
const profile={...cfg,DATABASE_URL:runtime.toString(),MEDIA_STORAGE_DRIVER:"local",DCN_STORAGE_MODE:"LOCAL",DCN_NEW_PAYMENTS_ENABLED:"false",DCN_WORK_ROOT:`${root}/work`,DCN_LOCAL_UPLOAD_ROOT:`${root}/parts`,DCN_EMAIL_CAPTURE_ROOT:`${root}/mail`,EMAIL_PROVIDER:"capture",ADS_ENABLED:"false",DCN_LOCAL_REVIEW_AUTHORIZED:"true"};
for(const[k,v]of Object.entries(profile))assert.ok(!v||!/(?:^|_)(?:STRIPE|PAYPAL|RESEND)(?:_|$)/.test(k),"No external provider credentials in consolidation profile");
await writeFile(`${privateRoot}/dcn-consolidation-config.json`,JSON.stringify(profile),{mode:0o600});await writeFile(`${privateRoot}/dcn-consolidation-owner-config.json`,JSON.stringify({DATABASE_URL:target.toString()}),{mode:0o600});
assert.deepEqual(await fingerprint(sourceDb),before,"Source review database remained read-only");
await unlink(dump);
await mkdir("output/dcn-consolidation",{recursive:true});
await writeFile("output/dcn-consolidation/upgrade-proof.json",JSON.stringify({source:"lnx_dcn_runtime_test",target:name,backupSha256:sha256,encryptedArchive:`${root}/local.dump.enc`,plaintextRemoved:true,realRestore:"PASS",migrations,canaries:before,runtimeAclChecks:checks,roleRotation:"PASS",historicalSourceUnchanged:true,nonDigitalAclUnchanged:true},null,2));
await db.end();await sourceDb.end();await control.end();console.log(JSON.stringify({backupRestore:"PASS",upgrade:"PASS",historicalTables:before.length,runtimeAclChecks:checks,database:name}));
