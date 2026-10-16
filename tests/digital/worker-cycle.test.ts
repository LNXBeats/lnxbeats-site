import assert from "node:assert/strict";
import { test } from "node:test";
import { createDigitalWorkerCycle, digitalWorkerMode, digitalMediaWorkerEnvironment, DIGITAL_WORKER_BATCH,
  type DigitalWorkerDependencies, type DigitalWorkerOrder, type DigitalWorkerRefund } from "@/lib/digital/worker-cycle";

// Scheduling/in-memory doubles only: no database, PSP, email, media or network.
const live = { DCN_ENABLED: "true", DCN_MODE: "LIVE", NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production",
  MEDIA_DEPLOYMENT_ENV: "production", PAYMENT_DEPLOYMENT_ENV: "production", DCN_STORAGE_MODE: "OBJECT",
  PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved", DCN_WORKER_ENABLED: "true",
  DCN_NEW_PAYMENTS_ENABLED: "false", PAYMENTS_ENABLED: "false" };
const qa = { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_WORKER_ENABLED: "true", DCN_EXTERNAL_TEST_AUTHORIZED: "true" };

function fixture(env = live) {
  const calls: string[] = [], orders: DigitalWorkerOrder[] = [], refunds: DigitalWorkerRefund[] = [];
  const cursors: Array<{ kind: string; id?: string }> = [];
  const dependencies: DigitalWorkerDependencies = {
    async inbox(limit) { assert.equal(limit, DIGITAL_WORKER_BATCH.inbox); calls.push("inbox"); },
    async pendingOrders(mode, limit, id) { assert.equal(mode, env.DCN_MODE); assert.equal(limit, 5); cursors.push({ kind: "order", id }); calls.push("orders"); return orders; },
    async recoverOrder(id) { calls.push(`order:${id}`); },
    async pendingRefunds(mode, limit, id) { assert.equal(mode, env.DCN_MODE); assert.equal(limit, 3); cursors.push({ kind: "refund", id }); calls.push("refunds"); return refunds; },
    async recoverRefund(id) { calls.push(`refund:${id}`); },
    async documents(limit) { assert.equal(limit, 2); calls.push("documents"); },
    async notifications(limit) { assert.equal(limit, 2); calls.push("notifications"); },
    async media(kind) { calls.push(kind); },
  };
  let time = 0;
  return { dependencies, calls, orders, refunds, cursors, now: () => time, advance: (ms: number) => { time += ms; } };
}

test("worker capability is OFF by default and refuses inconsistent LIVE or TEST production", async () => {
  assert.equal(digitalWorkerMode({ ...live, DCN_WORKER_ENABLED: undefined }), null);
  assert.equal(digitalWorkerMode({ ...live, DCN_WORKER_ENABLED: "TRUE" }), null);
  assert.equal(digitalWorkerMode({ ...live, DCN_MODE: "TEST" }), null);
  assert.equal(digitalWorkerMode({ ...live, DCN_EXTERNAL_TEST_AUTHORIZED: "true" }), null);
  const f = fixture();
  const run = createDigitalWorkerCycle(f.dependencies, { env: () => ({ ...live, DCN_WORKER_ENABLED: "false" }) });
  assert.equal((await run()).status, "DISABLED"); assert.deepEqual(f.calls, []);
});

test("isolated media child does not inherit payment or email credentials", () => {
  const env = { ...live, DATABASE_URL: "synthetic-database-marker", R2_ACCESS_KEY_ID: "synthetic-storage-marker",
    DCN_STRIPE_SECRET_KEY: "synthetic-do-not-inherit", STRIPE_SECRET_KEY: "synthetic-do-not-inherit", DCN_PAYPAL_CLIENT_SECRET: "synthetic-do-not-inherit",
    PAYPAL_CLIENT_ID: "synthetic-do-not-inherit", RESEND_API_KEY: "synthetic-do-not-inherit", DCN_RESEND_API_KEY: "synthetic-do-not-inherit" };
  const child = digitalMediaWorkerEnvironment(env);
  assert.equal(child.DATABASE_URL, env.DATABASE_URL); assert.equal(child.R2_ACCESS_KEY_ID, env.R2_ACCESS_KEY_ID);
  assert.equal(digitalWorkerMode(child), "LIVE");
  assert.equal(Object.keys(child).some(name => /STRIPE|PAYPAL|RESEND/.test(name)), false);
  assert.equal(env.DCN_STRIPE_SECRET_KEY, "synthetic-do-not-inherit");
});

test("isolated child provides a valid explicit NODE_ENV without relaxing LIVE runtime", () => {
  assert.equal(digitalMediaWorkerEnvironment({ NODE_ENV: "production" }).NODE_ENV, "production");
  assert.equal(digitalMediaWorkerEnvironment({ NODE_ENV: "test" }).NODE_ENV, "test");
  assert.ok(["development", "test", "production"].includes(digitalMediaWorkerEnvironment({}).NODE_ENV!));
  assert.throws(() => digitalMediaWorkerEnvironment({ NODE_ENV: "unexpected" }), /INVALID_NODE_ENV/);
  assert.equal(digitalWorkerMode(digitalMediaWorkerEnvironment({ ...live, NODE_ENV: "development" })), null);
});

test("LIVE inbox, acquired documents/mail/ZIP and READ recovery survive closing new sales", async () => {
  const f = fixture(); f.orders.push({ id: "a", mode: "LIVE" }); f.refunds.push({ id: "b", status: "PENDING", mode: "LIVE" });
  const run = createDigitalWorkerCycle(f.dependencies, { env: () => live, now: f.now });
  const result = await run();
  assert.equal(result.status, "COMPLETED"); assert.equal(result.paymentsChecked, 1); assert.equal(result.refundsChecked, 1);
  assert.deepEqual(f.calls, ["inbox", "orders", "order:a", "refunds", "refund:b", "documents", "notifications", "audio", "zip"]);
  assert.equal("capture" in f.dependencies, false); assert.equal("refund" in f.dependencies, false);
});

test("TEST provider reads retain explicit external authorization, independent local jobs continue", async () => {
  const f = fixture();
  const run = createDigitalWorkerCycle(f.dependencies, { env: () => ({ ...qa, DCN_EXTERNAL_TEST_AUTHORIZED: "false" }) });
  const result = await run(); assert.equal(result.status, "COMPLETED");
  assert.deepEqual(f.calls, ["documents", "notifications", "audio", "zip"]);
});

test("READ batches are bounded even if a broken adapter returns excessive rows", async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) { f.orders.push({ id: `o${i}`, mode: "LIVE" }); f.refunds.push({ id: `r${i}`, status: "PENDING", mode: "LIVE" }); }
  const result = await createDigitalWorkerCycle(f.dependencies, { env: () => live, now: f.now })();
  assert.equal(result.paymentsChecked, 5); assert.equal(result.refundsChecked, 3);
});

test("cross-mode rows and REQUESTED refunds are never sent to recovery", async () => {
  const f = fixture(); f.orders.push({ id: "qa-order", mode: "TEST" });
  f.refunds.push({ id: "requested", mode: "LIVE", status: "REQUESTED" }, { id: "qa-refund", mode: "TEST", status: "PENDING" },
    { id: "paid-refund", mode: "LIVE", status: "SUCCEEDED" });
  const result = await createDigitalWorkerCycle(f.dependencies, { env: () => live })();
  assert.equal(result.paymentsChecked, 0); assert.equal(result.refundsChecked, 0);
  assert.equal(f.calls.some(value => value.startsWith("order:") || value.startsWith("refund:")), false);
});

test("periodic READ recovery is throttled and cursor batches progress without database writes", async () => {
  const f = fixture(); f.orders.push({ id: "first", mode: "LIVE" });
  const run = createDigitalWorkerCycle(f.dependencies, { env: () => live, now: f.now });
  await run(); f.advance(59_999); await run();
  assert.equal(f.calls.filter(value => value === "orders").length, 1);
  assert.equal(f.calls.filter(value => value === "inbox").length, 2);
  f.advance(1); await run(); assert.equal(f.cursors.filter(c => c.kind === "order")[1].id, "first");
  f.orders.length = 0; f.advance(60_000); await run(); f.advance(60_000); await run();
  assert.equal(f.cursors.filter(c => c.kind === "order").at(-1)?.id, undefined);
});

test("a cycle is non-reentrant and never runs heavy media in parallel", async () => {
  const f = fixture(); let release!: () => void;
  f.dependencies.inbox = async () => { await new Promise<void>(resolve => { release = resolve; }); };
  let heavyActive = 0, heavyPeak = 0;
  f.dependencies.media = async kind => { heavyActive++; heavyPeak = Math.max(heavyPeak, heavyActive); await Promise.resolve(); f.calls.push(kind); heavyActive--; };
  const run = createDigitalWorkerCycle(f.dependencies, { env: () => live });
  const first = run(); assert.equal((await run()).status, "BUSY"); release(); await first;
  assert.equal(heavyPeak, 1); assert.deepEqual(f.calls.slice(-2), ["audio", "zip"]);
});

test("shutdown before or during a cycle prevents all later jobs", async () => {
  const f = fixture(), shutdown = new AbortController(); shutdown.abort();
  const run = createDigitalWorkerCycle(f.dependencies, { env: () => live });
  assert.equal((await run(shutdown.signal)).status, "STOPPED"); assert.deepEqual(f.calls, []);
  const second = new AbortController(); f.dependencies.inbox = async () => { f.calls.push("inbox"); second.abort(); };
  assert.equal((await run(second.signal)).status, "STOPPED"); assert.deepEqual(f.calls, ["inbox"]);
});

test("disable or mode change between stages cannot process the next tenant/mode", async () => {
  const f = fixture(); let env = { ...live };
  f.dependencies.inbox = async () => { f.calls.push("inbox"); env = { ...env, DCN_WORKER_ENABLED: "false" }; };
  const result = await createDigitalWorkerCycle(f.dependencies, { env: () => env })();
  assert.equal(result.status, "STOPPED"); assert.deepEqual(f.calls, ["inbox"]);
});

test("failure is counted without logging provider payloads and does not starve durable documents", async () => {
  const f = fixture(); f.dependencies.inbox = async () => { throw new Error("private-provider-body-never-log"); };
  f.dependencies.pendingOrders = async () => { throw new Error("credential-never-log"); };
  const result = await createDigitalWorkerCycle(f.dependencies, { env: () => live })();
  assert.equal(result.failures, 2); assert.equal(result.status, "COMPLETED");
  assert.equal(JSON.stringify(result).includes("never-log"), false);
  assert.deepEqual(f.calls.slice(-4), ["documents", "notifications", "audio", "zip"]);
});

test("reconciliation-only entrypoint has no document, email, encoding or archive side effects", async () => {
  const f = fixture();
  await createDigitalWorkerCycle(f.dependencies, { env: () => live })(undefined, true);
  assert.deepEqual(f.calls, ["inbox", "orders", "refunds"]);
});
