import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
    assert.ok(upload.durationMs >= 900 && upload.durationMs <= 1_100);
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
