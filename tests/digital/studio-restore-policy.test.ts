import test from "node:test";
import assert from "node:assert/strict";
import { assertStudioRestoreRequest, studioRestoreAvailable, studioRestoreCurrentBinding, studioRestorePreparationKey, STUDIO_RESTORE_REQUIRED_ROLES, type StudioRestoreCurrent, type StudioRestoreSource } from "../../lib/digital/studio-restore-policy";

const source: StudioRestoreSource = { id: "source-job", trackId: "track", status: "READY", decision: "APPROVED", binding: "a".repeat(64), publishedMasterId: "old-master", sourceLossy: false,
  title: "Ça l’fait — 東京", album: "Été", metadata: { credits: [{ name: "Auteur réel", role: "COMPOSER", note: null }] } };
const current: StudioRestoreCurrent = { id: "current-master", trackId: "track", version: 3, masterAssetId: "current-asset", masterSha256: "b".repeat(64), title: source.title, album: source.album, metadata: source.metadata };
test("Restore permits only an older, approved lossless Studio version with exact current title/album/credits", () => {
  assert.equal(studioRestoreAvailable(source, current), true);
  for (const change of [{ decision: "PENDING" }, { decision: "REJECTED" }, { status: "FAILED" }, { sourceLossy: true }, { publishedMasterId: null }, { publishedMasterId: current.id }, { trackId: "other" }, { binding: "bad" }, { title: "Ça l’fait — 东京" }, { album: "Autre album" }, { metadata: { credits: [] } }]) assert.equal(studioRestoreAvailable({ ...source, ...change }, current), false);
  assert.equal(studioRestoreAvailable(source, null), false);
});
test("Restore binds the current immutable version and never treats a source-only approval as a catalogue decision", () => {
  const input = { expectedBinding: source.binding!, expectedCurrentBinding: studioRestoreCurrentBinding(current), confirmReplacement: true };
  const intent = assertStudioRestoreRequest(source, current, input);
  assert.equal(intent.currentMasterId, current.id); assert.equal(intent.currentVersion, 3);
  assert.throws(() => assertStudioRestoreRequest(source, current, { ...input, confirmReplacement: false }), { message: "STUDIO_REPLACEMENT_CONFIRMATION_REQUIRED" });
  for (const change of [{ id: "new-current" }, { version: 4 }, { masterAssetId: "new-asset" }, { masterSha256: "c".repeat(64) }]) assert.throws(() => assertStudioRestoreRequest(source, { ...current, ...change }, input), { message: "STUDIO_VERSION_CHANGED" });
  assert.throws(() => assertStudioRestoreRequest(source, current, { ...input, expectedBinding: "d".repeat(64) }), { message: "STUDIO_VERSION_CHANGED" });
  assert.throws(() => assertStudioRestoreRequest(source, current, { ...input, expectedCurrentBinding: undefined }), { message: "STUDIO_VERSION_CHANGED" });
});
test("One restore preparation identity exists per exact source job, source binding and current master", () => {
  const binding = studioRestoreCurrentBinding(current), key = studioRestorePreparationKey(source.id, source.binding!, binding);
  assert.equal(key.length, 64); assert.equal(studioRestorePreparationKey(source.id, source.binding!, binding), key);
  assert.notEqual(studioRestorePreparationKey("other-source-job", source.binding!, binding), key);
  assert.notEqual(studioRestorePreparationKey(source.id, "e".repeat(64), binding), key);
  assert.notEqual(studioRestorePreparationKey(source.id, source.binding!, studioRestoreCurrentBinding({ ...current, version: 4 })), key);
});
test("Restore includes all three actual outputs and original/preview without inventing a listening approval", () => {
  assert.deepEqual(STUDIO_RESTORE_REQUIRED_ROLES, ["ORIGINAL", "MP3", "WAV_CD", "WAV_24", "PREVIEW"]);
  const intent = assertStudioRestoreRequest(source, current, { expectedBinding: source.binding!, expectedCurrentBinding: studioRestoreCurrentBinding(current), confirmReplacement: true });
  assert.equal("humanListened" in intent, false); assert.equal("rightsApproved" in intent, false); assert.equal("offerActivated" in intent, false);
});
