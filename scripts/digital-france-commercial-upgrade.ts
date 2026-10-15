/** Restore a NEW local QA copy, never migrate an acquired/historical QA database. */
import assert from "node:assert/strict";
import { randomBytes,createCipheriv,createDecipheriv,createHash } from "node:crypto";
import { createReadStream,createWriteStream } from "node:fs";
import { readFile,writeFile,appendFile,stat,mkdir,mkdtemp,chmod,unlink,open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { assertSafeDigitalLocalPostgresUrl } from "@/lib/digital/local-review-database";
import { provisionDigitalRuntime,DIGITAL_RUNTIME_TABLES } from "@/lib/digital/runtime-privileges";

const SOURCE="lnx_dcn_final_paths_test_20261015",TARGET="lnx_dcn_france_commercial_test_20261015",ROLE="dcn_runtime_a";
const MIGRATION="20261015050000_digital_free_completion",ROOT="output/dcn-france-commercial",PROFILE=".private/dcn-france-commercial-config.json";
const proof:Record<string,unknown>={status:"NOT_RUN",source:SOURCE,target:TARGET,sourceMutation:false,productionAccess:false,externalCalls:0};
const connections:Client[]=[];let stage="PRECHECK",plain:string|undefined,recovered:string|undefined;
const q=(s:string)=>`"${s.replaceAll('"','""')}"`;
const digest=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
async function config(file:string){assert.equal((await stat(file)).mode&0o077,0);return JSON.parse(await readFile(file,"utf8")) as Record<string,string>;}
function url(value:string,name:string,role:string){const u=assertSafeDigitalLocalPostgresUrl(value);assert.equal(u.hostname,"127.0.0.1");assert.equal(u.port,"55473");assert.equal(u.pathname,`/${name}`);assert.equal(u.username,role);return u;}
async function connect(u:URL,readOnly=false){const connection=new URL(u);connection.searchParams.delete("options");const c=new Client({connectionString:connection.toString(),options:`-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=5000${readOnly?" -c default_transaction_read_only=on":""}`});connections.push(c);await c.connect();return c;}
function pgEnv(u:URL){return{NODE_ENV:"test" as const,PATH:process.env.PATH,PGHOST:u.hostname,PGPORT:u.port,PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1),PGCONNECT_TIMEOUT:"10",PGSSLMODE:"disable",PGOPTIONS:"-c timezone=UTC"};}
type Table={name:string;columns:string[]};
async function tables(c:Client):Promise<Table[]>{const list=(await c.query("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows,result:Table[]=[];for(const t of list)result.push({name:t.name,columns:(await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[t.name])).rows.map(r=>r.column_name)});return result;}
async function canaries(c:Client,all:Table[]){const result=[];for(const t of all){const row=(await c.query(`SELECT count(*)::int AS count,md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY to_jsonb(p)::text)::text,'[]')) AS hash FROM (SELECT ${t.columns.map(k=>`t.${q(k)}`).join(",")} FROM public.${q(t.name)} t) p`)).rows[0];result.push({table:t.name,...row});}return result;}
async function acl(c:Client,exclude:readonly string[]=[]){return{tables:(await c.query("SELECT relname,relacl::text,relowner::regrole::text AS owner FROM pg_class WHERE relnamespace='public'::regnamespace AND NOT(relname=ANY($1::text[])) ORDER BY relname",[exclude])).rows,columns:(await c.query("SELECT c.relname,a.attname,a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped AND NOT(c.relname=ANY($1::text[])) ORDER BY c.relname,a.attnum",[exclude])).rows};}
async function main(){
  const args=process.argv.slice(2);assert.equal(args.length,2);assert.ok(args.includes("--execute-local-france-commercial"));
  const expected=args.find(a=>a.startsWith("--migration-sha256="))?.slice(19);assert.match(expected??"",/^[a-f0-9]{64}$/);
  const sql=await readFile(`prisma/migrations/${MIGRATION}/migration.sql`,"utf8");assert.equal(digest(sql),expected);
  const ownerCfg=await config(".private/dcn-consolidation-owner-config.json"),cfg=await config(".private/dcn-final-paths-config.json");
  const originalOwner=url(ownerCfg.DATABASE_URL,"lnx_dcn_consolidation_test","dcn_owner");originalOwner.pathname=`/${SOURCE}`;
  const runtimeSource=url(cfg.DATABASE_URL,SOURCE,ROLE);
  for(const key of Object.keys(cfg))assert.ok(!/(STRIPE|PAYPAL|RESEND|RAILWAY|AWS|R2|SMTP)/i.test(key));
  await assert.rejects(stat(PROFILE),{code:"ENOENT"},"Preserve an existing QA profile.");
  const controlUrl=new URL(originalOwner);controlUrl.pathname="/postgres";const control=await connect(controlUrl);
  assert.equal((await control.query("SELECT 1 FROM pg_database WHERE datname=$1",[TARGET])).rowCount,0,"Never overwrite an existing database.");
  const source=await connect(originalOwner,true);await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal((await source.query("SHOW transaction_read_only")).rows[0].transaction_read_only,"on");
  const schema=await tables(source);assert.ok(schema.find(t=>t.name==="consumer_withdrawal_requests")?.columns.includes("digitalOrderId"));
  const before=await canaries(source,schema),sourceAcl=await acl(source),snapshot=(await source.query("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot;
  assert.match(snapshot,/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/);
  stage="LOCAL_BACKUP";const temp=await mkdtemp("/private/tmp/lnx-dcn-france-commercial-");await chmod(temp,0o700);
  plain=`${temp}/source.dump`;recovered=`${temp}/restore.dump`;
  execFileSync("pg_dump",["--format=custom","--no-owner",`--snapshot=${snapshot}`,"--file",plain],{env:{...pgEnv(originalOwner),PGOPTIONS:"-c timezone=UTC -c default_transaction_read_only=on"},stdio:["ignore","pipe","pipe"],timeout:120000,maxBuffer:65536});
  await chmod(plain,0o600);const backupHash=digest(await readFile(plain)),key=randomBytes(32),iv=randomBytes(12),enc=`${temp}/source.dump.enc`,keyFile=`.private/dcn-france-commercial-backup-key-${temp.split("-").pop()}.bin`;
  await writeFile(keyFile,key,{mode:0o600,flag:"wx"});const cipher=createCipheriv("aes-256-gcm",key,iv);await writeFile(enc,iv,{mode:0o600,flag:"wx"});
  await pipeline(createReadStream(plain),cipher,createWriteStream(enc,{flags:"a",mode:0o600}));await appendFile(enc,cipher.getAuthTag());key.fill(0);
  const bytes=await stat(enc),file=await open(enc,"r"),tag=Buffer.alloc(16);try{await file.read(tag,0,16,bytes.size-16);}finally{await file.close();}
  const savedKey=await readFile(keyFile),decipher=createDecipheriv("aes-256-gcm",savedKey,iv);savedKey.fill(0);decipher.setAuthTag(tag);
  await pipeline(createReadStream(enc,{start:12,end:bytes.size-17}),decipher,createWriteStream(recovered,{flags:"wx",mode:0o600}));assert.equal(digest(await readFile(recovered)),backupHash);
  proof.backup={scope:"LOCAL_QA_ONLY",sha256:backupHash,encryption:"AES-256-GCM",keyStoredSeparately:true,recoverable:true,encryptedArchive:enc};
  await source.query("COMMIT");stage="ISOLATED_RESTORE";
  await control.query(`CREATE DATABASE ${q(TARGET)} OWNER dcn_owner`);
  const targetUrl=new URL(originalOwner);targetUrl.pathname=`/${TARGET}`;
  execFileSync("pg_restore",["--exit-on-error","--no-owner","--dbname",TARGET,recovered],{env:pgEnv(targetUrl),stdio:["ignore","pipe","pipe"],timeout:120000,maxBuffer:65536});
  await unlink(plain);plain=undefined;await unlink(recovered);recovered=undefined;
  const target=await connect(targetUrl);assert.deepEqual(await canaries(target,schema),before);assert.deepEqual(await acl(target),sourceAcl);
  proof.restore={status:"PASS",canaryTables:schema.length,plaintextRemoved:true};
  stage="UPGRADE";await target.query("BEGIN");try{await target.query(sql);assert.deepEqual(await canaries(target,schema),before);await target.query("COMMIT");}catch(error){await target.query("ROLLBACK");throw error;}proof.migration={name:MIGRATION,sha256:expected,status:"PASS",historicalRowsPreserved:true};
  stage="ACL";const foreignBefore=await acl(target,DIGITAL_RUNTIME_TABLES);await provisionDigitalRuntime(target,ROLE);const first=await acl(target);await provisionDigitalRuntime(target,ROLE);assert.deepEqual(await acl(target),first);assert.deepEqual(await acl(target,DIGITAL_RUNTIME_TABLES),foreignBefore);
  const runtimeUrl=new URL(runtimeSource);runtimeUrl.pathname=`/${TARGET}`;runtimeUrl.searchParams.set("options","-c timezone=UTC");const runtime=await connect(runtimeUrl);await runtime.query("BEGIN");
  const checks:string[]=[];
  try{
    const identity=(await runtime.query("SELECT current_user<>c.relowner::regrole::text AS non_owner,NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolbypassrls AS safe FROM pg_class c CROSS JOIN pg_roles r WHERE c.oid='digital_orders'::regclass AND r.rolname=current_user")).rows[0];assert.equal(identity.non_owner,true);assert.equal(identity.safe,true);checks.push("non_owner_runtime");
    for(const table of ["digital_orders","digital_order_lines","digital_completion_credits","digital_documents","digital_entitlements","digital_events"]){await runtime.query(`SELECT * FROM ${q(table)} LIMIT 0`);checks.push(`read_${table}`);}
    let n=0;for(const [name,query]of[["no_delete_orders","DELETE FROM digital_orders WHERE false"],["append_only_events","UPDATE digital_events SET details=details WHERE false"],["immutable_documents","UPDATE digital_documents SET snapshot=snapshot WHERE false"],["no_tax_approval","INSERT INTO digital_country_tax_rules DEFAULT VALUES"],["no_ddl","CREATE TABLE public.forbidden_dcn_commercial(id int)"],["physical_shop_unchanged","UPDATE shop_orders SET status=status WHERE false"]]){const save=`acl_${++n}`;await runtime.query(`SAVEPOINT ${save}`);await assert.rejects(runtime.query(query),{code:"42501"});await runtime.query(`ROLLBACK TO SAVEPOINT ${save}`);await runtime.query(`RELEASE SAVEPOINT ${save}`);checks.push(name);}
  }finally{await runtime.query("ROLLBACK");}
  assert.deepEqual(await canaries(target,schema),before);proof.runtime={status:"PASS",role:ROLE,checks,otherDomainAclUnchanged:true,provisioningIdempotent:true};
  stage="SOURCE_RECHECK";await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");assert.deepEqual(await tables(source),schema);assert.deepEqual(await canaries(source,schema),before);assert.deepEqual(await acl(source),sourceAcl);await source.query("COMMIT");proof.sourceRecheck={status:"PASS",canaries:before,readOnly:true};
  const profile={...cfg,DATABASE_URL:runtimeUrl.toString(),DCN_ENABLED:"false",DCN_MODE:"TEST",DCN_NEW_PAYMENTS_ENABLED:"false",DCN_EXTERNAL_TEST_AUTHORIZED:"false",DCN_LOCAL_REVIEW_AUTHORIZED:"false",ADS_ENABLED:"false",MEDIA_STORAGE_DRIVER:"local",DCN_STORAGE_MODE:"LOCAL",EMAIL_PROVIDER:"capture",DCN_WORK_ROOT:`${temp}/work`,DCN_LOCAL_UPLOAD_ROOT:`${temp}/parts`,DCN_EMAIL_CAPTURE_ROOT:`${temp}/mail`};
  await writeFile(PROFILE,JSON.stringify(profile),{flag:"wx",mode:0o600});stage="COMPLETE";proof.status="PASS";
}
try{await main();}catch(error){proof.status="FAIL";proof.errorCode=error&&typeof error==="object"&&"code"in error&&typeof error.code==="string"&&/^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:"LOCAL_GATE_FAILED";process.exitCode=1;}
finally{for(const file of[plain,recovered])if(file)await unlink(file).catch(()=>undefined);for(const c of connections.reverse())await c.end().catch(()=>undefined);await mkdir(ROOT,{recursive:true});await writeFile(`${ROOT}/upgrade-runtime.json`,JSON.stringify({...proof,stage},null,2),{flag:"wx"});console.log(JSON.stringify({status:proof.status,stage,proof:`${ROOT}/upgrade-runtime.json`,externalCalls:0,sourceMutation:false}));}
