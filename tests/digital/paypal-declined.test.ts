import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { paypalCaptureResponseEvidence } from "@/lib/payments/paypal-client";
import { digitalPaypalOrderEvidence, assertDigitalPaypalDeclinedRecovery } from "@/lib/digital/paypal-evidence";
import type { DigitalPaymentEvidence } from "@/lib/digital/domain";
import type { DigitalGateway } from "@/lib/digital/providers";

// All provider responses and persistence below are local doubles. No profile,
// credentials, SDK factory, database connection, HTTP request or real signature.
const orderId = "2c07c4dd-2e1e-4a70-a7ad-33444fd9c057";
const attemptId = "c38fceda-e088-485c-b69e-307b2f166676";
const merchant = "FYB627RNF647L", captureId = "CAPTURE-QA", providerOrderId = "ORDER-QA";
const order = { id: orderId, totalCents: 990 }, attempt = { id: attemptId, providerReference: providerOrderId };
function response(status = "DECLINED") {
  return { id: providerOrderId, status: "APPROVED", purchase_units: [{ reference_id: orderId, custom_id: attemptId,
    payee: { merchant_id: merchant }, amount: { value: "9.90", currency_code: "EUR" },
    payments: { captures: [{ id: captureId, status, amount: { value: "9.90", currency_code: "EUR" },
      final_capture: true, update_time: "2026-10-14T10:00:00Z" }] } }] };
}
const declined = () => digitalPaypalOrderEvidence(response(), order, attempt, merchant);
test("DECLINED v2 reproduces shared-parser rejection but scoped DCN evidence is FAILED, never PAID", () => {
  assert.throws(() => paypalCaptureResponseEvidence(response()), { code: "INVALID_RESPONSE" });
  const evidence = declined(); assert.equal(evidence.status, "FAILED"); assert.equal(evidence.paymentReference, captureId);
  assert.equal(evidence.eventId, `paypal-recover:${captureId}:DECLINED`);
});
test("DCN scoped failure validates merchant, amount, currency, Order and custom/reference IDs", () => {
  const invalid = [
    { ...response(), id: "OTHER-ORDER" },
    { ...response(), purchase_units: [{ ...response().purchase_units[0], custom_id: "other-attempt" }] },
    { ...response(), purchase_units: [{ ...response().purchase_units[0], reference_id: "other-order" }] },
    { ...response(), purchase_units: [{ ...response().purchase_units[0], payee: { merchant_id: "OTHER-MERCHANT" } }] },
    { ...response(), purchase_units: [{ ...response().purchase_units[0], amount: { value: "9.89", currency_code: "EUR" } }] },
    { ...response(), purchase_units: [{ ...response().purchase_units[0], amount: { value: "9.90", currency_code: "USD" } }] },
  ];
  for (const body of invalid) assert.throws(() => digitalPaypalOrderEvidence(body, order, attempt, merchant));
});
test("capture omissions, wrong capture amount/currency and contradictory capture metadata fail closed", () => {
  for (const patch of [
    { id: "" }, { amount: { value: "9.89", currency_code: "EUR" } }, { amount: { value: "9.90", currency_code: "USD" } },
    { custom_id: "other-attempt" }, { payee: { merchant_id: "OTHER-MERCHANT" } },
    { supplementary_data: { related_ids: { order_id: "OTHER-ORDER" } } },
  ]) {
    const body = response(); Object.assign(body.purchase_units[0].payments.captures[0], patch);
    assert.throws(() => digitalPaypalOrderEvidence(body, order, attempt, merchant));
  }
  for (const body of [null, {}, { ...response(), status: "CREATED" }, { ...response(), purchase_units: [] },
    { ...response(), purchase_units: [response().purchase_units[0], response().purchase_units[0]] }]) assert.throws(() => digitalPaypalOrderEvidence(body, order, attempt, merchant));
  const multiple = response(); multiple.purchase_units[0].payments.captures.push(response("COMPLETED").purchase_units[0].payments.captures[0]);
  assert.throws(() => digitalPaypalOrderEvidence(multiple, order, attempt, merchant));
});
test("successful and pending scoped captures retain previous shared validation; no DENIED alias", () => {
  assert.equal(digitalPaypalOrderEvidence(response("COMPLETED"), order, attempt, merchant).status, "PAID");
  assert.equal(digitalPaypalOrderEvidence(response("PENDING"), order, attempt, merchant).status, "PENDING");
  assert.throws(() => digitalPaypalOrderEvidence(response("DENIED"), order, attempt, merchant));
});
test("a declined webhook can never reconcile a different capture, paid/pending response or missing evidence", () => {
  assertDigitalPaypalDeclinedRecovery(captureId, declined());
  for (const evidence of [undefined, { ...declined(), paymentReference: "OTHER-CAPTURE" }, { ...declined(), status: "PAID" as const },
    { ...declined(), status: "PENDING" as const }, { ...declined(), provider: "STRIPE" as const }]) assert.throws(() => assertDigitalPaypalDeclinedRecovery(captureId, evidence));
});

type Event = { orderId: string; externalKey?: string; kind: string; details: Record<string, unknown> };
type Inbox = { id: string; provider: string; eventId: string; eventType: string; orderId: string; bodyHash: string; payload: Record<string, unknown>;
  status: string; attempts: number; availableAt: Date; leaseToken: string | null; leaseUntil: Date | null; errorCode: string | null };
function state(orderStatus = "PENDING", attemptStatus = "OPEN") {
  const payment = { ...attempt, orderId, provider: "PAYPAL", status: attemptStatus, operation: "CAPTURE", paymentReference: null as string | null, leaseUntil: null as Date | null };
  return { order: { ...order, userId: "757bfdf1-4933-4440-9442-4d580c34f48e", mode: "TEST", status: orderStatus, user: { email: "qa@example.invalid" }, lines: [], attempts: [payment] },
    payment, events: [] as Event[], inbox: [] as Inbox[], documents: 0, entitlementWrites: 0, notifications: 0, recoveries: 0 };
}
let current = state();
const fake = {
  digitalOrder: { async findUnique() { return current.order; }, async findFirst() { return current.order; }, async findUniqueOrThrow() { return current.order; }, async update({ data }: { data: Record<string, unknown> }) { Object.assign(current.order, data); return current.order; } },
  digitalPaymentAttempt: {
    async findUnique() { return current.payment; }, async findFirst() { return current.payment; },
    async update({ data }: { data: Record<string, unknown> }) { Object.assign(current.payment, data); return current.payment; },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      if (where.status !== current.payment.status) return { count: 0 };
      Object.assign(current.payment, data); return { count: 1 };
    },
  },
  digitalEvent: {
    async findUnique({ where }: { where: { externalKey: string } }) { return current.events.find(e => e.externalKey === where.externalKey) ?? null; },
    async findFirst({ where }: { where: { kind?: string | { in: string[] } } }) { const kinds = typeof where.kind === "string" ? [where.kind] : where.kind?.in ?? []; return current.events.find(e => kinds.includes(e.kind)) ?? null; },
    async create({ data }: { data: Event }) { current.events.push(data); return data; },
  },
  digitalEntitlement: { async findFirst() { return null; }, async upsert() { current.entitlementWrites++; throw Error("No rights may be granted by refusal"); } },
  digitalBillingDocument: { async create() { current.documents++; throw Error("No document may be created by refusal"); } },
  digitalNotification: { async upsert() { current.notifications++; return {}; } },
  digitalInbox: {
    async findUnique({ where }: { where: { provider_eventId: { provider: string; eventId: string } } }) { return current.inbox.find(i => i.provider === where.provider_eventId.provider && i.eventId === where.provider_eventId.eventId) ?? null; },
    async create({ data }: { data: Pick<Inbox, "provider" | "eventId" | "eventType" | "orderId" | "bodyHash" | "payload"> }) {
      const row: Inbox = { ...data, id: `inbox-${current.inbox.length}`, status: "PENDING", attempts: 0, availableAt: new Date(0), leaseToken: null, leaseUntil: null, errorCode: null }; current.inbox.push(row); return row;
    },
    async findMany() { return current.inbox.filter(i => ["PENDING", "RETRY"].includes(i.status) && i.availableAt <= new Date()); },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const row = current.inbox.find(i => i.id === where.id); if (!row) return { count: 0 };
      if (where.leaseToken !== undefined && row.leaseToken !== where.leaseToken || typeof where.status === "string" && row.status !== where.status) return { count: 0 };
      for (const [key, value] of Object.entries(data)) {
        if (key === "attempts") row.attempts += (value as { increment: number }).increment;
        else Object.assign(row, { [key]: value });
      }
      return { count: 1 };
    },
  },
  async $queryRaw() { return []; },
  async $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> { return callback(fake); },
};
Object.assign(globalThis, { prisma: fake });
async function local<T>(operation: () => Promise<T>, initial = state()) {
  current = initial;
  const names = ["DCN_ENABLED", "DCN_MODE", "MEDIA_DEPLOYMENT_ENV", "PAYMENT_DEPLOYMENT_ENV", "RAILWAY_ENVIRONMENT_NAME"];
  const old = new Map(names.map(k => [k, process.env[k]]));
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", MEDIA_DEPLOYMENT_ENV: "test", PAYMENT_DEPLOYMENT_ENV: "development" });
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  try { return await operation(); } finally { for (const [key, value] of old) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
function gateway(evidence: DigitalPaymentEvidence | undefined = declined()): DigitalGateway {
  return { merchantId: merchant, async create() { throw Error("No creation in reconciliation"); }, async capture() { throw Error("No recapture in reconciliation"); },
    async recover() { current.recoveries++; return evidence ? { evidence } : null; } };
}
async function queue(eventId = "WH-OFFLINE-DECLINED", reference: string | undefined = captureId) {
  const { receiveDigitalEvent } = await import("@/lib/digital/inbox");
  const payload = { providerReference: providerOrderId, attemptId, ...(reference ? { resourceReference: reference } : {}) };
  return receiveDigitalEvent({ provider: "PAYPAL", eventId, eventType: "PAYMENT.CAPTURE.DECLINED", orderId, bodyHash: createHash("sha256").update(eventId).digest("hex"), payload });
}
function noFulfillment() { assert.equal(current.entitlementWrites, 0); assert.equal(current.documents, 0); assert.equal(current.notifications, 0); }
test("DECLINED is persisted, verified by scoped recovery and processed FAILED without fulfillment", async () => {
  await local(async () => {
    const { DIGITAL_PAYPAL_EVENTS, processDigitalInbox } = await import("@/lib/digital/inbox");
    assert.ok(DIGITAL_PAYPAL_EVENTS.includes("PAYMENT.CAPTURE.DECLINED"));
    await queue(); assert.deepEqual(await processDigitalInbox(1, { payment: gateway() }), { processed: 1, retry: 0, review: 0 });
    assert.equal(current.order.status, "FAILED"); assert.equal(current.payment.status, "FAILED"); assert.equal(current.payment.paymentReference, captureId);
    assert.equal(current.inbox[0].status, "PROCESSED"); noFulfillment();
  });
});
test("strict PayPal DECLINED resolves UNKNOWN capture after timeout, without recapturing", async () => {
  await local(async () => {
    const { reconcileDigitalEvidence } = await import("@/lib/digital/commerce");
    assert.deepEqual(await reconcileDigitalEvidence(declined(), merchant), { failed: true });
    assert.equal(current.order.status, "FAILED"); assert.equal(current.payment.status, "FAILED"); noFulfillment();
  }, state("REQUIRES_REVIEW", "UNKNOWN"));
});
test("shared capture rejection remains UNKNOWN until scoped fresh recovery; a single simulated capture POST", async () => {
  await local(async () => {
    const names = ["DCN_PAYPAL_ENVIRONMENT", "DCN_PAYPAL_CLIENT_ID", "DCN_PAYPAL_CLIENT_SECRET", "DCN_PAYPAL_WEBHOOK_ID", "DCN_PAYPAL_MERCHANT_ID"];
    const old = new Map(names.map(k => [k, process.env[k]])), originalFetch = globalThis.fetch;
    const calls: Array<{ method: string; path: string }> = []; let captured = false;
    Object.assign(process.env, { DCN_PAYPAL_ENVIRONMENT: "sandbox", DCN_PAYPAL_CLIENT_ID: "OFFLINE_DUMMY_CLIENT_ID_ONLY",
      DCN_PAYPAL_CLIENT_SECRET: "OFFLINE_DUMMY_CLIENT_SECRET_ONLY", DCN_PAYPAL_WEBHOOK_ID: "OFFLINE-WEBHOOK", DCN_PAYPAL_MERCHANT_ID: merchant });
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input)), method = options?.method ?? "GET";
      assert.equal(url.origin, "https://api-m.sandbox.paypal.com"); calls.push({ method, path: url.pathname });
      if (url.pathname === "/v1/oauth2/token") return new Response(JSON.stringify({ access_token: "OFFLINE_DUMMY_TOKEN_ONLY", token_type: "Bearer" }));
      if (method === "POST" && url.pathname === `/v2/checkout/orders/${providerOrderId}/capture`) { captured = true; return new Response(JSON.stringify(response())); }
      if (method === "GET" && url.pathname === `/v2/checkout/orders/${providerOrderId}`) {
        const body = response(); if (!captured) body.purchase_units[0].payments.captures = [];
        return new Response(JSON.stringify(body));
      }
      throw Error("Unexpected operation; no real fetch exists in this double");
    };
    try {
      const { captureDigitalPaypal, reconcileDigitalOrder } = await import("@/lib/digital/commerce");
      await captureDigitalPaypal(current.order.userId, orderId);
      assert.equal(current.order.status, "REQUIRES_REVIEW"); assert.equal(current.payment.status, "UNKNOWN"); noFulfillment();
      await reconcileDigitalOrder(orderId);
      assert.equal(current.order.status, "FAILED"); assert.equal(current.payment.status, "FAILED"); noFulfillment();
      assert.equal(calls.filter(c => c.method === "POST" && c.path.endsWith("/capture")).length, 1);
      assert.equal(calls.filter(c => c.method === "GET").length, 2);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of old) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
});
test("duplicate events and different-event same-capture refusals are idempotent", async () => {
  await local(async () => {
    const { processDigitalInbox } = await import("@/lib/digital/inbox");
    await queue(); assert.deepEqual(await queue(), { received: true, duplicate: true });
    await processDigitalInbox(1, { payment: gateway() }); await queue("WH-OFFLINE-SECOND");
    await processDigitalInbox(1, { payment: gateway() });
    assert.equal(current.recoveries, 1); assert.equal(current.events.length, 1); assert.equal(current.inbox.length, 2);
    assert.ok(current.inbox.every(i => i.status === "PROCESSED")); noFulfillment();
  });
});
test("incomplete declined event or contradictory fresh paid capture remains RETRY, never grants", async () => {
  for (const missing of [true, false]) await local(async () => {
    const { processDigitalInbox } = await import("@/lib/digital/inbox");
    await queue("WH-OFFLINE-CONTRADICTION", missing ? "" : captureId);
    assert.deepEqual(await processDigitalInbox(1, { payment: gateway({ ...declined(), status: "PAID" }) }), { processed: 0, retry: 1, review: 0 });
    assert.equal(current.order.status, "PENDING"); assert.equal(current.inbox[0].status, "RETRY"); noFulfillment();
  });
});
test("old same-capture DECLINED cannot downgrade PAID/REFUNDED or revoke an acquisition", async () => {
  for (const status of ["PAID", "REFUNDED"]) {
    const initial = state(status, "PAID"); initial.payment.paymentReference = captureId;
    await local(async () => {
      const { processDigitalInbox } = await import("@/lib/digital/inbox");
      await queue(); await processDigitalInbox(1, { payment: gateway() });
      assert.equal(current.order.status, status); assert.equal(current.payment.status, "PAID"); assert.equal(current.recoveries, 0);
      assert.equal(current.inbox[0].status, "PROCESSED"); noFulfillment();
    }, initial);
  }
});
test("different capture after paid is a contradiction, never processed as same refusal", async () => {
  const initial = state("PAID", "PAID"); initial.payment.paymentReference = captureId;
  await local(async () => {
    const { processDigitalInbox } = await import("@/lib/digital/inbox");
    await queue("WH-OFFLINE-OTHER-CAPTURE", "OTHER-CAPTURE");
    assert.deepEqual(await processDigitalInbox(1, { payment: gateway() }), { processed: 0, retry: 1, review: 0 });
    assert.equal(current.order.status, "PAID"); assert.equal(current.payment.status, "PAID"); noFulfillment();
  }, initial);
});
test("a pre-existing financial contradiction is not cleared by later refusal evidence", async () => {
  const initial = state("REQUIRES_REVIEW", "UNKNOWN"); initial.events.push({ orderId, kind: "PAYMENT_CONTRADICTION", details: {} });
  await local(async () => {
    const { reconcileDigitalEvidence } = await import("@/lib/digital/commerce");
    await reconcileDigitalEvidence(declined(), merchant); assert.equal(current.order.status, "REQUIRES_REVIEW"); assert.equal(current.payment.status, "UNKNOWN"); noFulfillment();
  }, initial);
});
test("late paid after a failed order stays review and cannot resurrect downloads/documents", async () => {
  const initial = state("FAILED", "FAILED"); initial.payment.paymentReference = captureId;
  await local(async () => {
    const { reconcileDigitalEvidence } = await import("@/lib/digital/commerce");
    const paid = digitalPaypalOrderEvidence(response("COMPLETED"), order, attempt, merchant);
    assert.deepEqual(await reconcileDigitalEvidence(paid, merchant), { review: true });
    assert.equal(current.order.status, "REQUIRES_REVIEW"); assert.equal(current.payment.status, "FAILED"); noFulfillment();
  }, initial);
});
