import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { receiveDigitalEvent } from "@/lib/digital/inbox";

// Real inbox function, in-memory repository only. Source assertions below do
// not claim to execute the HTTP route or validate a real provider signature.
let networkAttempts = 0;
before(() => {
  const deny = () => { networkAttempts++; throw new Error("NETWORK_FORBIDDEN_IN_WEBHOOK_CONTEXT_TEST"); };
  mock.method(globalThis, "fetch", deny); mock.method(http, "request", deny); mock.method(http, "get", deny);
  mock.method(https, "request", deny); mock.method(https, "get", deny);
  mock.method(net, "connect", deny); mock.method(net, "createConnection", deny);
});
after(() => { mock.restoreAll(); assert.equal(networkAttempts, 0); });
const live = { DCN_ENABLED: "true", DCN_MODE: "LIVE", NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production",
  MEDIA_DEPLOYMENT_ENV: "production", PAYMENT_DEPLOYMENT_ENV: "production", DCN_STORAGE_MODE: "OBJECT",
  PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved", DCN_NEW_PAYMENTS_ENABLED: "false", PAYMENTS_ENABLED: "false" };
const orderId = "9de9e26a-e15b-4ad5-9f13-930e9c1249ba", attemptId = "e1ef4a21-2705-44f7-a888-de4408f89324";
type Input = Parameters<typeof receiveDigitalEvent>[0];
type Stored = { provider: string; eventId: string; eventType: string; orderId?: string; bodyHash: string; payload: unknown };
const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseKeys(entry)])) : value;
function input(provider = "STRIPE"): Input {
  return { provider, eventId: "synthetic-event-context-only", eventType: provider === "STRIPE" ? "checkout.session.completed" : "PAYMENT.CAPTURE.COMPLETED",
    orderId, bodyHash: "a".repeat(64), payload: { providerReference: "synthetic-order-reference", attemptId }, verifiedMode: "LIVE", merchantId: "SYNTHETIC_MERCHANT" };
}
async function repository<T>(run: (state: { rows: Stored[]; order: { mode: string | null }; reads: { transactions: number; orders: number } }) => Promise<T>, mode: "LIVE" | "TEST" = "LIVE") {
  const previous = { ...process.env }, original = prisma.$transaction;
  for (const name of Object.keys(process.env)) if (/^DCN_(?:R4_|LOCAL_QA_)/.test(name)) delete process.env[name];
  for (const name of ["RAILWAY_ENVIRONMENT", "DCN_EXTERNAL_TEST_AUTHORIZED", "DCN_LOCAL_REVIEW_AUTHORIZED", "DCN_RECOVERY_EXCERPTS_REVIEW_ONLY",
    "RAILWAY_ENVIRONMENT_NAME", "MEDIA_DEPLOYMENT_ENV", "PAYMENT_DEPLOYMENT_ENV"]) delete process.env[name];
  Object.assign(process.env, mode === "LIVE" ? live : { DCN_ENABLED: "true", DCN_MODE: "TEST" });
  const rows: Stored[] = [], order = { mode: "LIVE" as string | null }, reads = { transactions: 0, orders: 0 };
  const tx = {
    $queryRaw: async () => [],
    digitalOrder: { async findUnique() { reads.orders++; return order.mode === null ? null : { mode: order.mode }; } },
    digitalInbox: { async findUnique({ where }: { where: { provider_eventId: { provider: string; eventId: string } } }) {
      return rows.find(row => row.provider === where.provider_eventId.provider && row.eventId === where.provider_eventId.eventId) ?? null;
    }, async create({ data }: { data: Stored }) { rows.push(structuredClone(data)); return data; } },
  } as unknown as Prisma.TransactionClient;
  let queue = Promise.resolve();
  prisma.$transaction = (async (callback: (client: Prisma.TransactionClient) => Promise<T>) => {
    reads.transactions++; const result = queue.then(() => callback(tx)); queue = result.then(() => undefined, () => undefined); return result;
  }) as unknown as typeof original;
  try { return await run({ rows, order, reads }); }
  finally { prisma.$transaction = original; for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name]; Object.assign(process.env, previous); }
}

test("LIVE requires explicit authenticated mode, merchant and order context before any inbox write", async () => {
  await repository(async ({ rows, reads }) => {
    for (const patch of [{ verifiedMode: undefined }, { verifiedMode: "TEST" as const }, { merchantId: undefined }, { merchantId: "" },
      { merchantId: "x".repeat(256) }, { orderId: undefined }, { payload: { mode: "TEST" as const } }]) {
      await assert.rejects(receiveDigitalEvent({ ...input(), ...patch }), { code: "INVALID_WEBHOOK" });
    }
    assert.equal(rows.length, 0); assert.equal(reads.transactions, 0);
  });
});
test("LIVE refuses a TEST order or missing order, even with verified provider context", async () => {
  await repository(async ({ rows, order }) => {
    for (const mode of ["TEST", null]) { order.mode = mode; await assert.rejects(receiveDigitalEvent(input()), { code: "INVALID_WEBHOOK" }); }
    assert.equal(rows.length, 0);
  });
});
test("both provider inbox records pin verified LIVE and merchant without mutating incoming payload", async () => {
  await repository(async ({ rows }) => {
    for (const provider of ["STRIPE", "PAYPAL"]) {
      const data = input(provider), original = structuredClone(data);
      assert.deepEqual(await receiveDigitalEvent(data), { received: true, queued: true });
      assert.deepEqual(data, original);
      const row = rows.at(-1)!;
      assert.deepEqual(row.payload, { ...data.payload, mode: "LIVE", merchantId: "SYNTHETIC_MERCHANT" });
      assert.equal(row.orderId, orderId); assert.equal(row.bodyHash, data.bodyHash);
    }
    assert.equal(rows.length, 2);
  });
});
test("same authentic context retries and simultaneous deliveries remain one inbox record, including JSONB key ordering", async () => {
  await repository(async ({ rows }) => {
    const data = input(); const results = await Promise.all([receiveDigitalEvent(data), receiveDigitalEvent(data)]);
    assert.equal(results.filter(result => "queued" in result).length, 1);
    assert.equal(results.filter(result => "duplicate" in result).length, 1);
    const hash = billingSnapshotHash(rows[0].payload); rows[0].payload = reverseKeys(rows[0].payload);
    assert.equal(billingSnapshotHash(rows[0].payload), hash);
    assert.deepEqual(await receiveDigitalEvent(data), { received: true, duplicate: true }); assert.equal(rows.length, 1);
  });
});
test("same event id rejects tampered body, event type, payload reference or verified merchant", async () => {
  await repository(async ({ rows }) => {
    const data = input(); await receiveDigitalEvent(data); const before = structuredClone(rows);
    for (const patch of [{ bodyHash: "b".repeat(64) }, { eventType: "refund.created" }, { payload: { ...data.payload, providerReference: "another-reference" } },
      { merchantId: "ANOTHER_SYNTHETIC_MERCHANT" }]) {
      await assert.rejects(receiveDigitalEvent({ ...data, ...patch }), { code: "EVENT_COLLISION" }); assert.deepEqual(rows, before);
    }
  });
});
test("TEST historical receipt keeps its exact payload and hash, without injected LIVE context", async () => {
  await repository(async ({ rows, reads }) => {
    const data = { ...input(), verifiedMode: undefined, merchantId: undefined, orderId: undefined };
    const hash = billingSnapshotHash(data.payload);
    assert.deepEqual(await receiveDigitalEvent(data), { received: true, queued: true });
    assert.deepEqual(rows[0].payload, data.payload); assert.equal(billingSnapshotHash(rows[0].payload), hash);
    assert.equal("mode" in (rows[0].payload as object), false); assert.equal("merchantId" in (rows[0].payload as object), false);
    assert.equal(reads.orders, 0); assert.deepEqual(await receiveDigitalEvent(data), { received: true, duplicate: true });
    await assert.rejects(receiveDigitalEvent({ ...data, payload: { mode: "LIVE" } }), { code: "INVALID_WEBHOOK" });
  }, "TEST");
});
test("route source forwards current verified context and rejects a provider-mismatched attempt in every DCN branch", () => {
  const source = readFileSync("app/api/digital/webhooks/[provider]/route.ts", "utf8");
  const calls = source.match(/receiveDigitalEvent\(\{[\s\S]*?\}\)\)/g) ?? [];
  assert.equal(calls.length, 3); assert.equal(calls.filter(call => call.includes('provider:"STRIPE"')).length, 2);
  assert.equal(calls.filter(call => call.includes('provider:"PAYPAL"')).length, 1);
  for (const call of calls) { assert.match(call, /verifiedMode\s*:\s*mode/); assert.match(call, /merchantId(?:\s*[,}]|\s*:)/); }
  assert.match(source, /attempt\.provider!=="STRIPE"/); assert.match(source, /attempt\.provider!=="PAYPAL"/);
  assert.ok(source.indexOf("verifiedDigitalStripeEvent(raw") < source.indexOf("receiveDigitalEvent({provider:\"STRIPE\""));
  assert.ok(source.indexOf("verifyDigitalPaypalEvent(raw,headers)") < source.indexOf("receiveDigitalEvent({provider:\"PAYPAL\""));
  assert.match(source, /merchantId:digitalPaypalClient\(mode\)\.merchantId/);
});
