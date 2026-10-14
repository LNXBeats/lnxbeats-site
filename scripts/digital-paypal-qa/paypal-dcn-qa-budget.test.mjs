// Offline journal tests only: no socket, SDK, credential or financial call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, unlink, rmdir, appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { initializePaypalQaBudget, reservePaypalQaCall, readPaypalQaBudget, paypalRestApplicationIdentity } from "./paypal-dcn-qa-budget.mjs";

const timestamp = 1800000000000;
const sandboxOrigin = "https://api-m.sandbox.paypal.com";
const scope = { environment: "SANDBOX", applicationName: "LNX Studio DCN QA", applicationId: paypalRestApplicationIdentity("synthetic-client-not-a-credential"),
  merchantId: "FYB627RNF647L", approvedHost: "offline-example.ngrok-free.app" };
const limits = { REST_TOTAL: 120, OAUTH: 60, GET: 20, CREATE_ORDER: 3, CAPTURE: 3,
  REFUND: 2, SIGNATURE: 30, CREATE_WEBHOOK: 1, DELETE_WEBHOOK: 1, DELIVERY: 30 };
function authorization(restricted = {}) {
  return { approval: "USER_APPROVED_EXACT_ROUTE_AND_RECIPE", scope, runId: "dcn-paypal-offline-test",
    startedAt: timestamp, deadline: timestamp + 7200000, limits: { ...limits, ...restricted } };
}
const oauth = { method: "POST", url: `${sandboxOrigin}/v1/oauth2/token` };
const getOrder = { method: "GET", url: `${sandboxOrigin}/v2/checkout/orders/OFFLINEORDER` };
async function fixture(execute) {
  const directory = await mkdtemp("/private/tmp/lnx-dcn-paypal-budget-test-"), file = path.join(directory, "ledger.jsonl");
  try { await execute(file); }
  finally { try { await unlink(file); } catch (error) { if (error.code !== "ENOENT") throw error; } await rmdir(directory); }
}

test("reservation persisted before caller operation; failed operation remains spent on restart", async () => {
  await fixture(async file => {
    await initializePaypalQaBudget(file, authorization({ REST_TOTAL: 1, DELETE_WEBHOOK: 0 }), timestamp);
    const reservation = await reservePaypalQaCall(file, oauth, scope, timestamp + 1);
    assert.equal(reservation.reservedBeforeCall, true);
    // No provider call: this is the durable accounting of a hypothetical failure.
    const restarted = await readPaypalQaBudget(file);
    assert.equal(restarted.used.OAUTH, 1); assert.equal(restarted.used.REST_TOTAL, 1);
    assert.equal(restarted.authorization.startedAt, timestamp); assert.equal(restarted.authorization.deadline, timestamp + 7200000);
    await assert.rejects(reservePaypalQaCall(file, getOrder, scope, timestamp + 2), /BUDGET_EXHAUSTED/);
    assert.equal((await readPaypalQaBudget(file)).sequence, 1);
  });
});

test("concurrent reservations atomically retain unique journal sequence", async () => {
  await fixture(async file => {
    await initializePaypalQaBudget(file, authorization(), timestamp);
    const reservations = await Promise.all(Array.from({ length: 8 }, (_, i) => reservePaypalQaCall(file, oauth, scope, timestamp + i + 1)));
    assert.deepEqual(reservations.map(r => r.sequence).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(new Set(reservations.map(r => r.requestId)).size, 8);
    assert.equal((await readPaypalQaBudget(file)).used.OAUTH, 8);
  });
});

test("LIVE, scope mismatch, pagination, retries and extra metadata blocked without spending", async () => {
  await fixture(async file => {
    await initializePaypalQaBudget(file, authorization(), timestamp);
    for (const request of [
      { method: "GET", url: "https://api-m.paypal.com/v2/checkout/orders/OFFLINEORDER" },
      { ...getOrder, url: `${getOrder.url}?page=2` }, { ...getOrder, pagination: true },
      { ...getOrder, retry: true }, { ...getOrder, unexpected: true },
    ]) await assert.rejects(reservePaypalQaCall(file, request, scope, timestamp + 1), /QA_BUDGET_BLOCKED/);
    await assert.rejects(reservePaypalQaCall(file, oauth, { ...scope, applicationId: "APP-OTHERAPP123" }, timestamp + 1), /MISMATCH/);
    await assert.rejects(reservePaypalQaCall(file, oauth, { ...scope, environment: "LIVE" }, timestamp + 1), /MISMATCH/);
    assert.equal((await readPaypalQaBudget(file)).sequence, 0);
  });
});

test("immutable authorization cannot be overwritten and expired deadline cannot restart", async () => {
  await fixture(async file => {
    const auth = authorization();
    await initializePaypalQaBudget(file, auth, timestamp);
    await assert.rejects(initializePaypalQaBudget(file, auth, timestamp + 1), error => error.code === "EEXIST");
    await assert.rejects(reservePaypalQaCall(file, oauth, scope, auth.deadline), /AUTHORIZATION_EXPIRED/);
    const original = await readPaypalQaBudget(file);
    assert.equal(original.authorization.deadline, auth.deadline); assert.equal(original.sequence, 0);
  });
});

test("deliveries and signature REST have distinct durable ceilings", async () => {
  await fixture(async file => {
    await initializePaypalQaBudget(file, authorization({ DELIVERY: 1, SIGNATURE: 1 }), timestamp);
    await reservePaypalQaCall(file, { method: "DELIVERY", url: "/api/digital/webhooks/paypal" }, scope, timestamp + 1);
    assert.equal((await readPaypalQaBudget(file)).used.REST_TOTAL, 0);
    await reservePaypalQaCall(file, { method: "POST", url: `${sandboxOrigin}/v1/notifications/verify-webhook-signature` }, scope, timestamp + 2);
    await assert.rejects(reservePaypalQaCall(file, { method: "DELIVERY", url: "/api/digital/webhooks/paypal" }, scope, timestamp + 3), /BUDGET_EXHAUSTED/);
    await assert.rejects(reservePaypalQaCall(file, { method: "POST", url: `${sandboxOrigin}/v1/notifications/verify-webhook-signature` }, scope, timestamp + 3), /BUDGET_EXHAUSTED/);
    const state = await readPaypalQaBudget(file);
    assert.equal(state.used.DELIVERY, 1); assert.equal(state.used.SIGNATURE, 1); assert.equal(state.used.REST_TOTAL, 1);
  });
});

test("torn journal fails closed; no recovery discards already reserved calls", async () => {
  await fixture(async file => {
    await initializePaypalQaBudget(file, authorization(), timestamp);
    await reservePaypalQaCall(file, oauth, scope, timestamp + 1);
    await appendFile(file, '{"incomplete":', "utf8");
    await assert.rejects(readPaypalQaBudget(file), /TORN_JOURNAL/);
    await assert.rejects(reservePaypalQaCall(file, oauth, scope, timestamp + 2), /TORN_JOURNAL/);
    assert.match(await readFile(file, "utf8"), /RESERVED_BEFORE_CALL/);
  });
});

test("cleanup margin survives restart inside original ceilings: one OAuth and bound DELETE reserved", async () => {
  await fixture(async file => {
    await initializePaypalQaBudget(file, authorization({ REST_TOTAL: 3, OAUTH: 2 }), timestamp);
    await reservePaypalQaCall(file, oauth, scope, timestamp + 1);
    await assert.rejects(reservePaypalQaCall(file, getOrder, scope, timestamp + 2), /TARGETED_CLEANUP_RESERVE/);
    assert.equal((await readPaypalQaBudget(file)).used.REST_TOTAL, 1);
    await reservePaypalQaCall(file, { ...oauth, cleanup: true }, scope, timestamp + 3);
    await assert.rejects(reservePaypalQaCall(file, { ...oauth, cleanup: true }, scope, timestamp + 4), /BUDGET_EXHAUSTED|ALREADY_SPENT/);
    await reservePaypalQaCall(file, { method: "DELETE", url: `${sandboxOrigin}/v1/notifications/webhooks/OFFLINEWEBHOOK`, cleanup: true }, scope, timestamp + 5);
    const restarted = await readPaypalQaBudget(file);
    assert.equal(restarted.used.REST_TOTAL, 3); assert.equal(restarted.cleanupOauthUsed, 1);
    assert.equal(restarted.used.DELETE_WEBHOOK, 1); assert.equal(restarted.authorization.deadline, timestamp + 7200000);
  });
});
