import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { downloadCreationVideoToTemporary } from "@/lib/creations/direct-upload-worker";
import type { MediaStorage } from "@/lib/media/storage/types";

const bytes = new TextEncoder().encode("synthetic-private-video");
const session = {
  id: "40000000-0000-4000-8000-000000000001",
  creationId: "10000000-0000-4000-8000-000000000001",
  provider: "r2",
  quarantineKey: "creations/quarantine/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/video.mp4",
  declaredSizeBytes: BigInt(bytes.length),
};

function fakeStorage(body: Uint8Array, declaredLength = bytes.length): MediaStorage {
  const metadata = {
    contentLength: declaredLength, contentType: "video/mp4", etag: "etag", checksumSha256: null, lastModified: new Date(),
    customMetadata: { "lnx-session-id": session.id, "lnx-creation-id": session.creationId, "lnx-declared-size": String(bytes.length) },
  };
  return {
    backend: "OBJECT", provider: "r2",
    put: async () => { throw new Error("unused"); },
    head: async () => metadata,
    get: async () => ({ ...metadata, body: new ReadableStream({ start(controller) { controller.enqueue(body); controller.close(); } }) }),
    delete: async () => undefined,
    createSignedUrl: async () => null,
  };
}

test("quarantine download is bounded, checks metadata and creates a private unpredictable file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-worker-test-"));
  try {
    const result = await downloadCreationVideoToTemporary(session as never, { storage: fakeStorage(bytes), temporaryRoot: root });
    assert.deepEqual(new Uint8Array(await readFile(result.target)), bytes);
    assert.match(path.basename(result.target), /^[0-9a-f-]{36}\.mp4$/);
    assert.equal((await stat(result.target)).mode & 0o777, 0o600);
    await rm(result.directory, { recursive: true, force: true });
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("short, oversized and metadata-mismatched quarantine objects leave no temp residue", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-worker-failure-"));
  try {
    await assert.rejects(downloadCreationVideoToTemporary(session as never, { storage: fakeStorage(bytes.subarray(0, bytes.length - 1)), temporaryRoot: root }));
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(downloadCreationVideoToTemporary(session as never, { storage: fakeStorage(new Uint8Array([...bytes, 1])), temporaryRoot: root }));
    assert.deepEqual(await readdir(root), []);
    const wrongProvider = { ...fakeStorage(bytes), provider: "other" };
    await assert.rejects(downloadCreationVideoToTemporary(session as never, { storage: wrongProvider, temporaryRoot: root }));
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("worker publication and cleanup remain lease/CAS guarded and replay-idempotent", async () => {
  const [worker, service, workerScript, video] = await Promise.all([
    readFile(new URL("../../lib/creations/direct-upload-worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/creations/media-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/creation-media-worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/creations/video.ts", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /if \(!\(await ownsLease\(session\)\)\) return/);
  assert.match(worker, /where: \{ id: session\.id, status: "VALIDATING", leaseToken: session\.leaseToken \}/);
  assert.match(worker, /if \(ready\.count !== 1\) return false;[\s\S]*deleteQuarantineAfterTerminalClaim/);
  assert.match(worker, /lastErrorCode: "QUARANTINE_CLEANUP_REQUIRED"/);
  assert.match(service, /activated\?\.assetId === assetId/);
  assert.match(service, /return \{ assetId, slug, lockVersion: activated\.creation\.lockVersion \}/);
  assert.match(worker, /activationLease: \{ uploadSessionId: session\.id, leaseToken: session\.leaseToken \}/);
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /current\.leaseToken !== lease\.leaseToken/);
  assert.match(workerScript, /shutdown\.abort\(\)/);
  assert.match(workerScript, /signal: shutdown\.signal/);
  assert.match(video, /child\.kill\(graceful \? "SIGTERM" : "SIGKILL"\)/);
  assert.match(video, /child\.kill\("SIGKILL"\)/);
  assert.match(video, /stderr\.length < 128 \* 1024/);
});
