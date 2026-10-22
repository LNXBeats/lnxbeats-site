import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EXPRESS_DEFAULTS } from "../../lib/digital/express-policy";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { memberMessages } from "../../lib/i18n/messages-members";

// Real React text rendering, not a browser/mobile or end-to-end upload claim.
registerHooks({ load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", source: "export default new Proxy({}, { get: (_target, key) => String(key) });", shortCircuit: true };
  return next(url, context);
} });
const { MusicExpress } = await import("../../components/music-express");
type Project = NonNullable<Parameters<typeof MusicExpress>[0]["initial"]>;
const noNavigation = () => { throw Error("SSR must not navigate, submit or prefetch"); };
const render = (initial: Project | null) => renderToStaticMarkup(<AppRouterContext.Provider value={{ back: noNavigation, forward: noNavigation, refresh: noNavigation, push: noNavigation, replace: noNavigation, prefetch: noNavigation, bfcacheId: "synthetic-ssr-only" }}><MusicExpress initial={initial} defaults={EXPRESS_DEFAULTS} mode="TEST" ownerId="synthetic-ui-only"/></AppRouterContext.Provider>);
test("A new ordinary single starts with one title, editable default price, date and an unchecked member-preview choice", () => {
  const html = render(null);
  assert.match(html, /Single · un titre/); assert.match(html, /Album · plusieurs titres/);
  assert.match(html, /Titre de la musique/); assert.doesNotMatch(html, />Titre de la piste</);
  assert.match(html, /value="1,29"/); assert.match(html, /type="date"/);
  assert.match(html, /Publication prévue sur les plateformes/); assert.match(html, /aucun envoi vers DistroKid/);
  assert.match(html, /Avant-première réservée aux membres/); assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /Créer le brouillon et importer mes musiques/);
  assert.match(html, /Audio de ce single/); assert.match(html, /type="file"[^>]*accept="\.wav/);
  assert.match(html, /Choisir un fichier — Audio de ce single/);
  assert.doesNotMatch(html, /Glissez votre fichier|Un fichier pour ce titre|Un titre = un fichier/);
  assert.doesNotMatch(html, /type="file"[^>]*multiple=/);
});
test("An existing album shows its exact date, ordered titles, independent prices and awaits server Studio capability before sending audio", () => {
  const tracks = ["Premier — 東京", "Deuxième"].map((title, index) => ({ id: `synthetic-${index}`, title, position: index + 1, durationMs: null,
    formats: "Aucun fichier", strictReady: false, masterId: null, previewUrl: null, review: null, artisticStatus: "TO_LISTEN", offer: { priceCents: index ? 249 : 129, version: 1, active: false } }));
  const initial = { id: "synthetic-album", slug: "synthetic-album", title: "Album — 東京", type: "ALBUM", releaseDate: "2030-01-02", membersPreviewEnabled: false,
    updatedAt: "2026-10-22T10:00:00.000Z", publicVisible: false, status: "DRAFT", tracks, credits: [], cover: null, albumOffer: { priceCents: 990, version: 1, active: false }, blockers: [], reviewToken: "a".repeat(64) } as unknown as Project;
  const html = render(initial);
  assert.match(html, /Nom de l’album/); assert.match(html, /Nombre de pistes/); assert.match(html, /value="2"/);
  assert.match(html, /value="Premier — 東京"/); assert.match(html, /value="Deuxième"/);
  assert.match(html, /value="1,29"/); assert.match(html, /value="2,49"/); assert.match(html, /value="9,90"/);
  assert.match(html, /type="date"[^>]*value="2030-01-02"/);
  assert.match(html, /Vérification de la préparation audio avant l’envoi des fichiers/); assert.match(html, /Aucun transfert n’est démarré/);
  assert.doesNotMatch(html, /Ajouter un ou plusieurs fichiers WAV/);
  assert.match(html, /Monter la piste 2/); assert.match(html, /Descendre la piste 1/);
  assert.match(html, /Enregistrer et continuer l’import/);
});
test("Admin shows only aggregate member opinions for its member-preview project, without turning votes into publication permission", () => {
  const initial = { id: "synthetic-premiere", slug: "synthetic-premiere", title: "Titre original — 東京", type: "SINGLE", releaseDate: "2030-01-02", membersPreviewEnabled: true,
    premiereVotes: { up: 9, down: 2 }, updatedAt: "2026-10-22T10:00:00.000Z", publicVisible: false, status: "DRAFT", tracks: [], credits: [], cover: null, albumOffer: null, blockers: [], reviewToken: "a".repeat(64) } as unknown as Project;
  const html = render(initial);
  assert.match(html, /Les avis des membres/); assert.match(html, /Plutôt oui : <strong>9<\/strong>/); assert.match(html, /Pas encore : <strong>2<\/strong>/);
  assert.match(html, /ne valide aucun droit et ne déclenche aucune publication ni mise en vente/);
  assert.doesNotMatch(render({ ...initial, membersPreviewEnabled: false }), /Les avis des membres/);
});
test("Published member premieres are not labelled public commercial offers, while private drafts and ordinary publications retain their actual state", () => {
  const project = { id: "synthetic-premiere-copy", slug: "synthetic-premiere-copy", title: "Titre original", type: "SINGLE", releaseDate: "2030-01-02", membersPreviewEnabled: true,
    premiereVotes: { up: 0, down: 0 }, updatedAt: "2026-10-22T10:00:00.000Z", publicVisible: true, status: "PUBLISHED", tracks: [], credits: [], cover: null, albumOffer: null, blockers: [], reviewToken: "a".repeat(64) } as unknown as Project;
  for (const type of ["SINGLE", "ALBUM"] as const) {
    const html = render({ ...project, type });
    assert.match(html, /Disponible aux membres/); assert.match(html, /Avant-première réservée aux membres · aucune offre activée/);
    assert.doesNotMatch(html, /Déjà public|Édition publiée\.|Single · une seule offre titre/);
  }
  const draft = render({ ...project, publicVisible: false, status: "DRAFT" });
  assert.match(draft, /Avant-première en brouillon privé/); assert.match(draft, /Aucun accès membre ni vente avant votre confirmation/); assert.doesNotMatch(draft, /Disponible aux membres/);
  const ordinary = render({ ...project, membersPreviewEnabled: false });
  assert.match(ordinary, /Déjà public/); assert.match(ordinary, /Édition publiée\./); assert.match(ordinary, /Single · une seule offre titre/);
  for (const label of ["Disponible aux membres", "Avant-première réservée aux membres · aucune offre activée", "Avant-première réservée aux membres · aucune offre activée. Les fichiers complets restent privés.", "Avant-première en brouillon privé. Aucun accès membre avant votre confirmation, aucune offre activée.", "Avant-première en brouillon"]) {
    assert.equal(memberMessages[label]?.length, 5, label); assert.ok(memberMessages[label].every(text => text.trim()), label);
  }
});
test("Member preview and early sale have separate explicit review actions, preserve actual offer prices and never imply deferred delivery", async () => {
  const project = { id: "synthetic-early-sale", slug: "synthetic-early-sale", title: "Album original", type: "ALBUM", releaseDate: "2030-01-02", membersPreviewEnabled: true,
    premiereVotes: { up: 0, down: 0 }, updatedAt: "2026-10-22T10:00:00.000Z", publicVisible: true, status: "PUBLISHED", tracks: [], credits: [], cover: null,
    albumOffer: { priceCents: 849, version: 3, active: true }, blockers: [], reviewToken: "a".repeat(64) } as unknown as Project;
  const html = render(project);
  assert.match(html, /Vérifier l’avant-première/); assert.match(html, /Vérifier la vente avant sortie/); assert.match(html, /value="8,49"/);
  assert.match(html, /Préachat · paiement et téléchargement immédiats/); assert.match(html, /Cette option seule n’active aucune offre/);
  assert.doesNotMatch(html, /Avant-première réservée aux membres · aucune offre activée|livraison différée|paiement différé/);
  assert.doesNotMatch(render({ ...project, membersPreviewEnabled: false }), /Vérifier la vente avant sortie/);
  const source = await readFile(new URL("../../components/music-express.tsx", import.meta.url), "utf8");
  assert.match(source, /async function review\(mode: "PREMIERE" \| "SALE"\)/); assert.match(source, /setPublishMode\(mode\); setReviewing\(true\); setConfirmed\(false\)/);
  assert.match(source, /onClick=\{\(\) => void review\("SALE"\)\}/); assert.match(source, /confirmed, publishMode, rightsDeclaration/);
  assert.match(source, /<ExpressPublicationConfirmation blockers=\{project\.blockers\}/);
  const confirmation = await readFile(new URL("../../components/express-publication-confirmation.tsx", import.meta.url), "utf8");
  assert.match(confirmation, /Je confirme la vente avant sortie, aux prix affichés, avec paiement et téléchargement immédiats/);
  assert.match(confirmation, /disabled=\{busy \|\| !confirmed \|\| !!blockers\.length\}/);
  for (const label of ["Préachat · paiement et téléchargement immédiats", "Vérifier l’avant-première", "Vérifier la vente avant sortie", "Confirmer la vente avant sortie"]) assert.equal(memberMessages[label]?.length, 5, label);
});
