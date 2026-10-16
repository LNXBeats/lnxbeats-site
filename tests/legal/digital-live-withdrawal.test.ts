import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Prisma } from "@/generated/prisma/client";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { NOTIFICATION_PRODUCTION_CONFIRMATION } from "@/lib/notifications/config";
import { assessDigitalWithdrawalEvidence, withdrawalReceiptText } from "@/lib/legal/withdrawal-policy";
import { digitalContractSnapshot, DIGITAL_FRANCE_LIVE_CONTRACT_POLICY } from "@/lib/digital/fulfillment-policy";
import { digitalFranceLiveContractCandidate as candidate, DIGITAL_FRANCE_LIVE_CONTRACT_VERSION as version,
  DIGITAL_FRANCE_LIVE_CONTRACT_SCOPE as scope, DIGITAL_FRANCE_LIVE_CONTRACT_TEXT_HASH as textHash,
  DIGITAL_FRANCE_LIVE_CONTRACT_CONSENTS_HASH as consentsHash, digitalFranceLiveContractApprovalHash as approvalHash,
  snapshotDigitalFranceLiveContractApproval as approvalSnapshot, type DigitalFranceLiveContractApproval } from "@/lib/digital/france-live-contract";

// All evidence is SYNTHETIC. No real contract approval, receipt, customer,
// signature or historic acquisition is created. Every transport is trapped.
process.env.DATABASE_URL ??= "postgresql://invalid:invalid@127.0.0.1:1/invalid";
const { prisma } = await import("@/lib/prisma");
const { parseWithdrawalSubmission, submitWithdrawalRequest } = await import("@/lib/legal/withdrawal");
const { processDigitalNotifications } = await import("@/lib/digital/notifications");
const { listDigitalConsumerRequests, reviewDigitalConsumerRequest } = await import("@/lib/legal/withdrawal-admin");
let networkAttempts = 0;
before(() => {
  const deny = () => { networkAttempts++; throw new Error("NETWORK_FORBIDDEN_IN_LIVE_WITHDRAWAL_TEST"); };
  mock.method(globalThis, "fetch", deny); mock.method(http, "request", deny); mock.method(http, "get", deny);
  mock.method(https, "request", deny); mock.method(https, "get", deny);
  mock.method(net, "connect", deny); mock.method(net, "createConnection", deny);
});
after(() => { mock.restoreAll(); assert.equal(networkAttempts, 0); });
const orderId = "44444444-4444-4444-8444-444444444444", userId = "66666666-6666-4666-8666-666666666666";
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "ADMIN", status: "ACTIVE", emailVerified: true } as const;
const buyer = { name: "Client synthétique", email: "synthetic-withdrawal@example.invalid",billingAddressConfirmedAsResidence:true, billingAddress: { countryCode: "FR" as const, line1: "1 rue des Tests", postalCode: "75001", city: "Paris" } };
function contract() {
  const body = { id: "22222222-2222-4222-8222-222222222222", kind: "DIGITAL_FRANCE_LIVE_CONTRACT_APPROVAL" as const, status: "APPROVED" as const,
    version, documentHashSha256: candidate.hashSha256, textHashSha256: textHash, consentsHashSha256: consentsHash, scope,
    approvedAt: "2026-10-16T16:00:00.000Z", createdAt: "2026-10-16T16:01:00.000Z", approvedBy: actor.id,
    evidenceReference: "private-evidence:synthetic-not-real-seller-approval", evidenceSha256: "a".repeat(64) };
  const approval: DigitalFranceLiveContractApproval = { ...body, recordHash: approvalHash(body) };
  return digitalContractSnapshot(buyer, new Date("2026-10-16T17:00:01.000Z"), version,
    { mode: "LIVE", approval: approvalSnapshot(approval, actor, new Date("2026-10-16T17:00:00.000Z")) });
}
function evidence() {
  const snapshot = contract(), documentId = randomUUID(), confirmationAt = new Date("2026-10-16T17:05:00.000Z");
  const hash = billingSnapshotHash({ orderId, contract: snapshot });
  return { userId, earlyDelivery: true, withdrawalAcknowledged: true, termsVersion: version, termsHash: textHash, contractSnapshot: snapshot,
    fulfillment: { confirmationStatus: "ACKNOWLEDGED", confirmationAt, accessReadyAt: confirmationAt,
      confirmationEvidence: { documentId, type: "OWNER_EXPLICIT_RECEIPT_AFTER_TRANSFER", policy: DIGITAL_FRANCE_LIVE_CONTRACT_POLICY, snapshotHash: hash, at: confirmationAt.toISOString() } },
    documents: [{ id: documentId, kind: "CONTRACT", status: "READY", snapshotHash: hash, pdfHash: "b".repeat(64) }],
    events: [
      { kind: "DOCUMENT_TRANSFER_FINISHED", actorId: userId, createdAt: confirmationAt, details: { documentId } },
      { kind: "CONTRACT_RECEIPT_ACKNOWLEDGED", actorId: userId, createdAt: confirmationAt, details: { documentId, policy: DIGITAL_FRANCE_LIVE_CONTRACT_POLICY } },
      { kind: "DOWNLOAD_STARTED", actorId: userId, createdAt: confirmationAt, details: { ticketId: randomUUID() } },
    ] };
}
const live: Record<string, string> = { DCN_ENABLED: "true", DCN_MODE: "LIVE", NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production",
  MEDIA_DEPLOYMENT_ENV: "production", PAYMENT_DEPLOYMENT_ENV: "production", DCN_STORAGE_MODE: "OBJECT",
  PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved", DCN_NEW_PAYMENTS_ENABLED: "false", PAYMENTS_ENABLED: "false",
  AUTH_SECRET: "synthetic-local-test-secret-never-an-access-credential",
  NOTIFICATION_DEPLOYMENT_ENV: "production", NOTIFICATION_EMAIL_TRANSPORT: "resend", NOTIFICATION_PRODUCTION_CONFIRM: NOTIFICATION_PRODUCTION_CONFIRMATION,
  EMAIL_NOTIFICATIONS_ENABLED: "true", CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true", OWNER_EMAIL_NOTIFICATIONS_ENABLED: "false", NOTIFICATION_WORKER_ENABLED: "false",
  SMS_TRANSPORT: "disabled", SMS_NOTIFICATIONS_ENABLED: "false", RESEND_API_KEY: "re_synthetic_fixture_never_send", RESEND_WEBHOOK_SECRET: "whsec_synthetic_fixture_never_use",
  EMAIL_FROM: "LNX Beats <notifications@lnxbeats.fr>", EMAIL_REPLY_TO: "contact@lnxbeats.fr", APP_CANONICAL_URL: "https://www.lnxbeats.fr", AUTH_URL: "https://www.lnxbeats.fr" };
function setMode(mode: "TEST" | "LIVE") {
  for (const name of Object.keys(process.env)) if (/^(?:DCN_|NOTIFICATION_|EMAIL_|OWNER_EMAIL_|CLIENT_EMAIL_|SMS_|RESEND_|RAILWAY_|PAYMENT_|MEDIA_DEPLOYMENT_ENV$|AUTH_URL$|APP_CANONICAL_URL$)/.test(name)) delete process.env[name];
  Object.assign(process.env, mode === "LIVE" ? live : { DCN_ENABLED: "true", DCN_MODE: "TEST", AUTH_SECRET: live.AUTH_SECRET });
}
async function isolated<T>(run: () => Promise<T>) {
  const previous = { ...process.env }; setMode("LIVE");
  try { return await run(); }
  finally { for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name]; Object.assign(process.env, previous); }
}
const valid = { contractType: "DIGITAL_ORDER", requestKind: "WITHDRAWAL", orderNumber: orderId, firstName: "Client", lastName: "Synthétique", email: buyer.email,
  productDescription: "Album synthétique — aucune acquisition réelle", quantity: null, reason: null, declarationAccepted: true };
type Stored = Record<string, unknown> & { id: string; requestNumber: string; receivedAt: Date };
function repository() {
  const requests: Stored[] = [], mails: Record<string, unknown>[] = [], events: Record<string, unknown>[] = [], rates = new Map<string, { count: number; lastRequest: bigint }>();
  const order = { mode: "LIVE", email: buyer.email };
  const tx = { $queryRaw: async (sql: TemplateStringsArray) => sql.join("").includes("current_setting('TimeZone')") ? [{ timezone: "UTC" }] : [],
    rateLimit: { async findUnique({ where }: { where: { key: string } }) { return rates.get(where.key) ?? null; },
      async create({ data }: { data: { key: string; count: number; lastRequest: bigint } }) { rates.set(data.key, data); },
      async update({ where, data }: { where: { key: string }; data: { count: number | { increment: number }; lastRequest?: bigint } }) {
        const previous = rates.get(where.key)!; rates.set(where.key, { count: typeof data.count === "number" ? data.count : previous.count + data.count.increment,
          lastRequest: data.lastRequest ?? previous.lastRequest }); } },
    digitalOrder: { async findUnique() { return { id: orderId, termsVersion: version, mode: order.mode, user: { email: order.email } }; } },
    consumerWithdrawalRequest: { async findUnique({ where }: { where: { deduplicationHashSha256: string } }) { return requests.find(row => row.deduplicationHashSha256 === where.deduplicationHashSha256) ?? null; },
      async create({ data }: { data: Record<string, unknown> }) { const row = { ...data, id: randomUUID(), requestNumber: String(data.requestNumber), receivedAt: data.receivedAt as Date }; requests.push(row); return row; },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) { const row = requests.find(row => row.id === where.id)!; Object.assign(row, data); return row; } },
    digitalNotification: { async create({ data }: { data: Record<string, unknown> }) { mails.push(data); return data; } },
    digitalEvent: { async create({ data }: { data: Record<string, unknown> }) { events.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  return { requests, mails, events, order, async use<T>(run: () => Promise<T>) {
    const previous = prisma.$transaction;
    prisma.$transaction = (async (callback: (client: Prisma.TransactionClient) => Promise<T>) => callback(tx)) as unknown as typeof previous;
    try { return await run(); } finally { prisma.$transaction = previous; }
  } };
}

test("approved acquired LIVE evidence exposes a cumulative candidate, never an automatic withdrawal or refund decision", () => {
  const value = assessDigitalWithdrawalEvidence(evidence());
  assert.equal(value.expressConsent, true); assert.equal(value.acknowledgementOfLoss, true); assert.equal(value.documentTransmissionRecorded, true);
  assert.equal(value.explicitReceiptRecorded, true); assert.equal(value.durableConfirmation, true); assert.equal(value.executionStarted, true);
  assert.equal(value.exceptionCandidate, true); assert.equal(value.decision, "HUMAN_REVIEW_REQUIRED");
});
test("new LIVE receipt policy refuses missing consent, altered approved terms, missing acknowledgement or hash/time mismatch", () => {
  const source = evidence();
  const invalid = [
    { ...source, earlyDelivery: false }, { ...source, withdrawalAcknowledged: false }, { ...source, termsHash: "f".repeat(64) },
    { ...source, contractSnapshot: { ...source.contractSnapshot, approvedForLive: false } },
    { ...source, events: source.events.filter(event => event.kind !== "CONTRACT_RECEIPT_ACKNOWLEDGED") },
    { ...source, fulfillment: { ...source.fulfillment, confirmationEvidence: { ...source.fulfillment.confirmationEvidence, snapshotHash: "0".repeat(64) } } },
    { ...source, fulfillment: { ...source.fulfillment, confirmationEvidence: { ...source.fulfillment.confirmationEvidence, at: "2026-10-16T17:04:59.000Z" } } },
    { ...source, events: source.events.filter(event => event.kind !== "DOWNLOAD_STARTED") },
    { ...source, events: source.events.map(event => event.kind === "DOWNLOAD_STARTED" ? { ...event, createdAt: new Date("2026-10-16T17:04:59.000Z") } : event) },
    { ...source, events: source.events.map(event => event.kind === "CONTRACT_RECEIPT_ACKNOWLEDGED" ? { ...event, actorId: actor.id } : event) },
  ];
  for (const value of invalid) { const result = assessDigitalWithdrawalEvidence(value); assert.equal(result.exceptionCandidate, false); assert.equal(result.decision, "HUMAN_REVIEW_REQUIRED"); }
});
test("LIVE request stores one canonical durable acknowledgement and outbox; retry never requests money or revokes access", async () => isolated(async () => {
  const f = repository(); await f.use(async () => {
    const date = new Date("2026-10-16T17:15:00.123Z"), first = await submitWithdrawalRequest(parseWithdrawalSubmission(valid), "127.0.0.1", date);
    const second = await submitWithdrawalRequest(parseWithdrawalSubmission(valid), "127.0.0.1", date);
    assert.equal(first.requestNumber, second.requestNumber); assert.equal(f.requests.length, 1); assert.equal(f.mails.length, 1); assert.equal(f.events.length, 1);
    assert.equal(f.requests[0].identityMatch, "MATCHED"); assert.equal(f.requests[0].digitalOrderId, orderId);
    const snapshot = f.requests[0].acknowledgementSnapshot as Record<string, unknown>;
    assert.equal(snapshot.digitalMode, "LIVE"); assert.equal(snapshot.receivedAt, date.toISOString()); assert.equal(snapshot.eligibility, "PENDING_REVIEW");
    assert.equal((f.mails[0].template as { mode: string }).mode, "LIVE"); assert.equal(f.mails[0].kind, "CONSUMER_REQUEST_ACK");
    assert.match(withdrawalReceiptText(snapshot, String(f.requests[0].acknowledgementHashSha256)), /Aucun remboursement n’est déclenché/);
    assert.equal("refund" in f.requests[0], false); assert.equal("entitlements" in f.requests[0], false);
  });
}));
test("TEST and LIVE submissions cannot share a deduplication receipt or silently bind a different-mode order", async () => isolated(async () => {
  const f = repository(); await f.use(async () => {
    setMode("TEST"); f.order.mode = "TEST"; const old = await submitWithdrawalRequest(parseWithdrawalSubmission(valid), "127.0.0.1");
    const historicalSnapshot = structuredClone(f.requests[0].acknowledgementSnapshot);
    setMode("LIVE"); f.order.mode = "LIVE"; const current = await submitWithdrawalRequest(parseWithdrawalSubmission(valid), "127.0.0.1");
    assert.notEqual(old.requestNumber, current.requestNumber); assert.equal(f.requests.length, 2); assert.equal(f.mails.length, 2);
    assert.notEqual(f.requests[0].deduplicationHashSha256, f.requests[1].deduplicationHashSha256);
    assert.deepEqual(f.requests[0].acknowledgementSnapshot, historicalSnapshot);
    assert.equal("digitalMode" in (historicalSnapshot as object), false); assert.equal((f.requests[1].acknowledgementSnapshot as { digitalMode: string }).digitalMode, "LIVE");
  });
  const mismatched = repository(); mismatched.order.mode = "TEST";
  await mismatched.use(async () => {
    const result = await submitWithdrawalRequest(parseWithdrawalSubmission(valid), "127.0.0.2");
    assert.deepEqual(Object.keys(result).sort(), ["receiptToken", "receivedAt", "requestNumber"]);
    assert.equal(mismatched.requests[0].identityMatch, "UNMATCHED"); assert.equal(mismatched.requests[0].digitalOrderId, null);
    assert.equal((mismatched.requests[0].acknowledgementSnapshot as { digitalMode: string }).digitalMode, "LIVE");
  });
}));
test("LIVE acknowledgement selection is mode-isolated even without a matched order and never accepts QA capture as SENT", async () => isolated(async () => {
  const original = { find: prisma.digitalNotification.findMany, update: prisma.digitalNotification.updateMany, ack: prisma.consumerWithdrawalRequest.updateMany };
  const f = repository(); await f.use(() => submitWithdrawalRequest(parseWithdrawalSubmission(valid), "127.0.0.1"));
  const snapshot = f.requests[0].acknowledgementSnapshot, hash = String(f.requests[0].acknowledgementHashSha256), requestId = f.requests[0].id;
  let selection: Record<string, unknown> | undefined, sent = 0, ackWrites = 0; const writes: Record<string, unknown>[] = [];
  prisma.digitalNotification.findMany = (async (args: { where: Record<string, unknown> }) => {
    selection = args.where; return [{ id: randomUUID(), orderId: null, withdrawalRequestId: requestId, recipient: buyer.email, businessKey: "synthetic-ack",
      template: f.mails[0].template, attempts: 0, firstAttemptAt: null, status: "PENDING", order: null,
      withdrawalRequest: { contractType: "DIGITAL_ORDER", claimantEmail: buyer.email, acknowledgementSnapshot: snapshot, acknowledgementHashSha256: hash } }];
  }) as unknown as typeof original.find;
  prisma.digitalNotification.updateMany = (async (args: { data: Record<string, unknown> }) => { writes.push(args.data); return { count: 1 }; }) as unknown as typeof original.update;
  prisma.consumerWithdrawalRequest.updateMany = (async () => { ackWrites++; return { count: 1 }; }) as typeof original.ack;
  try {
    const outcome = await processDigitalNotifications(1, async () => { sent++; return { id: "synthetic-capture-not-delivery", evidence: "CAPTURED_QA" }; }, undefined, requestId);
    assert.deepEqual(outcome, { captured: 0, sent: 0, failed: 1 }); assert.equal(sent, 1); assert.equal(ackWrites, 0);
    assert.match(JSON.stringify(selection), /"digitalMode"\],"equals":"LIVE"/);
    assert.equal(selection?.withdrawalRequestId, requestId); assert.equal(writes.some(write => write.status === "SENT"), false);
    assert.equal(writes.at(-1)?.status, "RETRY");
    // An injected acceptance double is not real email delivery. It checks only
    // the durable request projection once the existing transport returns SENT.
    assert.deepEqual(await processDigitalNotifications(1, async () => ({ id: "synthetic-provider-acceptance", evidence: "SENT" }), undefined, requestId),
      { captured: 0, sent: 1, failed: 0 });
    assert.equal(ackWrites, 1); assert.equal(writes.at(-1)?.status, "SENT");
  } finally { prisma.digitalNotification.findMany = original.find; prisma.digitalNotification.updateMany = original.update; prisma.consumerWithdrawalRequest.updateMany = original.ack; }
}));

function adminRepository() {
  type ReviewRequest = { id: string; requestNumber: string; requestKind: string; digitalOrderId: string | null; identityMatch: string; status: string;
    updatedAt: Date; refundStatus: string; acknowledgementSnapshot: { digitalMode?: string }; digitalOrder: (ReturnType<typeof evidence> & { mode?: string }) | null };
  const request: ReviewRequest = { id: randomUUID(), requestNumber: "SYNTHETIC-NOT-REAL", requestKind: "WITHDRAWAL", digitalOrderId: orderId,
    identityMatch: "MATCHED", status: "RECEIVED", updatedAt: new Date("2026-10-16T17:10:00.000Z"), refundStatus: "NOT_EVALUATED",
    acknowledgementSnapshot: { digitalMode: "LIVE" }, digitalOrder: { ...evidence(), mode: "LIVE" } };
  const requests = [request], updates: Record<string, unknown>[] = [], audits: Array<Record<string, unknown>> = [];
  const selects: Array<{ where: Prisma.ConsumerWithdrawalRequestWhereInput; select?: { digitalOrder?: { select?: { events?: { where?: { kind?: { in?: string[] } } } } } };
    include?: { digitalOrder?: { select?: { events?: { where?: { kind?: { in?: string[] } } } } } } }> = [];
  const project = (row: ReviewRequest, args: (typeof selects)[number]) => {
    const source = structuredClone(row), kinds = args.select?.digitalOrder?.select?.events?.where?.kind?.in ?? args.include?.digitalOrder?.select?.events?.where?.kind?.in ?? [];
    if (source.digitalOrder) source.digitalOrder.events = source.digitalOrder.events.filter(event => kinds.includes(event.kind));
    return source;
  };
  const tx = { $queryRaw: async (sql: TemplateStringsArray) => sql.join("").includes("current_setting('TimeZone')") ? [{ timezone: "UTC" }] : [],
    user: { async findFirst() { return { id: actor.id }; } },
    consumerWithdrawalRequest: {
      async findMany(args: (typeof selects)[number]) { selects.push(args); return requests.map(row => project(row, args)); },
      async findFirst(args: (typeof selects)[number]) { selects.push(args); return project(request, args); },
      async updateMany({ where, data }: { where: { updatedAt: Date; status: string }; data: Record<string, unknown> }) {
        if (where.status !== request.status || where.updatedAt.getTime() !== request.updatedAt.getTime()) return { count: 0 };
        updates.push(data); Object.assign(request, data); return { count: 1 };
      },
    }, digitalEvent: {
      async findUnique({ where }: { where: { externalKey: string } }) { return audits.find(row => row.externalKey === where.externalKey) ?? null; },
      async findMany() { return []; }, async create({ data }: { data: Record<string, unknown> }) { audits.push(data); return data; },
    } } as unknown as Prisma.TransactionClient;
  return { request, requests, selects, updates, audits, input: () => ({ requestId: request.id, idempotencyKey: randomUUID(), expectedUpdatedAt: request.updatedAt.toISOString(),
    decision: "REJECTED", basis: "DIGITAL_EXCEPTION", reason: "Revue humaine synthétique complète, aucun remboursement automatique." }),
  async use<T>(run: () => Promise<T>) {
    const original = prisma.$transaction; prisma.$transaction = (async (callback: (client: Prisma.TransactionClient) => Promise<T>) => callback(tx)) as unknown as typeof original;
    try { return await run(); } finally { prisma.$transaction = original; }
  } };
}
test("LIVE Admin actually loads the acknowledged-receipt event and records one scoped human decision without financial mutation", async () => isolated(async () => {
  const f = adminRepository(); await f.use(async () => {
    const input = f.input(); await reviewDigitalConsumerRequest({ ...actor, name: "Admin synthétique", email: "admin@example.invalid" }, input);
    assert.equal(f.request.status, "REJECTED"); assert.equal(f.request.refundStatus, "NOT_EVALUATED");
    assert.equal(f.audits.length, 1); assert.equal(f.updates.length, 1);
    assert.equal(f.audits[0].externalKey, `consumer-review:LIVE:${input.idempotencyKey}`);
    const details = f.audits[0].details as { mode: string; financialMutation: boolean; assessment: { exceptionCandidate: boolean } };
    assert.equal(details.mode, "LIVE"); assert.equal(details.financialMutation, false); assert.equal(details.assessment.exceptionCandidate, true);
    assert.ok(f.selects[0].include?.digitalOrder?.select?.events?.where?.kind?.in?.includes("CONTRACT_RECEIPT_ACKNOWLEDGED"));
    assert.match(JSON.stringify(f.selects[0].where), /"digitalOrder":\{"mode":"LIVE"\}/);
    assert.equal("refundStatus" in f.updates[0], false);
    assert.deepEqual(await reviewDigitalConsumerRequest({ ...actor, name: "Admin synthétique", email: "admin@example.invalid" }, input), { duplicate: true });
    assert.equal(f.audits.length, 1); assert.equal(f.updates.length, 1);
  });
}));
test("LIVE Admin excludes TEST or unknown receipts and refuses cross-mode review even if a repository double ignores SQL", async () => isolated(async () => {
  const f = adminRepository();
  f.requests.push({ ...structuredClone(f.request), id: randomUUID(), digitalOrder: { ...evidence(), mode: "TEST" } },
    { ...structuredClone(f.request), id: randomUUID(), digitalOrderId: null, digitalOrder: null, acknowledgementSnapshot: { digitalMode: "LIVE" } },
    { ...structuredClone(f.request), id: randomUUID(), digitalOrderId: null, digitalOrder: null, acknowledgementSnapshot: {} },
    { ...structuredClone(f.request), id: randomUUID(), digitalOrderId: null, digitalOrder: null, acknowledgementSnapshot: { digitalMode: "UNKNOWN" } });
  await f.use(async () => {
    const rows = await listDigitalConsumerRequests(actor); assert.equal(rows.length, 2);
    assert.equal(rows[0].evidence?.exceptionCandidate, true); assert.equal(rows[1].evidence, null);
    assert.equal(rows[0].acknowledgementSnapshot, undefined);
    f.request.digitalOrder!.mode = "TEST";
    await assert.rejects(reviewDigitalConsumerRequest({ ...actor, name: "Admin synthétique", email: "admin@example.invalid" }, f.input()), { code: "NOT_FOUND" });
    assert.equal(f.audits.length, 0); assert.equal(f.updates.length, 0);
  });
}));
test("TEST Admin keeps absent-mode historical acknowledgements and the original idempotence key", async () => isolated(async () => {
  setMode("TEST"); const f = adminRepository(); f.request.digitalOrder!.mode = "TEST";
  f.requests.push({ ...structuredClone(f.request), id: randomUUID(), digitalOrderId: null, digitalOrder: null, acknowledgementSnapshot: {} },
    { ...structuredClone(f.request), id: randomUUID(), digitalOrderId: null, digitalOrder: null, acknowledgementSnapshot: { digitalMode: "LIVE" } });
  await f.use(async () => {
    const rows = await listDigitalConsumerRequests(actor); assert.equal(rows.length, 2);
    const nullScope = f.selects[0].where.OR?.[1]?.OR?.[1]?.acknowledgementSnapshot as { equals?: unknown };
    assert.equal(nullScope.equals, Prisma.AnyNull);
    const input = { ...f.input(), decision: "UNDER_REVIEW", basis: "HUMAN_REVIEW" };
    await reviewDigitalConsumerRequest({ ...actor, name: "Admin synthétique", email: "admin@example.invalid" }, input);
    assert.equal(f.audits[0].externalKey, `consumer-review:${input.idempotencyKey}`);
    assert.equal("mode" in (f.audits[0].details as object), false); assert.equal(f.request.refundStatus, "NOT_EVALUATED");
  });
}));
