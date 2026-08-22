import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { assertMediaStorageKey } from "@/lib/media/storage/policy";
import { ORDER_DELIVERY_SIGNED_URL_SECONDS, orderDeliveryResponse } from "@/lib/orders/audio-response";

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

function streamingDependencies(mimeType = asset.mimeType) {
  return {
    stat: async () => ({
      contentLength: bytes.length,
      contentType: mimeType,
      etag: null,
      checksumSha256: asset.checksumSha256,
      lastModified: asset.updatedAt,
    }),
    stream: async (_asset: unknown, range?: { start: number; end: number }) => {
      const selected = range ? bytes.subarray(range.start, range.end + 1) : bytes;
      return {
        body: Readable.toWeb(Readable.from([selected])) as ReadableStream<Uint8Array>,
        contentLength: selected.length,
        contentType: mimeType,
        etag: null,
        checksumSha256: asset.checksumSha256,
        lastModified: asset.updatedAt,
      };
    },
  };
}

const dependencies = streamingDependencies();
const wavAsset = {
  ...asset,
  storageKey: asset.storageKey.replace(/\.mp3$/, ".wav"),
  filename: "master final.wav",
  mimeType: "audio/wav",
};

test("autorise uniquement les clés privées opaques des formats de livraison", () => {
  assert.doesNotThrow(() => assertMediaStorageKey("private", asset.storageKey));
  for (const extension of ["wav", "flac", "zip", "pdf", "jpg", "png"]) {
    assert.doesNotThrow(() => assertMediaStorageKey("private", `orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000010.${extension}`));
  }
  assert.throws(() => assertMediaStorageKey("public", asset.storageKey));
  assert.throws(() => assertMediaStorageKey("private", "orders/owner/deliveries/master.mp3"));
  assert.throws(() => assertMediaStorageKey("private", "orders/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000010.exe"));
});

test("le player OBJECT reste sur le proxy privé same-origin", async () => {
  let signCalls = 0;
  let streamCalls = 0;
  const response = await orderDeliveryResponse(
    new Request("http://localhost/audio"),
    asset,
    { download: false },
    {
      sign: async () => {
        signCalls += 1;
        return "https://private.example.invalid/object?signature=opaque";
      },
      stat: dependencies.stat,
      stream: async (...args) => {
        streamCalls += 1;
        return dependencies.stream(...args);
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-length"), String(bytes.length));
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
  assert.equal(await response.text(), bytes.toString());
  assert.equal(signCalls, 0);
  assert.equal(streamCalls, 1);
});

test("le player sert les ranges ouvertes, partielles et de fin en 206", async () => {
  const cases = [
    { header: "bytes=0-", contentRange: "bytes 0-9/10", body: "0123456789" },
    { header: "bytes=2-5", contentRange: "bytes 2-5/10", body: "2345" },
    { header: "bytes=-3", contentRange: "bytes 7-9/10", body: "789" },
    { header: "bytes=8-99", contentRange: "bytes 8-9/10", body: "89" },
  ];
  for (const item of cases) {
    const response = await orderDeliveryResponse(
      new Request("http://localhost/audio", { headers: { range: item.header } }),
      asset,
      { download: false },
      dependencies,
    );
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), item.contentRange);
    assert.equal(response.headers.get("content-length"), String(item.body.length));
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(await response.text(), item.body);
  }
});

test("HEAD et les MIME MP3/WAV restent adaptés à la lecture", async () => {
  const head = await orderDeliveryResponse(
    new Request("http://localhost/audio"),
    asset,
    { head: true, download: false },
    dependencies,
  );
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(head.headers.get("content-type"), "audio/mpeg");
  assert.match(head.headers.get("content-disposition") ?? "", /^inline;/);
  assert.equal(await head.text(), "");

  const wav = await orderDeliveryResponse(
    new Request("http://localhost/audio", { headers: { range: "bytes=0-1" } }),
    wavAsset,
    { download: false },
    streamingDependencies("audio/wav"),
  );
  assert.equal(wav.status, 206);
  assert.equal(wav.headers.get("content-type"), "audio/wav");
  assert.equal(wav.headers.get("content-range"), "bytes 0-1/10");
  assert.equal(await wav.text(), "01");
});

test("refuse les ranges invalides avec 416", async () => {
  for (const range of ["bytes=999-1000", "bytes=0-1,4-5", "items=0-1"]) {
    const response = await orderDeliveryResponse(
      new Request("http://localhost/audio", { headers: { range } }),
      asset,
      { download: false },
      dependencies,
    );
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), `bytes */${bytes.length}`);
    assert.equal(response.headers.get("content-length"), "0");
  }
});

test("le téléchargement proxy de secours reste une pièce jointe", async () => {
  const download = await orderDeliveryResponse(new Request("http://localhost/audio"), asset, {}, dependencies);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.doesNotMatch(download.headers.get("content-disposition") ?? "", /[\r\n]/);
});

test("un téléchargement objet privé produit uniquement une URL HTTPS signée pendant dix minutes", async () => {
  let observedExpiry = 0;
  let observedFilename = "";
  let streamCalls = 0;
  const response = await orderDeliveryResponse(new Request("http://localhost/audio"), asset, {}, {
    sign: async (_reference, options) => {
      observedExpiry = options.expiresInSeconds;
      observedFilename = options.downloadFilename ?? "";
      return "https://private.example.invalid/object?X-Amz-Expires=600&signature=opaque";
    },
    stat: dependencies.stat,
    stream: async (...args) => { streamCalls += 1; return dependencies.stream(...args); },
  });
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(observedExpiry, ORDER_DELIVERY_SIGNED_URL_SECONDS);
  assert.equal(observedExpiry, 600);
  assert.equal(observedFilename, asset.filename);
  assert.equal(streamCalls, 0);
});

test("HEAD reste contrôlé par l’application et une URL signée non HTTPS est refusée au téléchargement", async () => {
  let signCalls = 0;
  const signedDependencies = {
    sign: async () => { signCalls += 1; return "http://unsafe.example.invalid/object"; },
    stat: dependencies.stat,
    stream: dependencies.stream,
  };
  const head = await orderDeliveryResponse(new Request("http://localhost/audio"), asset, { head: true }, signedDependencies);
  assert.equal(head.status, 200);
  assert.equal(signCalls, 0);
  const unsafe = await orderDeliveryResponse(new Request("http://localhost/audio"), asset, {}, signedDependencies);
  assert.equal(unsafe.status, 404);
  assert.equal(signCalls, 1);
});
