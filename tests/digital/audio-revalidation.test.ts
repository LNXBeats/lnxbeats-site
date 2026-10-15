import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { planDigitalMasterImport, type DigitalDuplicateMasterProof } from "@/lib/digital/master-import-policy";

function fixture() {
  const trackId = randomUUID(), previousId = randomUUID(), oldAssetId = randomUUID(), newAssetId: string = randomUUID(), checksum = "a".repeat(64);
  const previous: DigitalDuplicateMasterProof = { id: previousId, trackId, version: 1, status: "READY", codec: "wav", encoderVersion: "ffmpeg-libmp3lame-cbr-v1", masterAssetId: oldAssetId,
    masterAsset: { checksumSha256: checksum, storageKey: `digital/masters/${trackId}/${oldAssetId}.wav`, visibility: "PRIVATE", mimeType: "audio/wav" } };
  return { trackId, expectedVersion: 1, latestMasterId: previousId, checksum, newAssetId, newStorageKey: `digital/masters/${trackId}/${newAssetId}.wav`, encoderVersion: DIGITAL_MP3_ENCODER_VERSION, duplicates: [previous] };
}

test("new unique strictly validated source preserves ordinary append-only import", () => {
  const f = fixture(); assert.deepEqual(planDigitalMasterImport({ ...f, duplicates: [] }), { revalidation: null });
});

test("same exact latest v1 WAV permits only additive strict revalidation and emits the previous immutable identity", () => {
  const f = fixture(), previous = f.duplicates[0]!, before = JSON.stringify(previous);
  Object.freeze(previous.masterAsset); Object.freeze(previous); Object.freeze(f.duplicates);
  const plan = planDigitalMasterImport(f);
  assert.deepEqual(plan.revalidation, { kind: "ADDITIVE_STRICT_REVALIDATION", previousMasterId: previous.id, previousMasterVersion: 1,
    previousMasterAssetId: previous.masterAssetId, previousEncoderVersion: "ffmpeg-libmp3lame-cbr-v1", sourceChecksum: f.checksum });
  assert.equal(JSON.stringify(previous), before); assert.notEqual(previous.masterAssetId, f.newAssetId); assert.notEqual(previous.masterAsset.storageKey, f.newStorageKey);
});

test("cross-track, v2, unknown, nonREADY, nonWAV, public or contradictory duplicates remain blocked", () => {
  const variants = ["track", "v2", "unknownEncoder", "status", "codec", "mime", "visibility", "checksum"];
  for (const variant of variants) {
    const f = fixture(), old = f.duplicates[0]!;
    if (variant === "track") old.trackId = randomUUID();
    if (variant === "v2") old.encoderVersion = DIGITAL_MP3_ENCODER_VERSION;
    if (variant === "unknownEncoder") old.encoderVersion = null;
    if (variant === "status") old.status = "QUARANTINED";
    if (variant === "codec") old.codec = "mp3";
    if (variant === "mime") old.masterAsset.mimeType = "audio/mpeg";
    if (variant === "visibility") old.masterAsset.visibility = "PUBLIC";
    if (variant === "checksum") old.masterAsset.checksumSha256 = "b".repeat(64);
    assert.throws(() => planDigitalMasterImport(f), { code: "DUPLICATE_MASTER_REVIEW_REQUIRED" }, variant);
  }
});

test("ambiguous sources, stale source version and reuse of old assets or storage keys remain blocked", () => {
  for (const variant of ["ambiguous", "notLatest", "staleVersion", "sameAsset", "sameKey"]) {
    const f = fixture();
    if (variant === "ambiguous") f.duplicates.push({ ...f.duplicates[0]!, id: randomUUID(), masterAsset: { ...f.duplicates[0]!.masterAsset } });
    if (variant === "notLatest") f.latestMasterId = randomUUID();
    if (variant === "staleVersion") f.expectedVersion = 2;
    if (variant === "sameAsset") f.newAssetId = f.duplicates[0]!.masterAssetId;
    if (variant === "sameKey") f.newStorageKey = f.duplicates[0]!.masterAsset.storageKey;
    assert.throws(() => planDigitalMasterImport(f), { code: "DUPLICATE_MASTER_REVIEW_REQUIRED" }, variant);
  }
});

test("duplicate allowance cannot bypass strict validation provenance or the full SHA256 identity", () => {
  const f = fixture();
  assert.throws(() => planDigitalMasterImport({ ...f, encoderVersion: "ffmpeg-libmp3lame-cbr-v1" }), { code: "AUDIO_VALIDATION_REQUIRED" });
  assert.throws(() => planDigitalMasterImport({ ...f, checksum: "partial" }), { code: "AUDIO_VALIDATION_REQUIRED" });
});
