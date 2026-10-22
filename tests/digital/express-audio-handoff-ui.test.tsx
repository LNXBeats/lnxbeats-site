import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

registerHooks({ load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", source: "export default new Proxy({}, { get: (_target, key) => String(key) });", shortCircuit: true };
  return next(url, context);
} });
const { DigitalBatchUpload } = await import("../../components/digital-admin");
const noNavigation = () => { throw Error("Local queue rendering must not navigate or submit"); };
const tracks = [{ id: "synthetic-track", title: "Titre", position: 1, publication: "ANNOUNCED", durationSeconds: null, version: 0, previewStartMs: 0, previewDurationMs: null, previewUrl: null, offer: null }];
const render = (files: File[], studio: boolean) => renderToStaticMarkup(<AppRouterContext.Provider value={{ back: noNavigation, forward: noNavigation, refresh: noNavigation, push: noNavigation, replace: noNavigation, prefetch: noNavigation, bfcacheId: "local-audio-selection-only" }}><DigitalBatchUpload tracks={tracks} initialFiles={files} studio={studio} compact /></AppRouterContext.Provider>);

test("Files selected before draft creation enter the existing queue with its resolved Studio mode, not an upload", () => {
  const file = new File(["synthetic only — no audio sent"], "Titre.wav", { type: "audio/wav", lastModified: 1 });
  const html = render([file], true);
  assert.match(html, /aria-label="Import Titre.wav"/); assert.match(html, /LNX Beats Studio/);
  assert.match(html, /Je confirme l’association proposée/); assert.match(html, /Envoyer \/ reprendre le lot associé/);
  assert.match(html, /Le dépôt seul ne transfère aucun fichier/); assert.match(html, /À associer/);
  assert.doesNotMatch(html, /Source privée reçue|data-state="busy"|data-state="ready"/);
});
test("A repeated local selection is queued once; plain mode does not silently opt in to Studio", () => {
  const file = new File(["synthetic only"], "Titre.mp3", { type: "audio/mpeg", lastModified: 2 });
  const html = render([file, file], false);
  assert.equal((html.match(/aria-label="Import Titre.mp3"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /LNX Beats Studio sera appliqué/); assert.match(html, /source compressée conservée/i);
});
test("Express hands local files over only after capability resolution, keeps save-before-import and never caches File objects", async () => {
  const source = await readFile(new URL("../../components/music-express.tsx", import.meta.url), "utf8");
  assert.match(source, /studioAvailabilityKnown \? <DigitalBatchUpload/);
  assert.match(source, /studio=\{studioEnabled && studioRequested\} preparedAssignments=\{preparedAssignments\} perTrackTargetPrefix="express-track-audio-" onInitialFilesAccepted=\{audioPrepared\}/);
  assert.match(source, /async function saveAndImport\(\) \{ const p = await save\(\); if \(p\) setAudioRequested\(true\); \}/);
  assert.doesNotMatch(source, /JSON\.stringify\([^\n]*preparedAudio/);
  assert.match(source, /tracks: tracks\.map\(\(\{ id, title, price, expectedOfferVersion \}\) => \(\{ id, title, price, expectedOfferVersion \}\)\)/);
});
test("An explicit per-title selection fixes the saved track ID without suggesting a filename or asking for another association", () => {
  const file = new File(["synthetic only"], "nom-sans-rapport.wav", { type: "audio/wav", lastModified: 3 });
  const html = renderToStaticMarkup(<AppRouterContext.Provider value={{ back: noNavigation, forward: noNavigation, refresh: noNavigation, push: noNavigation, replace: noNavigation, prefetch: noNavigation, bfcacheId: "bound-audio-only" }}><DigitalBatchUpload tracks={tracks} preparedAssignments={[{ file, trackId: tracks[0].id }]} studio compact /></AppRouterContext.Provider>);
  assert.match(html, /Rattaché directement à <strong>Titre<\/strong>/);
  assert.match(html, /Prêt à envoyer/); assert.match(html, /nom-sans-rapport.wav/);
  assert.doesNotMatch(html, /Associer ce fichier à une piste|Je confirme l’association proposée|data-state="busy"/);
});
