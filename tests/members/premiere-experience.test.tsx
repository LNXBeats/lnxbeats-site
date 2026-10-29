import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({ load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", source: "export default new Proxy({}, { get: (_target, key) => String(key) });", shortCircuit: true };
  // Native Node ESM does not apply Next's CJS default interop. Keep the real
  // Image implementation, unwrapping only its package-entry export here.
  if (url.endsWith("/next/image.js")) return { format: "module", source: "import imageModule from './dist/shared/lib/image-external.js'; export default imageModule.default;", shortCircuit: true };
  return next(url, context);
} });
const { PremiereExperience } = await import("../../components/premiere-experience");
type Props = React.ComponentProps<typeof PremiereExperience>;
const previewUrl = "/media/members-premieres/8a206874-5b8e-4bce-b2ea-433129983205";
const fixture = (member: boolean, suffix = "a"): Props["projects"][number] => ({
  id: `synthetic-project-${suffix}`, slug: `synthetic-release-${suffix}`, title: `Création originale ${suffix} — 東京`, type: "ALBUM",
  releaseDate: "2026-12-01", coverUrl: "/media/catalog/5bba7bc2-6b1e-4cf4-a47c-480738765a22", description: "Présentation publique originale.", trackCount: 1,
  digital: { membersPreviewOnly: true, memberPreviewAccess: member ? "available" : "sign-in",
    album: { id: `synthetic-offer-${suffix}`, priceCents: 990, version: 1, trackCount: 1, formats: ["WAV", "MP3"] },
    tracks: [{ id: `synthetic-track-${suffix}`, title: `Titre original ${suffix}`, position: 1, publication: "RELEASED", fullDurationMs: 189_000,
      previewUrl: member ? previewUrl : null, previewDurationMs: member ? 59_000 : null,
      offer: { id: `synthetic-track-offer-${suffix}`, priceCents: 129, version: 1, formats: ["WAV", "MP3"] } }],
  },
  ...(member ? { voteBinding: "a".repeat(64) } : {}),
});
const render = (access: Props["access"], projects: Props["projects"]) => renderToStaticMarkup(<PremiereExperience access={access} projects={projects} initialNow={Date.parse("2026-10-29T21:00:00Z")} mode="TEST" />);

test("premiere experience: guest sees public presentation, date, prices and member invitation without private audio or vote controls", () => {
  const html = render("guest", [fixture(false)]);
  assert.match(html, /Avant-premières/); assert.match(html, /Création originale a — 東京/);
  assert.match(html, /data-premiere-countdown="2026-12-01"/);
  assert.match(html, /Créer mon compte gratuit/); assert.match(html, /Se connecter/);
  assert.match(html, /9,90/); assert.match(html, /1,29/);
  assert.doesNotMatch(html, /<audio[^>]+src=|media\/members-premieres|aria-pressed|type="checkbox"/);
  assert.doesNotMatch(html, /Chargement de votre avis|Votre avis est enregistré|private-documentary-binding/);
  assert.match(html, /fichiers achetés sont complets/); assert.match(html, /Aucun abonnement automatique/);
});
test("premiere experience: verified member gets real excerpt player, gated vote form and optional unchecked preferences", () => {
  const html = render("member", [fixture(true)]);
  assert.match(html, new RegExp(`<audio[^>]*src="${previewUrl}"[^>]*preload="none"`));
  assert.match(html, /Chargement de votre avis/);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 2);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<input[^>]*\schecked(?:=|\s|>)/);
  assert.match(html, /Enregistrer mes choix/);
  assert.doesNotMatch(html, /Vos préférences ont été enregistrées|Votre avis est enregistré/);
  assert.match(html, /LNX Beats Studio/); assert.match(html, /class="[^"]*notranslate/);
});
test("premiere experience: unverified session gets a verification action, no vote or alert subscription form", () => {
  const html = render("verify-email", [fixture(false)]);
  assert.match(html, /href="\/renvoyer-verification"/); assert.match(html, /Vérifier mon e-mail/);
  assert.doesNotMatch(html, /aria-pressed|type="checkbox"|media\/members-premieres/);
});
test("premiere experience: empty catalogue is an honest empty state, without invented release, vote or countdown", () => {
  const html = render("guest", []);
  assert.match(html, /La prochaine écoute se prépare/); assert.match(html, /href="\/discographie"/);
  assert.doesNotMatch(html, /data-premiere-countdown|<audio|aria-pressed|Ajouter au panier/);
});
test("premiere experience: unavailable offers keep listening but never invent a purchase button", () => {
  const project = fixture(true);
  project.digital!.album = null; project.digital!.tracks[0].offer = null;
  const html = render("member", [project]);
  assert.match(html, /<audio/); assert.match(html, /Chargement de votre avis/);
  assert.doesNotMatch(html, /Ajouter au panier|Ajouter l’album au panier|Pas besoin d’attendre/);
});
test("premiere experience: multiple albums keep unique heading and accessibility target IDs", () => {
  const html = render("member", [fixture(true, "a"), fixture(true, "b")]);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Each section/player heading must have a unique ID");
  for (const [, id] of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert(ids.includes(id), `Missing label target ${id}`);
});
