import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { planDigitalMasterImport, type DigitalDuplicateMasterProof } from "@/lib/digital/master-import-policy";

function fixture() {
  const trackId = randomUUID(), previousId = randomUUID(), oldAssetId = randomUUID(), newAssetId: string = randomUUID(), checksum = "a".repeat(64);
  const previous: DigitalDuplicateMasterProof = { id: previousId, trackId, version: 1, status: "READY", codec: "wav", encoderVersion: "ffmpeg-libmp3lame-cbr-v1", previewStartMs: 0, masterAssetId: oldAssetId,
    masterAsset: { checksumSha256: checksum, storageKey: `digital/masters/${trackId}/${oldAssetId}.wav`, visibility: "PRIVATE", mimeType: "audio/wav" } };
  return { trackId, expectedVersion: 1, latestMasterId: previousId, checksum, newAssetId, newStorageKey: `digital/masters/${trackId}/${newAssetId}.wav`, encoderVersion: DIGITAL_MP3_ENCODER_VERSION, previewStartMs: 0, duplicates: [previous] };
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

test("cross-track, unchanged v2 excerpt, unknown, nonREADY, nonWAV, public or contradictory duplicates remain blocked", () => {
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

test("a different excerpt of the same current strict WAV creates a new immutable version without inherited rights", () => {
  const f = fixture(), previous = f.duplicates[0]!;
  previous.encoderVersion = DIGITAL_MP3_ENCODER_VERSION;
  const before = JSON.stringify(previous);
  Object.freeze(previous.masterAsset); Object.freeze(previous);
  const plan = planDigitalMasterImport({ ...f, previewStartMs: 12_345 });
  assert.deepEqual(plan.revalidation, { kind: "ADDITIVE_EXCERPT_REVISION", previousMasterId: previous.id, previousMasterVersion: 1,
    previousMasterAssetId: previous.masterAssetId, previousEncoderVersion: DIGITAL_MP3_ENCODER_VERSION, sourceChecksum: f.checksum,
    previousPreviewStartMs: 0, previewStartMs: 12_345 });
  assert.equal(JSON.stringify(previous), before);
  assert.doesNotMatch(JSON.stringify(plan), /APPROVED|CLEARED|rightsConfirmed/);
});

test("repeated excerpt revisions permit a coherent same-track source history, not another track or an ambiguous lineage", () => {
  const f = fixture(), original = f.duplicates[0]!, latestAssetId = randomUUID();
  const latest = { ...original, id: randomUUID(), version: 2, previewStartMs: 10_000, encoderVersion: DIGITAL_MP3_ENCODER_VERSION,
    masterAssetId: latestAssetId, masterAsset: { ...original.masterAsset, storageKey: `digital/masters/${f.trackId}/${latestAssetId}.wav` } };
  const revision = { ...f, expectedVersion: 2, latestMasterId: latest.id, previewStartMs: 20_000, duplicates: [original, latest] };
  assert.equal(planDigitalMasterImport(revision).revalidation?.kind, "ADDITIVE_EXCERPT_REVISION");
  for (const patch of [{ trackId: randomUUID() }, { version: latest.version }, { masterAssetId: latest.masterAssetId }, { encoderVersion: null }, { status: "QUARANTINED" }]) {
    assert.throws(() => planDigitalMasterImport({ ...revision, duplicates: [{ ...original, ...patch }, latest] }), { code: "DUPLICATE_MASTER_REVIEW_REQUIRED" });
  }
  assert.throws(() => planDigitalMasterImport({ ...revision, previewStartMs: latest.previewStartMs }), { code: "DUPLICATE_MASTER_REVIEW_REQUIRED" });
  for (const previewStartMs of [-1, 0.1, NaN, 1_800_000]) assert.throws(() => planDigitalMasterImport({ ...revision, previewStartMs }), { code: "DUPLICATE_MASTER_REVIEW_REQUIRED" });
});

test("same-source excerpt history is bounded and cannot conceal a cross-track duplicate beyond the old two-row lookup", () => {
  const f = fixture();
  const history = Array.from({ length: 101 }, (_, index) => {
    const id = randomUUID(), masterAssetId = randomUUID();
    return { ...f.duplicates[0]!, id, version: index + 1, previewStartMs: index * 1000, encoderVersion: DIGITAL_MP3_ENCODER_VERSION, masterAssetId,
      masterAsset: { ...f.duplicates[0]!.masterAsset, storageKey: `digital/masters/${f.trackId}/${masterAssetId}.wav` } };
  });
  assert.equal(planDigitalMasterImport({ ...f, expectedVersion: 100, latestMasterId: history[99]!.id, previewStartMs: 101_000, duplicates: history.slice(0, 100) }).revalidation?.kind, "ADDITIVE_EXCERPT_REVISION");
  assert.throws(() => planDigitalMasterImport({ ...f, expectedVersion: 101, latestMasterId: history[100]!.id, previewStartMs: 102_000, duplicates: history }), { code: "DUPLICATE_MASTER_REVIEW_REQUIRED" });
  const three = history.slice(0, 3); three[2] = { ...three[2]!, trackId: randomUUID() };
  assert.throws(() => planDigitalMasterImport({ ...f, expectedVersion: 2, latestMasterId: three[1]!.id, previewStartMs: 102_000, duplicates: three }), { code: "DUPLICATE_MASTER_REVIEW_REQUIRED" });
});
