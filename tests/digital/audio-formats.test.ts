import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAudioFixture } from "../audio/fixture";
import { digitalMp3Bitrate, generateDigitalMp3, validateDigitalAudio } from "@/lib/digital/audio";
import { digitalZip } from "@/lib/digital/zip";

test("MP3 quality is bounded and explicit; 320 kbit/s default is not a new price", () => {
  assert.equal(digitalMp3Bitrate(""), 320);
  for (const rate of ["192", "256", "320"]) assert.equal(digitalMp3Bitrate(rate), Number(rate));
  for (const rate of ["0", "321", "v0", "192k", "NaN", "-1"]) assert.throws(() => digitalMp3Bitrate(rate), { code: "INVALID_MP3_BITRATE_CONFIGURATION" });
});
test("real FFmpeg private MP3 and independently streamed WAV/MP3 ZIP payloads", { timeout: 60000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-dcn-formats-test-"));
  try {
    const wav = path.join(root, "source.wav"), mp3 = path.join(root, "private.mp3"), preview = path.join(root, "preview.mp3");
    await createAudioFixture({ seconds: 3, format: "wav", outputPath: wav });
    const sourceBefore = createHash("sha256").update(await readFile(wav)).digest("hex");
    const validated = await validateDigitalAudio(wav, preview, 0, new AbortController().signal);
    assert.equal(validated.durationMs, 3000); assert.ok(validated.previewDurationMs <= 60000);
    const rendition = await generateDigitalMp3(wav, mp3, validated.durationMs, new AbortController().signal);
    assert.equal(rendition.codec, "mp3"); assert.equal(rendition.bitrateKbps, 320); assert.ok(Math.abs(rendition.durationMs - 3000) <= 100);
    const wavBytes = await readFile(wav), mp3Bytes = await readFile(mp3);
    assert.equal(createHash("sha256").update(wavBytes).digest("hex"), sourceBefore);
    assert.ok(mp3Bytes.length > 1); assert.ok(mp3Bytes.length < wavBytes.length);
    const archive = async (name: string, bytes: Buffer) => {
      const parts: Uint8Array[] = [];
      for await (const chunk of digitalZip([{ name, size: bytes.length, async open() { return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }); } }])) parts.push(chunk);
      return Buffer.concat(parts);
    };
    const zipWav = await archive("01-QA.wav", wavBytes), zipMp3 = await archive("01-QA.mp3", mp3Bytes);
    assert.notEqual(createHash("sha256").update(zipWav).digest("hex"), createHash("sha256").update(zipMp3).digest("hex"));
    assert.equal(zipWav.subarray(30 + Buffer.byteLength("01-QA.wav"), 30 + Buffer.byteLength("01-QA.wav") + wavBytes.length).compare(wavBytes), 0);
    assert.equal(zipMp3.subarray(30 + Buffer.byteLength("01-QA.mp3"), 30 + Buffer.byteLength("01-QA.mp3") + mp3Bytes.length).compare(mp3Bytes), 0);
    assert.equal((await stat(wav)).size, wavBytes.length);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("full MP3 conversion rejects non-WAV and aborted leases before exposing output", { timeout: 30000 }, async () => {
  const fixture = await createAudioFixture({ seconds: 1, format: "mp3" });
  try {
    await assert.rejects(generateDigitalMp3(fixture.path, `${fixture.path}.derived.mp3`, 1000, new AbortController().signal), { code: "WAV_SOURCE_REQUIRED" });
    const stop = new AbortController(); stop.abort();
    await assert.rejects(generateDigitalMp3(fixture.path, `${fixture.path}.derived.mp3`, 1000, stop.signal), { code: "LEASE_LOST" });
  } finally { await fixture.cleanup(); }
});
