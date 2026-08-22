import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import sharp from "sharp";

import { readOrderDeliveryUpload } from "@/lib/orders/audio-request";
import { OrderUploadError } from "@/lib/orders/upload";
import { createAudioFixture } from "@/tests/audio/fixture";

async function multipartRequest(file: File) {
  const form = new FormData();
  form.set("delivery", file, file.name);
  const encoded = new Request("http://localhost/upload", { method: "POST", body: form });
  const body = Buffer.from(await encoded.arrayBuffer());
  return new Request("http://localhost/upload", {
    method: "POST",
    headers: {
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(body.length),
    },
    body,
  });
}

function multipartStreamRequest(input: {
  source: Readable;
  sourceBytes: number;
  filename: string;
  mimeType: string;
}) {
  const boundary = "lnx-v0751-fragmented-boundary";
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="delivery"; filename="${input.filename}"\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const fragmented = Readable.from((async function* () {
    for (let offset = 0; offset < prefix.length; offset += 7) yield prefix.subarray(offset, offset + 7);
    for await (const chunk of input.source) yield chunk;
    for (let offset = 0; offset < suffix.length; offset += 5) yield suffix.subarray(offset, offset + 5);
  })());
  return new Request("http://localhost/upload", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(prefix.length + input.sourceBytes + suffix.length),
    },
    body: Readable.toWeb(fragmented) as never,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

test("streame, identifie et analyse un WAV réel sans le conserver après cleanup", async () => {
  const fixture = await createAudioFixture({ seconds: 1, format: "wav" });
  try {
    const bytes = fixture.bytes ?? await readFile(fixture.path);
    const upload = await readOrderDeliveryUpload(await multipartRequest(
      new File([bytes], "master-final.wav", { type: "audio/wav" }),
    ));
    assert.equal(upload.mimeType, "audio/wav");
    assert.equal(upload.extension, "wav");
    assert.ok(upload.durationMs !== null && upload.durationMs >= 900 && upload.durationMs <= 1_100);
    assert.equal(upload.sizeBytes, bytes.length);
    assert.equal(upload.checksumSha256.length, 64);
    await upload.cleanup();
    await assert.rejects(readFile(upload.path));
  } finally {
    await fixture.cleanup();
  }
});

test("streame un WAV réel de 60 Mio fragmenté, puis garde la source réutilisable après FFmpeg", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lnx-delivery-large-test-"));
  const fixturePath = path.join(directory, "walkman-vs-spotify.wav");
  await createAudioFixture({ seconds: 238, format: "wav", outputPath: fixturePath });
  try {
    const fixtureSize = (await stat(fixturePath)).size;
    assert.ok(fixtureSize >= 59 * 1024 * 1024 && fixtureSize <= 61 * 1024 * 1024);
    const upload = await readOrderDeliveryUpload(multipartStreamRequest({
      source: createReadStream(fixturePath, { highWaterMark: 65_537 }),
      sourceBytes: fixtureSize,
      filename: "walkman vs Spotify.wav",
      mimeType: "audio/wav",
    }));
    try {
      assert.equal(upload.sizeBytes, fixtureSize);
      assert.equal(upload.mimeType, "audio/wav");
      assert.ok(upload.durationMs !== null && upload.durationMs >= 237_000 && upload.durationMs <= 239_000);
      const reopenedHash = createHash("sha256");
      let reopenedBytes = 0;
      for await (const chunk of createReadStream(upload.path, { highWaterMark: 131_071 })) {
        reopenedBytes += chunk.length;
        reopenedHash.update(chunk);
      }
      assert.equal(reopenedBytes, fixtureSize);
      assert.equal(reopenedHash.digest("hex"), upload.checksumSha256);
    } finally {
      await upload.cleanup();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("classe une fermeture prématurée du flux navigateur sans laisser de fichier temporaire exploitable", async () => {
  const failure = Object.assign(new Error("destination sentinel must never be returned"), {
    code: "ERR_STREAM_PREMATURE_CLOSE",
  });
  const source = Readable.from((async function* () {
    yield Buffer.from("RIFF0000WAVE");
    throw failure;
  })());
  await assert.rejects(
    readOrderDeliveryUpload(multipartStreamRequest({
      source,
      sourceBytes: 64,
      filename: "interrupted.wav",
      mimeType: "audio/wav",
    })),
    (error: unknown) => error instanceof OrderUploadError
      && error.code === "STREAM_CLOSED_EARLY"
      && !error.message.includes("sentinel"),
  );
});

test("refuse un faux WAV malgré son extension et son MIME annoncés", async () => {
  await assert.rejects(
    readOrderDeliveryUpload(await multipartRequest(
      new File([Buffer.from("RIFF0000WAVEnot-audio")], "fake.wav", { type: "audio/wav" }),
    )),
    (error: unknown) => error instanceof OrderUploadError
      && ["UNSUPPORTED_SIGNATURE", "DECODE_FAILED"].includes(error.code),
  );
});

test("valide un FLAC réel par signature, identité MIME et décodage complet", async () => {
  const fixture = await createAudioFixture({ seconds: 1, format: "flac" });
  try {
    const bytes = fixture.bytes ?? await readFile(fixture.path);
    const upload = await readOrderDeliveryUpload(await multipartRequest(new File([bytes], "master.flac", { type: "audio/flac" })));
    assert.equal(upload.assetType, "AUDIO");
    assert.equal(upload.mimeType, "audio/flac");
    assert.equal(upload.extension, "flac");
    assert.ok(upload.durationMs !== null && upload.durationMs >= 900);
    await upload.cleanup();
  } finally {
    await fixture.cleanup();
  }
});

test("valide les signatures PDF, ZIP, JPEG et PNG sans faire confiance au nom seul", async () => {
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#c6a15b" } }).jpeg().toBuffer();
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#c6a15b" } }).png().toBuffer();
  const fixtures = [
    { bytes: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"), name: "notice.pdf", type: "application/pdf", assetType: "DOCUMENT", extension: "pdf" },
    { bytes: Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), name: "sources.zip", type: "application/zip", assetType: "DOCUMENT", extension: "zip" },
    { bytes: jpeg, name: "cover.jpeg", type: "image/jpeg", assetType: "IMAGE", extension: "jpg" },
    { bytes: png, name: "cover.png", type: "image/png", assetType: "IMAGE", extension: "png" },
  ] as const;
  for (const fixture of fixtures) {
    const upload = await readOrderDeliveryUpload(await multipartRequest(new File([fixture.bytes], fixture.name, { type: fixture.type })));
    assert.equal(upload.assetType, fixture.assetType);
    assert.equal(upload.extension, fixture.extension);
    if (fixture.assetType === "IMAGE") assert.deepEqual([upload.width, upload.height], [2, 2]);
    await upload.cleanup();
  }
});

test("refuse les scripts, les extensions incohérentes et la limite transport avant écriture", async () => {
  for (const file of [
    new File([Buffer.from("<script>alert(1)</script>")], "payload.html", { type: "text/html" }),
    new File([Buffer.from("%PDF-1.7\n%%EOF")], "payload.exe", { type: "application/pdf" }),
  ]) {
    await assert.rejects(readOrderDeliveryUpload(await multipartRequest(file)), (error: unknown) => error instanceof OrderUploadError && error.code === "UNSUPPORTED_SIGNATURE");
  }
  const oversized = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=safe", "content-length": String(202 * 1024 * 1024) },
    body: "--safe--",
  });
  await assert.rejects(readOrderDeliveryUpload(oversized), (error: unknown) => error instanceof OrderUploadError && error.code === "FILE_TOO_LARGE");
});
