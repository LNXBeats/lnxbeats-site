import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpeg from "ffmpeg-static";
import { createAudioFixture } from "../audio/fixture";
import { inspectDigitalWav } from "@/lib/digital/wav-validation";
import { inspectDigitalMp3 } from "@/lib/digital/mp3-validation";
import { validateDigitalAudio, validateDigitalMp3 } from "@/lib/digital/audio";
import { DIGITAL_MP3_ENCODER_VERSION, digitalCommercialAudioReady, type DigitalCommercialAudioProof } from "@/lib/digital/formats";

const exec = promisify(execFile);
const signal = () => new AbortController().signal;
const scratch = async () => mkdtemp(path.join(os.tmpdir(), "lnx-dcn-audio-validation-"));

test("real strict WAV validation rejects truncated data, fake headers and inconsistent PCM metadata", { timeout: 30000 }, async () => {
  const root = await scratch();
  try {
    const wav = path.join(root, "source.wav"); await createAudioFixture({ seconds: 3, format: "wav", outputPath: wav });
    const original = await readFile(wav), checked = await inspectDigitalWav(wav);
    assert.equal(checked.durationMs, 3000); assert.equal(checked.encoding, "PCM"); assert.equal(checked.bitsPerSample, 24);
    for (const [name, bytes] of [["truncated.wav", original.subarray(0, original.length - 13)], ["html.wav", Buffer.from("<!doctype html>".padEnd(200, " "))], ["empty.wav", Buffer.alloc(100)]] as const) {
      const file = path.join(root, name); await writeFile(file, bytes);
      await assert.rejects(validateDigitalAudio(file, `${file}.mp3`, 0, signal()), { code: "INVALID_WAV_STRUCTURE" });
    }
    const broken = Buffer.from(original), fmt = broken.indexOf(Buffer.from("fmt "));
    broken.writeUInt32LE(1, fmt + 8 + 8);
    const bad = path.join(root, "invalid-byte-rate.wav"); await writeFile(bad, broken);
    await assert.rejects(inspectDigitalWav(bad), { code: "INVALID_WAV_STRUCTURE" });
    const fixedRiff = Buffer.from(original.subarray(0, original.length - 12)); fixedRiff.writeUInt32LE(fixedRiff.length - 8, 4);
    const mismatched = path.join(root, "declared-data-incomplete.wav"); await writeFile(mismatched, fixedRiff);
    await assert.rejects(inspectDigitalWav(mismatched), { code: "INVALID_WAV_STRUCTURE" });
    assert.deepEqual(await readFile(wav), original, "validation never rewrites a master");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real floating PCM WAV is accepted and a two-audio-stream Matroska masquerading as WAV is refused", { timeout: 30000 }, async () => {
  const root = await scratch();
  try {
    assert.ok(ffmpeg);
    const wav = path.join(root, "float.wav"), multi = path.join(root, "two-audio.wav");
    await exec(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1", "-c:a", "pcm_f32le", "-y", wav], { timeout: 10000, maxBuffer: 65536 });
    assert.equal((await inspectDigitalWav(wav)).encoding, "FLOAT");
    assert.equal((await validateDigitalAudio(wav, path.join(root, "preview.mp3"), 0, signal())).durationMs, 1000);
    await exec(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1", "-map", "0:a", "-map", "1:a", "-c:a", "pcm_s16le", "-f", "matroska", "-y", multi], { timeout: 10000, maxBuffer: 65536 });
    await assert.rejects(validateDigitalAudio(multi, path.join(root, "untrusted-preview.mp3"), 0, signal()), { code: "INVALID_WAV_STRUCTURE" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real MP3 inspection rejects partial frames, missing complete frames, trailing payloads and bitrate/duration contradictions", { timeout: 30000 }, async () => {
  const root = await scratch();
  try {
    const mp3 = path.join(root, "source.mp3"); await createAudioFixture({ seconds: 3, format: "mp3", outputPath: mp3 });
    assert.equal((await validateDigitalMp3(mp3, signal(), { durationMs: 3000, bitrateKbps: 256 })).codec, "mp3");
    const bytes = await readFile(mp3);
    for (const [name, content] of [["partial-frame.mp3", bytes.subarray(0, bytes.length - 17)], ["trailing-html.mp3", Buffer.concat([bytes, Buffer.from("<html>untrusted</html>")])], ["not-mp3.mp3", Buffer.alloc(100)]] as const) {
      const file = path.join(root, name); await writeFile(file, content); await assert.rejects(validateDigitalMp3(file, signal()), { code: "INVALID_MP3_STRUCTURE" });
    }
    const start = 10 + bytes[6]! * 2097152 + bytes[7]! * 16384 + bytes[8]! * 128 + bytes[9]!;
    let offset = start, last = offset;
    while (offset < bytes.length) { last = offset; const bitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bytes[offset + 2]! >> 4]!; offset += Math.floor(144000 * bitrate / 44100) + ((bytes[offset + 2]! >> 1) & 1); }
    assert.equal(offset, bytes.length);
    const missing = path.join(root, "complete-last-frame-missing.mp3"); await writeFile(missing, bytes.subarray(0, last));
    await assert.rejects(inspectDigitalMp3(missing, signal()), { code: "INVALID_MP3_STRUCTURE" });
    const firstBitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bytes[start + 2]! >> 4]!;
    const withoutIndex = path.join(root, "xing-frame-missing.mp3"); await writeFile(withoutIndex, bytes.subarray(start + Math.floor(144000 * firstBitrate / 44100) + ((bytes[start + 2]! >> 1) & 1)));
    await assert.rejects(validateDigitalMp3(withoutIndex, signal(), { durationMs: 3000, bitrateKbps: 256 }), { code: "MP3_RENDITION_INTEGRITY" });
    await assert.rejects(validateDigitalMp3(mp3, signal(), { durationMs: 3000, bitrateKbps: 320 }), { code: "MP3_RENDITION_INTEGRITY" });
    await assert.rejects(validateDigitalMp3(mp3, signal(), { durationMs: 1000 }), { code: "AUDIO_DURATION_MISMATCH" });
    const stopped = new AbortController(); stopped.abort(); await assert.rejects(validateDigitalMp3(mp3, stopped.signal), { code: "LEASE_LOST" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("physical preview remains at most sixty seconds after strict full decoding", { timeout: 30000 }, async () => {
  const root = await scratch();
  try {
    const wav = path.join(root, "source.wav"); await createAudioFixture({ seconds: 65, format: "wav", outputPath: wav });
    const result = await validateDigitalAudio(wav, path.join(root, "preview.mp3"), 0, signal());
    assert.equal(result.durationMs, 65000); assert.ok(result.previewDurationMs > 59000 && result.previewDurationMs <= 60000);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("commercial readiness requires strict validation provenance, exact metadata and both private formats without mutating history", () => {
  const asset = { visibility: "PRIVATE", mimeType: "audio/wav", checksumSha256: "a".repeat(64), durationMs: 3000, sizeBytes: 100000n };
  const proof: DigitalCommercialAudioProof = { status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION, mp3BitrateKbps: 320, previewDurationMs: 3000,
    masterAsset: asset, mp3Asset: { ...asset, mimeType: "audio/mpeg" }, previewAsset: { ...asset, visibility: "PUBLIC", mimeType: "audio/mpeg" } };
  assert.equal(digitalCommercialAudioReady(proof), true);
  for (const variant of [{ ...proof, encoderVersion: "ffmpeg-libmp3lame-cbr-v1" }, { ...proof, mp3Asset: null }, { ...proof, mp3BitrateKbps: 0 }, { ...proof, previewDurationMs: 60001 },
    { ...proof, masterAsset: { ...asset, checksumSha256: "" } }, { ...proof, mp3Asset: { ...proof.mp3Asset!, durationMs: 1000 } }, { ...proof, mp3Asset: { ...proof.mp3Asset!, visibility: "PUBLIC" } }]) assert.equal(digitalCommercialAudioReady(variant), false);
  assert.equal(proof.masterAsset, asset); assert.equal(proof.encoderVersion, DIGITAL_MP3_ENCODER_VERSION);
});
