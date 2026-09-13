import assert from "node:assert/strict";
import test from "node:test";

import { CREATION_MEDIA_DELETION_CONFIRMATION } from "../../lib/creations/media-contract";
import type { CreationMediaUpload } from "../../lib/creations/media-request";
import {
  handleCreationMediaDelete,
  handleCreationMediaUpload,
  type CreationMediaMutationDependencies,
} from "../../lib/creations/media-route-handler";
import { CreationMediaConflictError, CreationMediaError } from "../../lib/creations/media-service";

const baseUrl = "http://127.0.0.1:31750";
const creationId = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000001";

function mediaUpload(cleanup: () => Promise<void>): CreationMediaUpload {
  return {
    creationId,
    slug: "collaboration-qa",
    expectedLockVersion: "4",
    role: "VIDEO",
    expectedAssetId: null,
    rightsConfirmed: true,
    alt: null,
    path: "/private/tmp/media.mp4",
    originalFilename: "collaboration.mp4",
    mimeType: "video/mp4",
    extension: "mp4",
    sizeBytes: 128,
    width: 1920,
    height: 1080,
    durationMs: 12_000,
    checksumSha256: "a".repeat(64),
    cleanup,
  };
}

function request(method: string, body?: object, origin = baseUrl) {
  return new Request(`${baseUrl}/api/admin/creations/media`, {
    method,
    headers: {
      origin,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function deletion(overrides: Record<string, unknown> = {}) {
  return {
    creationId,
    slug: "collaboration-qa",
    role: "VIDEO",
    expectedLockVersion: 4,
    expectedAssetId: assetId,
    confirmation: CREATION_MEDIA_DELETION_CONFIRMATION,
    ...overrides,
  };
}

function harness(overrides: Partial<CreationMediaMutationDependencies> = {}) {
  let adminCalls = 0;
  let readCalls = 0;
  let replaceCalls = 0;
  let removeCalls = 0;
  let cleanupCalls = 0;
  const upload = mediaUpload(async () => { cleanupCalls += 1; });
  const dependencies: CreationMediaMutationDependencies = {
    baseUrl: () => baseUrl,
    sameOrigin: (incoming, expected) => incoming.headers.get("origin") === expected,
    admin: async () => {
      adminCalls += 1;
      return { user: { id: "30000000-0000-4000-8000-000000000001" } };
    },
    readUpload: async () => {
      readCalls += 1;
      return upload;
    },
    readJson: async (incoming) => {
      readCalls += 1;
      return incoming.json();
    },
    replace: async () => {
      replaceCalls += 1;
      return { assetId, slug: "collaboration-qa", lockVersion: 5 };
    },
    remove: async () => {
      removeCalls += 1;
      return { slug: "collaboration-qa", lockVersion: 5 };
    },
    ...overrides,
  };
  return {
    dependencies,
    counts: () => ({ adminCalls, readCalls, replaceCalls, removeCalls, cleanupCalls }),
  };
}

test("hostile origins and non-admin users are refused before body parsing", async () => {
  const hostile = harness();
  const response = await handleCreationMediaUpload(request("POST", undefined, "https://example.com"), hostile.dependencies);
  assert.equal(response.status, 403);
  assert.deepEqual(hostile.counts(), { adminCalls: 0, readCalls: 0, replaceCalls: 0, removeCalls: 0, cleanupCalls: 0 });

  const denied = harness({ admin: async () => { throw new Error("NEXT_REDIRECT:/compte?acces=refuse"); } });
  await assert.rejects(handleCreationMediaUpload(request("POST"), denied.dependencies), /NEXT_REDIRECT/);
  assert.equal(denied.counts().readCalls, 0);
});

test("successful upload returns only an Admin-local destination and always removes the temporary file", async () => {
  const current = harness();
  const response = await handleCreationMediaUpload(request("POST"), current.dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    state: "media-enregistre",
    currentAssetId: assetId,
    currentLockVersion: 5,
    location: `${baseUrl}/admin/creations/collaboration-qa?etat=media-enregistre`,
  });
  assert.deepEqual(current.counts(), { adminCalls: 1, readCalls: 1, replaceCalls: 1, removeCalls: 0, cleanupCalls: 1 });
});

test("temporary upload is also cleaned when activation reports an optimistic conflict", async () => {
  const current = harness({
    replace: async () => { throw new CreationMediaConflictError(assetId, 9); },
  });
  const response = await handleCreationMediaUpload(request("POST"), current.dependencies);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    state: "media-conflit",
    currentAssetId: assetId,
    currentLockVersion: 9,
  });
  assert.equal(current.counts().cleanupCalls, 1);
});

test("deletion accepts one closed role-bound payload and rejects extra fields or weak confirmations", async () => {
  const accepted = harness();
  const response = await handleCreationMediaDelete(request("DELETE", deletion()), accepted.dependencies);
  assert.equal(response.status, 200);
  assert.equal(accepted.counts().removeCalls, 1);

  for (const invalid of [
    deletion({ confirmation: "yes" }),
    deletion({ role: "STREAM" }),
    deletion({ storageKey: "creations/arbitrary" }),
    deletion({ expectedLockVersion: "4" }),
  ]) {
    const current = harness();
    const refused = await handleCreationMediaDelete(request("DELETE", invalid), current.dependencies);
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).state, "media-confirmation");
    assert.equal(current.counts().removeCalls, 0);
  }
});

test("published invariant failures are stable conflicts without storage or database details", async () => {
  const current = harness({
    remove: async () => { throw new CreationMediaError("PUBLISHED_INVARIANT"); },
  });
  const response = await handleCreationMediaDelete(request("DELETE", deletion()), current.dependencies);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { ok: false, state: "media-publication-bloquee" });
});
