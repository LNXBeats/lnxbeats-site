import { test } from "node:test";
import assert from "node:assert/strict";
import { studioAcquisitionAllowed, studioAttachment, studioDownloadFilename, studioClientLabel, studioClientRole } from "../../lib/digital/studio-client-policy";
import { assertMediaStorageKey } from "../../lib/media/storage/policy";
import { digitalErrorMessage } from "../../lib/digital/error-presentation";

const exact = { acquiredMasterId: "new", acquiredSha256: "a".repeat(64), publishedMasterId: "new", baseMasterId: "old", sourceSha256: "a".repeat(64), sourceLossy: false, allowExistingPurchases: false, technicalReady: true, humanApproved: true, rightsCleared: true };
test("Studio approval is separate from rights and technical integrity", () => {
  assert.equal(studioAcquisitionAllowed(exact), true);
  for (const key of ["technicalReady", "humanApproved", "rightsCleared"] as const) assert.equal(studioAcquisitionAllowed({ ...exact, [key]: false }), false);
  assert.equal(studioAcquisitionAllowed({ ...exact, sourceLossy: true }), false);
  assert.equal(studioAcquisitionAllowed({ ...exact, publishedMasterId: null }), false);
});
test("historical acquisitions remain pinned unless exact-source additional formats explicitly authorized", () => {
  assert.equal(studioAcquisitionAllowed({ ...exact, acquiredMasterId: "old" }), false);
  assert.equal(studioAcquisitionAllowed({ ...exact, acquiredMasterId: "old", allowExistingPurchases: true }), true);
  assert.equal(studioAcquisitionAllowed({ ...exact, acquiredMasterId: "old", allowExistingPurchases: true, acquiredSha256: "b".repeat(64) }), false);
  assert.equal(studioAcquisitionAllowed({ ...exact, acquiredMasterId: "unrelated", allowExistingPurchases: true }), false);
});
test("download names preserve exact accents, Unicode, apostrophes and both WAV names", () => {
  for (const title of ["Célébrons la vie", "J'ai dit promenade", "Ça sentait très bien avant", "東京 – 海", "Cafe\u0301 !"]) {
    assert.equal(studioDownloadFilename(title, "WAV_CD"), `${title}.wav`);
    assert.equal(studioDownloadFilename(title, "WAV_24"), `${title}.wav`);
    const header = studioAttachment(title, "MP3");
    assert.equal(decodeURIComponent(header.split("filename*=UTF-8''")[1]), `${title}.mp3`);
  }
  for (const title of ["../master", "evil\r\nX: injected", "x".repeat(241), ""]) assert.throws(() => studioAttachment(title, "MP3"));
});
test("only actual client formats and bitrate are labelled", () => {
  assert.equal(studioClientRole("WAV_CD"), "WAV_CD");
  assert.throws(() => studioClientRole("ORIGINAL"));
  assert.throws(() => studioClientRole("PREVIEW"));
  assert.equal(studioClientLabel("MP3", 180, 48000), "MP3 — 180 kbit/s");
  assert.ok(!studioClientLabel("MP3", null, null).includes("320"));
  assert.equal(studioClientLabel("WAV_24", null, 48000), "WAV — 24 bits / 48 kHz");
});
test("Studio storage keys are opaque, strictly private and traversal-safe", () => {
  const key = "digital/studio/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.wav";
  assert.doesNotThrow(() => assertMediaStorageKey("private", key));
  for (const scope of ["public"] as const) assert.throws(() => assertMediaStorageKey(scope, key));
  for (const invalid of [key.replace(".wav", ".pdf"), key.replace(".wav", ".wav/../x"), key.replace(/0/g, "-"), key.replace("digital/studio/", "digital/studio/../")]) assert.throws(() => assertMediaStorageKey("private", invalid));
});
test("Studio errors never incorrectly request a payment review", () => {
  assert.match(digitalErrorMessage("STUDIO_HUMAN_LISTENING_REQUIRED"), /personnellement/);
  assert.match(digitalErrorMessage("STUDIO_LOSSY_COMMERCIAL_POLICY_REQUIRED"), /privées/);
  assert.match(digitalErrorMessage("STUDIO_RESTORE_REQUIRES_RELEASE_REVIEW"), /pas encore activé/);
  assert.ok(!digitalErrorMessage("STUDIO_UNKNOWN_REVIEW").includes("Ce paiement"));
});
