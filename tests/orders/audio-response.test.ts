import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { assertMediaStorageKey } from "@/lib/media/storage/policy";
import { orderDeliveryResponse } from "@/lib/orders/audio-response";

const bytes = Buffer.from("0123456789");
const asset = {
  id: "00000000-0000-4000-8000-000000000010",
  storageKey: "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000010.mp3",
  storageBackend: "OBJECT" as const,
  storageProvider: "r2",
  visibility: "PRIVATE" as const,
  checksumSha256: "a".repeat(64),
  filename: "master final.mp3",
  mimeType: "audio/mpeg",
  sizeBytes: BigInt(bytes.length),
  updatedAt: new Date("2026-08-14T00:00:00Z"),
};

const dependencies = {
  stat: async () => ({
    contentLength: bytes.length,
    contentType: "audio/mpeg",
    etag: null,
    checksumSha256: asset.checksumSha256,
    lastModified: asset.updatedAt,
  }),
  stream: async (_asset: unknown, range?: { start: number; end: number }) => {
    const selected = range ? bytes.subarray(range.start, range.end + 1) : bytes;
    return {
      body: Readable.toWeb(Readable.from([selected])) as ReadableStream<Uint8Array>,
      contentLength: selected.length,
      contentType: "audio/mpeg",
      etag: null,
      checksumSha256: asset.checksumSha256,
      lastModified: asset.updatedAt,
    };
  },
};

test("autorise uniquement la clé privée opaque des livraisons audio", () => {
  assert.doesNotThrow(() => assertMediaStorageKey("private", asset.storageKey));
  assert.throws(() => assertMediaStorageKey("public", asset.storageKey));
  assert.throws(() => assertMediaStorageKey("private", "orders/owner/deliveries/master.mp3"));
});

test("streame une livraison privée avec no-store, nosniff et Range", async () => {
  const full = await orderDeliveryResponse(new Request("http://localhost/audio"), asset, {}, dependencies);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("cache-control"), "private, no-store");
  assert.equal(full.headers.get("x-content-type-options"), "nosniff");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(await full.text(), bytes.toString());

  const partial = await orderDeliveryResponse(
    new Request("http://localhost/audio", { headers: { range: "bytes=2-5" } }),
    asset,
    {},
    dependencies,
  );
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await partial.text(), "2345");
});

test("sert HEAD sans corps, refuse les ranges invalides et borne le téléchargement", async () => {
  const head = await orderDeliveryResponse(new Request("http://localhost/audio"), asset, { head: true }, dependencies);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(await head.text(), "");

  const invalid = await orderDeliveryResponse(
    new Request("http://localhost/audio", { headers: { range: "bytes=999-1000" } }),
    asset,
    {},
    dependencies,
  );
  assert.equal(invalid.status, 416);

  const download = await orderDeliveryResponse(new Request("http://localhost/audio"), asset, {}, dependencies);
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.doesNotMatch(download.headers.get("content-disposition") ?? "", /[\r\n]/);
  const playback = await orderDeliveryResponse(new Request("http://localhost/audio"), asset, { download: false }, dependencies);
  assert.match(playback.headers.get("content-disposition") ?? "", /^inline;/);
});
