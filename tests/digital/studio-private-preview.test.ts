import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createPublicMediaSignedUrl, deleteMediaObject, getMediaObject, headMediaObject, putMediaObject } from "../../lib/media/storage";
import { assertMediaStorageKey, isPrivateStudioStorageKey, mediaScopeForReference } from "../../lib/media/storage/policy";
import { LocalMediaStorage } from "../../lib/media/storage/local";

const key = "digital/studio/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.mp3";
test("Studio namespace forces private physical scope even for a logically PUBLIC gated preview", () => {
  assert.equal(isPrivateStudioStorageKey(key), true);
  for (const visibility of ["PUBLIC", "PRIVATE"] as const) assert.equal(mediaScopeForReference({ storageKey: key, visibility }), "private");
  assert.equal(mediaScopeForReference({ storageKey: "catalog/audio-previews/22222222-2222-4222-8222-222222222222.mp3", visibility: "PUBLIC" }), "public");
  for (const unsafe of [key.replace(".mp3", ".mp4"), key.replace("/22222222", "/../22222222"), key.replace("digital/studio/", "digital/studio/%2e%2e/"), key.replace("11111111-1111-4111-8111-111111111111", "not-an-id")]) {
    assert.equal(isPrivateStudioStorageKey(unsafe), false);
    assert.throws(() => mediaScopeForReference({ storageKey: unsafe, visibility: "PUBLIC" }));
  }
  assert.throws(() => assertMediaStorageKey("public", key));
});
test("A Studio preview never obtains a public signed URL before application gates", () => {
  assert.throws(() => createPublicMediaSignedUrl({ storageKey: key, visibility: "PUBLIC", storageBackend: "LOCAL", storageProvider: "local" }, { expiresInSeconds: 60 }), /application authorization/);
});
test("get/head/delete use the private object for a logical PUBLIC Studio reference, leaving public storage empty", async () => {
  const root = await mkdtemp("/private/tmp/lnx-studio-scope-test-");
  const names = ["MEDIA_STORAGE_DRIVER", "MEDIA_DEPLOYMENT_ENV", "MEDIA_LOCAL_PUBLIC_ROOT", "MEDIA_LOCAL_PRIVATE_ROOT", "ORDER_UPLOAD_MODE", "RAILWAY_ENVIRONMENT"] as const;
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { MEDIA_STORAGE_DRIVER: "local", MEDIA_DEPLOYMENT_ENV: "test", MEDIA_LOCAL_PUBLIC_ROOT: path.join(root, "public"), MEDIA_LOCAL_PRIVATE_ROOT: path.join(root, "private") });
  delete process.env.ORDER_UPLOAD_MODE; delete process.env.RAILWAY_ENVIRONMENT;
  const reference = { storageKey: key, visibility: "PUBLIC" as const, storageBackend: "LOCAL" as const, storageProvider: "local" };
  try {
    await putMediaObject({ scope: "private", key, body: new Uint8Array([1, 2, 3, 4]), contentLength: 4, contentType: "audio/mpeg", checksumSha256: "a".repeat(64) });
    assert.equal((await headMediaObject(reference)).contentLength, 4);
    assert.deepEqual(new Uint8Array(await new Response((await getMediaObject(reference)).body).arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
    await assert.rejects(stat(path.join(root, "public", key)), { code: "ENOENT" });
    const storage = new LocalMediaStorage({ publicRoot: path.join(root, "public"), privateRoot: path.join(root, "private") });
    await assert.rejects(storage.head({ scope: "public", key }), { code: "INVALID_KEY" });
    await deleteMediaObject(reference);
    await assert.rejects(headMediaObject(reference), { code: "NOT_FOUND" });
  } finally {
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    await rm(root, { recursive: true, force: true });
  }
});
