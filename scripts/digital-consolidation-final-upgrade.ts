/** Reuses this lot's encrypted LOCAL backup to prove the complete final SQL, not only a trigger refresh. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdtemp,unlink} from "node:fs/promises";
import {createDecipheriv,createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {Client} from "pg";
import {assertSafeLocalPostgresUrl} from "@/lib/database/local-postgres-url";
import {provisionDigitalRuntime} from "@/lib/digital/runtime-privileges";
const proof=JSON.parse(await readFile("output/dcn-consolidation/upgrade-proof.json","utf8")),cfg=JSON.parse(await readFile(".private/dcn-review-config.json","utf8"));
assert.match(proof.encryptedArchive,/^\/private\/tmp\/lnx-dcn-consolidation-[A-Za-z0-9]+\/local\.dump\.enc$/);
const root=proof.encryptedArchive.slice(0,proof.encryptedArchive.lastIndexOf("/")),key=await readFile(`.private/dcn-consolidation-backup-key-${root.split("-").at(-1)}.bin`),encrypted=await readFile(proof.encryptedArchive);
const decipher=createDecipheriv("aes-256-gcm",key,encrypted.subarray(0,12));decipher.setAuthTag(encrypted.subarray(-16));const plaintext=Buffer.concat([decipher.update(encrypted.subarray(12,-16)),decipher.final()]);key.fill(0);
assert.equal(createHash("sha256").update(plaintext).digest("hex"),proof.backupSha256);
const owner=assertSafeLocalPostgresUrl(cfg.DATABASE_URL);owner.username="dcn_owner";assert.equal(owner.pathname,"/lnx_dcn_runtime_test");assert.equal(owner.port,"55473");
const source=new Client({connectionString:owner.toString()});await source.connect();
async function canaries(c:Client){const out=[];for(const {table}of proof.canaries){out.push({table,...(await c.query(`SELECT count(*)::int n,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) hash FROM "${table}" t`)).rows[0]});}return out;}
assert.deepEqual(await canaries(source),proof.canaries,"Persistent source is still unchanged; previous backup remains applicable");
const ctlURL=new URL(owner);ctlURL.pathname="/postgres";const ctl=new Client({connectionString:ctlURL.toString()});await ctl.connect();const name=process.argv[2]==="--reviewed"?"lnx_dcn_consolidation_upgrade_reviewed":"lnx_dcn_consolidation_upgrade_final";
assert.equal((await ctl.query("SELECT 1 FROM pg_database WHERE datname=$1",[name])).rowCount,0,"Never overwrite an existing final proof database");await ctl.query(`CREATE DATABASE ${name} OWNER dcn_owner`);
const target=new URL(owner);target.pathname=`/${name}`;const temp=await mkdtemp("/private/tmp/lnx-dcn-final-upgrade-"),dump=`${temp}/restored.dump`;
await writeFile(dump,plaintext,{mode:0o600});plaintext.fill(0);
try{execFileSync("pg_restore",["--exit-on-error","--no-owner","--dbname",name,dump],{env:{...process.env,PGHOST:target.hostname,PGPORT:target.port,PGUSER:target.username,PGPASSWORD:decodeURIComponent(target.password)},stdio:"pipe"});}finally{await unlink(dump);}
const db=new Client({connectionString:target.toString()});await db.connect();assert.deepEqual(await canaries(db),proof.canaries);
const sqlHashes=[];for(const migration of proof.migrations){const sql=await readFile(`prisma/migrations/${migration}/migration.sql`,"utf8");await db.query(sql);sqlHashes.push({migration,sha256:createHash("sha256").update(sql).digest("hex")});}
// Compare only the columns present in the restored source. New defaults/nulls are not invented historical data.
for(const expected of proof.canaries){const t=expected.table,exclusions=t==="digital_masters"?["mp3AssetId","mp3BitrateKbps","encoderVersion"]:t==="digital_order_lines"?["completionSnapshot"]:t==="digital_orders"?["jurisdictionSnapshot"]:t==="digital_archives"||t==="digital_download_tickets"?["format"]:[];
 const row=(await db.query(`SELECT count(*)::int n,md5(coalesce(jsonb_agg((to_jsonb(t)-$1::text[]) ORDER BY (to_jsonb(t)-$1::text[])::text)::text,'[]')) hash FROM "${t}" t`,[exclusions])).rows[0];assert.deepEqual({table:t,...row},expected);}
const beforeAcl=(await db.query("SELECT relname,relacl::text FROM pg_class WHERE relnamespace='public'::regnamespace AND relname NOT LIKE 'digital_%' ORDER BY relname")).rows;
await provisionDigitalRuntime(db,"dcn_runtime_a");await provisionDigitalRuntime(db,"dcn_runtime_b");
assert.deepEqual((await db.query("SELECT relname,relacl::text FROM pg_class WHERE relnamespace='public'::regnamespace AND relname NOT LIKE 'digital_%' ORDER BY relname")).rows,beforeAcl);
assert.equal((await db.query("SELECT count(*)::int n FROM digital_country_tax_rules WHERE decision='ALLOW'")).rows[0].n,0);
assert.deepEqual(await canaries(source),proof.canaries);
await writeFile("output/dcn-consolidation/final-upgrade-proof.json",JSON.stringify({backupReused:true,backupSha256:proof.backupSha256,encryptionVerified:true,actualIsolatedRestore:"PASS",finalMigrationHashes:sqlHashes,canaryTables:proof.canaries.length,historicalDataPreserved:true,historicalSourceUnchanged:true,runtimeProvisioning:"PASS",otherDomainAclPreserved:true,allowedCountries:0,plaintextRemoved:true},null,2));
await db.end();await ctl.end();await source.end();console.log(JSON.stringify({finalUpgrade:"PASS",sourceCanaryTables:proof.canaries.length,backupReused:true,allowedCountries:0}));
