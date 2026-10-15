/** Follow-up SQL-only upgrade on the already restored new QA copy. No second export/restore. */
import assert from "node:assert/strict";
import {readFile,writeFile,stat,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {Client} from "pg";
import {assertSafeDigitalLocalPostgresUrl} from "@/lib/digital/local-review-database";
const TARGET="lnx_dcn_france_commercial_test_20261015",MIGRATION="20261015060000_digital_master_equivalence",ROOT="output/dcn-france-commercial";
const q=(s:string)=>`"${s.replaceAll('"','""')}"`,connections:Client[]=[];
const proof:Record<string,unknown>={status:"NOT_RUN",database:TARGET,migration:MIGRATION,scope:"ALREADY_RESTORED_NEW_LOCAL_COPY_ONLY",externalCalls:0,sourceMutation:false,productionAccess:false};
async function canaries(db:Client){const result=[];for(const t of(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows){const c=await db.query(`SELECT count(*)::int AS count,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM ${q(t.tablename)} t`);result.push({table:t.tablename,...c.rows[0]});}return result;}
async function main(){
  const previous=JSON.parse(await readFile(`${ROOT}/upgrade-runtime.json`,"utf8"));assert.equal(previous.status,"PASS");assert.equal(previous.restore.status,"PASS");assert.equal(previous.target,TARGET);
  const args=process.argv.slice(2);assert.equal(args.length,1);assert.match(args[0],/^--migration-sha256=[a-f0-9]{64}$/);
  const sql=await readFile(`prisma/migrations/${MIGRATION}/migration.sql`,"utf8"),hash=createHash("sha256").update(sql).digest("hex");assert.equal(hash,args[0].slice(19));
  assert.ok(/CREATE OR REPLACE FUNCTION digital_verify_completion_credit\(\)/.test(sql));
  const p=".private/dcn-consolidation-owner-config.json";assert.equal((await stat(p)).mode&0o077,0);const cfg=JSON.parse(await readFile(p,"utf8")),u=assertSafeDigitalLocalPostgresUrl(cfg.DATABASE_URL);
  assert.equal(u.hostname,"127.0.0.1");assert.equal(u.port,"55473");assert.equal(u.username,"dcn_owner");assert.equal(u.pathname,"/lnx_dcn_consolidation_test");u.pathname=`/${TARGET}`;
  const db=new Client({connectionString:u.toString(),options:"-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=5000"});connections.push(db);await db.connect();
  assert.equal((await db.query("SELECT current_database() AS name")).rows[0].name,TARGET);
  const before=await canaries(db),acl=(await db.query("SELECT relname,relacl::text FROM pg_class WHERE relnamespace='public'::regnamespace ORDER BY relname")).rows;
  const body=(await db.query("SELECT pg_get_functiondef('digital_verify_completion_credit()'::regprocedure) AS sql")).rows[0].sql;
  await writeFile(`${ROOT}/completion-trigger-before-equivalence.sql`,body,{flag:"wx"});
  await db.query("BEGIN");try{await db.query(sql);assert.deepEqual(await canaries(db),before);assert.deepEqual((await db.query("SELECT relname,relacl::text FROM pg_class WHERE relnamespace='public'::regnamespace ORDER BY relname")).rows,acl);await db.query("COMMIT");}catch(error){await db.query("ROLLBACK");throw error;}
  Object.assign(proof,{status:"PASS",migrationSha256:hash,historicalDataCanaries:before,aclUnchanged:true,backupRestoreReused:true,previousLocalBackupSha256:previous.backup.sha256,oldFunctionDefinitionSaved:true});
}
try{await main();}catch(error){proof.status="FAIL";proof.code=error&&typeof error==="object"&&"code"in error?error.code:"LOCAL_UPGRADE_FAILED";process.exitCode=1;}
finally{for(const db of connections)await db.end().catch(()=>undefined);await mkdir(ROOT,{recursive:true});await writeFile(`${ROOT}/equivalence-upgrade.json`,JSON.stringify(proof,null,2),{flag:"wx"});console.log(JSON.stringify({status:proof.status,proof:`${ROOT}/equivalence-upgrade.json`,externalCalls:0,productionAccess:false}));}
