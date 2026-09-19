import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { creationMediaResponse, publicMediaSignedUrlTtlSeconds } from "../../lib/creations/media-response";
import { putMediaObject } from "../../lib/media/storage";

test("short signed media TTL is strictly limited to Preview", () => {
  assert.equal(publicMediaSignedUrlTtlSeconds({}), 3_600);
  assert.equal(publicMediaSignedUrlTtlSeconds({
    MEDIA_DEPLOYMENT_ENV: "preview",
    CREATION_MEDIA_SIGNED_URL_TTL_SECONDS: "5",
  }), 5);
  for (const deployment of ["production", "staging", "test"]) {
    assert.equal(publicMediaSignedUrlTtlSeconds({
      MEDIA_DEPLOYMENT_ENV: deployment,
      CREATION_MEDIA_SIGNED_URL_TTL_SECONDS: "5",
    }), 3_600);
  }
  assert.equal(publicMediaSignedUrlTtlSeconds({
    MEDIA_DEPLOYMENT_ENV: "preview",
    CREATION_MEDIA_SIGNED_URL_TTL_SECONDS: "2",
  }), 3_600);
  assert.equal(publicMediaSignedUrlTtlSeconds({
    MEDIA_DEPLOYMENT_ENV: "preview",
    CREATION_MEDIA_SIGNED_URL_TTL_SECONDS: "61",
  }), 3_600);
});

test("Creation media supports byte ranges while authenticated draft previews remain private", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-creation-response-"));
  const previous = {
    driver: process.env.MEDIA_STORAGE_DRIVER,
    deployment: process.env.MEDIA_DEPLOYMENT_ENV,
    publicRoot: process.env.MEDIA_LOCAL_PUBLIC_ROOT,
    privateRoot: process.env.MEDIA_LOCAL_PRIVATE_ROOT,
  };
  process.env.MEDIA_STORAGE_DRIVER = "local";
  process.env.MEDIA_DEPLOYMENT_ENV = "test";
  process.env.MEDIA_LOCAL_PUBLIC_ROOT = path.join(root, "public");
  process.env.MEDIA_LOCAL_PRIVATE_ROOT = path.join(root, "private");
  const id = "20000000-0000-4000-8000-000000000001";
  const key = `creations/10000000-0000-4000-8000-000000000001/video/${id}.mp4`;
  const bytes = Buffer.from("0123456789abcdef");
  try {
    await putMediaObject({
      scope: "public",
      key,
      body: bytes,
      contentLength: bytes.length,
      contentType: "video/mp4",
      checksumSha256: "a".repeat(64),
    });
    const asset = {
      id,
      storageKey: key,
      storageBackend: "LOCAL" as const,
      storageProvider: "local",
      visibility: "PUBLIC" as const,
      mimeType: "video/mp4",
      sizeBytes: BigInt(bytes.length),
      checksumSha256: "a".repeat(64),
      updatedAt: new Date("2026-09-13T12:00:00Z"),
    };
    const range = await creationMediaResponse(new Request("http://localhost/media", {
      headers: { range: "bytes=2-5" },
    }), asset);
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("accept-ranges"), "bytes");
    assert.equal(range.headers.get("content-range"), "bytes 2-5/16");
    assert.equal(await range.text(), "2345");

    const preview = await creationMediaResponse(new Request("http://localhost/admin-preview"), asset, false, true);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("cache-control"), "private, no-store");
    assert.equal(preview.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(await preview.text(), bytes.toString());

    const unsatisfied = await creationMediaResponse(new Request("http://localhost/media", {
      headers: { range: "bytes=99-100" },
    }), asset);
    assert.equal(unsatisfied.status, 416);
    assert.equal(unsatisfied.headers.get("content-range"), "bytes */16");
  } finally {
    if (previous.driver === undefined) delete process.env.MEDIA_STORAGE_DRIVER; else process.env.MEDIA_STORAGE_DRIVER = previous.driver;
    if (previous.deployment === undefined) delete process.env.MEDIA_DEPLOYMENT_ENV; else process.env.MEDIA_DEPLOYMENT_ENV = previous.deployment;
    if (previous.publicRoot === undefined) delete process.env.MEDIA_LOCAL_PUBLIC_ROOT; else process.env.MEDIA_LOCAL_PUBLIC_ROOT = previous.publicRoot;
    if (previous.privateRoot === undefined) delete process.env.MEDIA_LOCAL_PRIVATE_ROOT; else process.env.MEDIA_LOCAL_PRIVATE_ROOT = previous.privateRoot;
    await rm(root, { recursive: true, force: true });
  }
});
