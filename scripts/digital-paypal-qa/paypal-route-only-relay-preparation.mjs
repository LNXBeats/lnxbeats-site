/**
 * QA PREPARATION. Default --check is offline; serve requires explicit approval and a durable ledger.
 * This QA-only helper does not authorize public exposure or financial tests.
 * Future transport must terminate HTTPS and pass accepted requests unchanged to
 * the fixed loopback destination. Its exact stable URL requires human approval.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPaypalQaBudgetAuthority, isPaypalQaBudgetAuthority, readPaypalQaBudget } from "./paypal-dcn-qa-budget.mjs";

export const PAYPAL_QA_ROUTE = "/api/digital/webhooks/paypal";
export const PAYPAL_QA_BODY_LIMIT = 65536;
export const PAYPAL_QA_UPSTREAM = `http://127.0.0.1:3140${PAYPAL_QA_ROUTE}`;
export const PAYPAL_SIGNATURE_HEADERS = Object.freeze([
  "paypal-transmission-id", "paypal-transmission-time", "paypal-cert-url",
  "paypal-auth-algo", "paypal-transmission-sig",
]);
const PUBLIC_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ngrok-free\.(?:app|dev)$/;
export const RELAY_BIND = Object.freeze({ hostname: "127.0.0.1", port: 3142 });
export const RELAY_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** Pure validation. Returning true never means the provider signature is valid. */
export function routeOnlyCandidate({ method, rawPath, rawHeaders, body }) {
  if (method !== "POST" || rawPath !== PAYPAL_QA_ROUTE || !Buffer.isBuffer(body)
    || body.length === 0 || body.length > PAYPAL_QA_BODY_LIMIT
    || !Array.isArray(rawHeaders) || rawHeaders.length % 2) return false;
  const headers = new Map();
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (typeof rawHeaders[i] !== "string" || typeof rawHeaders[i + 1] !== "string") return false;
    const name = rawHeaders[i].toLowerCase(), value = rawHeaders[i + 1];
    if (headers.has(name) || value.length > 4096 || /[\r\n\0]/.test(value)) return false;
    headers.set(name, value);
  }
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers.get("content-type") ?? "")) return false;
  if (headers.has("content-encoding") && headers.get("content-encoding") !== "identity") return false;
  return PAYPAL_SIGNATURE_HEADERS.every(name => Boolean(headers.get(name)));
}

function filteredHeaders(rawHeaders, byteLength) {
  const headers = { "content-type": "application/json", "content-length": String(byteLength), "accept-encoding": "identity", host: "127.0.0.1:3140" };
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    if (PAYPAL_SIGNATURE_HEADERS.includes(name) || name === "content-type") headers[name] = rawHeaders[i + 1];
  }
  return headers;
}

/** Fixed loopback target. Injected request is reserved for offline unit tests. */
function forwardRaw(body, rawHeaders, requestImplementation = http.request) {
  return new Promise((resolve, reject) => {
    const target = { hostname: "127.0.0.1", port: 3140, method: "POST", path: PAYPAL_QA_ROUTE,
      headers: filteredHeaders(rawHeaders, body.length), timeout: 45000 };
    const upstream = requestImplementation(target, response => {
      const chunks = []; let size = 0, failed = false;
      response.on("data", chunk => {
        if (failed) return;
        size += chunk.length;
        if (size > PAYPAL_QA_BODY_LIMIT) { failed = true; response.destroy(); upstream.destroy(); reject(new Error("BOUNDED_UPSTREAM_FAILED")); return; }
        chunks.push(chunk);
      });
      response.once("error", () => reject(new Error("UPSTREAM_FAILED")));
      response.once("aborted", () => reject(new Error("UPSTREAM_FAILED")));
      response.once("end", () => {
        if (failed) return;
        const status = response.statusCode;
        if (!Number.isInteger(status) || status < 200 || status > 599) { reject(new Error("UPSTREAM_FAILED")); return; }
        resolve({ status, body: Buffer.concat(chunks, size) });
      });
    });
    upstream.once("error", () => reject(new Error("UPSTREAM_FAILED")));
    upstream.once("timeout", () => { upstream.destroy(); reject(new Error("UPSTREAM_TIMEOUT")); });
    upstream.end(body);
  });
}

/** The caller must authorize public transport separately; this binds only LAN-inaccessible loopback. */
export function createRouteOnlyRelay({ approvedHost, budget, requestImplementation, now = Date.now, log = () => {} }) {
  assert.match(approvedHost, PUBLIC_HOST_PATTERN);
  assert.ok(isPaypalQaBudgetAuthority(budget), "EXISTING_DURABLE_BUDGET_REQUIRED");
  assert.equal(approvedHost, budget.scope.approvedHost, "EXACT_APPROVED_HOST_REQUIRED");
  const deadline = budget.deadline;
  assert.ok(Number.isSafeInteger(deadline) && deadline > now() && deadline <= budget.startedAt + RELAY_MAX_LIFETIME_MS);
  const counters = { forwarded: budget.initialUsed.DELIVERY, active: 0, refused: 0, upstreamFailures: 0 };
  let windowStart = now(), windowCount = 0;
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 60000, headersTimeout: 5000, keepAliveTimeout: 1000 }, async (request, response) => {
    function answer(status, body = Buffer.from("{\"received\":false}")) {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" });
      response.end(body);
    }
    function refuse(status) { counters.refused++; answer(status); request.resume(); }
    if (now() >= deadline || counters.forwarded >= budget.limits.DELIVERY) { refuse(503); return; }
    if (request.method !== "POST" || request.url !== PAYPAL_QA_ROUTE) { refuse(404); return; }
    if (request.headers.host !== approvedHost && request.headers.host !== `${approvedHost}:443`) { refuse(403); return; }
    if (now() - windowStart >= 60000) { windowStart = now(); windowCount = 0; }
    if (windowCount >= 10) { refuse(429); return; }
    windowCount++;
    if (counters.active >= 2) { refuse(503); return; }
    if (request.headers["content-length"] && (!/^\d+$/.test(request.headers["content-length"]) || Number(request.headers["content-length"]) > PAYPAL_QA_BODY_LIMIT)) { refuse(413); return; }
    counters.active++;
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > PAYPAL_QA_BODY_LIMIT) { answer(413); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks, size);
      if (!routeOnlyCandidate({ method: request.method, rawPath: request.url, rawHeaders: request.rawHeaders, body })) { counters.refused++; answer(400); return; }
      if (now() >= deadline || counters.forwarded >= budget.limits.DELIVERY) { refuse(503); return; }
      // The append+fsync finishes before opening the upstream socket. A failed
      // forward remains spent; another process/restart uses the same journal.
      try {
        await budget.reserve({ method: "DELIVERY", url: PAYPAL_QA_ROUTE });
        counters.forwarded = (await budget.snapshot()).used.DELIVERY;
      } catch { refuse(503); return; }
      const result = await forwardRaw(body, request.rawHeaders, requestImplementation);
      answer(result.status, result.body); // No synthetic 200 or premature acknowledgement.
    } catch { counters.upstreamFailures++; answer(502); }
    finally { counters.active--; log({ event: "relay-counters", ...counters }); }
  });
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
  return { server, counters };
}

async function futureServe(args) {
  // The approval flag is an authorization attestation, not a security bypass.
  // There is no tunnel launcher, config mutation or credential read here.
  if (args.length !== 2 || args[0] !== "serve" || !args[1].startsWith("--approved-host=")
    || process.env.DCN_PAYPAL_QA_EXPOSURE_APPROVED !== "YES"
    || process.env.DCN_PAYPAL_QA_RECIPE_APPROVED !== "YES"
    || !process.env.DCN_PAYPAL_QA_BUDGET_LEDGER) throw new Error("APPROVAL_REQUIRED");
  const approvedHost = args[1].slice("--approved-host=".length);
  assert.match(approvedHost, PUBLIC_HOST_PATTERN);
  const ledger = process.env.DCN_PAYPAL_QA_BUDGET_LEDGER;
  const original = await readPaypalQaBudget(ledger);
  const budget = await createPaypalQaBudgetAuthority(ledger, { ...original.authorization.scope, approvedHost });
  const deadline = budget.deadline;
  const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  const { server, counters } = createRouteOnlyRelay({ approvedHost, budget, log: emit });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { emit({ event: "relay-stopped", ...counters }); process.exitCode = 0; });
    server.closeIdleConnections();
    const force = setTimeout(() => server.closeAllConnections(), 5000); force.unref();
  };
  const lifetime = setTimeout(stop, Math.max(1, deadline - Date.now())); lifetime.unref();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  server.once("error", () => { clearTimeout(lifetime); emit({ event: "relay-start-failed" }); process.exitCode = 1; });
  server.listen(RELAY_BIND.port, RELAY_BIND.hostname, () => emit({ event: "relay-started", bind: RELAY_BIND.hostname, port: RELAY_BIND.port,
    publicWebhookUrl: `https://${approvedHost}${PAYPAL_QA_ROUTE}`, deadline: new Date(deadline).toISOString(), maximumForwarded: budget.limits.DELIVERY,
    maximumConcurrency: 2, maximumPerMinute: 10, providerCallsPerformedByRelay: 0 }));
}

function offlineSelfCheck() {
  const rawHeaders = ["Content-Type", "application/json", ...PAYPAL_SIGNATURE_HEADERS.flatMap(name => [name, "offline-example-not-a-valid-signature"])];
  const input = { method: "POST", rawPath: PAYPAL_QA_ROUTE, rawHeaders, body: Buffer.from("{\"offline\":true}") };
  assert.equal(routeOnlyCandidate(input), true);
  for (const rawPath of ["/", "/admin", "/ma-musique", "/api/digital/webhooks/stripe", `${PAYPAL_QA_ROUTE}?anything=1`, `${PAYPAL_QA_ROUTE}/`]) {
    assert.equal(routeOnlyCandidate({ ...input, rawPath }), false);
  }
  assert.equal(routeOnlyCandidate({ ...input, method: "GET" }), false);
  assert.equal(routeOnlyCandidate({ ...input, body: Buffer.alloc(PAYPAL_QA_BODY_LIMIT + 1) }), false);
  assert.equal(routeOnlyCandidate({ ...input, rawHeaders: [...rawHeaders, "paypal-transmission-id", "duplicate"] }), false);
  assert.equal(routeOnlyCandidate({ ...input, rawHeaders: rawHeaders.slice(0, -2) }), false);
  assert.equal(routeOnlyCandidate({ ...input, rawHeaders: [...rawHeaders, "Content-Encoding", "gzip"] }), false);
  assert.equal(routeOnlyCandidate({ ...input, body: Buffer.alloc(0) }), false);
  process.stdout.write(`${JSON.stringify({
    offlinePreparationChecks: "PASS", path: PAYPAL_QA_ROUTE,
    loopbackUpstream: PAYPAL_QA_UPSTREAM, maximumBodyBytes: PAYPAL_QA_BODY_LIMIT,
    listenerStarted: false, publicTransportStarted: false, providerCalls: 0,
    providerSignatureVerification: "NOT_RUN", exactStablePublicUrl: "PENDING_APPROVAL",
    humanExposureApprovalRequired: true,
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === "--check") offlineSelfCheck();
    else await futureServe(process.argv.slice(2));
  } catch {
    process.stderr.write("QA_RELAY_BLOCKED; use --check or provide exact approved host and explicit approval.\n");
    process.exitCode = 1;
  }
}
