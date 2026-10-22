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
const { DigitalExcerptReview } = await import("../../components/digital-excerpt-review");
const { CatalogAudioForm } = await import("../../components/catalog-audio-form");
const track = { masterId: "synthetic-master", trackId: "synthetic-track", title: "Titre synthétique", position: 1,
  durationMs: 120000, provisionalStartMs: 0, provisionalDurationMs: 59950, provisionalUrl: "/synthetic/preview.mp3",
  selection: { revisionId: null, status: "TO_LISTEN" as const, startMs: 0, previewDurationMs: 59950, candidateUrl: null, errorCode: null } };

test("New excerpt review offers listening from zero without a position or offset control", () => {
  const html = renderToStaticMarkup(<DigitalExcerptReview tracks={[track]} />);
  assert.match(html, /Écouter l’extrait depuis le début/);
  assert.match(html, /Début du morceau/);
  assert.doesNotMatch(html, /type="number"|Début souhaité|Utiliser cette position|Utiliser la position actuelle/);
  assert.match(html, /src="\/api\/admin\/digital\/masters\/synthetic-master"/);
});

test("Existing historical preview review displays its actual offset without silently replacing it", () => {
  const historical = { ...track, provisionalStartMs: 7848, selection: { ...track.selection, startMs: 7848 } };
  const html = renderToStaticMarkup(<DigitalExcerptReview tracks={[historical]} existingOnly />);
  assert.match(html, /00:07,848/); assert.match(html, /Ce fichier conservé ne sera ni remplacé ni régénéré/);
  assert.match(html, /src="\/synthetic\/preview.mp3"/);
  assert.doesNotMatch(html, /type="number"|Créer l’extrait candidat privé/);
});

test("The legacy catalogue form sends zero and no longer exposes start-selection controls", async () => {
  const noNavigation = () => { throw Error("Rendering must not navigate or submit"); };
  const html = renderToStaticMarkup(<AppRouterContext.Provider value={{ back: noNavigation, forward: noNavigation, refresh: noNavigation, push: noNavigation, replace: noNavigation, prefetch: noNavigation, bfcacheId: "zero-preview-render" }}><CatalogAudioForm projectId="synthetic" slug="synthetic" title="Titre" currentAudioAssetId={null} durationMs={null} updatedAt={null} /></AppRouterContext.Provider>);
  assert.match(html, /type="file"/);
  const source = await readFile(new URL("../../components/catalog-audio-form.tsx", import.meta.url), "utf8");
  assert.match(source, /body\.set\("offsetMs", "0"\)/);
  assert.doesNotMatch(source, /Début de l’extrait|setOffsetSeconds|Utiliser la position actuelle comme début/);
});
