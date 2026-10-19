import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyStudioRestoreArtifact, type StudioRestoreCopyDependencies } from "../../lib/digital/studio-restore";
import { MediaStorageError } from "../../lib/media/storage/types";

Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", NODE_ENV: "test", LNX_STUDIO_ENABLED: "true" });
const jobId = "2f2ca670-b2fe-4473-9609-6f76c118d06f", assetId = "b1fb874a-dfff-4bca-ac31-2a0edb64db4e";
const bytes = Buffer.from("synthetic-copy-integrity-only—not an audio decoding fixture"), checksum = createHash("sha256").update(bytes).digest("hex");
const original = { storageKey: "digital/studio/original/immutable.wav", storageBackend: "LOCAL" as const, storageProvider: "memory-fixture", visibility: "PRIVATE" as const,
  checksumSha256: checksum, sizeBytes: bytes.length, mimeType: "audio/wav" };
function memory(corruptSource = false, corruptReadback = false) {
  const objects = new Map([[original.storageKey, Buffer.from(bytes)]]);
  const deps: StudioRestoreCopyDependencies = { destination: { storageBackend: "LOCAL", storageProvider: "memory-fixture" }, get: async reference => {
    const content = Buffer.from(objects.get(reference.storageKey)!);
    if (corruptSource && reference.storageKey === original.storageKey || corruptReadback && reference.storageKey !== original.storageKey) content[0] ^= 1;
    return { body: new ReadableStream({ start(controller) { controller.enqueue(content); controller.close(); } }), contentLength: content.length,
      contentType: "audio/wav", etag: null, checksumSha256: checksum, lastModified: null };
  }, head: async reference => {
    if (!objects.has(reference.storageKey)) throw new MediaStorageError("NOT_FOUND");
    return { contentLength: objects.get(reference.storageKey)!.length, contentType: "audio/wav", etag: null, checksumSha256: checksum, lastModified: null };
  }, put: async input => { const chunks: Buffer[] = []; for await (const chunk of input.body) chunks.push(Buffer.from(chunk)); objects.set(input.key, Buffer.concat(chunks)); return { storageBackend: "LOCAL", storageProvider: "memory-fixture" }; } };
  return { objects, deps };
}
test("Restore copy uses a new private key and verifies both source and new stored bytes without changing the original", async () => {
  const fixture = memory();
  const result = await copyStudioRestoreArtifact({ source: original, jobId, assetId, role: "WAV_24", signal: new AbortController().signal }, fixture.deps);
  assert.notEqual(result.storageKey, original.storageKey); assert.equal(result.visibility, "PRIVATE"); assert.equal(result.sha256, checksum);
  assert.deepEqual(fixture.objects.get(original.storageKey), bytes); assert.deepEqual(fixture.objects.get(result.storageKey), bytes);
});
test("Restore refuses changed source bytes and never commits that copy as a valid object", async () => {
  const fixture = memory(true);
  await assert.rejects(copyStudioRestoreArtifact({ source: original, jobId, assetId, role: "WAV_24", signal: new AbortController().signal }, fixture.deps), { message: "STUDIO_RESTORE_INTEGRITY" });
  assert.equal(fixture.objects.size, 1); assert.deepEqual(fixture.objects.get(original.storageKey), bytes);
});
test("Restore verifies the actual new object instead of trusting provider checksum metadata", async () => {
  const fixture = memory(false, true);
  await assert.rejects(copyStudioRestoreArtifact({ source: original, jobId, assetId, role: "WAV_CD", signal: new AbortController().signal }, fixture.deps), { message: "STUDIO_RESTORE_INTEGRITY" });
  assert.deepEqual(fixture.objects.get(original.storageKey), bytes);
});
test("Restore cannot copy originals, overwrite its source, or start after cancellation", async () => {
  const fixture = memory(), controller = new AbortController(); controller.abort();
  await assert.rejects(copyStudioRestoreArtifact({ source: original, jobId, assetId, role: "WAV_CD", signal: controller.signal }, fixture.deps), { message: "WORKER_SHUTDOWN" });
  await assert.rejects(copyStudioRestoreArtifact({ source: original, jobId, assetId, role: "ORIGINAL", signal: new AbortController().signal }, fixture.deps), { message: "STUDIO_RESTORE_ASSET_INVALID" });
  const same = { ...original, storageKey: `digital/studio/${jobId}/${assetId}.wav` };
  await assert.rejects(copyStudioRestoreArtifact({ source: same, jobId, assetId, role: "WAV_24", signal: new AbortController().signal }, fixture.deps), { message: "STUDIO_RESTORE_OVERWRITE_REFUSED" });
  assert.equal(fixture.objects.size, 1);
  fixture.objects.set(same.storageKey, Buffer.from("an existing unrelated object must not be overwritten"));
  await assert.rejects(copyStudioRestoreArtifact({ source: original, jobId, assetId, role: "WAV_24", signal: new AbortController().signal }, fixture.deps), { message: "STUDIO_RESTORE_OVERWRITE_REFUSED" });
  assert.equal(fixture.objects.get(same.storageKey)!.toString(), "an existing unrelated object must not be overwritten");
});
test("Restore enforces the exact MIME of each rendition rather than trusting its role label", async () => {
  const fixture = memory();
  for (const role of ["MP3", "PREVIEW", "AUDITION_WAV_CD", "AUDITION_WAV_24"]) await assert.rejects(copyStudioRestoreArtifact({ source: original, jobId, assetId, role, signal: new AbortController().signal }, fixture.deps), { message: "STUDIO_RESTORE_ASSET_INVALID" });
  for (const role of ["WAV_CD", "WAV_24"]) await assert.rejects(copyStudioRestoreArtifact({ source: { ...original, mimeType: "audio/mpeg" }, jobId, assetId, role, signal: new AbortController().signal }, fixture.deps), { message: "STUDIO_RESTORE_ASSET_INVALID" });
  assert.equal(fixture.objects.size, 1);
});
