import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const originalEnvironment = { ...process.env };

test("real local media route behavior preserves GET, HEAD and Range semantics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-media-http-"));
  process.env.MEDIA_STORAGE_DRIVER = "local";
  process.env.MEDIA_LOCAL_PUBLIC_ROOT = path.join(root, "public");
  process.env.MEDIA_LOCAL_PRIVATE_ROOT = path.join(root, "private");
  process.env.MEDIA_DEPLOYMENT_ENV = "test";
  const [{ writeCatalogAudioPreview, removeCatalogAudioPreview }, { catalogAudioResponse }] = await Promise.all([
    import("@/lib/catalog/media-storage"),
    import("@/lib/catalog/audio-response"),
  ]);
  const storageKey = "catalog/audio-previews/00000000-0000-4000-8000-000000000001.mp3";
  const bytes = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251));
  const stored = await writeCatalogAudioPreview(storageKey, bytes);
  const asset = {
    id: "00000000-0000-4000-8000-000000000001",
    storageKey,
    storageBackend: stored.storageBackend,
    storageProvider: stored.storageProvider,
    visibility: stored.visibility,
    checksumSha256: stored.checksumSha256,
    mimeType: "audio/mpeg",
    sizeBytes: BigInt(bytes.length),
    updatedAt: new Date("2026-08-13T00:00:00Z"),
  };
  try {
    const full = await catalogAudioResponse(new Request("http://localhost/media"), asset, "public, max-age=31536000, immutable");
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(full.headers.get("etag"), `\"${stored.checksumSha256}\"`);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);

    const head = await catalogAudioResponse(new Request("http://localhost/media", { method: "HEAD" }), asset, "public, max-age=31536000, immutable", true);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(bytes.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    const range = await catalogAudioResponse(new Request("http://localhost/media", { headers: { range: "bytes=0-1023" } }), asset, "public, max-age=31536000, immutable");
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), `bytes 0-1023/${bytes.length}`);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 1024));

    const tail = await catalogAudioResponse(new Request("http://localhost/media", { headers: { range: "bytes=-512" } }), asset, "public, max-age=31536000, immutable");
    assert.equal(tail.status, 206);
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(-512));

    const invalid = await catalogAudioResponse(new Request("http://localhost/media", { headers: { range: "bytes=999999-" } }), asset, "public, max-age=31536000, immutable");
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), `bytes */${bytes.length}`);
  } finally {
    await removeCatalogAudioPreview(asset);
    await rm(root, { recursive: true, force: true });
    process.env = { ...originalEnvironment };
  }
});
