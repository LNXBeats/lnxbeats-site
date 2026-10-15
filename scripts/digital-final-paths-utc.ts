/** Correct only the generated NEW local QA profile. No database setting or old evidence is changed. */
import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import { Client } from "pg";
import { assertSafeDigitalLocalPostgresUrl as assertSafeLocalPostgresUrl } from "@/lib/digital/local-review-database";
const file=".private/dcn-final-paths-config.json",cfg=JSON.parse(await readFile(file,"utf8"));
const url=assertSafeLocalPostgresUrl(cfg.DATABASE_URL);
assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"55473");assert.equal(url.pathname,"/lnx_dcn_final_paths_test_20261015");assert.equal(url.username,"dcn_runtime_a");
assert.equal(cfg.DCN_NEW_PAYMENTS_ENABLED,"false");assert.equal(cfg.DCN_EXTERNAL_TEST_AUTHORIZED,"false");
assert.ok([null,"-c timezone=UTC"].includes(url.searchParams.get("options")),"Unexpected QA connection options; stop instead of replacing them");
const before=new Client({connectionString:url.toString(),options:'-c default_transaction_read_only=on'});await before.connect();
const previousTimezone=(await before.query("SHOW TimeZone")).rows[0].TimeZone;
const original=(await before.query('SELECT extract(epoch FROM "receivedAt")::text AS epoch,"acknowledgementHashSha256" AS hash,"acknowledgementSnapshot"->>\'receivedAt\' AS "snapshotTime" FROM consumer_withdrawal_requests WHERE "requestNumber"=$1',["LNX-RET-2026-1F9CD390D8A0"])).rows[0];
assert.ok(original);await before.end();
url.searchParams.set("options","-c timezone=UTC");
const checked=new Client({connectionString:url.toString()});await checked.connect();
assert.equal((await checked.query("SHOW TimeZone")).rows[0].TimeZone,"UTC");
await checked.query("BEGIN READ ONLY");
const after=(await checked.query('SELECT extract(epoch FROM "receivedAt")::text AS epoch,"acknowledgementHashSha256" AS hash,"acknowledgementSnapshot"->>\'receivedAt\' AS "snapshotTime" FROM consumer_withdrawal_requests WHERE "requestNumber"=$1',["LNX-RET-2026-1F9CD390D8A0"])).rows[0];
assert.deepEqual(after,original);await checked.query("COMMIT");await checked.end();
cfg.DATABASE_URL=url.toString();await writeFile(file,JSON.stringify(cfg),{mode:0o600});
await writeFile("output/dcn-final-paths/utc-session-correction.json",JSON.stringify({status:"PASS",environment:"NEW_LOCAL_QA_PROFILE_ONLY",previousTimezone,newSessionTimezone:"UTC",profilePermissions:"0600",databaseGlobalSettingChanged:false,sourceProfileChanged:false,historicalRowsChanged:false,
  initialSyntheticReceipt:{reference:"LNX-RET-2026-1F9CD390D8A0",sqlAndSnapshotEpochMismatchObserved:Number(original.epoch)*1000!==Date.parse(original.snapshotTime),preservedUnmodified:true},
  cause:"Existing adapter-pg serializes Date as UTC wall time without offset and normalizes timestamptz by stripping server offset; it requires UTC sessions. Local QA inherited a non-UTC server timezone.",
  correction:"Explicit UTC connection option for this generated QA copy; new DCN application guard refuses unsafe timezone before writes. No historical timestamp or receipt rewritten.",productionAccess:false,providerCalls:0},null,2));
console.log(JSON.stringify({localProfileUtc:"PASS",databaseMutation:false,historicalReceiptPreserved:true}));
