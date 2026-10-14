/** No listener/socket: synthetic streams and an injected upstream double only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createRouteOnlyRelay, PAYPAL_QA_ROUTE, PAYPAL_SIGNATURE_HEADERS } from "./paypal-route-only-relay-preparation.mjs";
import { createPaypalQaBudgetAuthority, readPaypalQaBudget } from "./paypal-dcn-qa-budget.mjs";
import { withOfflineBudget, OFFLINE_SCOPE, OFFLINE_TIME } from "./paypal-dcn-qa-test-fixture.mjs";
const bytes = Buffer.from('{ "id":"OFFLINE", "spaces" : [1, 2] }\n');
const rawHeaders = ["Host", OFFLINE_SCOPE.approvedHost, "Content-Type", "application/json; charset=utf-8",
  ...PAYPAL_SIGNATURE_HEADERS.flatMap(name => [name, `offline-${name}-unchanged`]),
  "Cookie", "not-forwarded", "Authorization", "not-forwarded", "X-Forwarded-For", "not-forwarded"];
function invoke(server, changes = {}) {
  return new Promise(resolve => {
    const request = Readable.from([changes.body ?? bytes]);
    request.method = changes.method ?? "POST"; request.url = changes.path ?? PAYPAL_QA_ROUTE;
    request.rawHeaders = changes.rawHeaders ?? rawHeaders;
    request.headers = Object.fromEntries(Array.from({ length: request.rawHeaders.length / 2 }, (_, i) =>
      [request.rawHeaders[2 * i].toLowerCase(), request.rawHeaders[2 * i + 1]]));
    if (changes.host != null) request.headers.host = changes.host;
    const response = { destroyed: false, writableEnded: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { this.writableEnded = true; resolve({ status: this.status, headers: this.headers, body }); } };
    server.emit("request", request, response);
  });
}
function upstreamDouble(onCall, { status = 202, failure = false } = {}) {
  return (options, callback) => {
    const request = new EventEmitter(); request.destroy = () => {};
    request.end = body => { queueMicrotask(async () => {
      await onCall(options, body);
      if (failure) { request.emit("error", new Error("OFFLINE_FAILURE")); return; }
      const response = Readable.from([Buffer.from('{"received":true}')]);
      response.statusCode = status; callback(response);
    }); };
    return request;
  };
}
test("relay refuses construction without durable authorization, no listener ever started", () => {
  assert.throws(() => createRouteOnlyRelay({ approvedHost: OFFLINE_SCOPE.approvedHost }), /DURABLE_BUDGET/);
});
test("delivery reservation is durable before upstream; preserves bytes/signatures and upstream status", async () => {
  await withOfflineBudget(async ({ file, budget, now }) => {
    let calls = 0;
    const { server, counters } = createRouteOnlyRelay({ approvedHost: OFFLINE_SCOPE.approvedHost, budget, now,
      requestImplementation: upstreamDouble(async (options, body) => {
        assert.equal((await readPaypalQaBudget(file)).used.DELIVERY, 1); calls++;
        assert.deepEqual(body, bytes); assert.equal(options.path, PAYPAL_QA_ROUTE);
        assert.equal(options.hostname, "127.0.0.1"); assert.equal(options.port, 3140);
        for (const header of PAYPAL_SIGNATURE_HEADERS) assert.equal(options.headers[header], `offline-${header}-unchanged`);
        for (const header of ["cookie", "authorization", "x-forwarded-for"]) assert.equal(options.headers[header], undefined);
      }) });
    const response = await invoke(server);
    assert.equal(response.status, 202); assert.equal(calls, 1); assert.equal(counters.forwarded, 1);
    assert.equal(server.listening, false); assert.equal((await readPaypalQaBudget(file)).used.REST_TOTAL, 0);
  });
});
test("failed upstream is spent and restart cannot reset DELIVERY ceiling or original deadline", async () => {
  await withOfflineBudget(async ({ file, budget, now }) => {
    let calls = 0;
    const first = createRouteOnlyRelay({ approvedHost: OFFLINE_SCOPE.approvedHost, budget, now,
      requestImplementation: upstreamDouble(async () => { calls++; }, { failure: true }) });
    assert.equal((await invoke(first.server)).status, 502);
    const restartedBudget = await createPaypalQaBudgetAuthority(file, OFFLINE_SCOPE, now);
    assert.equal(restartedBudget.deadline, OFFLINE_TIME + 7200000);
    const restarted = createRouteOnlyRelay({ approvedHost: OFFLINE_SCOPE.approvedHost, budget: restartedBudget, now,
      requestImplementation: upstreamDouble(async () => { calls++; }) });
    assert.equal(restarted.counters.forwarded, 1);
    assert.equal((await invoke(restarted.server)).status, 503); assert.equal(calls, 1);
    assert.equal((await readPaypalQaBudget(file)).used.DELIVERY, 1);
  }, { DELIVERY: 1 });
});
test("exact host/path/method/headers/size are refused without spending provider or delivery counters", async () => {
  await withOfflineBudget(async ({ file, budget, now }) => {
    let calls = 0;
    const { server } = createRouteOnlyRelay({ approvedHost: OFFLINE_SCOPE.approvedHost, budget, now,
      requestImplementation: upstreamDouble(async () => { calls++; }) });
    for (const [changes, expected] of [[{ path: "/admin" }, 404], [{ path: `${PAYPAL_QA_ROUTE}?page=2` }, 404],
      [{ method: "GET" }, 404], [{ host: "another.ngrok-free.dev" }, 403],
      [{ rawHeaders: rawHeaders.slice(0, 8) }, 400], [{ body: Buffer.alloc(65537) }, 413],
      [{ rawHeaders: [...rawHeaders, "Content-Encoding", "gzip"] }, 400]]) assert.equal((await invoke(server, changes)).status, expected);
    assert.equal(calls, 0); assert.equal((await readPaypalQaBudget(file)).sequence, 0);
  });
});
test("deadline checked again after body collection, no renewed window or upstream call", async () => {
  await withOfflineBudget(async ({ file, budget, now, setTime }) => {
    let calls = 0;
    const { server } = createRouteOnlyRelay({ approvedHost: OFFLINE_SCOPE.approvedHost, budget, now,
      requestImplementation: upstreamDouble(async () => { calls++; }) });
    setTime(budget.deadline);
    assert.equal((await invoke(server)).status, 503); assert.equal(calls, 0);
    assert.equal((await readPaypalQaBudget(file)).sequence, 0);
  });
});
test("two relay processes sharing a ledger cannot overspend the one remaining delivery", async () => {
  await withOfflineBudget(async ({ file, budget, now }) => {
    let calls = 0;
    const secondBudget = await createPaypalQaBudgetAuthority(file, OFFLINE_SCOPE, now);
    const relays = [budget, secondBudget].map(b => createRouteOnlyRelay({ approvedHost: OFFLINE_SCOPE.approvedHost, budget: b, now,
      requestImplementation: upstreamDouble(async () => { calls++; }) }));
    const results = await Promise.all(relays.map(r => invoke(r.server)));
    assert.deepEqual(results.map(r => r.status).sort(), [202, 503]); assert.equal(calls, 1);
    assert.equal((await readPaypalQaBudget(file)).used.DELIVERY, 1);
  }, { DELIVERY: 1 });
});
