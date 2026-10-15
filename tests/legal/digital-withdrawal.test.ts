import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { consumerRequestDeclaration } from "@/lib/legal/withdrawal-copy";
import { assessDigitalWithdrawalEvidence, CONSUMER_ACKNOWLEDGEMENT_POLICY, withdrawalAcknowledgementTemplate, withdrawalReceiptText } from "@/lib/legal/withdrawal-policy";

// Repository doubles only. This address cannot contact a real database; no API or mail transport is used.
process.env.DATABASE_URL ??= "postgresql://invalid:invalid@127.0.0.1:1/invalid";
const { prisma } = await import("@/lib/prisma");
const { parseWithdrawalSubmission, submitWithdrawalRequest } = await import("@/lib/legal/withdrawal");
const { handleWithdrawalSubmission } = await import("@/lib/legal/withdrawal-route-handler");
const { parseDigitalConsumerReview, reviewDigitalConsumerRequest } = await import("@/lib/legal/withdrawal-admin");
const { processDigitalNotifications } = await import("@/lib/digital/notifications");
const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)])) : value;
const orderId = randomUUID(), userId = randomUUID();
const valid = { contractType: "DIGITAL_ORDER", requestKind: "WITHDRAWAL", orderNumber: orderId, firstName: "Client", lastName: "Synthétique", email: "buyer@example.invalid",
  productDescription: "Album synthétique QA", quantity: null, reason: null, declarationAccepted: true };

async function isolated<T>(tx: Prisma.TransactionClient, run: () => Promise<T>) {
  const keys = ["AUTH_SECRET", "DCN_ENABLED", "DCN_MODE", "RAILWAY_ENVIRONMENT_NAME", "MEDIA_DEPLOYMENT_ENV", "PAYMENT_DEPLOYMENT_ENV"] as const;
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]])), transaction = prisma.$transaction;
  Object.assign(process.env, { AUTH_SECRET: "synthetic-local-test-secret-never-an-access-credential", DCN_ENABLED: "true", DCN_MODE: "TEST" });
  delete process.env.RAILWAY_ENVIRONMENT_NAME; delete process.env.MEDIA_DEPLOYMENT_ENV; delete process.env.PAYMENT_DEPLOYMENT_ENV;
  let queue = Promise.resolve();
  prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
    const result = queue.then(() => callback(tx)); queue = result.then(() => undefined, () => undefined); return result;
  }) as unknown as typeof transaction;
  try { return await run(); } finally { prisma.$transaction = transaction; for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
}

function submissionRepository(email = valid.email) {
  type Stored = Record<string, unknown> & { id: string; requestNumber: string; receivedAt: Date };
  const requests: Stored[] = [], mails: Record<string, unknown>[] = [], events: Record<string, unknown>[] = [], rates = new Map<string, { count: number; lastRequest: bigint }>();
  const session = { timezone: "UTC" };
  const tx = { $queryRaw: async (strings: TemplateStringsArray) => strings.join("").includes("current_setting('TimeZone')") ? [{ timezone: session.timezone }] : [],
    rateLimit: { async findUnique({ where }: { where: { key: string } }) { return rates.get(where.key) ?? null; },
      async create({ data }: { data: { key: string; count: number; lastRequest: bigint } }) { rates.set(data.key, { ...data }); },
      async update({ where, data }: { where: { key: string }; data: { count: number | { increment: number }; lastRequest?: bigint } }) {
        const old = rates.get(where.key)!; rates.set(where.key, { count: typeof data.count === "number" ? data.count : old.count + data.count.increment, lastRequest: data.lastRequest ?? old.lastRequest }); } },
    digitalOrder: { async findUnique() { return { id: orderId, termsVersion: "LOCAL-DRAFT", mode: "TEST", user: { email } }; } },
    consumerWithdrawalRequest: { async findUnique({ where }: { where: { deduplicationHashSha256: string } }) { return requests.find(r => r.deduplicationHashSha256 === where.deduplicationHashSha256) ?? null; },
      async create({ data }: { data: Record<string, unknown> }) { const row = { ...data, id: randomUUID(), requestNumber: data.requestNumber as string, receivedAt: data.receivedAt as Date }; requests.push(row); return row; },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) { const row = requests.find(r => r.id === where.id)!; Object.assign(row, data); return row; } },
    digitalNotification: { async create({ data }: { data: Record<string, unknown> }) { mails.push(data); return data; } },
    digitalEvent: { async create({ data }: { data: Record<string, unknown> }) { events.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  return { tx, requests, mails, events, rates, session };
}

test("digital consumer form accepts withdrawal without reason and separates non-conformity/goodwill without arbitrary fields", () => {
  assert.equal(parseWithdrawalSubmission(valid).reason, null);
  for (const requestKind of ["WITHDRAWAL", "NON_CONFORMITY", "GOODWILL"]) {
    assert.equal(parseWithdrawalSubmission({ ...valid, requestKind, orderNumber: orderId.toUpperCase() }).orderNumber, orderId);
    assert.match(consumerRequestDeclaration(requestKind as "WITHDRAWAL"), /rétracter|non-conformité|geste commercial/);
  }
  for (const patch of [{ requestKind: "REFUND_NOW" }, { refund: true }, { declarationAccepted: false }, { orderNumber: "only-last-eight" }, { email: "invalid" }]) assert.throws(() => parseWithdrawalSubmission({ ...valid, ...patch }));
  assert.throws(() => parseWithdrawalSubmission({ ...valid, contractType: "SHOP_ORDER", orderNumber: "LNX-SHOP-2026-000001", requestKind: "GOODWILL" }));
});

test("durable receipt survives JSONB key order with versioned canonical hash; historical hashes retain their exact original order", () => {
  const legacy = { requestNumber: "LNX-RET-2026-AABBCCDDEEFF", receivedAt: "2026-10-15T10:11:12.123Z", contractType: "MUSIC_ORDER", claimedOrderReference: "LNX-2026-000001",
    claimantName: "Client Synthétique", claimantEmail: valid.email, productDescription: "Création QA", quantity: null, declaration: consumerRequestDeclaration("WITHDRAWAL"), status: "RECEIVED", eligibility: "PENDING_REVIEW", professional: "LNX Beats", contact: "support@example.invalid" };
  const oldHash = createHash("sha256").update(JSON.stringify(legacy)).digest("hex");
  assert.match(withdrawalReceiptText(reverseKeys(legacy), oldHash), /10:11:12.123Z/);
  const current = { ...legacy, policy: CONSUMER_ACKNOWLEDGEMENT_POLICY, requestKind: "WITHDRAWAL", reason: null };
  const hash = billingSnapshotHash(current);
  assert.equal(withdrawalReceiptText(reverseKeys(current), hash), withdrawalReceiptText(current, hash));
  assert.throws(() => withdrawalReceiptText({ ...current, declaration: "changed" }, hash));
  assert.throws(() => withdrawalReceiptText({ ...current, policy: "future-unknown" }, hash));
  assert.match(withdrawalAcknowledgementTemplate(current, hash).text, /Contrat déclaré.*LNX-2026-000001/);
  assert.doesNotMatch(withdrawalAcknowledgementTemplate({ ...current, productDescription: "<script>synthetic</script>" }, billingSnapshotHash({ ...current, productDescription: "<script>synthetic</script>" })).html, /<script>/);
});

test("public route is login-free but enforces origin, JSON and an actual streamed 8 KiB body limit without enumeration", async () => {
  let calls = 0;
  const dependencies = { sameOrigin: () => true, submit: async () => { calls++; return { requestNumber: "private", receivedAt: new Date(), receiptToken: "a".repeat(43) }; } };
  const request = (body: string, contentType = "application/json") => new Request("http://localhost/api/legal/withdrawals", { method: "POST", body, headers: { "content-type": contentType } });
  assert.equal((await handleWithdrawalSubmission(request(JSON.stringify(valid)), { ...dependencies, sameOrigin: () => false })).status, 403);
  assert.equal((await handleWithdrawalSubmission(request(JSON.stringify(valid), "text/plain"), dependencies)).status, 415);
  assert.equal((await handleWithdrawalSubmission(request(`{"reason":"${"x".repeat(9000)}"}`), dependencies)).status, 400);
  assert.equal(calls, 0);
  const response = await handleWithdrawalSubmission(request(JSON.stringify(valid)), dependencies);
  assert.equal(response.status, 202); assert.deepEqual(await response.json(), { ok: true, next: "/retractation/confirmation" });
  assert.match(response.headers.get("set-cookie")!, /HttpOnly.*SameSite=Lax.*Path=\/retractation\/confirmation/); assert.match(response.headers.get("cache-control")!, /no-store/);
});

test("submission atomically preserves the original declaration, creates one durable acknowledgement/outbox and retries once", async () => {
  const f = submissionRepository(), date = new Date("2026-10-15T10:11:12.123Z"), input = parseWithdrawalSubmission(valid);
  await isolated(f.tx, async () => {
    const first = await submitWithdrawalRequest(input, "127.0.0.1", date), token = f.requests[0].publicReceiptTokenHash;
    const second = await submitWithdrawalRequest(input, "127.0.0.1", date);
    assert.equal(first.requestNumber, second.requestNumber); assert.equal(f.requests.length, 1); assert.equal(f.mails.length, 1); assert.equal(f.events.length, 1);
    assert.notEqual(f.requests[0].publicReceiptTokenHash, token); assert.notEqual(first.receiptToken, second.receiptToken);
    assert.equal(f.requests[0].digitalOrderId, orderId); assert.equal(f.requests[0].identityMatch, "MATCHED");
    assert.equal(f.mails[0].withdrawalRequestId, f.requests[0].id); assert.equal(f.mails[0].kind, "CONSUMER_REQUEST_ACK"); assert.equal(f.mails[0].orderId, undefined);
    const snapshot = reverseKeys(f.requests[0].acknowledgementSnapshot);
    assert.match(withdrawalReceiptText(snapshot, String(f.requests[0].acknowledgementHashSha256)), /10:11:12.123Z/);
  });
});

test("knowing reference/email never grants the original receipt after changing claimant/content; unmatched contracts look identical publicly", async () => {
  const f = submissionRepository();
  await isolated(f.tx, async () => {
    await submitWithdrawalRequest(parseWithdrawalSubmission({ ...valid, reason: "Original private precision" }), "127.0.0.1");
    const oldCapability = f.requests[0].publicReceiptTokenHash;
    const distinct = await submitWithdrawalRequest(parseWithdrawalSubmission({ ...valid, firstName: "Autre" }), "127.0.0.1");
    assert.equal(f.requests.length, 2); assert.equal(f.requests[0].publicReceiptTokenHash, oldCapability); assert.notEqual(distinct.requestNumber, f.requests[0].requestNumber);
    await submitWithdrawalRequest(parseWithdrawalSubmission({ ...valid, firstName: "Autre" }), "127.0.0.1"); assert.equal(f.requests.length, 2);
  });
  const u = submissionRepository("different@example.invalid");
  await isolated(u.tx, async () => { const result = await submitWithdrawalRequest(parseWithdrawalSubmission(valid), "127.0.0.2");
    assert.deepEqual(Object.keys(result).sort(), ["receiptToken", "receivedAt", "requestNumber"]); assert.equal(u.requests[0].identityMatch, "UNMATCHED"); assert.equal(u.requests[0].digitalOrderId, null); assert.equal(u.mails.length, 1); });
});

test("persistent identity rate limit stops the sixth request even when all are idempotent", async () => {
  const f = submissionRepository();
  await isolated(f.tx, async () => { for (let i = 0; i < 5; i++) await submitWithdrawalRequest(parseWithdrawalSubmission(valid), "127.0.0.1");
    await assert.rejects(() => submitWithdrawalRequest(parseWithdrawalSubmission(valid), "127.0.0.1"), { code: "RATE_LIMITED" }); assert.equal(f.requests.length, 1); assert.equal(f.mails.length, 1); });
});

test("DCN submission rejects a non-UTC database session before rate limits, receipt, audit or email writes", async () => {
  const f = submissionRepository(); f.session.timezone = "Europe/Paris";
  await isolated(f.tx, () => assert.rejects(() => submitWithdrawalRequest(parseWithdrawalSubmission(valid), "127.0.0.1"), { code: "DIGITAL_DATABASE_TIMEZONE_UNSAFE" }));
  assert.equal(f.rates.size, 0); assert.equal(f.requests.length, 0); assert.equal(f.mails.length, 0); assert.equal(f.events.length, 0);
});

function orderEvidence() {
  const text = "Conditions synthétiques QA, pas un texte juridique approuvé", documentId = randomUUID(), confirmationAt = new Date("2026-10-15T10:00:00Z");
  return { userId, earlyDelivery: true, withdrawalAcknowledged: true, termsVersion: "LOCAL-DRAFT", termsHash: createHash("sha256").update(text).digest("hex"),
    contractSnapshot: { mode: "TEST", acceptedAt: "2026-10-01T10:00:00Z", terms: { version: "LOCAL-DRAFT", text }, earlyDelivery: { expresslyRequested: true }, withdrawal: { expresslyAcknowledged: true } },
    fulfillment: { confirmationStatus: "ACKNOWLEDGED", confirmationAt, accessReadyAt: confirmationAt, confirmationEvidence: { documentId, type: "OWNER_EXPLICIT_QA_RECEIPT_AFTER_TRANSFER", policy: "PROPOSED_NOT_LEGAL_VALIDATION" } },
    documents: [{ id: documentId, kind: "CONTRACT", status: "READY", snapshotHash: "a".repeat(64), pdfHash: "b".repeat(64) }],
    events: [{ kind: "DOCUMENT_TRANSFER_FINISHED", actorId: userId, createdAt: confirmationAt, details: { documentId, evidence: "SERVER_STREAM_DISPATCHED_NOT_CLIENT_STORAGE" } },
      { kind: "DOWNLOAD_STARTED", actorId: userId, createdAt: confirmationAt, details: { ticketId: randomUUID() } }] };
}

test("digital exception is cumulative, informative and never an automatic refusal from two boxes, QA receipt or apparent age", () => {
  const evidence = orderEvidence(), assessment = assessDigitalWithdrawalEvidence(evidence);
  assert.equal(assessment.expressConsent, true); assert.equal(assessment.acknowledgementOfLoss, true); assert.equal(assessment.documentTransmissionRecorded, true);
  assert.equal(assessment.explicitReceiptRecorded, true); assert.equal(assessment.executionStarted, true); assert.equal(assessment.durableConfirmation, false);
  assert.equal(assessment.exceptionCandidate, false); assert.equal(assessment.decision, "HUMAN_REVIEW_REQUIRED");
  assert.equal(assessDigitalWithdrawalEvidence({ ...evidence, events: evidence.events.filter(e => e.kind !== "DOWNLOAD_STARTED") }).executionStarted, false);
  assert.equal(assessDigitalWithdrawalEvidence({ ...evidence, termsHash: "f".repeat(64) }).expressConsent, false);
});

function reviewRepository() {
  const actor: OrderActor = { id: randomUUID(), name: "QA Admin", email: "admin@example.invalid", role: "ADMIN", status: "ACTIVE", emailVerified: true };
  const request = { id: randomUUID(), requestNumber: "LNX-RET-2026-ABCDEF123456", requestKind: "WITHDRAWAL", digitalOrderId: orderId as string | null,
    identityMatch: "MATCHED", status: "RECEIVED", updatedAt: new Date("2026-10-15T10:00:00Z"), refundStatus: "NOT_EVALUATED", digitalOrder: orderEvidence() };
  const user = { allowed: true }, session = { timezone: "UTC" }, events: Array<{ externalKey: string; actorId: string; details: unknown }> = [], updates: Record<string, unknown>[] = [];
  const tx = { $queryRaw: async (strings: TemplateStringsArray) => strings.join("").includes("current_setting('TimeZone')") ? [{ timezone: session.timezone }] : [], user: { async findFirst() { return user.allowed ? { id: actor.id } : null; } },
    digitalEvent: { async findUnique({ where }: { where: { externalKey: string } }) { return events.find(e => e.externalKey === where.externalKey) ?? null; }, async create({ data }: { data: (typeof events)[number] }) { events.push(data); return data; } },
    consumerWithdrawalRequest: { async findFirst() { return request; }, async updateMany({ where, data }: { where: { updatedAt: Date; status: string }; data: Record<string, unknown> }) {
      if (where.status !== request.status || where.updatedAt.getTime() !== request.updatedAt.getTime()) return { count: 0 };
      updates.push(data); Object.assign(request, data); return { count: 1 }; } },
  } as unknown as Prisma.TransactionClient;
  const input = () => ({ requestId: request.id, idempotencyKey: randomUUID(), expectedUpdatedAt: request.updatedAt.toISOString(), decision: "UNDER_REVIEW", basis: "HUMAN_REVIEW", reason: "Revue humaine synthétique en cours sans décision financière." });
  return { tx, request, actor, user, events, updates, input, session };
}

test("DCN human decision rejects a non-UTC session before status, decision date or audit writes", async () => {
  const f = reviewRepository(), before = structuredClone(f.request); f.session.timezone = "Europe/Paris";
  await isolated(f.tx, () => assert.rejects(() => reviewDigitalConsumerRequest(f.actor, f.input()), { code: "DIGITAL_DATABASE_TIMEZONE_UNSAFE" }));
  assert.deepEqual(f.request, before); assert.equal(f.updates.length, 0); assert.equal(f.events.length, 0);
});

test("Admin refreshes database role and refuses arbitrary/short review input before writes", async () => {
  const f = reviewRepository();
  for (const patch of [{ reason: "court" }, { actorId: randomUUID() }, { decision: "REFUND_NOW" }, { expectedUpdatedAt: "yesterday" }]) assert.throws(() => parseDigitalConsumerReview({ ...f.input(), ...patch }));
  f.user.allowed = false;
  await isolated(f.tx, () => assert.rejects(() => reviewDigitalConsumerRequest(f.actor, f.input()), { code: "ADMIN_REQUIRED" })); assert.equal(f.updates.length, 0); assert.equal(f.events.length, 0);
});

test("human review writes one audit and no refund/access/order mutation; JSONB-sorted retry is idempotent", async () => {
  const f = reviewRepository();
  await isolated(f.tx, async () => {
    const input = { ...f.input(), decision: "ACCEPTED" };
    await reviewDigitalConsumerRequest(f.actor, input); f.events[0].details = reverseKeys(f.events[0].details);
    assert.deepEqual(await reviewDigitalConsumerRequest(f.actor, input), { duplicate: true });
    assert.equal(f.events.length, 1); assert.equal(f.updates.length, 1); assert.equal(f.request.status, "ACCEPTED"); assert.equal(f.request.refundStatus, "NOT_EVALUATED");
    assert.equal(Object.hasOwn(f.updates[0], "refundStatus"), false);
    await assert.rejects(() => reviewDigitalConsumerRequest(f.actor, { ...input, reason: "Autre motivation synthétique après résultat inconnu." }), { code: "IDEMPOTENCY_CONFLICT" });
  });
});

test("same-millisecond stale concurrent review cannot overwrite latest; identity and unproven digital exception fail closed", async () => {
  const f = reviewRepository();
  await isolated(f.tx, async () => {
    const input = f.input(), now = f.request.updatedAt;
    await reviewDigitalConsumerRequest(f.actor, input, now); assert.equal(f.request.updatedAt.getTime(), now.getTime() + 1);
    await assert.rejects(() => reviewDigitalConsumerRequest(f.actor, { ...input, idempotencyKey: randomUUID() }, now), { code: "REQUEST_CHANGED" });
    await assert.rejects(() => reviewDigitalConsumerRequest(f.actor, { ...f.input(), decision: "REJECTED", basis: "DIGITAL_EXCEPTION" }), { code: "WITHDRAWAL_EXCEPTION_UNPROVEN" });
    f.request.identityMatch = "UNMATCHED"; f.request.digitalOrderId = null;
    await assert.rejects(() => reviewDigitalConsumerRequest(f.actor, { ...f.input(), decision: "ACCEPTED" }), { code: "IDENTITY_REVIEW_REQUIRED" });
    assert.equal(f.events.length, 1);
  });
});

test("QA notification capture never marks the durable consumer acknowledgement SENT", async () => {
  const f = submissionRepository(), methods = { findMany: prisma.digitalNotification.findMany, updateMany: prisma.digitalNotification.updateMany, ack: prisma.consumerWithdrawalRequest.updateMany };
  let ackWrites = 0;
  prisma.digitalNotification.findMany = (async () => [{ id: randomUUID(), recipient: valid.email, businessKey: "withdraw:synthetic:ack", template: {}, status: "PENDING", attempts: 0, firstAttemptAt: null, withdrawalRequestId: randomUUID() }]) as unknown as typeof methods.findMany;
  prisma.digitalNotification.updateMany = (async () => ({ count: 1 })) as typeof methods.updateMany;
  prisma.consumerWithdrawalRequest.updateMany = (async () => { ackWrites++; return { count: 1 }; }) as typeof methods.ack;
  try { await isolated(f.tx, async () => { assert.deepEqual(await processDigitalNotifications(1, async () => ({ id: "synthetic-capture", evidence: "CAPTURED_QA" })), { captured: 1, sent: 0, failed: 0 }); assert.equal(ackWrites, 0); }); }
  finally { prisma.digitalNotification.findMany = methods.findMany; prisma.digitalNotification.updateMany = methods.updateMany; prisma.consumerWithdrawalRequest.updateMany = methods.ack; }
});

test("notification processing can scope only the new withdrawal and refuses combined/invalid scopes before reading jobs", async () => {
  const f = submissionRepository(), original = prisma.digitalNotification.findMany, requestId = randomUUID(); let read = 0;
  prisma.digitalNotification.findMany = (async (input: unknown) => { read++; const where = (input as { where: Record<string, unknown> }).where;
    assert.equal(where.withdrawalRequestId, requestId); assert.equal(where.orderId, undefined); return []; }) as typeof original;
  try { await isolated(f.tx, async () => {
    await assert.rejects(() => processDigitalNotifications(1, undefined, orderId, requestId), { code: "INVALID_NOTIFICATION_SCOPE" });
    await assert.rejects(() => processDigitalNotifications(1, undefined, undefined, "invalid")); assert.equal(read, 0);
    assert.deepEqual(await processDigitalNotifications(1, undefined, undefined, requestId), { captured: 0, sent: 0, failed: 0 }); assert.equal(read, 1);
  }); } finally { prisma.digitalNotification.findMany = original; }
});

test("additive migration and provision preserve durable facts, strict parents and no runtime deletion/DDL", () => {
  const sql = readFileSync("prisma/migrations/20261015040000_digital_consumer_withdrawal/migration.sql", "utf8"), service = readFileSync("lib/legal/withdrawal-admin.ts", "utf8");
  assert.match(sql, /contractType"::text='DIGITAL_ORDER'/); assert.match(sql, /consumer_acknowledgement_immutable/); assert.match(sql, /digital_notification_parent/);
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE|UPDATE consumer_withdrawal_requests SET/i);
  assert.doesNotMatch(service, /requestDigitalRefund|processDigitalRefund|\.refund\(|digitalEntitlement\./);
  const privileges = readFileSync("lib/digital/runtime-privileges.ts", "utf8"); assert.match(privileges, /consumer_withdrawal_requests:\["publicReceiptTokenHash"/);
  assert.doesNotMatch(privileges, /GRANT ALL|GRANT.*DELETE|GRANT.*ON ALL TABLES/i);
});
