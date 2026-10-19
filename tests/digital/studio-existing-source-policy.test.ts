import assert from "node:assert/strict";
import { test } from "node:test";
import { assertStudioExistingSource, studioExistingMetadataHash, studioExistingPreparationKey, studioExistingSourceInput, type StudioExistingSourceSnapshot } from "../../lib/digital/studio-existing-source-policy";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const snapshot: StudioExistingSourceSnapshot = { id: uuid(1), trackId: uuid(2), version: 3, status: "READY", previewStartMs: 1000,
  title: "Ça l’fait — 東京", album: "Été", metadata: { credits: [{ role: "COMPOSER", name: "Auteur documenté" }], date: "2026-10-19" },
  source: { id: uuid(3), visibility: "PRIVATE", checksumSha256: "a".repeat(64), mimeType: "audio/wav", sizeBytes: 4096n, filename: "Ça l’fait — 東京.wav" } };
const request = { masterId: snapshot.id, expectedVersion: snapshot.version, sourceAssetId: snapshot.source.id, sourceSha256: snapshot.source.checksumSha256!, expectedMetadataHash: studioExistingMetadataHash(snapshot) };
test("existing-source preparation is exact and idempotent, never guessed from title or duration", () => {
  const key = studioExistingPreparationKey(snapshot);
  assert.equal(key.length, 64); assert.equal(assertStudioExistingSource(snapshot, request), key);
  assert.deepEqual(studioExistingSourceInput({ sources: [request, request] }), [request]);
  for (const change of [{ sourceSha256: "b".repeat(64) }, { expectedVersion: 2 }, { masterId: uuid(4) }, { sourceAssetId: uuid(5) }, { expectedMetadataHash: "c".repeat(64) }])
    assert.throws(() => assertStudioExistingSource(snapshot, { ...request, ...change }), { code: "STUDIO_SOURCE_CHANGED" });
});
test("metadata and exact preview offset are pinned independently of commercial or artistic approval", () => {
  const key = studioExistingPreparationKey(snapshot);
  for (const changed of [{ ...snapshot, title: "Ça l’fait — 东京" }, { ...snapshot, previewStartMs: 0 }, { ...snapshot, metadata: { credits: [] } }, { ...snapshot, version: 4 }])
    assert.notEqual(studioExistingPreparationKey(changed), key);
});
test("only existing private, bounded READY sources are eligible, including honest MP3 origins", () => {
  const source = snapshot.source;
  assert.doesNotThrow(() => studioExistingPreparationKey({ ...snapshot, source: { ...source, filename: "Origin.mp3", mimeType: "audio/mpeg" } }));
  for (const changed of [{ ...snapshot, status: "QUARANTINED" }, { ...snapshot, source: { ...source, visibility: "PUBLIC" } },
    { ...snapshot, source: { ...source, checksumSha256: null } }, { ...snapshot, source: { ...source, sizeBytes: 600n * 1024n * 1024n } },
    { ...snapshot, source: { ...source, mimeType: "audio/mpeg" } }, { ...snapshot, previewStartMs: -1 }])
    assert.throws(() => studioExistingPreparationKey(changed), { code: "STUDIO_SOURCE_NOT_READY" });
});
test("source selection rejects implicit scope, unknown approval keys and contradictory duplicates", () => {
  for (const raw of [{ sources: [] }, { sources: [request], all: true }, { sources: [{ ...request, approveRights: true }] }, { sources: [{ ...request, expectedVersion: "3" }] },
    { sources: [request, { ...request, sourceSha256: "b".repeat(64) }] }, { sources: [{ ...request, sourceAssetId: "../../private" }] }]) assert.throws(() => studioExistingSourceInput(raw));
});
