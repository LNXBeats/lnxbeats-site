import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CREATION_AUDIO_MAXIMUM_BYTES,
  CREATION_IMAGE_MAXIMUM_BYTES,
  CREATION_VIDEO_MAXIMUM_BYTES,
  type CreationMediaRole,
} from "../../lib/creations/media-contract";
import { creationMediaStorageKey } from "../../lib/creations/media-service";
import { assertMediaStorageKey } from "../../lib/media/storage/policy";

const creationId = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000001";

test("server-generated Creation keys are isolated by creation, role and asset UUID", () => {
  const expected: Record<CreationMediaRole, string> = {
    COVER: `creations/${creationId}/cover/${assetId}.webp`,
    VIDEO_POSTER: `creations/${creationId}/poster/${assetId}.webp`,
    AUDIO: `creations/${creationId}/audio/${assetId}.mp3`,
    VIDEO: `creations/${creationId}/video/${assetId}.mp4`,
  };
  for (const role of Object.keys(expected) as CreationMediaRole[]) {
    const key = creationMediaStorageKey(creationId, role, assetId);
    assert.equal(key, expected[role]);
    assert.doesNotThrow(() => assertMediaStorageKey("public", key));
  }
});

test("Creation media limits stay centralized and bounded", () => {
  assert.equal(CREATION_IMAGE_MAXIMUM_BYTES, 10 * 1024 * 1024);
  assert.equal(CREATION_AUDIO_MAXIMUM_BYTES, 80 * 1024 * 1024);
  assert.equal(CREATION_VIDEO_MAXIMUM_BYTES, 500 * 1024 * 1024);
  assert.ok(CREATION_IMAGE_MAXIMUM_BYTES < CREATION_AUDIO_MAXIMUM_BYTES);
  assert.ok(CREATION_AUDIO_MAXIMUM_BYTES < CREATION_VIDEO_MAXIMUM_BYTES);
});

test("activation is versioned, locked and compensated without a second storage system", async () => {
  const [service, storage, route] = await Promise.all([
    readFile(new URL("../../lib/creations/media-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/creations/media-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/admin/creations/media/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /lockVersion: expectedLockVersion/);
  assert.match(service, /expectedAssetId/);
  assert.match(service, /removeOrphanedCandidate/);
  assert.match(service, /creations: \{ none: \{\} \}/);
  assert.match(service, /PUBLISHED_INVARIANT/);
  assert.match(storage, /putMediaObject/);
  assert.match(storage, /createReadStream/);
  assert.doesNotMatch(storage, /readFile|Buffer\.from/);
  assert.match(route, /requireAdmin/);
  assert.match(route, /revalidatePath\("\/sitemap\.xml"\)/);
});

test("draft previews require Admin while the public route is publication and MIME fail-closed", async () => {
  const [previewRoute, publicRoute] = await Promise.all([
    readFile(new URL("../../app/api/admin/creations/media/[assetId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/media/creations/[assetId]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(previewRoute, /await requireAdmin\(\)/);
  assert.match(previewRoute, /creationMediaResponse\(request, asset, head, true\)/);
  assert.match(publicRoute, /status: "PUBLISHED"/);
  assert.match(publicRoute, /publishedAt: \{ not: null \}/);
  assert.match(publicRoute, /rightsStatus: "CLEARED"/);
  assert.match(publicRoute, /type: "AUDIO"[\s\S]*?mimeType: "audio\/mpeg"[\s\S]*?role: "AUDIO"/);
  assert.match(publicRoute, /type: "VIDEO"[\s\S]*?mimeType: "video\/mp4"[\s\S]*?role: "VIDEO"/);
});
