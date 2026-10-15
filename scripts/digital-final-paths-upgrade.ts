/** Fresh LOCAL-only backup/restore/upgrade proof. Execution requires the reviewed SQL hash. */
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, chmod, link, mkdir, mkdtemp, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { Client } from "pg";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { provisionDigitalRuntime, DIGITAL_RUNTIME_TABLES, DIGITAL_UPDATE_COLUMNS } from "@/lib/digital/runtime-privileges";

const SOURCE = "lnx_dcn_consolidation_test", TARGET = "lnx_dcn_final_paths_test_20261015", ROLE = "dcn_runtime_a";
const MIGRATION = "20261015040000_digital_consumer_withdrawal", OUTPUT = "output/dcn-final-paths/upgrade-runtime.json";
const INITIAL_OUTPUT = "output/dcn-final-paths/upgrade-initial-attempt.json";
const PROFILE = ".private/dcn-final-paths-config.json", PRIVATE_PREFIX = "/private/tmp/lnx-dcn-final-paths-";
type Table = { table: string; columns: string[] };
type Canary = { table: string; count: number; hash: string };
type InitialAttempt = { source: string; target: string; migration: string; status: string; stage: string; failureCode: string;
  backup: { freshLocalLogical: string; sha256: string; encryptedArchive: string; encryption: string; keyStoredSeparately: boolean; decryptSha256Verified: boolean };
  restore: { actualIsolatedRestore: string; restoredCanaryTables: number; plaintextRemoved: boolean };
  appliedMigrations: Array<{ name: string; sha256: string }>; newColumnsExcludedFromHistoricalProjection: Array<{ table: string; column: string }> };
const proof: Record<string, unknown> = { source: SOURCE, target: TARGET, migration: MIGRATION, status: "NOT_RUN", stage: "PRECHECK",
  externalProviderCalls: 0, mediaObjectAccesses: 0, sourceMutation: false, historicalDataDeletion: false, productionMutation: false };
let stage = "PRECHECK";
const connections: Client[] = [];
let plainDump: string | null = null, recoveredDump: string | null = null;
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function privateJson(file: string) {
  const metadata = await stat(file);
  assert.equal(metadata.mode & 0o077, 0, "Private local configuration must not be group/world readable");
  const input = JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
  assert.equal(typeof input.DATABASE_URL, "string", "Local database configuration missing");
  return input;
}
function localUrl(value: string, database: string, role: string) {
  const url = assertSafeLocalPostgresUrl(value);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55473"); assert.equal(url.pathname, `/${database}`);
  assert.equal(decodeURIComponent(url.username), role); return url;
}
async function connect(url: URL, readOnly = false) {
  const connection=new URL(url),timezone=connection.searchParams.get("options");
  assert.ok(timezone===null||timezone==="-c timezone=UTC");connection.searchParams.delete("options");
  const db = new Client({ connectionString: connection.toString(), options: `-c statement_timeout=30000 -c lock_timeout=5000${timezone?` ${timezone}`:""}${readOnly ? " -c default_transaction_read_only=on" : ""}` });
  connections.push(db); await db.connect(); return db;
}
function pgEnvironment(url: URL, readOnly = false) {
  return { NODE_ENV:"test" as const, PATH: process.env.PATH, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1), PGSSLMODE: "disable", PGCONNECT_TIMEOUT: "10",
    ...(readOnly ? { PGOPTIONS: "-c default_transaction_read_only=on" } : {}) };
}
async function sha256(file: string) {
  const hash = createHash("sha256"); for await (const part of createReadStream(file)) hash.update(part); return hash.digest("hex");
}
/** Authenticate an existing backup in a stream, without restoring it or creating plaintext. */
async function verifyExistingEncryptedBackup(archive: string, expectedHash: string) {
  assert.match(archive, /^\/private\/tmp\/lnx-dcn-final-paths-[A-Za-z0-9]+\/source\.dump\.enc$/);
  assert.match(expectedHash, /^[a-f0-9]{64}$/);
  const temp = archive.slice(0, archive.lastIndexOf("/")), suffix = temp.slice(PRIVATE_PREFIX.length), keyPath = `.private/dcn-final-paths-backup-key-${suffix}.bin`;
  const keyMetadata = await stat(keyPath), archiveMetadata = await stat(archive);
  assert.equal(keyMetadata.mode & 0o077, 0); assert.equal(keyMetadata.size, 32); assert.equal(archiveMetadata.mode & 0o077, 0); assert.ok(archiveMetadata.size > 28);
  const file = await open(archive, "r"), iv = Buffer.alloc(12), tag = Buffer.alloc(16);
  try { assert.equal((await file.read(iv, 0, 12, 0)).bytesRead, 12); assert.equal((await file.read(tag, 0, 16, archiveMetadata.size - 16)).bytesRead, 16); }
  finally { await file.close(); }
  const key = await readFile(keyPath), hash = createHash("sha256"), decipher = createDecipheriv("aes-256-gcm", key, iv); key.fill(0); decipher.setAuthTag(tag);
  await pipeline(createReadStream(archive, { start: 12, end: archiveMetadata.size - 17 }), decipher,
    new Writable({ write(chunk, _encoding, done) { hash.update(chunk); done(); } }));
  assert.equal(hash.digest("hex"), expectedHash, "Existing encrypted backup must authenticate and retain its original SHA256");
  return temp;
}
async function verifyUpgradedTarget(target: Client, sourceTables: Table[], previous: InitialAttempt, sql: string) {
  const targetTables = await tables(target); assert.equal(targetTables.length, sourceTables.length);
  for (const sourceTable of sourceTables) {
    const current = targetTables.find(table => table.table === sourceTable.table); assert.ok(current, "Restored source table missing");
    const additions = previous.newColumnsExcludedFromHistoricalProjection.filter(column => column.table === sourceTable.table).map(column => column.column);
    assert.deepEqual([...current.columns].sort(), [...sourceTable.columns, ...additions].sort(), "Unexpected target schema drift");
  }
  const expectedAdditions = ["consumer_withdrawal_requests.digitalOrderId", "consumer_withdrawal_requests.requestKind", "consumer_withdrawal_requests.reviewReason", "digital_notifications.withdrawalRequestId"];
  assert.deepEqual(previous.newColumnsExcludedFromHistoricalProjection.map(column => `${column.table}.${column.column}`).sort(), expectedAdditions.sort());
  const owner = await target.query<{ owned: boolean }>("SELECT relowner=current_user::regrole AS owned FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'");
  assert.ok(owner.rows.length && owner.rows.every(row => row.owned), "All target tables require the expected migration owner");
  const nullable = await target.query<{ is_nullable: string }>("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='digital_notifications' AND column_name='orderId'");
  assert.equal(nullable.rows[0]?.is_nullable, "YES");
  const enumValue = await target.query("SELECT 1 FROM pg_enum WHERE enumtypid='\"ConsumerContractType\"'::regtype AND enumlabel='DIGITAL_ORDER'"); assert.equal(enumValue.rowCount, 1);
  const constraints = await target.query<{ conname: string }>("SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname=ANY($1::text[])",
    [["consumer_request_kind", "consumer_request_review_reason", "consumer_withdrawal_requests_parent_scope", "digital_notification_parent"]]);
  assert.equal(constraints.rows.length, 4, "Expected target domain constraints missing");
  const trigger = await target.query<{ tgenabled: string; prosrc: string }>("SELECT t.tgenabled,p.prosrc FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='consumer_withdrawal_requests'::regclass AND t.tgname='consumer_acknowledgement_immutable' AND NOT t.tgisinternal");
  const expectedBody = sql.match(/CREATE FUNCTION consumer_preserve_acknowledgement\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/)?.[1];
  assert.ok(expectedBody); assert.equal(trigger.rows.length, 1); assert.equal(trigger.rows[0]!.tgenabled, "O"); assert.equal(trigger.rows[0]!.prosrc, expectedBody, "Migration trigger changed since the reviewed SQL");
}
async function tables(db: Client): Promise<Table[]> {
  const found = await db.query<{ table: string }>("SELECT tablename AS table FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result = [];
  for (const { table } of found.rows) {
    const columns = await db.query<{ column: string }>("SELECT column_name AS column FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table]);
    result.push({ table, columns: columns.rows.map(row => row.column) });
  }
  return result;
}
/** Project source columns only: new nullable/default columns do not alter historical fingerprints. */
async function canaries(db: Client, sourceTables: Table[]): Promise<Canary[]> {
  const result = [];
  for (const table of sourceTables) {
    const projection = table.columns.map(column => `t.${quote(column)}`).join(",");
    const row = (await db.query<{ count: number; hash: string }>(`SELECT count(*)::int AS count,md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY to_jsonb(p)::text)::text,'[]')) AS hash FROM (SELECT ${projection} FROM public.${quote(table.table)} t) p`)).rows[0]!;
    result.push({ table: table.table, count: row.count, hash: row.hash });
  }
  return result;
}
async function aclSnapshot(db: Client, excludedTables: readonly string[] = []) {
  const relations = await db.query("SELECT c.relname,c.relkind,c.relacl::text,c.relowner::regrole::text AS owner FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND NOT(c.relname=ANY($1::text[])) ORDER BY c.relname", [excludedTables]);
  const columns = await db.query("SELECT c.relname,a.attname,a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped AND NOT(c.relname=ANY($1::text[])) ORDER BY c.relname,a.attnum", [excludedTables]);
  return { relations: relations.rows, columns: columns.rows };
}
async function writeProof() {
  await mkdir("output/dcn-final-paths", { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify({ ...proof, stage }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}
async function savepoint(db: Client, label: string, operation: () => Promise<void>) {
  await db.query(`SAVEPOINT ${label}`);
  try { await operation(); } finally { await db.query(`ROLLBACK TO SAVEPOINT ${label}`); await db.query(`RELEASE SAVEPOINT ${label}`); }
}
async function aclProof(runtime: Client, owner: Client) {
  const checks: Array<{ name: string; result: "PASS" }> = [];
  const positive = async (name: string, operation: () => Promise<void>) => { proof.runtimeLastCheck = name; await operation(); checks.push({ name, result: "PASS" }); };
  let sequence = 0;
  const denied = async (name: string, sql: string, code = "42501") => {
    proof.runtimeLastCheck = name;
    await savepoint(runtime, `deny_${++sequence}`, async () => { await assert.rejects(runtime.query(sql), { code }); });
    checks.push({ name, result: "PASS" });
  };
  await runtime.query("BEGIN");
  try {
    const identity = (await runtime.query<{ non_owner: boolean; safe: boolean }>(`SELECT current_user<>c.relowner::regrole::text AS non_owner,
      NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls AS safe
      FROM pg_class c CROSS JOIN pg_roles r WHERE c.oid='public.consumer_withdrawal_requests'::regclass AND r.rolname=current_user`)).rows[0]!;
    assert.equal(identity.non_owner, true); assert.equal(identity.safe, true); checks.push({ name: "real_runtime_non_owner_non_privileged", result: "PASS" });
    for (const table of ["consumer_withdrawal_requests", "digital_notifications"]) await positive(`select_${table}`, async () => { await runtime.query(`SELECT * FROM public.${quote(table)} LIMIT 0`); });
    const id = randomUUID(), notification = randomUUID(), now = new Date().toISOString();
    const hash = () => randomBytes(32).toString("hex");
    await positive("insert_digital_consumer_request", async () => {
      const result = await runtime.query(`INSERT INTO consumer_withdrawal_requests
        (id,"requestNumber","publicReceiptTokenHash","deduplicationHashSha256","contractType","claimedOrderReference","identityMatch","claimantFirstName","claimantLastName","claimantEmail","productDescription","declarationText","receivedAt","acknowledgementSnapshot","acknowledgementHashSha256","acknowledgementCreatedAt","updatedAt","requestKind")
        VALUES($1,$2,$3,$4,'DIGITAL_ORDER',$5,'UNMATCHED','QA','Local','acl-check@example.invalid','QA metadata only','QA request without refund',$6,'{}'::jsonb,$7,$6,$6,'WITHDRAWAL') RETURNING id`,
      [id, `LNX-RET-2026-${randomBytes(6).toString("hex").toUpperCase()}`, hash(), hash(), `DCN-QA-${randomUUID()}`, now, hash()]);
      assert.equal(result.rowCount, 1);
    });
    await positive("update_review_state_and_reason", async () => {
      assert.equal((await runtime.query(`UPDATE consumer_withdrawal_requests SET status='UNDER_REVIEW',"reviewReason"='QA local ACL review only',"updatedAt"=now() WHERE id=$1`, [id])).rowCount, 1);
    });
    await positive("update_receipt_token", async () => { assert.equal((await runtime.query('UPDATE consumer_withdrawal_requests SET "publicReceiptTokenHash"=$2 WHERE id=$1', [id, hash()])).rowCount, 1); });
    await positive("update_acknowledgement_transport_state", async () => {
      // now() is transaction start, earlier than the JavaScript receipt fixture created after BEGIN.
      assert.equal((await runtime.query(`UPDATE consumer_withdrawal_requests SET "acknowledgementStatus"='SENT',"acknowledgementSentAt"=GREATEST(clock_timestamp(),"acknowledgementCreatedAt") WHERE id=$1`, [id])).rowCount, 1);
    });
    await positive("insert_request_ack_notification_without_order", async () => {
      assert.equal((await runtime.query(`INSERT INTO digital_notifications(id,"orderId","withdrawalRequestId","businessKey",kind,recipient,template)
        VALUES($1,NULL,$2,$3,'CONSUMER_REQUEST_ACK','acl-check@example.invalid','{}'::jsonb)`, [notification, id, `final-paths-acl:${notification}`])).rowCount, 1);
    });
    await positive("update_notification_delivery_state", async () => {
      assert.equal((await runtime.query(`UPDATE digital_notifications SET status='CAPTURED_QA',"capturedAt"=now(),"transportId"='QA_NOT_DELIVERED',attempts=1 WHERE id=$1`, [notification])).rowCount, 1);
    });
    for (const table of ["consumer_withdrawal_requests", "digital_notifications"]) {
      for (const [name, sql] of [["delete", `DELETE FROM ${table} WHERE false`], ["truncate", `TRUNCATE ${table}`], ["ddl", `ALTER TABLE ${table} ADD COLUMN forbidden_final_paths_acl int`]] as const) await denied(`${name}_${table}`, sql);
    }
    for (const column of ["acknowledgementSnapshot", "acknowledgementHashSha256", "receivedAt", "digitalOrderId", "requestKind", "contractType", "claimantEmail"])
      await denied(`immutable_request_column_${column}`, `UPDATE consumer_withdrawal_requests SET ${quote(column)}=${quote(column)} WHERE false`);
    for (const column of ["orderId", "withdrawalRequestId", "businessKey", "recipient", "template"])
      await denied(`immutable_notification_column_${column}`, `UPDATE digital_notifications SET ${quote(column)}=${quote(column)} WHERE false`);
    await denied("append_only_digital_events", "UPDATE digital_events SET details=details WHERE false");
    await denied("digital_country_rules_read_only", "INSERT INTO digital_country_tax_rules DEFAULT VALUES");
    await denied("physical_shop_order_update_refused", "UPDATE shop_orders SET status=status WHERE false");
    await denied("historical_music_order_delete_refused", "DELETE FROM orders WHERE false");
    await denied("global_schema_create_refused", 'CREATE TABLE public."forbidden_final_paths_acl"(id int)');
  } finally { await runtime.query("ROLLBACK"); }
  // ACLs are not enough: verify the new immutable trigger as the migration owner, in an always-rolled-back fixture.
  await owner.query("BEGIN");
  try {
    const id = randomUUID(), hash = randomBytes(32).toString("hex");
    await owner.query(`INSERT INTO consumer_withdrawal_requests(id,"requestNumber","publicReceiptTokenHash","deduplicationHashSha256","contractType","claimedOrderReference","identityMatch","claimantFirstName","claimantLastName","claimantEmail","productDescription","declarationText","receivedAt","acknowledgementSnapshot","acknowledgementHashSha256","acknowledgementCreatedAt","updatedAt")
      VALUES($1,$2,$3,$3,'DIGITAL_ORDER','QA','UNMATCHED','QA','Local','acl-check@example.invalid','QA metadata only','QA immutable receipt',now(),'{}'::jsonb,$3,now(),now())`, [id, `LNX-RET-2026-${randomBytes(6).toString("hex").toUpperCase()}`, hash]);
    await savepoint(owner, "immutable_owner", async () => { await assert.rejects(owner.query('UPDATE consumer_withdrawal_requests SET "acknowledgementSnapshot"=$2::jsonb WHERE id=$1', [id, '{"changed":true}']), { code: "23514" }); });
    checks.push({ name: "owner_cannot_rewrite_durable_acknowledgement", result: "PASS" });
  } finally { await owner.query("ROLLBACK"); }
  return checks;
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  assert.ok(flags.has("--execute-local-final-paths"), "No execution without explicit local final-paths gate");
  const expectedSqlHash = [...flags].find(value => value.startsWith("--migration-sha256="))?.split("=")[1];
  assert.match(expectedSqlHash ?? "", /^[a-f0-9]{64}$/, "Reviewed migration hash is required");
  assert.ok([...flags].every(value => value === "--execute-local-final-paths" || value === "--resume-verified-empty" || value === "--resume-upgraded-qa" || value.startsWith("--migration-sha256=")), "Unexpected operation flag");
  const resume = flags.has("--resume-upgraded-qa");
  assert.ok(!(resume && flags.has("--resume-verified-empty")), "Conflicting resume modes");
  const sql = await readFile(`prisma/migrations/${MIGRATION}/migration.sql`, "utf8");
  const sqlHash = createHash("sha256").update(sql, "utf8").digest("hex"); assert.equal(sqlHash, expectedSqlHash, "Migration changed after review");
  const ownerCfg = await privateJson(".private/dcn-consolidation-owner-config.json"), cfg = await privateJson(".private/dcn-consolidation-config.json");
  const sourceUrl = localUrl(ownerCfg.DATABASE_URL!, SOURCE, "dcn_owner"), runtimeSource = localUrl(cfg.DATABASE_URL!, SOURCE, ROLE);
  for (const [key, value] of Object.entries(cfg)) assert.ok(!value || !/(?:^|_)(?:STRIPE|PAYPAL|RESEND)(?:_|$)/.test(key), "Source QA profile must not contain provider credentials");
  await assert.rejects(stat(PROFILE), { code: "ENOENT" }, "Preserve an existing final-paths QA profile");
  let previous: InitialAttempt | null = null, previousProofHash: string | null = null;
  if (resume) {
    const original = await readFile(OUTPUT, "utf8"); previousProofHash = createHash("sha256").update(original, "utf8").digest("hex");
    previous = JSON.parse(original) as InitialAttempt;
    assert.equal(previous.source, SOURCE); assert.equal(previous.target, TARGET); assert.equal(previous.migration, MIGRATION);
    assert.equal(previous.status, "FAIL"); assert.equal(previous.stage, "TARGET_RUNTIME_ACL"); assert.equal(previous.failureCode, "23514");
    assert.equal(previous.backup.freshLocalLogical, "PASS"); assert.equal(previous.backup.encryption, "AES-256-GCM");
    assert.equal(previous.backup.keyStoredSeparately, true); assert.equal(previous.backup.decryptSha256Verified, true);
    assert.equal(previous.restore.actualIsolatedRestore, "PASS"); assert.equal(previous.restore.plaintextRemoved, true);
    assert.deepEqual(previous.appliedMigrations, [{ name: MIGRATION, sha256: sqlHash }]);
    await assert.rejects(stat(INITIAL_OUTPUT), { code: "ENOENT" }, "Preserve any previously archived attempt; do not repeat resume blindly");
  } else await assert.rejects(stat(OUTPUT), { code: "ENOENT" }, "Preserve an existing final-paths upgrade proof");
  const controlUrl = new URL(sourceUrl); controlUrl.pathname = "/postgres";
  const control = await connect(controlUrl), existing = !!(await control.query("SELECT 1 FROM pg_database WHERE datname=$1", [TARGET])).rowCount;
  if (resume) assert.equal(existing, true, "Resume requires the exact already-upgraded disposable database");
  if (existing && !resume) {
    assert.ok(flags.has("--resume-verified-empty"), "Existing target must not be overwritten");
    const emptyUrl = new URL(sourceUrl); emptyUrl.pathname = `/${TARGET}`; const empty = await connect(emptyUrl);
    assert.equal((await empty.query("SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace")).rows[0].n, 0, "Resume requires a verified empty database");
    assert.equal((await empty.query("SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace")).rows[0].n, 0);
    assert.equal((await empty.query("SELECT count(*)::int n FROM pg_type WHERE typnamespace='public'::regnamespace")).rows[0].n, 0);
    assert.equal((await control.query("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1", [TARGET])).rows[0].owner, "dcn_owner");
  }
  if (resume) assert.equal((await control.query("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1", [TARGET])).rows[0].owner, "dcn_owner");
  const source = await connect(sourceUrl, true);
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const sourceTables = await tables(source);
  assert.ok(sourceTables.some(table => table.table === "digital_orders"), "Expected consolidation source required");
  assert.ok(!sourceTables.find(table => table.table === "consumer_withdrawal_requests")?.columns.includes("digitalOrderId"), "Source already contains target migration");
  const before = await canaries(source, sourceTables), sourceAcl = await aclSnapshot(source);
  const targetUrl = new URL(sourceUrl); targetUrl.pathname = `/${TARGET}`;
  let target: Client, temp: string;
  if (resume) {
    assert.ok(previous); assert.equal(sourceTables.length, previous.restore.restoredCanaryTables);
    stage = "VERIFY_UPGRADED_QA_READ_ONLY";
    target = await connect(targetUrl); await target.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await verifyUpgradedTarget(target, sourceTables, previous, sql);
    assert.deepEqual(await canaries(target, sourceTables), before, "Upgraded copy and fresh read-only source must match on all historical columns");
    await target.query("COMMIT");
    temp = await verifyExistingEncryptedBackup(previous.backup.encryptedArchive, previous.backup.sha256);
    await source.query("COMMIT");
    // Preserve the exact failed evidence recoverably before writing a new result.
    await link(OUTPUT, INITIAL_OUTPUT); assert.equal(await sha256(INITIAL_OUTPUT), previousProofHash); await unlink(OUTPUT);
    Object.assign(proof, { backup: previous.backup, restore: previous.restore, appliedMigrations: previous.appliedMigrations,
      newColumnsExcludedFromHistoricalProjection: previous.newColumnsExcludedFromHistoricalProjection,
      resume: { initialAttemptProof: INITIAL_OUTPUT, initialAttemptSha256: previousProofHash, cause: "ACL_FIXTURE_TRANSACTION_START_BEFORE_JS_RECEIPT",
        constraint: "consumer_withdrawal_requests_acknowledgement_state", fixtureCorrectedWithMonotonicTimestamp: true,
        encryptedBackupReauthenticated: true, sourceAndTargetCanaryTablesComparedBeforeRetry: before.length,
        newBackupCreated: false, restoreRepeated: false, migrationReapplied: false } });
  } else {
  const snapshot = (await source.query<{ snapshot: string }>("SELECT pg_export_snapshot() AS snapshot")).rows[0]!.snapshot;
  assert.match(snapshot, /^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/);
  stage = "LOCAL_BACKUP";
  temp = await mkdtemp(PRIVATE_PREFIX); const suffix = temp.slice(PRIVATE_PREFIX.length); await chmod(temp, 0o700);
  plainDump = `${temp}/source.dump`; recoveredDump = `${temp}/restore.dump`;
  const encrypted = `${temp}/source.dump.enc`, keyPath = `.private/dcn-final-paths-backup-key-${suffix}.bin`;
  execFileSync("pg_dump", ["--format=custom", "--no-owner", `--snapshot=${snapshot}`, "--file", plainDump], { env: pgEnvironment(sourceUrl, true), stdio: ["ignore", "pipe", "pipe"], timeout: 120000, maxBuffer: 65536 });
  await chmod(plainDump, 0o600); const backupHash = await sha256(plainDump);
  const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  await writeFile(keyPath, key, { mode: 0o600, flag: "wx" }); key.fill(0);
  await writeFile(encrypted, iv, { mode: 0o600, flag: "wx" });
  await pipeline(createReadStream(plainDump), cipher, createWriteStream(encrypted, { flags: "a", mode: 0o600 }));
  await appendFile(encrypted, cipher.getAuthTag());
  const savedKey = await readFile(keyPath), encryptedStat = await stat(encrypted), encryptedFile = await open(encrypted, "r"), savedIv = Buffer.alloc(12), tag = Buffer.alloc(16);
  try {
    assert.equal((await encryptedFile.read(savedIv, 0, 12, 0)).bytesRead, 12);
    assert.equal((await encryptedFile.read(tag, 0, 16, encryptedStat.size - 16)).bytesRead, 16);
  } finally { await encryptedFile.close(); }
  const decipher = createDecipheriv("aes-256-gcm", savedKey, savedIv); decipher.setAuthTag(tag); savedKey.fill(0);
  await pipeline(createReadStream(encrypted, { start: 12, end: encryptedStat.size - 17 }), decipher, createWriteStream(recoveredDump, { flags: "wx", mode: 0o600 }));
  assert.equal(await sha256(recoveredDump), backupHash, "Encrypted logical backup must be recoverable");
  proof.backup = { freshLocalLogical: "PASS", sha256: backupHash, encryptedArchive: encrypted, encryption: "AES-256-GCM", keyStoredSeparately: true, decryptSha256Verified: true };
  await source.query("COMMIT");
  stage = "ISOLATED_RESTORE";
  if (!existing) await control.query(`CREATE DATABASE ${TARGET} OWNER dcn_owner`);
  execFileSync("pg_restore", ["--exit-on-error", "--no-owner", "--dbname", TARGET, recoveredDump], { env: pgEnvironment(targetUrl), stdio: ["ignore", "pipe", "pipe"], timeout: 120000, maxBuffer: 65536 });
  await unlink(plainDump); plainDump = null; await unlink(recoveredDump); recoveredDump = null;
  target = await connect(targetUrl); assert.deepEqual(await canaries(target, sourceTables), before, "Restored historical rows must match");
  assert.deepEqual(await aclSnapshot(target), sourceAcl, "Restore preserves source ACLs");
  proof.restore = { actualIsolatedRestore: "PASS", restoredCanaryTables: before.length, plaintextRemoved: true };
  stage = "TARGET_MIGRATION";
  await target.query(sql);
  assert.deepEqual(await canaries(target, sourceTables), before, "Additive upgrade preserves every historical source-column value");
  proof.appliedMigrations = [{ name: MIGRATION, sha256: sqlHash }];
  const added = [];
  for (const table of await tables(target)) {
    const sourceTable = sourceTables.find(previous => previous.table === table.table);
    for (const column of table.columns) if (!sourceTable?.columns.includes(column)) added.push({ table: table.table, column });
  }
  proof.newColumnsExcludedFromHistoricalProjection = added;
  }
  stage = "TARGET_RUNTIME_ACL";
  const foreignBefore = await aclSnapshot(target, DIGITAL_RUNTIME_TABLES);
  await provisionDigitalRuntime(target, ROLE); const provisioned = await aclSnapshot(target);
  await provisionDigitalRuntime(target, ROLE); assert.deepEqual(await aclSnapshot(target), provisioned, "Provisioning must be idempotent");
  assert.deepEqual(await aclSnapshot(target, DIGITAL_RUNTIME_TABLES), foreignBefore, "Other-domain ACLs must not change");
  assert.ok(DIGITAL_UPDATE_COLUMNS.consumer_withdrawal_requests.includes("reviewReason"));
  const runtimeUrl = new URL(runtimeSource); runtimeUrl.pathname = `/${TARGET}`;
  runtimeUrl.searchParams.set("options", "-c timezone=UTC");
  const runtime = await connect(runtimeUrl), checks = await aclProof(runtime, target);
  assert.deepEqual(await canaries(target, sourceTables), before, "ACL fixtures must roll back without changing history");
  proof.runtime = { role: ROLE, nonOwner: true, provisioning: "PASS", secondProvisioning: "PASS", otherDomainAclPreserved: true, checks, checkCount: checks.length, syntheticFixturesRolledBack: true };
  stage = "SOURCE_RECHECK";
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.deepEqual(await tables(source), sourceTables, "Source schema must remain unchanged");
  assert.deepEqual(await canaries(source, sourceTables), before, "Source rows must remain unchanged on a fresh read");
  assert.deepEqual(await aclSnapshot(source), sourceAcl, "Source ACLs must remain unchanged");
  assert.equal((await source.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only, "on");
  await source.query("COMMIT");
  proof.sourceRecheck = { schema: "PASS", data: "PASS", acl: "PASS", connectionReadOnly: true, canaries: before };
  const profile = { ...cfg, DATABASE_URL: runtimeUrl.toString(), DCN_ENABLED: "false", DCN_MODE: "TEST", DCN_NEW_PAYMENTS_ENABLED: "false", DCN_EXTERNAL_TEST_AUTHORIZED: "false",
    DCN_LOCAL_REVIEW_AUTHORIZED: "false", ADS_ENABLED: "false", MEDIA_STORAGE_DRIVER: "local", DCN_STORAGE_MODE: "LOCAL", EMAIL_PROVIDER: "capture",
    DCN_WORK_ROOT: `${temp}/work`, DCN_LOCAL_UPLOAD_ROOT: `${temp}/parts`, DCN_EMAIL_CAPTURE_ROOT: `${temp}/mail` };
  await mkdir(".private", { recursive: true, mode: 0o700 }); await writeFile(PROFILE, JSON.stringify(profile), { mode: 0o600, flag: "wx" });
  proof.qaProfileCreated = true; proof.qaProfilePermissions = "0600"; proof.qaFlagsClosed = true;
  stage = "COMPLETE"; proof.status = "PASS"; await writeProof();
  console.log(JSON.stringify({ finalPathsLocalUpgrade: "PASS", migration: MIGRATION, canaryTables: before.length, runtimeAclChecks: checks.length, proof: OUTPUT, sourceUnchanged: true }));
}

try { await main(); }
catch (error) {
  proof.status = "FAIL"; proof.failureCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : "LOCAL_GATE_FAILED";
  if (error && typeof error === "object" && "constraint" in error && typeof error.constraint === "string" && /^[A-Za-z0-9_]{1,120}$/.test(error.constraint)) proof.failureConstraint = error.constraint;
  await writeProof().catch(() => undefined);
  console.error(JSON.stringify({ finalPathsLocalUpgrade: "FAIL", stage, code: proof.failureCode, proof: OUTPUT })); process.exitCode = 1;
} finally {
  // These exact paths were created by this invocation; encrypted archives and separate keys remain recoverable.
  for (const file of [plainDump, recoveredDump]) if (file) await unlink(file).catch(() => undefined);
  for (const db of connections.reverse()) await db.end().catch(() => undefined);
}
