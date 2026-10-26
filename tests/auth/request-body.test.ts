import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_BODY_MAX_BYTES,
  AUTH_BODY_TIMEOUT_MS,
  AUTH_JSON_MAX_DEPTH,
  readAuthBody,
} from "@/lib/auth/request-body";

const baseUrl = "http://127.0.0.1:3199/api/auth/sign-in/email";
const encoder = new TextEncoder();

function request(body: string | Uint8Array | ReadableStream<Uint8Array> | null, headers: HeadersInit = {}, signal?: AbortSignal) {
  return new Request(baseUrl, {
    method: "POST", headers, body, signal, duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function chunks(parts: Uint8Array[], onCancel = () => undefined) {
  let position = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (position < parts.length) controller.enqueue(parts[position++]);
      else controller.close();
    },
    cancel: onCancel,
  });
}

test("auth body reads bytes once without clone, tee, request.json or header changes", async () => {
  const text = '{"email":"synthetic@example.test","password":"synthetic-password"}';
  const incoming = request(chunks([encoder.encode(text.slice(0, 10)), encoder.encode(text.slice(10))]), {
    "content-type": "application/json", origin: "http://127.0.0.1:3199", cookie: "synthetic=session",
  });
  Object.defineProperty(incoming, "clone", { value() { assert.fail("No request clone before the byte limit."); } });
  Object.defineProperty(incoming, "json", { value() { assert.fail("No unbounded Request.json."); } });
  const before = [...incoming.headers.entries()];
  const result = await readAuthBody(incoming);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.body, encoder.encode(text));
  assert.deepEqual(result.json, { email: "synthetic@example.test", password: "synthetic-password" });
  assert.deepEqual([...incoming.headers.entries()], before);
  assert.equal(incoming.bodyUsed, true);
  assert.equal(incoming.body?.locked, false);
});

test("auth body preserves absence, empty bytes, invalid JSON and URL-encoded forms", async () => {
  assert.deepEqual(await readAuthBody(new Request(baseUrl)), { ok: true, body: null, json: null });
  for (const text of ["", "{bad-json", "email=synthetic%40example.test&password=synthetic-password", "null"]) {
    const result = await readAuthBody(request(text, { "content-type": "application/x-www-form-urlencoded" }));
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.deepEqual(result.body, encoder.encode(text));
    assert.equal(result.json, null);
  }
});

test("auth body accepts exactly sixteen KiB without a declared length", async () => {
  const body = new Uint8Array(AUTH_BODY_MAX_BYTES).fill(0x20);
  const result = await readAuthBody(request(chunks([body.subarray(0, 100), body.subarray(100)])));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.body, body);
});

test("auth body rejects an oversized declared length before taking a reader and cancels without waiting", async () => {
  let canceled = 0;
  let readerTaken = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { canceled++; return new Promise<void>(() => undefined); } });
  const originalGetReader = stream.getReader.bind(stream);
  Object.defineProperty(stream, "getReader", { value(...args: []) { readerTaken++; return originalGetReader(...args); } });
  const result = await readAuthBody(request(stream, { "content-length": String(AUTH_BODY_MAX_BYTES + 1) }));
  assert.deepEqual(result, { ok: false, status: 413 });
  assert.equal(canceled, 1);
  assert.equal(readerTaken, 0);
});

test("auth body rejects malformed declared lengths, including negative or unsafe values", async () => {
  for (const length of ["-1", "abc", "1e3", "1.5", "9007199254740992", ""]) {
    assert.deepEqual(await readAuthBody(request("{}", { "content-length": length })), { ok: false, status: 400 });
  }
});

test("auth body rejects actual oversized chunks with omitted, zero or false small lengths", async () => {
  for (const length of [null, "0", "2"]) {
    let canceled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(AUTH_BODY_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); },
      cancel() { canceled++; },
    });
    const result = await readAuthBody(request(body, length === null ? {} : { "content-length": length }));
    assert.deepEqual(result, { ok: false, status: 413 });
    assert.equal(canceled, 1);
  }
});

test("auth body counts UTF-8 bytes, not characters, and preserves valid multibyte data", async () => {
  const small = JSON.stringify({ name: "Éléonore 李 🎵" });
  const valid = await readAuthBody(request(small));
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.deepEqual(valid.body, encoder.encode(small));
    assert.deepEqual(valid.json, { name: "Éléonore 李 🎵" });
  }
  const tooLarge = "🎵".repeat(AUTH_BODY_MAX_BYTES / 4 + 1);
  assert.ok(tooLarge.length < AUTH_BODY_MAX_BYTES);
  assert.deepEqual(await readAuthBody(request(tooLarge)), { ok: false, status: 413 });
});

test("auth body keeps invalid UTF-8 raw instead of coercing bytes or throwing details", async () => {
  const raw = Uint8Array.of(0xff, 0x7b, 0xc3, 0x28);
  assert.deepEqual(await readAuthBody(request(raw)), { ok: true, body: raw, json: null });
});

test("auth body handles stream read errors generically", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("private synthetic transport detail")); } });
  assert.deepEqual(await readAuthBody(request(body)), { ok: false, status: 400 });
});

test("auth body stops at timeout even if the stream cancellation never settles", async () => {
  let canceled = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { canceled++; return new Promise<void>(() => undefined); } });
  const started = performance.now();
  assert.deepEqual(await readAuthBody(request(body), { timeoutMs: 25 }), { ok: false, status: 408 });
  assert.ok(performance.now() - started < 1_000);
  assert.equal(canceled, 1);
  assert.equal(AUTH_BODY_TIMEOUT_MS, 10_000);
});

test("auth body rejects pre-aborted and in-flight aborted requests without waiting for cancellation", async () => {
  for (const alreadyAborted of [true, false]) {
    let canceled = 0;
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ cancel() { canceled++; return new Promise<void>(() => undefined); } });
    const incoming = request(body, {}, controller.signal);
    if (alreadyAborted) controller.abort();
    const pending = readAuthBody(incoming);
    if (!alreadyAborted) controller.abort();
    assert.deepEqual(await pending, { ok: false, status: 408 });
    assert.equal(canceled, 1);
  }
});

test("auth body cancellation errors cannot escape an oversized rejection", async () => {
  const stream = new ReadableStream<Uint8Array>({ cancel() { return Promise.reject(new Error("private cancellation detail")); } });
  assert.deepEqual(await readAuthBody(request(stream, { "content-length": String(AUTH_BODY_MAX_BYTES + 1) })), { ok: false, status: 413 });
});

test("auth JSON complexity accepts current small registration and alert choices", async () => {
  const json = {
    password: "synthetic-long-password", passwordConfirmation: "synthetic-long-password",
    releaseAlerts: { music: true, shop: false, news: true },
  };
  const result = await readAuthBody(request(JSON.stringify(json)));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.json, json);
});

test("auth JSON depth is checked iteratively at the exact boundary", async () => {
  let value: unknown = "leaf";
  for (let depth = 1; depth < AUTH_JSON_MAX_DEPTH; depth++) value = { next: value };
  assert.equal((await readAuthBody(request(JSON.stringify(value)))).ok, true);
  assert.deepEqual(await readAuthBody(request(JSON.stringify({ next: value }))), { ok: false, status: 400 });
});

test("auth JSON rejects excessive array/object breadth before schema validation", async () => {
  assert.equal((await readAuthBody(request(JSON.stringify(Array.from({ length: 64 }, () => true))))).ok, true);
  assert.deepEqual(await readAuthBody(request(JSON.stringify(Array.from({ length: 65 }, () => true)))), { ok: false, status: 400 });
  const wideObject = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key${index}`, true]));
  assert.deepEqual(await readAuthBody(request(JSON.stringify(wideObject))), { ok: false, status: 400 });
});

test("auth JSON rejects excessive total nodes even when each array is small", async () => {
  const exact = [Array(64).fill(null), Array(64).fill(null), Array(64).fill(null), Array(59).fill(null)];
  assert.equal((await readAuthBody(request(JSON.stringify(exact)))).ok, true);
  exact[3].push(null);
  assert.deepEqual(await readAuthBody(request(JSON.stringify(exact))), { ok: false, status: 400 });
});

test("auth JSON rejects excessive total collections even below the node limit", async () => {
  const exact = Array.from({ length: 63 }, () => ({}));
  assert.equal((await readAuthBody(request(JSON.stringify(exact)))).ok, true);
  assert.deepEqual(await readAuthBody(request(JSON.stringify([...exact, {}]))), { ok: false, status: 400 });
});
