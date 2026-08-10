import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_URL = "http://127.0.0.1:3000";
process.env.AUTH_SECRET = "lnx-v060-request-test-secret-with-32-bytes";
process.env.DATABASE_URL = "postgres://ignored:ignored@127.0.0.1:59999/ignored";

const { OrderRequestError, readOrderJson } = await import("@/lib/orders/request");

test("lit un petit payload JSON UTF-8", async () => {
  const request = new Request("http://127.0.0.1:3000/api/orders/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief: "Une histoire" }),
  });
  assert.deepEqual(await readOrderJson(request), { brief: "Une histoire" });
});

test("refuse un JSON invalide avec une erreur neutre", async () => {
  const request = new Request("http://127.0.0.1:3000/api/orders/drafts", { method: "POST", body: "{" });
  await assert.rejects(readOrderJson(request), (error: unknown) => error instanceof OrderRequestError && error.code === "INVALID_JSON");
});

test("refuse un content-length ou un flux supérieur à 128 Kio", async () => {
  const declared = new Request("http://127.0.0.1:3000/api/orders/drafts", {
    method: "POST",
    headers: { "content-length": String(129 * 1024) },
    body: "{}",
  });
  await assert.rejects(readOrderJson(declared), (error: unknown) => error instanceof OrderRequestError && error.code === "PAYLOAD_TOO_LARGE");

  const streamed = new Request("http://127.0.0.1:3000/api/orders/drafts", {
    method: "POST",
    body: "x".repeat(129 * 1024),
  });
  await assert.rejects(readOrderJson(streamed), (error: unknown) => error instanceof OrderRequestError && error.code === "PAYLOAD_TOO_LARGE");
});
