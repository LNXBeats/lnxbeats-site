import assert from "node:assert/strict";
import test from "node:test";

import { automaticPlatformLabel, platformLabelOverride, resolvePlatformLabel } from "@/lib/catalog/platform-label";

test("release labels are generated centrally for listening platforms", () => {
  assert.equal(automaticPlatformLabel("spotify", "release"), "Écouter sur Spotify");
  assert.equal(automaticPlatformLabel("appleMusic", "release"), "Écouter sur Apple Music");
  assert.equal(automaticPlatformLabel("deezer", "release"), "Écouter sur Deezer");
  assert.equal(automaticPlatformLabel("youtube", "release"), "Voir sur YouTube");
});

test("artist labels describe the profile instead of a release", () => {
  assert.equal(automaticPlatformLabel("spotify", "artist"), "LNX Beats sur Spotify");
  assert.equal(automaticPlatformLabel("appleMusic", "artist"), "LNX Beats sur Apple Music");
});

test("custom overrides survive while former automatic wording is normalized", () => {
  assert.equal(resolvePlatformLabel("Session officielle", "spotify", "release"), "Session officielle");
  assert.equal(platformLabelOverride("Session officielle", "spotify", "release"), "Session officielle");
  assert.equal(platformLabelOverride("Écouter le titre sur YouTube", "youtube", "release"), null);
  assert.equal(resolvePlatformLabel(null, "spotify", "release"), "Écouter sur Spotify");
  assert.equal(resolvePlatformLabel(null, "appleMusic", "release"), "Écouter sur Apple Music");
  assert.notEqual(resolvePlatformLabel(null, "spotify", "release"), resolvePlatformLabel(null, "appleMusic", "release"));
});
