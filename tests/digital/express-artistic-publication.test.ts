import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expressArtisticAtPublication } from "../../lib/digital/express-artistic-publication";
import { DIGITAL_MP3_ENCODER_VERSION } from "../../lib/digital/formats";
import type { DigitalExcerptMaster, DigitalExcerptSelection } from "../../lib/digital/excerpt-policy";

function fixture() {
  const sourceId = randomUUID(), mp3Id = randomUUID(), previewId = randomUUID();
  const asset = (id: string, mimeType: string, visibility = "PRIVATE", durationMs = 125_960) => ({ id, type: mimeType === "audio/wav" ? "AUDIO" : "AUDIO_PREVIEW",
    mimeType, visibility, durationMs, checksumSha256: "a".repeat(64), sizeBytes: 400_000n });
  const master: DigitalExcerptMaster = { id: randomUUID(), trackId: randomUUID(), version: 1, masterAssetId: sourceId, previewAssetId: previewId,
    status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION, mp3BitrateKbps: 320, previewStartMs: 0,
    previewDurationMs: 59_950, masterAsset: asset(sourceId, "audio/wav"), mp3Asset: asset(mp3Id, "audio/mpeg"), previewAsset: asset(previewId, "audio/mpeg", "PUBLIC", 59_950) };
  const selection: DigitalExcerptSelection = { revisionId: null, status: "TO_LISTEN", startMs: 0, previewDurationMs: 59_950, candidateUrl: null, errorCode: null };
  return { master, selection };
}

test("Express final confirmation may propose only the exact ready provisional excerpt at zero", () => {
  const f = fixture(), before = structuredClone(f);
  assert.equal(expressArtisticAtPublication(f.master, f.selection, { reviewStatus: "REVIEW_REQUIRED", assetRights: ["PENDING"] }), true);
  assert.deepEqual(f, before, "eligibility never writes an artistic approval or changes source proof");
});

test("Express never collapses a pending edited candidate, failed state or existing approval into final confirmation", () => {
  const f = fixture();
  for (const status of ["DRAFT", "QUEUED", "READY", "FAILED", "VALIDATED"] as const) {
    assert.equal(expressArtisticAtPublication(f.master, { ...f.selection, status }), false, status);
  }
  assert.equal(expressArtisticAtPublication(f.master, { ...f.selection, revisionId: randomUUID() }), false);
  assert.equal(expressArtisticAtPublication(f.master, null), false);
  assert.equal(expressArtisticAtPublication(null, f.selection), false);
});

test("Express keeps historical nonzero choices intact instead of approving a new interpretation", () => {
  const f = fixture();
  assert.equal(expressArtisticAtPublication({ ...f.master, previewStartMs: 7_848 }, { ...f.selection, startMs: 7_848 }), false);
  assert.equal(expressArtisticAtPublication(f.master, { ...f.selection, startMs: 7_848 }), false);
  assert.equal(expressArtisticAtPublication(f.master, { ...f.selection, previewDurationMs: 59_000 }), false);
});

test("Express requires exact preview asset identity, checksum and bounded measured duration", () => {
  const f = fixture();
  for (const patch of [{ previewAssetId: randomUUID() }, { previewAssetId: null },
    { previewAsset: { ...f.master.previewAsset!, checksumSha256: null } },
    { previewAsset: { ...f.master.previewAsset!, durationMs: 59_000 } },
    { previewAsset: { ...f.master.previewAsset!, visibility: "PRIVATE" } },
    { previewAsset: { ...f.master.previewAsset!, sizeBytes: 3n * 1024n * 1024n + 1n } },
    { previewDurationMs: 60_001 }, { previewDurationMs: 0 }]) {
    assert.equal(expressArtisticAtPublication({ ...f.master, ...patch }, f.selection), false);
  }
});

test("Express does not bypass rejected/revoked rights or restricted assets", () => {
  const f = fixture();
  for (const reviewStatus of ["REJECTED", "REVOKED"]) assert.equal(expressArtisticAtPublication(f.master, f.selection, { reviewStatus }), false);
  assert.equal(expressArtisticAtPublication(f.master, f.selection, { assetRights: ["PENDING", "RESTRICTED"] }), false);
  assert.equal(expressArtisticAtPublication(f.master, f.selection, { reviewStatus: "APPROVED", assetRights: ["CLEARED"] }), true);
});

test("Express final artistic option cannot make an unready or arbitrary MP3 source commercially ready", () => {
  const f = fixture();
  for (const patch of [{ status: "QUARANTINED" }, { codec: "mp3" }, { encoderVersion: "legacy" }, { mp3Asset: null },
    { masterAsset: { ...f.master.masterAsset, visibility: "PUBLIC" } }, { masterAsset: { ...f.master.masterAsset, checksumSha256: null } }]) {
    assert.equal(expressArtisticAtPublication({ ...f.master, ...patch }, f.selection), false);
  }
});
