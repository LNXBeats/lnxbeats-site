import assert from "node:assert/strict";
import test from "node:test";

import {
  handleDirectUploadOperation,
  type DirectUploadRouteDependencies,
} from "@/lib/creations/direct-upload-route-handler";

const baseUrl = "http://127.0.0.1:31750";
const actor = "30000000-0000-4000-8000-000000000001";
const session = {
  id: "40000000-0000-4000-8000-000000000001", tokenHash: "a".repeat(64),
  creationId: "10000000-0000-4000-8000-000000000001", creationSlug: "video-test", actorUserId: actor,
  role: "VIDEO" as const, status: "UPLOADING" as const, expectedLockVersion: 1, expectedAssetId: null,
  rightsConfirmed: true, alt: null, originalFilename: "test.mp4", declaredMimeType: "video/mp4",
  declaredSizeBytes: BigInt(10), quarantineKey: "creations/quarantine/a/b/video.mp4", provider: "r2", providerUploadId: "upload",
  partSizeBytes: 8 * 1024 * 1024, partCount: 1, expiresAt: new Date(Date.now() + 60_000), completedAt: null,
  validationStartedAt: null, validationFinishedAt: null, availableAt: new Date(), leaseToken: null, leaseExpiresAt: null,
  attempts: 0, lastErrorCode: null, resultAssetId: null, resultLockVersion: null, createdAt: new Date(), updatedAt: new Date(),
  sessionToken: "opaque",
};

function harness() {
  const calls = { admin: 0, init: 0, status: 0 };
  const dependencies: DirectUploadRouteDependencies = {
    baseUrl: () => baseUrl,
    sameOrigin: (request, expected) => request.headers.get("origin") === expected,
    admin: async () => { calls.admin += 1; return { user: { id: actor } }; },
    initialize: async () => { calls.init += 1; return session as never; },
    partUrl: async () => ({ ok: true, url: "https://example.test/part" }),
    status: async () => { calls.status += 1; return { ok: true, status: "UPLOADING", state: "media-upload", sessionToken: "opaque", expiresAt: session.expiresAt.toISOString(), partSizeBytes: session.partSizeBytes, partCount: 1, completedParts: [], errorCode: null, currentAssetId: null, currentLockVersion: null, location: null }; },
    complete: async () => ({ ok: true, status: "QUARANTINE", state: "media-validation", sessionToken: "opaque", expiresAt: session.expiresAt.toISOString(), partSizeBytes: session.partSizeBytes, partCount: 1, completedParts: [], errorCode: null, currentAssetId: null, currentLockVersion: null, location: null }),
    abort: async () => ({ ok: true, status: "ABORTED", state: "media-annule", sessionToken: "opaque", expiresAt: session.expiresAt.toISOString(), partSizeBytes: session.partSizeBytes, partCount: 1, completedParts: [], errorCode: null, currentAssetId: null, currentLockVersion: null, location: null }),
  };
  return { dependencies, calls };
}

function request(body: unknown, origin = baseUrl) {
  return new Request(`${baseUrl}/api/admin/creations/media/multipart/init`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

test("multipart routes enforce same-origin and Admin before parsing", async () => {
  const current = harness();
  const response = await handleDirectUploadOperation(request({}, "https://evil.example"), "init", current.dependencies);
  assert.equal(response.status, 403);
  assert.deepEqual(current.calls, { admin: 0, init: 0, status: 0 });

  const denied = harness();
  denied.dependencies.admin = async () => { throw new Error("NEXT_REDIRECT:/compte?acces=refuse"); };
  await assert.rejects(handleDirectUploadOperation(request({}), "init", denied.dependencies), /NEXT_REDIRECT/);
  assert.equal(denied.calls.init, 0);
});

test("multipart init accepts a closed video declaration and refuses client object keys", async () => {
  const valid = {
    creationId: session.creationId, slug: session.creationSlug, expectedLockVersion: 1, expectedAssetId: null,
    rightsConfirmed: true, alt: "", role: "VIDEO", filename: "test.mp4", mimeType: "video/mp4", sizeBytes: 10,
  };
  const accepted = harness();
  assert.equal((await handleDirectUploadOperation(request(valid), "init", accepted.dependencies)).status, 200);
  assert.equal(accepted.calls.init, 1);

  for (const extra of [{ objectKey: "creations/quarantine/forged" }, { uploadId: "forged" }, { role: "AUDIO" }]) {
    const current = harness();
    const response = await handleDirectUploadOperation(request({ ...valid, ...extra }), "init", current.dependencies);
    assert.equal(response.status, 400);
    assert.equal(current.calls.init, 0);
  }
});

test("status payload is closed and body size is bounded", async () => {
  const current = harness();
  const extra = await handleDirectUploadOperation(request({ sessionToken: "opaque", creationId: session.creationId }), "status", current.dependencies);
  assert.equal(extra.status, 400);
  assert.equal(current.calls.status, 0);

  const oversized = new Request(`${baseUrl}/status`, { method: "POST", headers: { origin: baseUrl, "content-type": "application/json", "content-length": "20000" }, body: "{}" });
  assert.equal((await handleDirectUploadOperation(oversized, "status", current.dependencies)).status, 400);
});
