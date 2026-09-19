import assert from "node:assert/strict";
import test from "node:test";

import { handlePublicCreationMediaRequest } from "../../lib/creations/public-media-route";

const knownId = "10000000-0000-4000-8000-000000000001";

test("invalid creation media UUIDs return 404 before any database lookup", async () => {
  for (const candidate of [
    "short",
    `${knownId}0`,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "00000000-0000-0000-0000-000000000000",
    "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz",
    "' OR 1=1 --",
  ]) {
    let calls = 0;
    const response = await handlePublicCreationMediaRequest(
      new Request(`https://www.lnxbeats.fr/media/creations/${encodeURIComponent(candidate)}`),
      candidate,
      false,
      { findPublishedAsset: async () => { calls += 1; return null; } },
    );
    assert.equal(response.status, 404);
    assert.equal(calls, 0);
  }
});

test("valid unknown UUID returns 404 after one lookup", async () => {
  let calls = 0;
  const response = await handlePublicCreationMediaRequest(
    new Request(`https://www.lnxbeats.fr/media/creations/${knownId}`),
    knownId,
    false,
    { findPublishedAsset: async () => { calls += 1; return null; } },
  );
  assert.equal(response.status, 404);
  assert.equal(calls, 1);
});

test("uppercase strict UUID is accepted by the existing parser", async () => {
  let received = "";
  const response = await handlePublicCreationMediaRequest(
    new Request(`https://www.lnxbeats.fr/media/creations/${knownId.toUpperCase()}`, { method: "HEAD" }),
    knownId.toUpperCase(),
    true,
    {
      findPublishedAsset: async (id) => {
        received = id;
        return null;
      },
    },
  );
  assert.equal(response.status, 404);
  assert.equal(received, knownId.toUpperCase());
});
