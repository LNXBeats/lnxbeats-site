import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
