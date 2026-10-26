import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { digitalAdminExcerptLabel, digitalAdminMasterLabel, digitalAdminMasterState, digitalAdminMp3Label, digitalAdminReleaseLabels, digitalAdminSeconds } from "@/lib/digital/admin-presentation";
import { digitalSalesReadiness } from "@/lib/digital/admin";

test("single, album and project Admin labels distinguish the whole edition from individual titles without changing scopes", () => {
  const single = digitalAdminReleaseLabels("SINGLE"), album = digitalAdminReleaseLabels("ALBUM"), project = digitalAdminReleaseLabels("PROJECT");
  assert.equal(single.completeOffer, "Offre du single complet"); assert.equal(album.completeOffer, "Offre de l’album complet"); assert.equal(project.completeOffer, "Offre du projet complet");
  assert.doesNotMatch(JSON.stringify(single), /album/i);
  assert.match(single.offerExplanation, /offres distinctes/); assert.match(single.offerExplanation, /prix ne s’additionnent pas/);
  for (const labels of [single, album, project]) {
    assert.equal(labels.individualOffer, "Offre du titre à l’unité");
    assert.doesNotMatch(labels.completeAvailability, /TEST/); assert.match(labels.excludedTrack, /annoncée ou non listée/);
    assert.match(labels.formats, /WAV original et MP3 privé/); assert.match(labels.formats, /Deux ZIP séparés/); assert.match(labels.formats, /Aucun fichier complet/);
  }
});

test("audio labels retain exact version, private formats, bitrate and millisecond excerpt choice in plain French", () => {
  assert.equal(digitalAdminSeconds(12_345), "12,345 s"); assert.equal(digitalAdminSeconds(60_000), "60 s");
  assert.equal(digitalAdminMasterLabel(0), "WAV à importer"); assert.equal(digitalAdminMasterLabel(2), "Version audio 2 — WAV privé");
  assert.equal(digitalAdminMp3Label(true, 320), "MP3 privé : prêt (320 kbit/s)");
  assert.match(digitalAdminMp3Label(true, null), /débit à vérifier/); assert.match(digitalAdminMp3Label(false, null), /après l’import WAV/);
  assert.equal(digitalAdminExcerptLabel(12_345, 53_000), "Extrait : 53 s · Début : 12,345 s");
  assert.equal(digitalAdminExcerptLabel(0, null), "Extrait à préparer ou à vérifier");
  assert.equal(digitalAdminMasterState("READY"), "Validée"); assert.equal(digitalAdminMasterState("QUARANTINED"), "À vérifier"); assert.equal(digitalAdminMasterState("FAILED"), "Échec"); assert.equal(digitalAdminMasterState("unknown"), "État à vérifier");
});

test("clearer missing-media labels retain every fail-closed readiness requirement", () => {
  const result = digitalSalesReadiness({ status: "DRAFT", publicVisible: false }, [{ id: "track", title: "Title", publication: "ANNOUNCED", masterReady: false, previewDurationMs: null, mediaCleared: false, offer: null }], null);
  assert.equal(result.albumReady, false); assert.equal(result.items[0].ready, false); assert.equal(result.items[0].blockers.length, 6);
  assert.ok(result.items[0].blockers.includes("WAV/MP3 à valider pour la vente")); assert.ok(result.items[0].blockers.includes("Extrait à vérifier — 60 s maximum"));
  assert.ok(result.items[0].blockers.includes("Droits de cette version à confirmer")); assert.ok(result.items[0].blockers.includes("Prix, droits de vente ou disponibilité à compléter"));
});

test("Admin integrates context labels while preserving private preview, independent offer inputs and explicit rights checks", async () => {
  const page = await readFile(new URL("../../app/admin/musique/[slug]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /digitalAdminReleaseLabels\(p.type, tracks.some\(t => t.codec === "mp3"\), mode\)/); assert.match(page, /label=\{release.completeOffer\}/); assert.match(page, /label=\{release.individualOffer\}/);
  assert.doesNotMatch(page, /Offre album|Exclue de l’album vendu|prix de fixture/);
  assert.match(page, /id="edition-preview"/); assert.match(page, /\/api\/admin\/digital\/previews\//); assert.match(page, /Image unoptimized/);
  assert.match(page, /Droits de cette version pour la vente/); assert.match(page, /DigitalRightsReview/);
  const offer = await readFile(new URL("../../components/digital-admin.tsx", import.meta.url), "utf8");
  assert.match(offer, /Prix \(EUR\) — TEST/); assert.match(offer, /sans montant par défaut/); assert.match(offer, /Laissez le champ vide et l’offre inactive/);
  assert.match(offer, /priceCents: price.trim\(\) \? parseEuroCents\(price\) : null/); assert.match(offer, /rightsConfirmed: rights/);
  assert.match(offer, /contrôles serveur de publication, droits, extraits, contrat et disponibilité restent obligatoires/);
  const rights = await readFile(new URL("../../components/digital-rights-review.tsx", import.meta.url), "utf8");
  assert.match(rights, /Sélectionner les versions éligibles<\/button>/); assert.doesNotMatch(rights, /éligibles de cet album/);
  for (const requirement of ["composition/master/collaborateurs/interprètes/samples/reprises/extraits", "SHA‑256", "private-evidence:", 'required={status === "APPROVED"}']) assert.ok(rights.includes(requirement));
});

test("advanced Admin points exact existing versions to the single Express confirmation without approving anything on read", async () => {
  assert.equal(digitalAdminReleaseLabels("ALBUM", false, "LIVE").completeAvailability, "Album complet");
  assert.equal(digitalAdminReleaseLabels("ALBUM", false, "TEST").completeAvailability, "Album complet — TEST");
  const page = await readFile(new URL("../../app/admin/musique/[slug]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /id="finaliser-vente"/);
  assert.match(page, /\/admin\/musique\/express\?projet=\$\{p.id\}&verification=vente#verification/);
  assert.match(page, /Aucun réimport ni justificatif à ressaisir/);
  assert.match(page, /sans les attribuer automatiquement au nouveau fichier/);
  assert.match(page, /Les versions et contenus déjà acquis restent inchangés/);
  assert.doesNotMatch(page, /publishExpressProject|recordDigitalRightsReviews|\.update\(|\.create\(/);
});

test("rights review alone can shrink its grid, fieldset and long consent text without hiding information", async () => {
  const ui = await readFile(new URL("../../components/digital-rights-review.tsx", import.meta.url), "utf8"), css = await readFile(new URL("../../components/digital.module.css", import.meta.url), "utf8");
  assert.match(ui, /className=\{`\$\{styles.form\} \$\{styles.rightsReview\}`\}/);
  assert.match(css, /\.rightsReview\s*\{[^}]*grid-template-columns:minmax\(0,1fr\);[^}]*min-width:0;/);
  assert.match(css, /\.rightsReview fieldset\s*\{[^}]*min-inline-size:0;/);
  assert.match(css, /\.rightsReview legend\s*\{[^}]*max-inline-size:100%;[^}]*white-space:normal;[^}]*overflow-wrap:anywhere;/);
  assert.match(css, /\.rightsReview \.checkbox>span\s*\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere;/);
  const scopedRules = css.match(/\.rightsReview[^{}]*\{[^}]*\}/g) ?? [];
  assert.equal(scopedRules.length, 6);
  assert.doesNotMatch(scopedRules.join("\n"), /overflow(?:-x|-y)?:\s*(?:hidden|clip)|text-overflow:\s*ellipsis|display:\s*none/);
});
