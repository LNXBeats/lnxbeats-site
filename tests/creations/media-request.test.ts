import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  CreationMediaRequestError,
  readCreationMediaJson,
  readCreationMediaUpload,
} from "../../lib/creations/media-request";

const creationId = "10000000-0000-4000-8000-000000000001";

async function coverRequest(mutate?: (form: FormData) => void, withLength = true) {
  const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#c8a758" } }).png().toBuffer();
  const form = new FormData();
  form.set("creationId", creationId);
  form.set("slug", "collaboration-qa");
  form.set("expectedLockVersion", "1");
  form.set("expectedAssetId", "");
  form.set("role", "COVER");
  form.set("rightsConfirmed", "on");
  form.set("alt", "Visuel de la collaboration QA");
  form.set("media", new File([bytes], "visuel.png", { type: "image/png" }));
  mutate?.(form);
  const browserRequest = new Request("http://127.0.0.1:3103/api/admin/creations/media", { method: "POST", body: form });
  const body = Buffer.from(await browserRequest.arrayBuffer());
  const headers = new Headers({
    "content-type": browserRequest.headers.get("content-type")!,
    "x-lnx-creation-media-role": "COVER",
    ...(withLength ? { "content-length": String(body.length) } : {}),
  });
  return new Request(browserRequest.url, { method: "POST", headers, body });
}

test("creation cover upload is closed, normalized and represented by a temporary file", async () => {
  const upload = await readCreationMediaUpload(await coverRequest());
  try {
    assert.equal(upload.creationId, creationId);
    assert.equal(upload.slug, "collaboration-qa");
    assert.equal(upload.expectedLockVersion, "1");
    assert.equal(upload.role, "COVER");
    assert.equal(upload.mimeType, "image/webp");
    assert.equal(upload.extension, "webp");
    assert.equal(upload.width, 8);
    assert.equal(upload.height, 6);
    assert.ok(upload.sizeBytes > 0);
    assert.match(upload.checksumSha256, /^[0-9a-f]{64}$/);
  } finally {
    await upload.cleanup();
  }
});

test("unknown, duplicate and missing multipart fields are rejected", async () => {
  const requests = [
    coverRequest((form) => form.set("storageKey", "arbitrary/key")),
    coverRequest((form) => form.append("slug", "second-slug")),
    coverRequest((form) => form.delete("expectedLockVersion")),
    coverRequest((form) => form.set("rightsConfirmed", "yes")),
  ];
  for (const pending of requests) {
    await assert.rejects(
      readCreationMediaUpload(await pending),
      (error: unknown) => error instanceof CreationMediaRequestError && error.code === "INVALID_FIELDS",
    );
  }
});

test("creation media transport requires an explicit bounded Content-Length", async () => {
  await assert.rejects(
    readCreationMediaUpload(await coverRequest(undefined, false)),
    (error: unknown) => error instanceof CreationMediaRequestError && error.code === "LENGTH_REQUIRED",
  );
});

test("a false Content-Length cannot bypass the measured multipart transport", async () => {
  const valid = await coverRequest();
  const body = Buffer.from(await valid.arrayBuffer());
  const lied = new Request(valid.url, {
    method: "POST",
    headers: {
      "content-type": valid.headers.get("content-type")!,
      "content-length": String(body.length - 1),
      "x-lnx-creation-media-role": "COVER",
    },
    body,
  });
  await assert.rejects(
    readCreationMediaUpload(lied),
    (error: unknown) => error instanceof CreationMediaRequestError && error.code === "INVALID_MULTIPART",
  );
});

test("bounded JSON reader accepts only JSON and rejects oversized declarations", async () => {
  assert.deepEqual(await readCreationMediaJson(new Request("http://127.0.0.1", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "COVER" }),
  })), { role: "COVER" });
  await assert.rejects(
    readCreationMediaJson(new Request("http://127.0.0.1", {
      method: "DELETE",
      headers: { "content-type": "application/json", "content-length": "4097" },
      body: "{}",
    })),
    CreationMediaRequestError,
  );
});
