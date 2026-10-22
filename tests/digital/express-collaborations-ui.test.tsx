import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
registerHooks({ load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", source: "export default new Proxy({}, { get: (_target, key) => String(key) });", shortCircuit: true };
  return next(url, context);
} });
const { ExpressCollaborations } = await import("../../components/express-collaborations");
type Metadata = NonNullable<Parameters<typeof ExpressCollaborations>[0]["initialMetadata"]>;
const metadata: Metadata = { projectId: "synthetic-project", slug: "ma-collaboration", updatedAt: "2026-10-23T10:00:00.000Z", editable: true,
  tracks: [{ id: "synthetic-track", title: "Titre original — 東京" }],
  credits: [{ id: "owner-artist", trackId: null, name: "LNX Beats Studio", role: "ARTIST", editable: true }, { id: "guest-artist", trackId: null, name: "Artiste invité", role: "FEATURING", editable: true }, { id: "legal-credit", trackId: null, name: "Compositeur documenté", role: "COMPOSER", editable: false }],
  links: [{ id: "synthetic-link", platform: "SPOTIFY", scope: "RELEASE", label: "Écouter", url: "https://open.spotify.com/album/qa", editable: true }] };
const onSaved = () => { throw new Error("Rendering must never save or publish"); };
const render = (value: Metadata, disabled = false) => renderToStaticMarkup(<ExpressCollaborations projectId={value.projectId} initialMetadata={value} disabled={disabled} onSaved={onSaved} />);

test("collaboration artist and release links are editable while legal credits remain read-only", () => {
  const html = render(metadata);
  assert.match(html, /value="LNX Beats Studio"/); assert.match(html, /value="Artiste invité"/);
  assert.match(html, /value="FEATURING" selected=""/); assert.match(html, /Titre original — 東京/);
  assert.match(html, /Compositeur documenté · COMPOSER/); assert.doesNotMatch(html, /value="Compositeur documenté"/);
  assert.match(html, /https:\/\/open.spotify.com\/album\/qa/); assert.match(html, /Ajouter l’artiste/); assert.match(html, /Ajouter le lien/);
  assert.doesNotMatch(html, /Supprimer|Approuver|Publier|action=/);
});
test("public metadata stays read-only and points to existing Catalogue review, without add or delete controls", () => {
  const html = render({ ...metadata, editable: false });
  assert.match(html, /href="\/admin\/catalogue\/ma-collaboration"/); assert.match(html, /value="LNX Beats Studio"/);
  assert.doesNotMatch(html, /Ajouter l’artiste|Ajouter le lien/);
  const inputs = html.match(/<(?:input|select|button)\b[^>]*>/g) ?? [];
  assert.ok(inputs.length > 0); assert.ok(inputs.every(input => /disabled=""/.test(input)), inputs.join("\n"));
});
test("parent saving/publication lock disables every mutation control without removing entered metadata", () => {
  const html = render(metadata, true);
  assert.match(html, /value="Artiste invité"/);
  const inputs = html.match(/<(?:input|select|button)\b[^>]*>/g) ?? [];
  assert.ok(inputs.length > 0); assert.ok(inputs.every(input => /disabled=""/.test(input)), inputs.join("\n"));
});
