/** REAL PostgreSQL/FFmpeg/local storage. Provider doubles only; no external request. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, writeFile, chmod,utimes,copyFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { execFileSync,execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { Client } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { provisionDigitalRuntime, DIGITAL_RUNTIME_TABLES, DIGITAL_UPDATE_COLUMNS } from "@/lib/digital/runtime-privileges";
import { createAudioFixture } from "@/tests/audio/fixture";
import type { DigitalGateway } from "@/lib/digital/providers";
import type { DigitalPaymentEvidence } from "@/lib/digital/domain";
import type { DigitalFinanceGateway, DigitalRefundEvidence } from "@/lib/digital/finance-policy";
const runId = randomUUID(), name = `lnx_dcn11_${runId.replaceAll("-", "").slice(0, 16)}`;
const cfg = JSON.parse(await readFile(".private/dcn-review-config.json", "utf8"));
const source = assertSafeLocalPostgresUrl(cfg.DATABASE_URL); assert.equal(source.pathname, "/lnx_dcn_runtime_test"); assert.equal(source.port, "55473");
const server = new URL(source); server.username = "dcn_owner"; server.pathname = "/postgres";
const control = new Client({ connectionString: server.toString() }); await control.connect();
const root = await mkdtemp("/private/tmp/lnx-dcn-11-runtime-");
const backup = `${root}/dcn-1-0-local.dump`; const sourceOwner = new URL(source); sourceOwner.username = "dcn_owner";
const sourceSql=new Client({connectionString:sourceOwner.toString()});await sourceSql.connect();
const upgraded=!!(await sourceSql.query("SELECT 1 FROM information_schema.columns WHERE table_name='digital_orders' AND column_name='contractSnapshot'")).rowCount;await sourceSql.end();
if(upgraded){const proof=JSON.parse(await readFile(".private/dcn-preview-upgrade-proof.json","utf8"));assert.ok(proof.file.startsWith("/private/tmp/lnx-dcn-preview-preserved-"));assert.equal(createHash("sha256").update(await readFile(proof.file)).digest("hex"),proof.sha256);await copyFile(proof.file,backup);}
else execFileSync("pg_dump", ["-Fc", "--no-owner", "--no-acl", "--file", backup, sourceOwner.toString()], { stdio: "pipe" });await chmod(backup, 0o600);
const backupHash = createHash("sha256").update(await readFile(backup)).digest("hex");
await control.query(`CREATE DATABASE "${name}" OWNER dcn_owner`);
const target = new URL(sourceOwner); target.pathname = `/${name}`;
execFileSync("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", "--dbname", target.toString(), backup], { stdio: "pipe" });
const db = new Client({ connectionString: target.toString() }); await db.connect();
const observer=new Client({connectionString:target.toString()});await observer.connect();
const beforeTables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename as string);
const fingerprint = async () => { const rows = []; for (const t of beforeTables) { const value = t === "digital_orders" ? "to_jsonb(t)-'contractSnapshot'" : t === "digital_uploads" ? "to_jsonb(t)-'leaseToken'-'cleanupAt'" : "to_jsonb(t)";
  rows.push((await db.query(`SELECT '${t}' name,count(*)::int n,md5(coalesce(jsonb_agg(${value} ORDER BY (${value})::text)::text,'[]')) hash FROM "${t}" t`)).rows[0]); } return rows; };
const before = await fingerprint();
execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", target.toString(), "-f", "prisma/migrations/20261013020000_digital_fulfillment/migration.sql"], { stdio: "pipe" });
assert.deepEqual(await fingerprint(), before, "Upgrade must preserve every restored row, including acquired versions and historic states");
assert.equal((await db.query('SELECT count(*)::int n FROM digital_orders WHERE "contractSnapshot" IS NOT NULL')).rows[0].n,0,"No historic contract fabricated by upgrade");
const oldAcl = (await db.query("SELECT relname,relacl::text FROM pg_class WHERE relnamespace='public'::regnamespace AND relname NOT LIKE 'digital_%' ORDER BY relname")).rows;
for (const role of ["dcn_runtime_a", "dcn_runtime_b"]) { await provisionDigitalRuntime(db, role); await provisionDigitalRuntime(db, role); }
assert.deepEqual((await db.query("SELECT relname,relacl::text FROM pg_class WHERE relnamespace='public'::regnamespace AND relname NOT LIKE 'digital_%' ORDER BY relname")).rows, oldAcl);
await db.query('GRANT SELECT ON users,projects,tracks,assets TO dcn_runtime_a,dcn_runtime_b; GRANT INSERT ON assets TO dcn_runtime_a; GRANT UPDATE ("rightsStatus","updatedAt") ON assets TO dcn_runtime_a');
const runtime = new URL(target); runtime.username = "dcn_runtime_a";
const workRoot = `${root}/work`, parts = `${root}/parts`, mail = `${root}/mail`;
Object.assign(process.env, cfg, { DATABASE_URL: runtime.toString(), DCN_NEW_PAYMENTS_ENABLED: "true", DCN_WORK_ROOT: workRoot, DCN_LOCAL_UPLOAD_ROOT: parts, DCN_EMAIL_CAPTURE_ROOT: mail, EMAIL_PROVIDER: "capture" });
const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
const { prisma } = await import("@/lib/prisma");
const { initDigitalUpload, writeDigitalLocalPart, completeDigitalUpload,abortDigitalUpload } = await import("@/lib/digital/upload");
const { saveOffer, syncCart } = await import("@/lib/digital/catalog");
const { createDigitalCheckout, reconcileDigitalEvidence } = await import("@/lib/digital/commerce");
const { processDigitalDocuments, digitalDocumentResponse, acknowledgeDigitalContract } = await import("@/lib/digital/documents");
const { processDigitalNotifications } = await import("@/lib/digital/notifications");
const { requestDigitalRefund, processDigitalRefund, recordDigitalRefundEvidence, recordDigitalDisputeEvidence } = await import("@/lib/digital/finance");
const { receiveDigitalEvent, processDigitalInbox } = await import("@/lib/digital/inbox");
const { createDigitalDownload, digitalDownloadResponse } = await import("@/lib/digital/library");
const { claimDigitalSlot, releaseDigitalSlot } = await import("@/lib/digital/work-slots");
const { cleanupDigitalRun,cleanupStaleDigitalWork } = await import("@/lib/digital/cleanup");
let groups = 0; const evidence: Array<{ name: string; status: string }> = [];
async function test(label: string, f: () => Promise<void>) { await f(); groups++; evidence.push({ name: label, status: "PASS" }); console.log(`PASS ${label}`); }
const admin = await owner.user.create({ data: { email: `dcn11-admin-${runId}@example.invalid`, displayName: "DCN11 QA Admin", role: "ADMIN", emailVerified: true, status: "ACTIVE" } });
const actor = (u: typeof admin) => ({ id: u.id, email: u.email, name: u.displayName, role: u.role, status: "ACTIVE" as const, emailVerified: true as const });
const member = () => owner.user.create({ data: { email: `dcn11-${randomUUID()}@example.invalid`, displayName: "Acheteur QA DCN11", emailVerified: true, status: "ACTIVE" } });
const project = await owner.project.create({ data: { slug: `dcn11-${runId}`, title: "DCN11 — Album synthétique de douze pistes", status: "PUBLISHED", publicVisible: true, type: "ALBUM", catalogPosition: 950,
  tracks: { create: Array.from({ length: 12 }, (_, i) => ({ title: `Piste synthétique ${i + 1}`, position: i + 1, status: "RELEASED" as const })) } }, include: { tracks: { orderBy: { position: "asc" } } } });
const remote = new Map<string, DigitalPaymentEvidence>(); let creates = 0, refundsPosted = 0;
const gateway: DigitalGateway = { merchantId: "dcn11-local-merchant", async create(o, a) { creates++; const e: DigitalPaymentEvidence = { authenticated: true, mode: "TEST", provider: a.provider as "STRIPE" | "PAYPAL", merchantId: "dcn11-local-merchant", orderId: o.id, providerReference: `dcn11-session-${a.id}`, paymentReference: `dcn11-payment-${a.id}`, amountCents: o.totalCents, currency: "EUR", status: "PAID", eventId: `dcn11-paid-${a.id}` }; remote.set(o.id, e); return { id: e.providerReference, url: a.provider === "PAYPAL" ? "https://www.sandbox.paypal.com/checkoutnow" : "https://checkout.stripe.com/c/qa_local_only" }; },
  async recover(o) { const e = remote.get(o.id); return e ? { evidence: e } : null; } };
let peakRss = process.memoryUsage().rss, peakExternal = 0, peakArrayBuffers = 0, peakChildrenRssKiB = 0, peakSlots = 0, cumulativeBytes = 0;
const workerMeasurements:unknown[]=[];const exec=promisify(execFile);
async function worker(kind="audio"){const r=await exec(process.execPath,["--conditions=react-server","--import","tsx","scripts/digital-worker-once.ts",kind],{env:process.env,timeout:20*60000,maxBuffer:4096});const result=JSON.parse(r.stdout.trim());workerMeasurements.push(result);return result;}
const started = performance.now(); let timerBusy = false;
const monitor = setInterval(() => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakExternal = Math.max(peakExternal, m.external); peakArrayBuffers = Math.max(peakArrayBuffers, m.arrayBuffers);
  if (timerBusy) return; timerBusy = true; void observer.query('SELECT count(*)::int n FROM digital_work_slots WHERE "leaseUntil">clock_timestamp()').then(r => { peakSlots = Math.max(peakSlots, r.rows[0].n); }).finally(() => { timerBusy = false; });
  try { const values = execFileSync("ps", ["-o", "rss=", "-P", String(process.pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\s+/).map(Number); peakChildrenRssKiB = Math.max(peakChildrenRssKiB, values.filter(Number.isFinite).reduce((n, v) => n + v, 0)); } catch { /* ps platform capability explicitly reported below */ }
}, 100);
async function checkout(u: typeof admin, offers: string[]) { const c = await syncCart(u.id, offers, 0); const r = await createDigitalCheckout(actor(u), { revision: c.revision, idempotencyKey: randomUUID(), provider: "STRIPE", termsVersion: "DCN-1.0-LOCAL-REVIEW", earlyDelivery: true, withdrawalAcknowledged: true }, gateway); await reconcileDigitalEvidence(remote.get(r.orderId)!, gateway.merchantId); return r.orderId; }
async function receipt(u: typeof admin, orderId: string) { for (let i = 0; i < 8; i++) await processDigitalDocuments(); const d = await prisma.digitalDocument.findFirstOrThrow({ where: { orderId, kind: "CONTRACT", status: "READY" } }); await (await digitalDocumentResponse(actor(u), d.id)).arrayBuffer(); await acknowledgeDigitalContract(u.id, orderId, d.id, d.snapshotHash); }
try {
  await test("local backup SHA256 / actual restore / additive upgrade: all historical row fingerprints preserved", async () => { assert.equal(backupHash.length, 64); assert.ok(before.some(t => t.name === "digital_masters" && t.n > 0)); });
  await test("effective ACLs, column refusals, append-only, sequence scope and rotated non-owner", async () => {
    for (const role of ["dcn_runtime_a", "dcn_runtime_b"]) { const u = new URL(target); u.username = role; const c = new Client({ connectionString: u.toString() }); await c.connect();
      for (const t of DIGITAL_RUNTIME_TABLES) { await c.query(`SELECT * FROM ${t} LIMIT 0`); for (const q of [`DELETE FROM ${t} WHERE false`, `TRUNCATE ${t}`, `ALTER TABLE ${t} ADD COLUMN bad int`]) await assert.rejects(c.query(q), { code: "42501" });
        for (const row of (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [t])).rows) { const q = `UPDATE ${t} SET "${row.column_name}"="${row.column_name}" WHERE false`; if ((DIGITAL_UPDATE_COLUMNS[t] as readonly string[]).includes(row.column_name)) await c.query(q); else await assert.rejects(c.query(q), { code: "42501" }); } }
      await assert.rejects(c.query("SELECT nextval('invoice_sequence')"), { code: "42501" }); await c.query("SELECT nextval('digital_test_invoice_sequence')"); await c.end(); }
  });
  await test("12 real WAV masters / segmented disk upload / bounded concurrent FFmpeg / physical clips <=60s", async () => {
    for (let i = 0; i < 12; i++) { const file = await createAudioFixture({ seconds: 180 + i, format: "wav", outputPath: `${root}/track-${i}.wav` }), size = (await stat(file.path)).size; cumulativeBytes += size;
      const s = await initDigitalUpload(actor(admin), project.tracks[i].id, { filename: `track-${i}.wav`, mimeType: "audio/wav", sizeBytes: size, expectedVersion: 0, previewStartMs: 1000 });
      for (let n = 1; n <= s.partCount; n++) { const start = (n - 1) * s.partSizeBytes, body = Readable.toWeb(createReadStream(file.path, { start, end: Math.min(size, start + s.partSizeBytes) - 1 }),{strategy:{highWaterMark:65536,size:chunk=>chunk.byteLength}}); await writeDigitalLocalPart(actor(admin), project.tracks[i].id, s.sessionToken, s.sessionToken.split(".")[0], n, new Request("http://127.0.0.1:3140/qa-part", { method: "PUT", body, duplex: "half" } as RequestInit)); }
      await completeDigitalUpload(actor(admin), project.tracks[i].id, s.sessionToken);
    }
    for (let batch = 0; batch < 12 && await prisma.digitalUpload.count({ where: { trackId: { in: project.tracks.map(t => t.id) }, status: "QUARANTINE" } }); batch++) await Promise.all(Array.from({ length: 4 }, () => worker()));
    const masters = await prisma.digitalMaster.findMany({ where: { trackId: { in: project.tracks.map(t => t.id) } }, include: { masterAsset: true } });
    assert.equal(masters.length, 12); assert.ok(masters.every(m => m.status === "READY" && m.previewDurationMs! <= 60000 && m.masterAsset.visibility === "PRIVATE")); assert.ok(peakSlots <= 2);
    for (const t of project.tracks) await saveOffer(actor(admin), { projectId: project.id, trackId: t.id, priceCents: 101, active: true, rightsConfirmed: true, distribution: "UNRELEASED", expectedVersion: 0 });
    await saveOffer(actor(admin), { projectId: project.id, priceCents: 999, active: true, rightsConfirmed: true, distribution: "UNRELEASED", expectedVersion: 0 });
  });
  const offers = await prisma.digitalOffer.findMany({ where: { projectId: project.id } }), album = offers.find(o => o.scope === "ALBUM")!, singles = offers.filter(o => o.scope === "TRACK");
  const u = await member(), orderId = await checkout(u, [album.id]);
  await test("payment and entitlements durable; missing contract receipt blocks all new file delivery", async () => { const line = await prisma.digitalOrderLine.findFirstOrThrow({ where: { orderId } }); await assert.rejects(createDigitalDownload(u.id, line.id, null), { code: "CONTRACT_RECEIPT_REQUIRED" }); assert.equal(await prisma.digitalDocument.count({ where: { orderId, kind: "INVOICE" } }), 1); });
  await test("PDF failure/restart: same invoice number; immutable snapshots; no second payment", async () => {
    const n = creates; await processDigitalDocuments(25, async () => { throw Error("QA PDF failure"); });
    await owner.digitalDocument.updateMany({ where: { orderId, status: "RETRY" }, data: { availableAt: new Date(0) } });
    await processDigitalDocuments(25); assert.equal(creates, n); assert.equal(await prisma.digitalDocument.count({ where: { orderId, kind: "INVOICE" } }), 1);
    const d = await prisma.digitalDocument.findFirstOrThrow({ where: { orderId, kind: "INVOICE" } }); assert.equal(d.status, "READY"); await assert.rejects(db.query("UPDATE digital_documents SET snapshot='{}' WHERE id=$1", [d.id]), { code: "23514" });
    await writeFile("output/pdf/dcn-qa-facture.pdf", Buffer.from(d.pdf!));
  });
  await test("durable confirmation QA: HEAD is not receipt; owner-only bytes and explicit acknowledgement", async () => {
    const d = await prisma.digitalDocument.findFirstOrThrow({ where: { orderId, kind: "CONTRACT", status: "READY" } });
    const other = await member(); await assert.rejects(digitalDocumentResponse(actor(other), d.id), { code: "NOT_FOUND" });
    await assert.rejects(digitalDocumentResponse({...actor(other),role:"ADMIN"},d.id),{code:"NOT_FOUND"},"An old/forged actor role cannot override the current database role");
    await assert.rejects(digitalDocumentResponse(actor(u),"../invalid-document"),{code:"INVALID_ID"});
    await digitalDocumentResponse(actor(u), d.id, "HEAD"); await assert.rejects(acknowledgeDigitalContract(u.id, orderId, d.id, d.snapshotHash), { code: "CONTRACT_RECEIPT_REQUIRED" });
    const response = await digitalDocumentResponse(actor(u), d.id); const bytes = Buffer.from(await response.arrayBuffer()); await writeFile("output/pdf/dcn-qa-confirmation.pdf", bytes);
    await acknowledgeDigitalContract(u.id, orderId, d.id, d.snapshotHash); await acknowledgeDigitalContract(u.id, orderId, d.id, d.snapshotHash); assert.equal(await prisma.digitalEvent.count({ where: { orderId, kind: "CONTRACT_RECEIPT_ACKNOWLEDGED" } }), 1);
  });
  await test("outbox concurrent replay / capture dedup / capture is not delivery or contractual receipt", async () => {
    await Promise.all([processDigitalNotifications(25), processDigitalNotifications(25)]);
    const rows = await prisma.digitalNotification.findMany({ where: { orderId } }); assert.ok(rows.every(n => n.status === "CAPTURED_QA" && !n.sentAt && !n.deliveredAt)); assert.equal(rows.length, 2);
    assert.equal((await readdir(mail)).filter(n => n.endsWith(".json")).length, await prisma.digitalNotification.count({ where: { status: "CAPTURED_QA" } }));
    for (const n of rows) { const t = n.template as { html: string; text: string }; assert.ok(!t.text.includes("digital/masters/")); await writeFile(`output/pdf/dcn-qa-email-${n.kind.toLowerCase()}.html`, t.html); await writeFile(`output/pdf/dcn-qa-email-${n.kind.toLowerCase()}.txt`, t.text); }
  });
  const line = await prisma.digitalOrderLine.findFirstOrThrow({ where: { orderId }, include: { entitlements: true } });
  await test("12-track ZIP / actual process crash mid-write / lease takeover / immutable verified archive", async () => { await assert.rejects(createDigitalDownload(u.id, line.id, null), { code: "ARCHIVE_PREPARING" }); await assert.rejects(worker("zip-crash"),{code:86}); assert.equal((await prisma.digitalArchive.findUniqueOrThrow({where:{lineId_format:{lineId:line.id,format:"WAV"}}})).status,"PROCESSING");
    await owner.digitalArchive.update({where:{lineId_format:{lineId:line.id,format:"WAV"}},data:{leaseUntil:new Date(0)}});await owner.digitalWorkSlot.update({where:{id:"zip-0"},data:{leaseUntil:new Date(0)}});assert.equal((await worker("zip")).ready, true); const t = await createDigitalDownload(u.id, line.id, null), response = await digitalDownloadResponse(u.id, t.ticketId, t.token);
    const file = `${root}/album.zip`; const { pipeline } = await import("node:stream/promises"), { createWriteStream } = await import("node:fs"); await pipeline(Readable.fromWeb(response.body as never), createWriteStream(file)); execFileSync("unzip", ["-t", file], { stdio: "pipe" }); assert.ok((await stat(file)).size >= cumulativeBytes); });
  await test("HEAD/Range/suffix/revocation and IDOR recalculated on every request; no shared cache", async () => { const t = await createDigitalDownload(u.id, line.id, line.entitlements[0].masterId); const head = await digitalDownloadResponse(u.id, t.ticketId, t.token, { method: "HEAD" }); assert.equal(head.body, null); assert.equal((await prisma.digitalDownloadTicket.findUniqueOrThrow({ where: { id: t.ticketId } })).usesLeft, 32);
    const range = await digitalDownloadResponse(u.id, t.ticketId, t.token, { range: "bytes=0-99" }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100); assert.equal(range.headers.get("cache-control"), "private, no-store");
    const retry=await createDigitalDownload(u.id,line.id,line.entitlements[0].masterId), transfer=await digitalDownloadResponse(u.id,retry.ticketId,retry.token,{range:"bytes=0-99"}),reader=transfer.body!.getReader();await reader.read();await reader.cancel();
    const terminal=await prisma.digitalEvent.findMany({where:{orderId,kind:{in:["DOWNLOAD_TRANSFER_FINISHED","DOWNLOAD_INTERRUPTED"]},details:{path:["ticketId"],equals:retry.ticketId}}});assert.equal(terminal.length,1,"Completion/cancellation race must not emit contradictory terminal audits");
    await assert.rejects(digitalDownloadResponse((await member()).id, t.ticketId, t.token), { code: "NOT_FOUND" }); await owner.digitalEntitlement.update({ where: { id: line.entitlements[0].id }, data: { status: "REVOKED" } }); await assert.rejects(digitalDownloadResponse(u.id, t.ticketId, t.token, { method: "HEAD" }), { code: "NOT_FOUND" }); await owner.digitalEntitlement.update({ where: { id: line.entitlements[0].id }, data: { status: "ACTIVE" } }); });
  const financeRemote = new Map<string, DigitalRefundEvidence>(); let lose = false;
  const finance: DigitalFinanceGateway = { merchantId: gateway.merchantId, async refund(r) { refundsPosted++; const e: DigitalRefundEvidence = { authenticated: true, mode: "TEST", provider: r.provider as "STRIPE", merchantId: gateway.merchantId, orderId: r.orderId, paymentReference: r.paymentReference, reference: `qa-refund-${r.id}`, amountCents: r.amountCents, currency: "EUR", status: "SUCCEEDED" }; financeRemote.set(r.id, e); if (lose) { lose = false; throw Error("QA result lost after provider success"); } return e; }, async recoverRefund(r) { return financeRemote.get(r.id) ?? null; }, async readRefund(_o, ref) { return [...financeRemote.values()].find(e => e.reference === ref)!; }, async readDispute() { throw Error("No fake dispute queued"); } };
  await test("concurrent refund reservations cap original amount; timeout recovers GET-only; one credit note", async () => {
    const n = refundsPosted; const key = randomUUID(), input = { idempotencyKey: key, targets: [{ lineId: line.id, amountCents: 100 }], purpose: "PRICE_REDUCTION", confirmedAmountCents: 100 };
    const rows = await Promise.all(Array.from({ length: 4 }, () => requestDigitalRefund(actor(admin), orderId, input))); assert.equal(new Set(rows.map(r => r.id)).size, 1);
    await assert.rejects(requestDigitalRefund(actor(admin), orderId, { ...input, idempotencyKey: randomUUID(), targets: [{ lineId: line.id, amountCents: 999 }], confirmedAmountCents: 999 }), { code: "REFUND_AMOUNT_EXCEEDED" });
    lose = true; await processDigitalRefund(rows[0].id, finance); assert.equal((await prisma.digitalRefund.findUniqueOrThrow({ where: { id: rows[0].id } })).status, "REQUIRES_REVIEW"); await processDigitalRefund(rows[0].id, finance); await processDigitalRefund(rows[0].id, finance); assert.equal(refundsPosted - n, 1);
    assert.equal(await prisma.digitalDocument.count({ where: { orderId, kind: "CREDIT_NOTE" } }), 1); assert.ok((await prisma.digitalEntitlement.findMany({ where: { lineId: line.id } })).every(e => e.status === "ACTIVE"));
    await processDigitalDocuments(25); const d = await prisma.digitalDocument.findFirstOrThrow({ where: { orderId, kind: "CREDIT_NOTE", status: "READY" } }); await writeFile("output/pdf/dcn-qa-avoir.pdf", Buffer.from(d.pdf!));
    const notification=await prisma.digitalNotification.findFirstOrThrow({where:{orderId,kind:"REFUND_CONFIRMED"}}),template=notification.template as {html:string;text:string};
    assert.ok(template.text.includes("1,00 EUR"));await writeFile("output/pdf/dcn-qa-email-refund_confirmed.html",template.html);await writeFile("output/pdf/dcn-qa-email-refund_confirmed.txt",template.text);
  });
  await test("refund by line only; full remaining resolution revokes exactly that source", async () => { const r = await requestDigitalRefund(actor(admin), orderId, { idempotencyKey: randomUUID(), targets: [{ lineId: line.id, amountCents: 899 }], purpose: "RESOLUTION", confirmedAmountCents: 899 }); await processDigitalRefund(r.id, finance); assert.equal((await prisma.digitalOrder.findUniqueOrThrow({ where: { id: orderId } })).status, "REFUNDED"); assert.ok((await prisma.digitalEntitlement.findMany({ where: { lineId: line.id } })).every(e => e.status === "REVOKED")); });
  await test("external partial album refund recorded as finance, retained for allocation review, not arbitrary tracks", async () => { const buyer = await member(), id = await checkout(buyer, [album.id]); await receipt(buyer, id); const e = remote.get(id)!; await recordDigitalRefundEvidence({ authenticated: true, mode: "TEST", merchantId: gateway.merchantId, provider: "STRIPE", orderId: id, paymentReference: e.paymentReference, reference: randomUUID(), amountCents: 123, currency: "EUR", status: "SUCCEEDED" }, gateway.merchantId);
    assert.equal((await prisma.digitalOrder.findUniqueOrThrow({ where: { id } })).status, "REQUIRES_REVIEW"); assert.equal(await prisma.digitalEntitlement.count({ where: { userId: buyer.id, status: "REVOKED" } }), 0); assert.equal(await prisma.digitalDocument.count({ where: { orderId: id, kind: "CREDIT_NOTE" } }), 1); });
  await test("dispute open/won/refund race: scoped suspension, restore only unrevoked rights, no refund while open", async () => { const buyer = await member(), id = await checkout(buyer, [singles[0].id, singles[1].id]); await receipt(buyer, id); const e = remote.get(id)!, lines = await prisma.digitalOrderLine.findMany({ where: { orderId: id } });
    const d = { authenticated: true, mode: "TEST" as const, merchantId: gateway.merchantId, provider: "STRIPE" as const, orderId: id, paymentReference: e.paymentReference, reference: randomUUID(), amountCents: e.amountCents, currency: "EUR", status: "OPEN" as const };
    await recordDigitalDisputeEvidence(d, gateway.merchantId); assert.equal(await prisma.digitalEntitlement.count({ where: { userId: buyer.id, status: "SUSPENDED" } }), 2);
    await assert.rejects(requestDigitalRefund(actor(admin), id, { idempotencyKey: randomUUID(), targets: [{ lineId: lines[0].id, amountCents: lines[0].priceCents }], purpose: "RESOLUTION", confirmedAmountCents: lines[0].priceCents }), { code: "REFUND_REQUIRES_REVIEW" });
    await recordDigitalDisputeEvidence({ ...d, status: "WON" }, gateway.merchantId); assert.equal(await prisma.digitalEntitlement.count({ where: { userId: buyer.id, status: "ACTIVE" } }), 2);
    const r = await requestDigitalRefund(actor(admin), id, { idempotencyKey: randomUUID(), targets: [{ lineId: lines[0].id, amountCents: 101 }], purpose: "RESOLUTION", confirmedAmountCents: 101 }); await processDigitalRefund(r.id, finance); await recordDigitalDisputeEvidence({ ...d, status: "WON" }, gateway.merchantId); assert.equal(await prisma.digitalEntitlement.count({ where: { userId: buyer.id, status: "REVOKED" } }), 1); });
  await test("durable inbox before acknowledgement / concurrent replay / fresh provider evidence / restart lease", async () => { const buyer = await member(), id = await checkout(buyer, [singles[2].id]); const a = await prisma.digitalPaymentAttempt.findFirstOrThrow({ where: { orderId: id } }); const input = { provider: "STRIPE", eventId: randomUUID(), eventType: "checkout.session.completed", orderId: id, bodyHash: "a".repeat(64), payload: { providerReference: a.providerReference!, attemptId: a.id } };
    await Promise.all(Array.from({ length: 6 }, () => receiveDigitalEvent(input))); assert.equal(await prisma.digitalInbox.count({ where: { eventId: input.eventId } }), 1); await assert.rejects(receiveDigitalEvent({ ...input, bodyHash: "b".repeat(64) }), { code: "EVENT_COLLISION" });
    const row = await prisma.digitalInbox.findFirstOrThrow({ where: { eventId: input.eventId } }); await owner.digitalInbox.update({ where: { id: row.id }, data: { status: "PROCESSING", leaseUntil: new Date(0), leaseToken: randomUUID() } }); await processDigitalInbox(25, { payment: gateway, finance }); assert.equal((await prisma.digitalInbox.findUniqueOrThrow({ where: { id: row.id } })).status, "PROCESSED"); });
  await test("second actual capture is a durable incident, not webhook dedup; no new normal invoice", async () => { const buyer = await member(), id = await checkout(buyer, [singles[3].id]), e = remote.get(id)!; await reconcileDigitalEvidence({ ...e, eventId: randomUUID(), providerReference: `second-${randomUUID()}`, paymentReference: `second-${randomUUID()}` }, gateway.merchantId); assert.equal((await prisma.digitalOrder.findUniqueOrThrow({ where: { id } })).status, "REQUIRES_REVIEW"); assert.equal(await prisma.digitalEvent.count({ where: { orderId: id, kind: "UNMATCHED_CAPTURE_INCIDENT" } }), 1); assert.equal(await prisma.digitalDocument.count({ where: { orderId: id, kind: "INVOICE" } }), 1); });
  await test("slots are global/atomic and stale owners cannot claim another active lease", async () => { const id = randomUUID(); const slots = await Promise.all(Array.from({ length: 5 }, () => claimDigitalSlot("audio", id))); assert.equal(slots.filter(Boolean).length, 2); for (const s of slots) if (s) await releaseDigitalSlot(s); });
  await test("actual worker process interruption after source / expired lease recovery / short clip / targeted orphan temp cleanup",async()=>{
    const t=await owner.track.create({data:{projectId:project.id,title:"QA crash/recovery",position:13,status:"DRAFT"}}),file=await createAudioFixture({seconds:5,format:"wav",outputPath:`${root}/crash.wav`}),size=(await stat(file.path)).size;
    const s=await initDigitalUpload(actor(admin),t.id,{filename:"crash.wav",mimeType:"audio/wav",sizeBytes:size,expectedVersion:0,previewStartMs:0});
    const body=Readable.toWeb(createReadStream(file.path),{strategy:{highWaterMark:65536,size:c=>c.byteLength}});await writeDigitalLocalPart(actor(admin),t.id,s.sessionToken,s.sessionToken.split(".")[0],1,new Request("http://127.0.0.1:3140/qa-part",{method:"PUT",body,duplex:"half"} as RequestInit));await completeDigitalUpload(actor(admin),t.id,s.sessionToken);
    await assert.rejects(worker("audio-crash"));const row=await prisma.digitalUpload.findUniqueOrThrow({where:{id:s.sessionToken.split(".")[0]}});assert.equal(row.status,"VALIDATING");assert.equal(await prisma.digitalMaster.count({where:{trackId:t.id}}),0);
    const dir=`${workRoot}/${row.id}.${row.leaseToken}`;await owner.digitalUpload.update({where:{id:row.id},data:{leaseUntil:new Date(0)}});await owner.digitalWorkSlot.updateMany({where:{jobId:row.id},data:{leaseUntil:new Date(0)}});
    assert.equal((await worker()).ready,true);assert.ok((await prisma.digitalMaster.findFirstOrThrow({where:{trackId:t.id}})).previewDurationMs!<60000);
    await utimes(dir,new Date(0),new Date(0));const plan=await cleanupStaleDigitalWork();assert.ok(plan.directories.includes(dir));await cleanupStaleDigitalWork(true);await assert.rejects(stat(dir));
  });
  await test("abandoned upload cleanup: exact dry-run list then deletion; acquired masters remain referenced",async()=>{
    const t=await owner.track.create({data:{projectId:project.id,title:"QA abandoned upload",position:14,status:"DRAFT"}});
    const s=await initDigitalUpload(actor(admin),t.id,{filename:"abandoned.wav",mimeType:"audio/wav",sizeBytes:12,expectedVersion:0,previewStartMs:0});await abortDigitalUpload(actor(admin),t.id,s.sessionToken);
    const id=s.sessionToken.split(".")[0];await owner.digitalUpload.update({where:{id},data:{updatedAt:new Date(0)}});const before=await prisma.digitalMaster.count();const plan=await cleanupDigitalRun(runId,[id]);assert.equal(plan.objects.length,1);assert.equal(plan.dryRun,true);
    await cleanupDigitalRun(runId,[id],true);assert.ok((await prisma.digitalUpload.findUniqueOrThrow({where:{id}})).cleanupAt);assert.equal(await prisma.digitalMaster.count(),before);
  });
  await test("pending/failed refund never yields credit note; reservation released after fresh terminal failure",async()=>{
    const buyer=await member(),id=await checkout(buyer,[singles[4].id]);await receipt(buyer,id);const l=await prisma.digitalOrderLine.findFirstOrThrow({where:{orderId:id}});
    const r=await requestDigitalRefund(actor(admin),id,{idempotencyKey:randomUUID(),targets:[{lineId:l.id,amountCents:10}],purpose:"PRICE_REDUCTION",confirmedAmountCents:10});
    const pending:DigitalFinanceGateway={...finance,async refund(r){const e=await finance.refund(r);e.status="PENDING";financeRemote.set(r.id,e);return e;}};
    await processDigitalRefund(r.id,pending);assert.equal(await prisma.digitalDocument.count({where:{orderId:id,kind:"CREDIT_NOTE"}}),0);const e=financeRemote.get(r.id)!;e.status="FAILED";await processDigitalRefund(r.id,pending);assert.equal((await prisma.digitalRefund.findUniqueOrThrow({where:{id:r.id}})).status,"FAILED");
    assert.equal(await prisma.digitalEntitlement.count({where:{lineId:l.id,status:"ACTIVE"}}),1);
    const reducedBuyer=await member(),reducedId=await checkout(reducedBuyer,[singles[7].id]),reducedLine=await prisma.digitalOrderLine.findFirstOrThrow({where:{orderId:reducedId},include:{entitlements:true}});
    const fullReduction=await requestDigitalRefund(actor(admin),reducedId,{idempotencyKey:randomUUID(),targets:[{lineId:reducedLine.id,amountCents:reducedLine.priceCents}],purpose:"PRICE_REDUCTION",confirmedAmountCents:reducedLine.priceCents});
    await processDigitalRefund(fullReduction.id,finance);assert.equal((await prisma.digitalOrder.findUniqueOrThrow({where:{id:reducedId}})).status,"REFUNDED");assert.equal(await prisma.digitalEntitlement.count({where:{lineId:reducedLine.id,status:"ACTIVE"}}),1);
    await assert.rejects(createDigitalDownload(reducedBuyer.id,reducedLine.id,reducedLine.entitlements[0].masterId),{code:"CONTRACT_RECEIPT_REQUIRED"});await receipt(reducedBuyer,reducedId);
    assert.ok((await createDigitalDownload(reducedBuyer.id,reducedLine.id,reducedLine.entitlements[0].masterId)).ticketId,"Full price reduction preserves rights without bypassing prior contract receipt");
  });
  await test("two genuinely distinct successful attempts trace the second capture without losing first payment or issuing another invoice",async()=>{
    const buyer=await member(),id=await checkout(buyer,[singles[5].id]),first=remote.get(id)!;
    const old=await owner.digitalPaymentAttempt.create({data:{orderId:id,provider:"PAYPAL",status:"FAILED",idempotencyKey:randomUUID(),providerReference:`second-${randomUUID()}`}});
    await reconcileDigitalEvidence({...first,eventId:randomUUID(),provider:"PAYPAL",providerReference:old.providerReference!,paymentReference:`capture-second-${randomUUID()}`},gateway.merchantId);
    assert.equal((await prisma.digitalOrder.findUniqueOrThrow({where:{id}})).status,"REQUIRES_REVIEW");assert.equal(await prisma.digitalDocument.count({where:{orderId:id,kind:"INVOICE"}}),1);assert.equal(await prisma.digitalEvent.count({where:{orderId:id,kind:"PAYMENT_CONTRADICTION"}}),1);
  });
  await test("targeted cleanup dry-run / active and acquired masters protected / no global sweep", async () => { const plan = await cleanupDigitalRun(runId, await prisma.digitalUpload.findMany({ where: { trackId: { in: project.tracks.map(t => t.id) } }, select: { id: true } }).then(r => r.map(x => x.id))); assert.equal(plan.dryRun, true); assert.equal(plan.objects.length, 0); assert.equal(await prisma.digitalMaster.count({ where: { trackId: { in: project.tracks.map(t => t.id) } } }), 12); });
  await test("historical billing, physical commerce, Support and legacy acquisitions intact", async () => { for (const table of ["orders", "shop_orders", "payments", "invoices", "support_contributions"]) assert.deepEqual((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, before.find(r => r.name === table)!.n); assert.ok(await prisma.digitalMaster.count({ where: { trackId: { notIn: project.tracks.map(t => t.id) } } }) > 0); });
  clearInterval(monitor);
  const report = { runId, database: name, groups, results: evidence, backup: { path: backup, sha256: backupHash, restored: true, historicalFingerprints: beforeTables.length },
    album: { tracks: 12, bytes: cumulativeBytes, elapsedMs: Math.round(performance.now() - started), harnessNodePeakRss: peakRss, peakExternal, peakArrayBuffers, childRssPeakKiB: peakChildrenRssKiB || "NOT_MEASURED", activeAudioSlotsPeak: peakSlots||"NOT_MEASURED",workerMeasurements }, externalProviderCalls: 0, providerDoubles: true, realEmails: 0 };
  await writeFile(".private/dcn-1-1-runtime-results.json", JSON.stringify(report, null, 2), { mode: 0o600 }); console.log(JSON.stringify({ groups, runId, albumBytes: cumulativeBytes, peakRss, externalProviderCalls: 0 }));
} finally { clearInterval(monitor); await prisma.$disconnect(); await owner.$disconnect(); await db.end();await observer.end(); await control.end(); }
