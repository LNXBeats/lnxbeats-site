/**
 * Local PostgreSQL regression for digital Stripe refunds. NO provider/network recipe.
 * Run with: node --conditions=react-server --import tsx scripts/test-digital-stripe-refund-runtime.ts
 * Restores schema ONLY into a uniquely named local database, retaining it as proof.
 * No source QA rows, masters, acquisitions, credentials or documents are copied/written.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { provisionDigitalRuntime } from "@/lib/digital/runtime-privileges";
import type { DigitalPaymentEvidence } from "@/lib/digital/domain";
import type { DigitalGateway } from "@/lib/digital/providers";
import type { DigitalFinanceGateway, DigitalRefundEvidence } from "@/lib/digital/finance-policy";

// No provider may escape a supplied double, including a fallback introduced later.
const forbidden = () => { throw new Error("LOCAL_REFUND_TEST_EXTERNAL_NETWORK_FORBIDDEN"); };
http.request = forbidden as typeof http.request;
http.get = forbidden as typeof http.get;
https.request = forbidden as typeof https.request;
https.get = forbidden as typeof https.get;
globalThis.fetch = forbidden as typeof fetch;
tls.connect = forbidden as typeof tls.connect;
const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const options = args[0];
  const host = typeof options === "object" && options !== null && "host" in options ? options.host : args[1];
  const port = typeof options === "object" && options !== null && "port" in options ? options.port : options;
  assert.equal(host, "127.0.0.1", "Only isolated PostgreSQL loopback is allowed");
  assert.equal(Number(port), 55473, "Only the isolated PostgreSQL port is allowed");
  return Reflect.apply(socketConnect, this, args) as net.Socket;
} as typeof socketConnect;
syncBuiltinESMExports();

const profilePath = ".private/dcn-review-config.json";
assert.equal((await stat(profilePath)).mode & 0o077, 0, "Local profile must be private");
const profile = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, string>;
const source = assertSafeLocalPostgresUrl(profile.DATABASE_URL);
assert.equal(source.hostname, "127.0.0.1");
assert.equal(source.port, "55473");
assert.equal(source.pathname, "/lnx_dcn_runtime_test");
assert.equal(source.username, "dcn_runtime_a");
assert.ok(!source.password, "No credential is passed to local subprocess arguments");
assert.equal(source.searchParams.size, 0);
const runId = randomUUID();
const database = `lnx_dcn_refund_${runId.replaceAll("-", "").slice(0, 16)}`;
assert.match(database, /^lnx_dcn_refund_[a-f0-9]{16}$/);
const root = await mkdtemp("/private/tmp/lnx-dcn-refund-runtime-");
await chmod(root, 0o700);
const ownerSource = new URL(source); ownerSource.username = "dcn_owner";
const administration = new URL(ownerSource); administration.pathname = "/postgres";
const ownerTarget = new URL(ownerSource); ownerTarget.pathname = `/${database}`;
const runtimeTarget = new URL(ownerTarget); runtimeTarget.username = "dcn_runtime_a";
const shellEnvironment = { PATH: process.env.PATH, NODE_ENV: "test" as const, PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable" };
const sourceDb = new Client({ connectionString: ownerSource.toString(), options: "-c default_transaction_read_only=on" });
const control = new Client({ connectionString: administration.toString() });
let owner: PrismaClient | undefined;
let runtime: PrismaClient | undefined;
let db: Client | undefined;
let sourceBefore: unknown;
const results: Array<{ name: string; status: "PASS" }> = [];
async function test(name: string, run: () => Promise<void>) { await run(); results.push({ name, status: "PASS" }); console.log(`PASS ${name}`); }
async function sourceFingerprint() {
  const tables = ["digital_orders", "digital_order_lines", "digital_payment_attempts", "digital_entitlements", "digital_masters", "digital_documents", "digital_refunds", "digital_events", "digital_inbox", "orders", "shop_orders", "payments", "invoices", "support_contributions"];
  const rows = [];
  for (const table of tables) rows.push((await sourceDb.query(`SELECT '${table}' AS name, count(*)::int AS n, md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM public.${table} t`)).rows[0]);
  return rows;
}
try {
  await sourceDb.connect(); sourceBefore = await sourceFingerprint();
  await control.connect();
  const roles = await control.query("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname IN ('dcn_owner','dcn_runtime_a')");
  const role = roles.rows.find(r => r.rolname === "dcn_runtime_a");
  assert.ok(role && !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole && !role.rolbypassrls);
  const schema = `${root}/schema-only.dump`;
  execFileSync("pg_dump", ["--schema-only", "-Fc", "--no-owner", "--no-acl", "--file", schema, ownerSource.toString()], { env: shellEnvironment, stdio: "pipe", timeout: 60000 });
  await chmod(schema, 0o600);
  const schemaSha256 = createHash("sha256").update(await readFile(schema)).digest("hex");
  await control.query(`CREATE DATABASE "${database}" OWNER dcn_owner`);
  execFileSync("pg_restore", ["--schema-only", "--exit-on-error", "--no-owner", "--no-acl", "--dbname", ownerTarget.toString(), schema], { env: shellEnvironment, stdio: "pipe", timeout: 60000 });
  db = new Client({ connectionString: ownerTarget.toString() }); await db.connect();
  assert.equal((await db.query("SELECT count(*)::int n FROM digital_orders")).rows[0].n, 0, "No historical data restored into the test database");
  await provisionDigitalRuntime(db, "dcn_runtime_a");
  await provisionDigitalRuntime(db, "dcn_runtime_a");
  await db.query("GRANT SELECT ON users,projects,tracks,assets TO dcn_runtime_a");
  for (const key of Object.keys(process.env)) if (/STRIPE|PAYPAL|RESEND|RAILWAY|S3|R2|AWS|SMTP/i.test(key)) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: runtimeTarget.toString(), DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_NEW_PAYMENTS_ENABLED: "true", DCN_EXTERNAL_TEST_AUTHORIZED: "false", AUTH_URL: "http://127.0.0.1:3140", ADS_ENABLED: "false", SUPPORT_ENABLED: "false", MEDIA_DEPLOYMENT_ENV: "test", PAYMENT_DEPLOYMENT_ENV: "test", MEDIA_STORAGE_DRIVER: "local", MEDIA_LOCAL_PUBLIC_ROOT: `${root}/public`, MEDIA_LOCAL_PRIVATE_ROOT: `${root}/private`, EMAIL_PROVIDER: "capture", DCN_EMAIL_CAPTURE_ROOT: `${root}/mail` });
  owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerTarget.toString() }) });
  runtime = (await import("@/lib/prisma")).prisma;
  const { createDigitalCheckout, reconcileDigitalEvidence } = await import("@/lib/digital/commerce");
  const { syncCart } = await import("@/lib/digital/catalog");
  const { receiveDigitalEvent, processDigitalInbox } = await import("@/lib/digital/inbox");
  const { requestDigitalRefund, processDigitalRefund } = await import("@/lib/digital/finance");
  const { processDigitalDocuments, digitalDocumentResponse, acknowledgeDigitalContract } = await import("@/lib/digital/documents");
  const { processDigitalNotifications } = await import("@/lib/digital/notifications");
  const { createDigitalDownload } = await import("@/lib/digital/library");
  const admin = await owner.user.create({ data: { email: `refund-admin-${runId}@example.invalid`, role: "ADMIN", emailVerified: true, status: "ACTIVE", displayName: "Local refund QA" } });
  const actor = (user: typeof admin) => ({ id: user.id, email: user.email, name: user.displayName, role: user.role, status: "ACTIVE" as const, emailVerified: true as const });
  const project = await owner.project.create({ data: { slug: `refund-${runId}`, title: "Synthetic refund regression", type: "ALBUM", status: "PUBLISHED", publicVisible: true, catalogPosition: 1, tracks: { create: [1, 2].map(position => ({ title: `Synthetic track ${position}`, position, status: "RELEASED" as const })) } }, include: { tracks: true } });
  for (const track of project.tracks) {
    const common = { storageBackend: "LOCAL" as const, storageProvider: "local", sizeBytes: 12n, checksumSha256: "a".repeat(64), durationMs: 1000, rightsStatus: "CLEARED" as const, mimeType: "audio/wav" };
    const asset = await owner.asset.create({ data: { ...common, type: "AUDIO", visibility: "PRIVATE", storageKey: `refund/${track.id}/master.wav`, filename: "synthetic.wav" } });
    const preview = await owner.asset.create({ data: { ...common, type: "AUDIO_PREVIEW", visibility: "PUBLIC", storageKey: `refund/${track.id}/preview.wav`, filename: "synthetic-preview.wav" } });
    await owner.digitalMaster.create({ data: { trackId: track.id, version: 1, masterAssetId: asset.id, previewAssetId: preview.id, previewDurationMs: 1000, codec: "pcm_s16le", status: "READY" } });
  }
  const offer = await owner.digitalOffer.create({ data: { scope: "ALBUM", projectId: project.id, priceCents: 1000, active: true, rightsConfirmed: true, distribution: "UNRELEASED" } });
  const payments = new Map<string, DigitalPaymentEvidence>();
  const refunds = new Map<string, DigitalRefundEvidence>();
  const chargeRefunds = new Map<string, string[]>();
  const calls = { refundReads: [] as string[], chargeReads: [] as string[], simulatedRefundPosts: 0 };
  const merchantId = "acct_LOCALREFUNDQA";
  const payment: DigitalGateway = { merchantId, async create(order, attempt) {
    const evidence: DigitalPaymentEvidence = { authenticated: true, mode: "TEST", provider: "STRIPE", merchantId, orderId: order.id, providerReference: `cs_test_${attempt.id.replaceAll("-", "")}`, paymentReference: `pi_${attempt.id.replaceAll("-", "")}`, amountCents: order.totalCents, currency: "EUR", status: "PAID", eventId: `evt_paid_${attempt.id}` };
    payments.set(order.id, evidence); return { id: evidence.providerReference, url: "https://checkout.stripe.com/c/local-double-only" };
  }, async recover(order) { return { evidence: payments.get(order.id)! }; } };
  let beforeRefundReturn: ((request: Parameters<DigitalFinanceGateway["refund"]>[0]) => Promise<DigitalRefundEvidence>) | undefined;
  const finance: DigitalFinanceGateway = { merchantId, async refund(request) { calls.simulatedRefundPosts++; assert.ok(beforeRefundReturn, "Unplanned simulated refund POST"); return beforeRefundReturn(request); }, async recoverRefund(request) { return refunds.get(request.providerReference ?? "") ?? null; }, async readRefund(orderId, reference) {
    assert.match(reference, /^re_/); calls.refundReads.push(reference); const evidence = refunds.get(reference); assert.ok(evidence); assert.equal(evidence.orderId, orderId); return { ...evidence };
  }, async readChargeRefunds(orderId, reference) {
    assert.match(reference, /^ch_/); calls.chargeReads.push(reference); const refs = chargeRefunds.get(reference); assert.ok(refs?.length, "Incomplete provider evidence is not financial success");
    return refs.map(ref => { assert.match(ref, /^re_/); const evidence = refunds.get(ref); assert.ok(evidence); assert.equal(evidence.orderId, orderId); return { ...evidence }; });
  }, async readDispute() { throw new Error("No dispute expected in refund-only regression"); } };
  async function purchased() {
    const user = await owner!.user.create({ data: { email: `refund-${randomUUID()}@example.invalid`, status: "ACTIVE", emailVerified: true, displayName: "Synthetic local buyer" } });
    const cart = await syncCart(user.id, [offer.id], 0);
    const checkout = await createDigitalCheckout(actor(user), { revision: cart.revision, provider: "STRIPE", idempotencyKey: randomUUID(), termsVersion: "DCN-1.0-LOCAL-REVIEW", earlyDelivery: true, withdrawalAcknowledged: true }, payment);
    await reconcileDigitalEvidence(payments.get(checkout.orderId)!, merchantId);
    while (await runtime!.digitalDocument.count({ where: { orderId: checkout.orderId, status: "PENDING" } })) assert.ok((await processDigitalDocuments()).ready);
    const contract = await runtime!.digitalDocument.findFirstOrThrow({ where: { orderId: checkout.orderId, kind: "CONTRACT", status: "READY" } });
    await (await digitalDocumentResponse(actor(user), contract.id)).arrayBuffer();
    await acknowledgeDigitalContract(user.id, checkout.orderId, contract.id, contract.snapshotHash);
    const line = await runtime!.digitalOrderLine.findFirstOrThrow({ where: { orderId: checkout.orderId }, include: { entitlements: true } });
    const attempt = await runtime!.digitalPaymentAttempt.findFirstOrThrow({ where: { orderId: checkout.orderId } });
    return { user, id: checkout.orderId, line, attempt, contract, charge: `ch_${attempt.id.replaceAll("-", "")}` };
  }
  type Purchase = Awaited<ReturnType<typeof purchased>>;
  function evidence(p: Purchase, amount = 1000, localRefundId?: string) {
    const ref = `re_${randomUUID().replaceAll("-", "")}`;
    const e: DigitalRefundEvidence = { authenticated: true, mode: "TEST", provider: "STRIPE", merchantId, orderId: p.id, paymentReference: p.attempt.paymentReference!, reference: ref, amountCents: amount, currency: "EUR", status: "SUCCEEDED", ...(localRefundId ? { localRefundId } : {}) };
    refunds.set(ref, e); chargeRefunds.set(p.charge, [...(chargeRefunds.get(p.charge) ?? []), ref]); return e;
  }
  async function event(p: Purchase, eventType = "charge.refunded", resourceReference = p.charge) {
    const input = { provider: "STRIPE", eventId: `evt_${randomUUID()}`, eventType, orderId: p.id, bodyHash: "b".repeat(64), payload: { paymentReference: p.attempt.paymentReference!, resourceReference } };
    await receiveDigitalEvent(input); return input;
  }
  async function immutableOrder(p: Purchase) {
    return { order: await runtime!.digitalOrder.findUniqueOrThrow({ where: { id: p.id }, select: { totalCents: true, termsVersion: true, termsHash: true, contractSnapshot: true, createdAt: true } }), line: await runtime!.digitalOrderLine.findUniqueOrThrow({ where: { id: p.line.id } }), payment: await runtime!.digitalPaymentAttempt.findUniqueOrThrow({ where: { id: p.attempt.id } }), documents: await runtime!.digitalDocument.findMany({ where: { orderId: p.id, kind: { in: ["CONTRACT", "INVOICE"] } }, orderBy: { kind: "asc" } }), fulfillment: await runtime!.digitalFulfillment.findUniqueOrThrow({ where: { orderId: p.id } }) };
  }
  await test("real non-owner runtime ACL and append-only refusals", async () => {
    const c = new Client({ connectionString: runtimeTarget.toString() }); await c.connect();
    try { const r = (await c.query("SELECT current_user = 'dcn_runtime_a' AS runtime, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser, (SELECT relowner=current_user::regrole FROM pg_class WHERE oid='digital_refunds'::regclass) AS owns_table")).rows[0]; assert.equal(r.runtime, true); assert.equal(r.superuser, false); assert.equal(r.owns_table, false); }
    finally { await c.end(); }
    const c2 = new Client({ connectionString: runtimeTarget.toString() }); await c2.connect();
    try { for (const sql of ["DELETE FROM digital_refunds WHERE false", "UPDATE digital_events SET kind=kind WHERE false", "ALTER TABLE digital_refunds ADD COLUMN forbidden text", "TRUNCATE digital_orders"]) await assert.rejects(c2.query(sql), { code: "42501" }); }
    finally { await c2.end(); }
  });
  const historical = await purchased(); const historicalBefore = await immutableOrder(historical);
  await test("charge.refunded with no refunds list discovers re_ records, full credit once and exact rights revoked", async () => {
    const p = await purchased(), before = await immutableOrder(p), e = evidence(p); await event(p);
    assert.deepEqual(await processDigitalInbox(25, { payment, finance }), { processed: 1, retry: 0, review: 0 });
    assert.equal((await runtime!.digitalRefund.findUniqueOrThrow({ where: { providerReference: e.reference } })).status, "SUCCEEDED");
    assert.equal((await runtime!.digitalOrder.findUniqueOrThrow({ where: { id: p.id } })).status, "REFUNDED");
    assert.equal(await runtime!.digitalEntitlement.count({ where: { lineId: p.line.id, status: "REVOKED" } }), 2);
    assert.equal(await runtime!.digitalDocument.count({ where: { orderId: p.id, kind: "CREDIT_NOTE" } }), 1);
    await assert.rejects(createDigitalDownload(p.user.id, p.line.id, p.line.entitlements[0].masterId), { code: "NOT_FOUND" });
    assert.deepEqual(await immutableOrder(p), before);
  });
  await test("legacy persisted charge resource already RETRY recovers without treating ch_ as re_", async () => {
    const p = await purchased(); evidence(p); const input = await event(p);
    await owner!.digitalInbox.update({ where: { provider_eventId: { provider: "STRIPE", eventId: input.eventId } }, data: { status: "RETRY", attempts: 3, errorCode: "PROVIDER_READ_FAILED", availableAt: new Date(0) } });
    assert.deepEqual(await processDigitalInbox(25, { payment, finance }), { processed: 1, retry: 0, review: 0 });
    assert.equal((await runtime!.digitalInbox.findUniqueOrThrow({ where: { provider_eventId: { provider: "STRIPE", eventId: input.eventId } } })).status, "PROCESSED");
  });
  await test("expired inbox lease is reclaimed; live competing lease is not stolen", async () => {
    const p = await purchased(); evidence(p); const input = await event(p);
    const where = { provider_eventId: { provider: "STRIPE", eventId: input.eventId } };
    await owner!.digitalInbox.update({ where, data: { status: "PROCESSING", leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60000) } });
    assert.deepEqual(await processDigitalInbox(25, { payment, finance }), { processed: 0, retry: 0, review: 0 });
    await owner!.digitalInbox.update({ where, data: { leaseUntil: new Date(0) } });
    assert.deepEqual(await processDigitalInbox(25, { payment, finance }), { processed: 1, retry: 0, review: 0 });
  });
  await test("duplicate/concurrent inbox and out-of-order refund.created/refund.updated/charge yield one credit and refund", async () => {
    const p = await purchased(), e = evidence(p), first = await event(p, "refund.updated", e.reference);
    await Promise.all(Array.from({ length: 6 }, () => receiveDigitalEvent(first)));
    await event(p); await event(p, "refund.created", e.reference);
    await Promise.all([processDigitalInbox(25, { payment, finance }), processDigitalInbox(25, { payment, finance })]);
    assert.equal(await runtime!.digitalRefund.count({ where: { orderId: p.id } }), 1);
    assert.equal(await runtime!.digitalDocument.count({ where: { orderId: p.id, kind: "CREDIT_NOTE" } }), 1);
    assert.equal(await runtime!.digitalEvent.count({ where: { orderId: p.id, kind: "REFUND_PROVIDER_EVIDENCE" } }), 1);
    assert.equal(await runtime!.digitalInbox.count({ where: { orderId: p.id, status: "PROCESSED" } }), 3);
    assert.equal(await runtime!.digitalNotification.count({ where: { orderId: p.id, kind: "REFUND_CONFIRMED" } }), 1);
  });
  await test("explicit price reduction is partial, preserves acquired rights; remaining resolution revokes without rewriting originals", async () => {
    const p = await purchased(), before = await immutableOrder(p);
    const r = await requestDigitalRefund(actor(admin), p.id, { idempotencyKey: randomUUID(), targets: [{ lineId: p.line.id, amountCents: 200 }], purpose: "PRICE_REDUCTION", confirmedAmountCents: 200 });
    evidence(p, 200, r.id); await event(p); await processDigitalInbox(25, { payment, finance });
    assert.equal((await runtime!.digitalOrder.findUniqueOrThrow({ where: { id: p.id } })).status, "PARTIALLY_REFUNDED");
    assert.equal(await runtime!.digitalEntitlement.count({ where: { lineId: p.line.id, status: "ACTIVE" } }), 2);
    assert.ok((await createDigitalDownload(p.user.id, p.line.id, p.line.entitlements[0].masterId)).ticketId);
    const remaining = await requestDigitalRefund(actor(admin), p.id, { idempotencyKey: randomUUID(), targets: [{ lineId: p.line.id, amountCents: 800 }], purpose: "RESOLUTION", confirmedAmountCents: 800 });
    evidence(p, 800, remaining.id); await event(p); await processDigitalInbox(25, { payment, finance });
    assert.equal((await runtime!.digitalOrder.findUniqueOrThrow({ where: { id: p.id } })).status, "REFUNDED");
    assert.equal(await runtime!.digitalEntitlement.count({ where: { lineId: p.line.id, status: "REVOKED" } }), 2);
    assert.equal(await runtime!.digitalDocument.count({ where: { orderId: p.id, kind: "CREDIT_NOTE" } }), 2);
    const amount = await runtime!.digitalRefund.aggregate({ where: { orderId: p.id, status: "SUCCEEDED" }, _sum: { amountCents: true } }); assert.equal(amount._sum.amountCents, 1000);
    assert.deepEqual(await immutableOrder(p), before);
  });
  await test("external partial album refund stays allocation REVIEW, never arbitrarily revokes a track", async () => {
    const p = await purchased(); const e = evidence(p, 150); await event(p); await processDigitalInbox(25, { payment, finance });
    const refund = await runtime!.digitalRefund.findUniqueOrThrow({ where: { providerReference: e.reference } });
    assert.equal(refund.allocationStatus, "REVIEW"); assert.equal(refund.purpose, "EXTERNAL_REVIEW"); assert.deepEqual(refund.targets, []);
    assert.equal((await runtime!.digitalOrder.findUniqueOrThrow({ where: { id: p.id } })).status, "REQUIRES_REVIEW");
    assert.equal(await runtime!.digitalEntitlement.count({ where: { lineId: p.line.id, status: "REVOKED" } }), 0);
    assert.equal(await runtime!.digitalEntitlement.count({ where: { lineId: p.line.id, status: "SUSPENDED" } }), 2);
    assert.equal(await runtime!.digitalDocument.count({ where: { orderId: p.id, kind: "CREDIT_NOTE" } }), 1);
  });
  await test("pending evidence issues no credit; fresh success and later stale event preserve terminal success", async () => {
    const p = await purchased(), e = evidence(p); refunds.set(e.reference, { ...e, status: "PENDING" });
    await event(p); await processDigitalInbox(25, { payment, finance });
    assert.equal(await runtime!.digitalDocument.count({ where: { orderId: p.id, kind: "CREDIT_NOTE" } }), 0);
    refunds.set(e.reference, e); await event(p, "refund.updated", e.reference); await processDigitalInbox(25, { payment, finance });
    await event(p, "refund.created", e.reference); await processDigitalInbox(25, { payment, finance });
    assert.equal((await runtime!.digitalRefund.findUniqueOrThrow({ where: { providerReference: e.reference } })).status, "SUCCEEDED");
    assert.equal(await runtime!.digitalDocument.count({ where: { orderId: p.id, kind: "CREDIT_NOTE" } }), 1);
  });
  await test("webhook processed before simulated refund POST returns still yields one refund/credit/notification", async () => {
    const p = await purchased();
    const r = await requestDigitalRefund(actor(admin), p.id, { idempotencyKey: randomUUID(), targets: [{ lineId: p.line.id, amountCents: 1000 }], purpose: "RESOLUTION", confirmedAmountCents: 1000 });
    beforeRefundReturn = async request => {
      assert.equal(request.id, r.id);
      const e = evidence(p, request.amountCents, request.id); await event(p);
      assert.deepEqual(await processDigitalInbox(25, { payment, finance }), { processed: 1, retry: 0, review: 0 });
      assert.equal((await runtime!.digitalRefund.findUniqueOrThrow({ where: { id: r.id } })).status, "SUCCEEDED");
      return e;
    };
    try { await processDigitalRefund(r.id, finance); await processDigitalRefund(r.id, finance); }
    finally { beforeRefundReturn = undefined; }
    assert.equal(await runtime!.digitalRefund.count({ where: { orderId: p.id } }), 1);
    assert.equal(await runtime!.digitalDocument.count({ where: { orderId: p.id, kind: "CREDIT_NOTE" } }), 1);
    assert.equal(await runtime!.digitalNotification.count({ where: { orderId: p.id, kind: "REFUND_CONFIRMED" } }), 1);
    assert.equal(calls.simulatedRefundPosts, 1);
  });
  await test("terminal FAILED ignores stale PENDING; contradictory fresh SUCCEEDED is reviewed without credit", async () => {
    const p = await purchased(), e = evidence(p); refunds.set(e.reference, { ...e, status: "FAILED" });
    await event(p, "refund.failed", e.reference); await processDigitalInbox(25, { payment, finance });
    assert.equal((await runtime!.digitalRefund.findUniqueOrThrow({ where: { providerReference: e.reference } })).status, "FAILED");
    refunds.set(e.reference, { ...e, status: "PENDING" }); await event(p); await processDigitalInbox(25, { payment, finance });
    assert.equal((await runtime!.digitalRefund.findUniqueOrThrow({ where: { providerReference: e.reference } })).status, "FAILED");
    refunds.set(e.reference, e); await event(p, "refund.updated", e.reference); await processDigitalInbox(25, { payment, finance });
    assert.equal((await runtime!.digitalOrder.findUniqueOrThrow({ where: { id: p.id } })).status, "REQUIRES_REVIEW");
    assert.equal(await runtime!.digitalEvent.count({ where: { orderId: p.id, kind: "REFUND_CONTRADICTION" } }), 1);
    assert.equal(await runtime!.digitalDocument.count({ where: { orderId: p.id, kind: "CREDIT_NOTE" } }), 0);
    assert.equal(await runtime!.digitalEntitlement.count({ where: { lineId: p.line.id, status: "SUSPENDED" } }), 2);
  });
  await test("old failed external refund does not consume another active reservation or create a false incident", async () => {
    const p = await purchased(), before = await immutableOrder(p);
    const reservation = await requestDigitalRefund(actor(admin), p.id, { idempotencyKey: randomUUID(), targets: [{ lineId: p.line.id, amountCents: 1000 }], purpose: "RESOLUTION", confirmedAmountCents: 1000 });
    // Isolated fixture representing the durable state after a provider operation
    // was claimed; no simulated or actual financial request is issued here.
    await runtime!.digitalRefund.update({ where: { id: reservation.id }, data: { status: "PENDING", leaseUntil: new Date(Date.now() + 60000) } });
    const reservedBefore = await runtime!.digitalRefund.findUniqueOrThrow({ where: { id: reservation.id } });
    const failed = evidence(p); refunds.set(failed.reference, { ...failed, status: "FAILED" });
    await event(p, "refund.failed", failed.reference);
    assert.deepEqual(await processDigitalInbox(25, { payment, finance }), { processed: 1, retry: 0, review: 0 });
    const recorded = await runtime!.digitalRefund.findUniqueOrThrow({ where: { providerReference: failed.reference } });
    assert.equal(recorded.status, "FAILED"); assert.equal(recorded.amountCents, 1000);
    assert.deepEqual(await runtime!.digitalRefund.findUniqueOrThrow({ where: { id: reservation.id } }), reservedBefore);
    assert.equal((await runtime!.digitalOrder.findUniqueOrThrow({ where: { id: p.id } })).status, "PAID");
    assert.equal(await runtime!.digitalEvent.count({ where: { orderId: p.id, kind: "REFUND_CONTRADICTION" } }), 0);
    assert.equal(await runtime!.digitalDocument.count({ where: { orderId: p.id, kind: "CREDIT_NOTE" } }), 0);
    assert.equal(await runtime!.digitalEntitlement.count({ where: { lineId: p.line.id, status: "ACTIVE" } }), 2);
    assert.equal(await runtime!.digitalEntitlement.count({ where: { lineId: p.line.id, status: { in: ["REVOKED", "SUSPENDED"] } } }), 0);
    assert.deepEqual(await immutableOrder(p), before);
  });
  await test("fresh FAILED after confirmed success audits contradiction without duplicate credit or revived rights", async () => {
    const p = await purchased(), before = await immutableOrder(p), e = evidence(p);
    await event(p); assert.deepEqual(await processDigitalInbox(25, { payment, finance }), { processed: 1, retry: 0, review: 0 });
    const creditBefore = await runtime!.digitalDocument.findMany({ where: { orderId: p.id, kind: "CREDIT_NOTE" }, select: { id: true, businessKey: true, number: true, snapshot: true, snapshotHash: true } });
    assert.equal(creditBefore.length, 1);
    refunds.set(e.reference, { ...e, status: "FAILED" }); await event(p, "refund.failed", e.reference);
    assert.deepEqual(await processDigitalInbox(25, { payment, finance }), { processed: 1, retry: 0, review: 0 });
    assert.equal((await runtime!.digitalRefund.findUniqueOrThrow({ where: { providerReference: e.reference } })).status, "SUCCEEDED");
    assert.equal((await runtime!.digitalOrder.findUniqueOrThrow({ where: { id: p.id } })).status, "REQUIRES_REVIEW");
    assert.equal(await runtime!.digitalEvent.count({ where: { orderId: p.id, kind: "REFUND_CONTRADICTION" } }), 1);
    assert.deepEqual(await runtime!.digitalDocument.findMany({ where: { orderId: p.id, kind: "CREDIT_NOTE" }, select: { id: true, businessKey: true, number: true, snapshot: true, snapshotHash: true } }), creditBefore);
    assert.equal(await runtime!.digitalNotification.count({ where: { orderId: p.id, kind: "REFUND_CONFIRMED" } }), 1);
    assert.equal(await runtime!.digitalEntitlement.count({ where: { lineId: p.line.id, status: "REVOKED" } }), 2);
    assert.equal(await runtime!.digitalEntitlement.count({ where: { lineId: p.line.id, status: { in: ["ACTIVE", "SUSPENDED"] } } }), 0);
    await assert.rejects(createDigitalDownload(p.user.id, p.line.id, p.line.entitlements[0].masterId), { code: "NOT_FOUND" });
    assert.deepEqual(await immutableOrder(p), before);
  });
  await test("incomplete provider lookup stays retry, no fabricated refund or credit", async () => {
    const p = await purchased(); const input = await event(p); const result = await processDigitalInbox(25, { payment, finance });
    assert.equal(result.retry, 1); assert.equal(await runtime!.digitalRefund.count({ where: { orderId: p.id } }), 0);
    assert.equal(await runtime!.digitalDocument.count({ where: { orderId: p.id, kind: "CREDIT_NOTE" } }), 0);
    assert.equal((await runtime!.digitalInbox.findUniqueOrThrow({ where: { provider_eventId: { provider: "STRIPE", eventId: input.eventId } } })).status, "RETRY");
  });
  await test("historical paid snapshots/receipt unchanged; originals immutable and only QA emails captured", async () => {
    assert.deepEqual(await immutableOrder(historical), historicalBefore);
    await assert.rejects(db!.query("UPDATE digital_documents SET snapshot='{}' WHERE id=$1", [historical.contract.id]), { code: "23514" });
    await assert.rejects(db!.query("UPDATE digital_orders SET \"contractSnapshot\"='{}' WHERE id=$1", [historical.id]), { code: "23514" });
    while (await runtime!.digitalDocument.count({ where: { status: "PENDING" } })) assert.ok((await processDigitalDocuments()).ready);
    for (let i = 0; i < 3; i++) await processDigitalNotifications(25);
    assert.equal(await runtime!.digitalNotification.count({ where: { status: { not: "CAPTURED_QA" } } }), 0);
    assert.equal(await runtime!.digitalNotification.count({ where: { OR: [{ sentAt: { not: null } }, { deliveredAt: { not: null } }] } }), 0);
    assert.equal(calls.simulatedRefundPosts, 1);
    assert.ok(calls.chargeReads.length > 0); assert.ok(calls.refundReads.every(ref => ref.startsWith("re_")));
    assert.equal(await runtime!.digitalRefund.count({ where: { providerReference: { startsWith: "ch_" } } }), 0);
    assert.deepEqual(await sourceFingerprint(), sourceBefore, "All original QA/historical records must remain unchanged");
  });
  const report = { database, root, groups: results.length, results, schemaOnlyRestore: true, schemaSha256, runtimeRole: "dcn_runtime_a", nonOwner: true, sourceHistoricalDataUnchanged: true, externalProviderCalls: 0, financialProviderPosts: 0, simulatedRefundPosts: calls.simulatedRefundPosts, providerDoubles: true, realEmails: 0, fullAudioFilesReadOrWritten: false, syntheticMasterMetadataOnly: true, retainedProofDatabase: true };
  await writeFile(`${root}/proof.json`, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
  await writeFile(".private/dcn-stripe-refund-runtime-results.json", JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: "PASS", groups: results.length, database, proof: `${root}/proof.json`, externalProviderCalls: 0, realEmails: 0 }));
} finally {
  if (runtime) await runtime.$disconnect();
  if (owner) await owner.$disconnect();
  if (db) await db.end();
  await sourceDb.end(); await control.end();
}
