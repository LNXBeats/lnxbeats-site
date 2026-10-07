import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deliveryUploadMetadata, DELIVERY_MAX_BYTES, DELIVERY_PART_BYTES, verifyDeliveryParts } from "@/lib/orders/delivery-direct-contract";
import { runDirectMultipartUpload, DirectMultipartUploadError, type MultipartDependencies, type MultipartPart } from "@/lib/creations/direct-multipart-upload";
import { handleDeliveryDirectUpload } from "@/lib/orders/delivery-direct-route";
import type { OrderActor } from "@/lib/orders/domain";

for (const sizeBytes of [1024, 68993674, DELIVERY_MAX_BYTES - 1, DELIVERY_MAX_BYTES]) {
  test(`declared WAV ${sizeBytes} bytes accepted before upload`, () => {
    assert.equal(deliveryUploadMetadata({ filename: "Été final master.wav", mimeType: "", sizeBytes }).sizeBytes, sizeBytes);
  });
}
test("limit+1 rejected before allocating R2; invalid size and extra keys refused", () => {
  for (const sizeBytes of [DELIVERY_MAX_BYTES + 1, 0, -1, 1.5, "1024", NaN]) assert.throws(() => deliveryUploadMetadata({ filename: "master.wav", mimeType: "audio/wav", sizeBytes }));
  assert.throws(() => deliveryUploadMetadata({ filename: "master.wav", mimeType: "audio/wav", sizeBytes: 100, bucket: "arbitrary" }));
});
for (const [extension, mimeType] of Object.entries({ mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", zip: "application/zip", pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" })) {
  test(`${extension} maps to canonical MIME without trusting WebKit MIME`, () => {
    for (const mime of [mimeType, "", "application/octet-stream", "audio/vnd.wave"]) assert.equal(deliveryUploadMetadata({ filename: `source.${extension}`, mimeType: mime, sizeBytes: 100 }).mimeType, mimeType);
  });
}
test("multipart provider sizes/count/order/ETag validated", () => {
  const parts = [{ partNumber: 1, etag: "one", sizeBytes: DELIVERY_PART_BYTES }, { partNumber: 2, etag: "two", sizeBytes: 123 }];
  assert.equal(verifyDeliveryParts(DELIVERY_PART_BYTES + 123, parts).length, 2);
  assert.equal(verifyDeliveryParts(DELIVERY_PART_BYTES + 123, [...parts].reverse())[0]?.partNumber, 1);
  for (const invalid of [[], parts.slice(0, 1), [parts[0]!, parts[0]!], [parts[0]!, { ...parts[1]!, sizeBytes: 124 }], [parts[0]!, { ...parts[1]!, etag: "\r\n" }]]) assert.throws(() => verifyDeliveryParts(DELIVERY_PART_BYTES + 123, invalid));
});
async function exerciseTransport(sizeBytes: number, resume = false, retry = false) {
  const parts = new Map<number, MultipartPart>(); const attempts = new Map<number, number>();
  const count = Math.ceil(sizeBytes / DELIVERY_PART_BYTES); let completes = 0;
  if (resume) parts.set(1, { partNumber: 1, etag: "confirmed", sizeBytes: Math.min(sizeBytes, DELIVERY_PART_BYTES) });
  const session = () => ({ sessionToken: "opaque-token-at-least-sixteen", expiresAt: new Date(Date.now() + 60000).toISOString(), partSizeBytes: DELIVERY_PART_BYTES, partCount: count, completedParts: [...parts.values()] });
  const file = { size: sizeBytes, name: "Été final master.wav", type: "audio/wav", slice(start: number, end: number) { return { size: end - start } as Blob; } } as File;
  const deps: MultipartDependencies<{ sizeBytes: number }> = {
    init: async () => session(), partUrl: async (_token, partNumber) => ({ url: `https://private.example.invalid/part/${partNumber}` }),
    status: async () => ({ ...session(), ok: true, status: completes ? "READY" : "UPLOADING", state: "media-upload" }),
    complete: async (_token, completed) => { assert.equal(completed.length, count); completes++; return { ...session(), ok: true, status: "VALIDATING", state: "media-upload" }; },
    uploadPart: async ({ url, body, onProgress }) => {
      const partNumber = Number(url.split("/").pop()); attempts.set(partNumber, (attempts.get(partNumber) ?? 0) + 1);
      if (retry && partNumber === 2 && attempts.get(partNumber) === 1) throw new DirectMultipartUploadError("media-reseau", true);
      assert.ok(body.size <= DELIVERY_PART_BYTES); onProgress(body.size);
      const etag = String(partNumber); parts.set(partNumber, { partNumber, etag, sizeBytes: body.size }); return { etag };
    }, wait: async () => undefined, waitUntilVisible: async () => undefined,
  };
  await runDirectMultipartUpload({ file, init: { sizeBytes }, signal: new AbortController().signal, dependencies: deps, ...(resume ? { resumeSessionToken: session().sessionToken } : {}) });
  assert.equal(completes, 1); assert.equal(parts.size, count);
  if (resume) assert.equal(attempts.has(1), false);
  if (retry) { assert.equal(attempts.get(2), 2); assert.equal(attempts.get(3), 1); }
}
for (const size of [68993674, DELIVERY_MAX_BYTES]) test(`browser ${size} byte file uses direct part transport only`, () => exerciseTransport(size));
test("part retry preserves successful parts", () => exerciseTransport(68993674, false, true));
test("resume skips provider-confirmed part after interrupted/reloaded browser", () => exerciseTransport(68993674, true));
test("Admin UI never sends 68,993,674-byte multipart to Next", async () => {
  const source = await readFile("components/admin-order-delivery-panel.tsx", "utf8");
  assert.doesNotMatch(source, /new FormData|body\.set\("delivery"/);
  assert.match(source, /uploadOrderDeliveryDirect/);
});
const admin: OrderActor = { id: "00000000-0000-4000-8000-000000000001", email: "qa@example.invalid", name: "QA", role: "ADMIN", status: "ACTIVE", emailVerified: true };
const request = (body: unknown) => new Request("https://example.invalid/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
test("unauthenticated/non-Admin/cross-origin cannot create upload", async () => {
  let initialized = 0;
  const deps = { allowed: () => true, init: async () => { initialized++; throw new Error("must not run"); } };
  assert.equal((await handleDeliveryDirectUpload(request({}), "QA", "init", { ...deps, actor: async () => null })).status, 401);
  assert.equal((await handleDeliveryDirectUpload(request({}), "QA", "init", { ...deps, actor: async () => ({ ...admin, role: "MEMBER" }) })).status, 403);
  assert.equal((await handleDeliveryDirectUpload(request({}), "QA", "init", { ...deps, actor: async () => admin, allowed: () => false })).status, 403);
  assert.equal(initialized, 0);
});
test("metadata endpoint rejects binary-size bodies and arbitrary target keys", async () => {
  const deps = { allowed: () => true, actor: async () => admin };
  assert.equal((await handleDeliveryDirectUpload(request({ sessionToken: "x", key: "arbitrary" }), "QA", "status", deps)).status, 400);
  assert.equal((await handleDeliveryDirectUpload(request({ sessionToken: "x".repeat(17000) }), "QA", "status", deps)).status, 413);
});
