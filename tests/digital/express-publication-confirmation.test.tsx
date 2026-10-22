import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExpressPublicationConfirmation } from "../../components/express-publication-confirmation";

const noMutation = () => { throw new Error("Rendering must not approve or publish anything"); };
const defaults = { blockers: [], coverMissing: false, premiereOnly: false, earlySale: false, pendingExcerpts: 3, missingRights: true, confirmed: false, busy: false, retrying: false, onConfirm: noMutation, onPublish: noMutation, className: "check" };
const render = (overrides: Partial<Parameters<typeof ExpressPublicationConfirmation>[0]> = {}) => renderToStaticMarkup(<ExpressPublicationConfirmation {...defaults} {...overrides} />);

test("One unchecked explicit final confirmation covers exact zero-second excerpts and the separate personal rights declaration", () => {
  const html = render();
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /J’ai écouté et vérifié les extraits/);
  assert.match(html, /commençant à 0 seconde et limités à 60 secondes/);
  assert.match(html, /Déclaration de droits liée à cette publication/);
  assert.match(html, /<button disabled=""/);
});
test("A missing cover is actionable, blocks publication and cannot be bypassed by an already checked state", () => {
  const html = render({ blockers: ["Ajoutez une pochette"], coverMissing: true, confirmed: true });
  assert.match(html, /href="#pochette-express"/);
  assert.match(html, /1 point à terminer/);
  assert.match(html, /type="checkbox"[^>]*disabled=""/);
  assert.match(html, /<button disabled=""/);
});
test("Previously recorded artistic and legal decisions are preserved instead of requesting new approvals", () => {
  const html = render({ pendingExcerpts: 0, missingRights: false, confirmed: true });
  assert.match(html, /validations d’extraits déjà enregistrées sont conservées/);
  assert.match(html, /déclarations de droits existantes sont conservées/);
  assert.doesNotMatch(html, /J’ai écouté et vérifié|Déclaration de droits liée/);
  assert.match(html, /<button>Confirmer la publication contrôlée/);
});
test("Member-only premiere and immediate early sale remain distinct choices, never inferred from a date", () => {
  const premiere = render({ premiereOnly: true });
  assert.match(premiere, /sans ouvrir de nouvelle vente/);
  assert.match(premiere, /Confirmer l’avant-première membres/);
  assert.doesNotMatch(premiere, /avec paiement et téléchargement immédiats/);
  const sale = render({ earlySale: true });
  assert.match(sale, /avec paiement et téléchargement immédiats/);
  assert.match(sale, /Confirmer la vente avant sortie/);
});
test("An ambiguous response retains a single exact publication attempt and blocks editing until its same-key retry", async () => {
  const html = render({ confirmed: true, retrying: true });
  assert.match(html, /type="checkbox"[^>]*disabled=""/);
  assert.match(html, /même identifiant/);
  assert.match(html, /<button>Reprendre la même publication/);
  const source = await readFile(new URL("../../components/music-express.tsx", import.meta.url), "utf8");
  assert.match(source, /const input = publicationAttempt \?\?/);
  assert.match(source, /setPublicationAttempt\(input\)/);
  assert.match(source, /if \(inFlight\.current \|\| publicationAttempt\) return null/);
  assert.match(source, /OWNER_EXCERPTS_AT_PUBLICATION_POLICY/);
  assert.match(source, /projectId=\{project\.id\} disabled=\{locked\} onSaved=\{refreshFiles\}/);
});
