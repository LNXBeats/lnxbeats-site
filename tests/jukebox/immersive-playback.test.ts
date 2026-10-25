import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { jukeboxPublicPreview } from "@/lib/catalog/jukebox-preview";

const id = "c14ea8c0-4e26-4e2e-b742-5343271fd1c2";
const preview = `/media/digital/previews/${id}`;
const legacy = { url: `/media/catalog/audio/${id}`, durationMs: 60_000 };
const album = { type: "album", audioPreview: legacy };

test("immersive preview projection selects the first exact server-approved public excerpt", () => {
  assert.deepEqual(jukeboxPublicPreview(album, { tracks: [
    { previewUrl: null, previewDurationMs: 60_000 },
    { previewUrl: preview, previewDurationMs: 59_500 },
    { previewUrl: `/media/digital/previews/${"a".repeat(8)}-4e26-4e2e-b742-5343271fd1c2`, previewDurationMs: 60_000 },
  ] }), { url: preview, durationMs: 59_500 });
});

test("immersive preview projection never revives legacy album or single audio when approval is absent", () => {
  for (const type of ["album", "single"]) {
    assert.equal(jukeboxPublicPreview({ ...album, type }, null), null);
    assert.equal(jukeboxPublicPreview({ ...album, type }, { tracks: [{ previewUrl: null, previewDurationMs: 60_000 }] }), null);
  }
});

test("immersive preview projection rejects masters, downloads, member routes and external URLs", () => {
  for (const url of [
    "https://cdn.example.invalid/full.mp3", `/media/digital/masters/${id}`,
    `/api/digital/downloads/${id}`, `/media/members/previews/${id}`,
    `/media/digital/previews/${id}?private=1`, `//other.invalid/media/digital/previews/${id}`,
    `/media/digital/previews/not-a-uuid`, legacy.url,
  ]) assert.equal(jukeboxPublicPreview(album, { tracks: [{ previewUrl: url, previewDurationMs: 60_000 }] }), null, url);
});

test("immersive preview projection does not substitute a full recording or unknown duration", () => {
  for (const duration of [null, 0, -1, 60_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(jukeboxPublicPreview(album, { tracks: [{ previewUrl: preview, previewDurationMs: duration }] }), null);
  }
});

test("legacy project presentations retain only the original gated public preview path", () => {
  assert.deepEqual(jukeboxPublicPreview({ type: "project", audioPreview: legacy }, null), legacy);
  assert.equal(jukeboxPublicPreview({ type: "project", audioPreview: { url: "/full.wav", durationMs: 60_000 } }, null), null);
});

test("immersive jukebox source contract keeps one audio element, explicit start and cancellable latest-request guards", async () => {
  const source = await readFile(new URL("../../components/home-jukebox.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/<audio\b/g) ?? []).length, 1);
  assert.doesNotMatch(source, /\bautoPlay\b/);
  assert.match(source, /const continuousListeningRef = useRef\(false\)/);
  assert.match(source, /if \(disableContinuity\) \{[\s\S]*?continuousListeningRef\.current = false/);
  assert.match(source, /pauseCurrent\(true, false\);[\s\S]*?syncTrackMedia\(next\);[\s\S]*?if \(continueListening && nextProject\.audioPreview\) void attemptPlayback\(next\)/);
  assert.match(source, /const requestId = \+\+playRequestRef\.current/);
  assert.match(source, /requestId !== playRequestRef\.current \|\| loadedSlugRef\.current !== target\.slug/);
  assert.match(source, /if \(pendingPlayRef\.current\) \{[\s\S]*?pauseCurrent\(\)/);
  assert.match(source, /await audio\.play\(\);[\s\S]*?transitionPlayerState\(\{ type: "play", slug: target\.slug \}\)/);
  assert.match(source, /error\.name === "NotAllowedError" \? "blocked" : "unavailable"/);
  assert.match(source, /Votre navigateur demande une action/);
  assert.match(source, /listenForOtherMediaPlayback\(playerId/);
  assert.match(source, /audio\?\.pause\(\)/);
});

test("immersive discography uses only the already approved digital projection and keeps crawlable real links", async () => {
  const source = await readFile(new URL("../../app/discographie/page.tsx", import.meta.url), "utf8");
  assert.match(source, /audioPreview: jukeboxPublicPreview\(project, digitalViews\.get\(project\.slug\) \?\? null\)/);
  assert.match(source, /const digitalViews = new Map\(digitalProjects\.map/);
  assert.match(source, /<details className="discography-directory">/);
  assert.doesNotMatch(source, /masterAssetId|mp3AssetId|storageKey|createSignedUrl/);
});

test("immersive scene keeps a visible player and explicit horizontal swipe without intercepting links", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../../components/home-jukebox.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/immersive-public.css", import.meta.url), "utf8"),
  ]);
  assert.match(css, /\.discography-jukebox \.discography-jukebox__player-context \{ display: grid/);
  assert.match(source, /sceneSwipeRef = useRef/);
  assert.match(source, /closest\("a,button,input,select"\)/);
  assert.match(source, /onPointerCancel=\{\(\) => \{ sceneSwipeRef\.current = null/);
  assert.match(source, /Math\.abs\(dx\) >= 48 && Math\.abs\(dx\) > Math\.abs\(dy\) \* 1\.4/);
  assert.match(source, /selectVisible\(currentVisibleIndex \+ \(dx < 0 \? 1 : -1\)\)/);
});
