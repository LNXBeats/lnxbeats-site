import assert from "node:assert/strict";
import test from "node:test";

import {
  initialCreationMediaPlayerState,
  reduceCreationMediaPlayerState,
} from "../../lib/creations/media-player";
import {
  creationArtwork,
  creationAvailableMedia,
  creationPresentationMedia,
  creationVideoOrientation,
  resolvedCreationPrimaryMedia,
  type PublicCreation,
  type PublicCreationAsset,
} from "../../lib/creations/types";

const asset = (overrides: Partial<PublicCreationAsset> = {}): PublicCreationAsset => ({
  id: "00000000-0000-4000-8000-000000000001",
  url: "/media/creations/00000000-0000-4000-8000-000000000001",
  filename: "media.webp",
  mimeType: "image/webp",
  sizeBytes: 42,
  width: 1_920,
  height: 1_080,
  durationMs: null,
  alt: "Visuel de création",
  ...overrides,
});

const creation = (overrides: Partial<PublicCreation> = {}): PublicCreation => ({
  slug: "rencontre-a",
  title: "Rencontre A",
  summary: "Une création multimédia.",
  description: null,
  collaborator: null,
  credits: null,
  category: "Collaboration",
  primaryMedia: "cover",
  position: 0,
  publishedAt: "2026-09-13T12:00:00.000Z",
  seo: { title: "Rencontre A", description: "Une création multimédia." },
  cover: asset(),
  poster: asset({ id: "00000000-0000-4000-8000-000000000002" }),
  audio: null,
  video: null,
  links: [],
  ...overrides,
});

test("selection stays independent from the actively playing creation", () => {
  let state = initialCreationMediaPlayerState("rencontre-a", "audio");
  state = reduceCreationMediaPlayerState(state, { type: "play", slug: "rencontre-a", kind: "audio" });
  state = reduceCreationMediaPlayerState(state, {
    type: "select-creation",
    slug: "rencontre-b",
    primaryMedia: "video",
  });

  assert.equal(state.selectedCreationSlug, "rencontre-b");
  assert.equal(state.selectedMedia, "video");
  assert.deepEqual(state.activeMedia, { creationSlug: "rencontre-a", kind: "audio" });
});

test("changing the selected media never starts or replaces playback", () => {
  const playing = reduceCreationMediaPlayerState(
    initialCreationMediaPlayerState("rencontre-a", "cover"),
    { type: "play", slug: "rencontre-a", kind: "audio" },
  );
  const selected = reduceCreationMediaPlayerState(playing, { type: "select-media", media: "video" });

  assert.equal(selected.selectedMedia, "video");
  assert.deepEqual(selected.activeMedia, { creationSlug: "rencontre-a", kind: "audio" });
});

test("only the matching pause clears active media and a new play atomically replaces it", () => {
  const audio = reduceCreationMediaPlayerState(
    initialCreationMediaPlayerState("rencontre-a", "audio"),
    { type: "play", slug: "rencontre-a", kind: "audio" },
  );
  assert.strictEqual(
    reduceCreationMediaPlayerState(audio, { type: "pause", slug: "rencontre-b", kind: "audio" }),
    audio,
  );

  const video = reduceCreationMediaPlayerState(audio, { type: "play", slug: "rencontre-b", kind: "video" });
  assert.deepEqual(video.activeMedia, { creationSlug: "rencontre-b", kind: "video" });
  assert.equal(
    reduceCreationMediaPlayerState(video, { type: "pause", slug: "rencontre-b", kind: "video" }).activeMedia,
    null,
  );
});

test("cover is the catalogue artwork while the video poster remains its fallback", () => {
  const withBoth = creation();
  assert.equal(creationArtwork(withBoth)?.id, withBoth.cover?.id);

  const posterOnly = creation({ cover: null });
  assert.equal(creationArtwork(posterOnly)?.id, posterOnly.poster?.id);
});

test("available and primary media are derived without inventing sources", () => {
  const audio = asset({ mimeType: "audio/mpeg", width: null, height: null, durationMs: 60_000 });
  const video = asset({ mimeType: "video/mp4", durationMs: 90_000 });
  const withMedia = creation({ primaryMedia: "video", audio, video });
  assert.deepEqual(creationAvailableMedia(withMedia), ["audio", "video"]);
  assert.equal(resolvedCreationPrimaryMedia(withMedia), "video");
  assert.equal(resolvedCreationPrimaryMedia(creation({ primaryMedia: "video", video: null, audio })), "audio");
});

test("audio-only, video-only and combined creations expose exactly their real presentation modes", () => {
  const audio = asset({ mimeType: "audio/mpeg", width: null, height: null, durationMs: 60_000 });
  const video = asset({ mimeType: "video/mp4", durationMs: 90_000 });

  assert.deepEqual(
    creationPresentationMedia(creation({ cover: null, poster: null, audio, video: null })),
    ["audio"],
  );
  assert.deepEqual(
    creationPresentationMedia(creation({ cover: null, poster: null, audio: null, video })),
    ["video"],
  );
  assert.deepEqual(
    creationPresentationMedia(creation({ cover: null, poster: null, audio, video })),
    ["audio", "video"],
  );
  assert.deepEqual(creationPresentationMedia(creation({ audio, video })), ["cover", "audio", "video"]);
});

test("video dimensions map deterministically to 16:9, 9:16 and 1:1 presentation families", () => {
  assert.equal(creationVideoOrientation(asset({ width: 1_920, height: 1_080 })), "landscape");
  assert.equal(creationVideoOrientation(asset({ width: 1_080, height: 1_920 })), "portrait");
  assert.equal(creationVideoOrientation(asset({ width: 1_080, height: 1_080 })), "square");
  assert.equal(creationVideoOrientation(asset({ width: null, height: null })), "landscape");
  assert.equal(creationVideoOrientation(null), "landscape");
});
