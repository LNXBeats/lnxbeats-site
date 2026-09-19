import assert from "node:assert/strict";
import test from "node:test";

import {
  CreationDirectUploadError,
  directUploadPartCount,
  expectedDirectUploadPartSize,
  newSessionToken,
  parseCreationDirectUploadInit,
  parseSessionToken,
  sessionTokenHash,
  sessionTokenHashMatches,
} from "@/lib/creations/direct-upload-domain";

const creationId = "10000000-0000-4000-8000-000000000001";

function valid(overrides: Record<string, unknown> = {}) {
  return {
    creationId,
    slug: "video-test",
    expectedLockVersion: 1,
    expectedAssetId: null,
    rightsConfirmed: true,
    alt: "",
    role: "VIDEO",
    filename: "test.mp4",
    mimeType: "video/mp4",
    sizeBytes: 20 * 1024 * 1024,
    ...overrides,
  };
}

test("direct video init is closed, role-bound and fail-closed on size and MIME", () => {
  assert.equal(parseCreationDirectUploadInit(valid()).sizeBytes, 20 * 1024 * 1024);
  assert.equal(parseCreationDirectUploadInit(valid({ filename: "clip.mov", mimeType: "video/quicktime" })).mimeType, "video/quicktime");
  assert.equal(parseCreationDirectUploadInit(valid({ filename: "clip.m4v", mimeType: "video/x-m4v" })).mimeType, "video/x-m4v");
  assert.equal(parseCreationDirectUploadInit(valid({ filename: "clip.webm", mimeType: "video/webm" })).mimeType, "video/webm");
  for (const input of [
    valid({ role: "AUDIO" }), valid({ mimeType: "video/quicktime" }), valid({ filename: "test.mov", mimeType: "video/webm" }),
    valid({ sizeBytes: 0 }), valid({ sizeBytes: -1 }), valid({ sizeBytes: 500 * 1024 * 1024 + 1 }),
    valid({ rightsConfirmed: false }), valid({ objectKey: "creations/arbitrary.mp4" }),
  ]) {
    assert.throws(() => parseCreationDirectUploadInit(input), CreationDirectUploadError);
  }
});

test("multipart geometry uses 8 MiB parts and a bounded last part", () => {
  const size = 17 * 1024 * 1024;
  assert.equal(directUploadPartCount(size), 3);
  assert.equal(expectedDirectUploadPartSize(size, 1), 8 * 1024 * 1024);
  assert.equal(expectedDirectUploadPartSize(size, 2), 8 * 1024 * 1024);
  assert.equal(expectedDirectUploadPartSize(size, 3), 1024 * 1024);
  assert.throws(() => expectedDirectUploadPartSize(size, 4), CreationDirectUploadError);
});

test("opaque session tokens are strict and compared through hashes", () => {
  const token = newSessionToken(creationId);
  assert.equal(parseSessionToken(token).id, creationId);
  const hash = sessionTokenHash(token);
  assert.equal(sessionTokenHashMatches(token, hash), true);
  assert.equal(sessionTokenHashMatches(`${token.slice(0, -1)}x`, hash), false);
  for (const invalid of [creationId, `${creationId}.short`, `../${token}`, `${token}\n`]) {
    assert.throws(() => parseSessionToken(invalid), CreationDirectUploadError);
  }
});
