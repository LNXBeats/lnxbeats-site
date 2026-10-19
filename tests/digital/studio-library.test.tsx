import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { registerHooks } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioCustomerFormat } from "../../lib/digital/studio-client";
import type { StudioArtifactView, StudioJobView } from "../../lib/digital/studio-presentation";

// Text-only SSR: this is not a physical Safari or responsive-browser proof.
registerHooks({ load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", source: "export default new Proxy({}, { get: (_target, key) => String(key) });", shortCircuit: true };
  return next(url, context);
} });
const { DigitalStudioFormats } = await import("../../components/digital-library");
const { StudioJob, StudioExistingSource } = await import("../../components/studio-review");
const id = "a42f0cd7-82df-4ea7-b8ac-d840f3dd6ace";
const render = (formats: StudioCustomerFormat[]) => renderToStaticMarkup(<DigitalStudioFormats formats={formats} lineId={id} masterId={id}/>);
test("Ma musique has no promised Studio formats without the server-approved choices", () => {
  assert.equal(render([]), "");
  assert.equal(render([{ jobId: "../private", role: "WAV_CD", label: "WAV CD", sourceLossy: false }]), "");
});
test("Ma musique offers three distinct private downloads, including both WAV choices, without another checkout", () => {
  const formats: StudioCustomerFormat[] = [{ jobId: id, role: "MP3", label: "MP3 — 180 kbit/s", sourceLossy: true }, { jobId: id, role: "WAV_CD", label: "WAV — Qualité CD · 16 bits / 44,1 kHz", sourceLossy: true }, { jobId: id, role: "WAV_24", label: "WAV — 24 bits / 48 kHz", sourceLossy: true }];
  const html = render(formats);
  assert.equal((html.match(/<a /g) ?? []).length, 3); assert.equal((html.match(/ download=""/g) ?? []).length, 3);
  for (const role of ["MP3", "WAV_CD", "WAV_24"]) assert.ok(html.includes(`/api/digital/studio/${id}/${role}?lineId=${id}&amp;masterId=${id}`));
  assert.match(html, /180 kbit\/s/); assert.doesNotMatch(html, /320 kbit\/s/);
  assert.match(html, /Qualité CD/); assert.match(html, /24 bits/); assert.match(html, /ne restaurent pas la qualité perdue/);
  assert.match(html, /Aucun nouvel achat nécessaire/); assert.doesNotMatch(html, /checkout|paypal|stripe|<button/i);
});
test("Existing acquired downloads, payment recovery and revoked-access guard remain unchanged", async () => {
  const source = await readFile(new URL("../../components/digital-library.tsx", import.meta.url), "utf8");
  const before = execFileSync("git", ["show", "HEAD:components/digital-library.tsx"], { encoding: "utf8" });
  function functions(text: string) {
    const ast = ts.createSourceFile("library.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), selected: Record<string, string> = {};
    for (const statement of ast.statements) if (ts.isFunctionDeclaration(statement) && statement.name && ["DigitalDownloadButton", "DigitalOrderActions"].includes(statement.name.text)) selected[statement.name.text] = statement.getText(ast);
    return selected;
  }
  assert.deepEqual(functions(source), functions(before));
  assert.match(source, /e\.status==="ACTIVE"\?<div className=\{styles\.actions\}/);
  assert.match(source, /DigitalStudioFormats formats=\{e\.studioFormats \?\? \[\]\}/);
  assert.match(source, /canDownload=o\.accessReady&&\["PAID","PARTIALLY_REFUNDED","REFUNDED","GRANTED"\]/);
});
test("Studio initial rendering has four private players, no automatic playback or consent, and protected titles", () => {
  const artifacts = (["ORIGINAL", "MP3", "WAV_CD", "WAV_24"] as const).map(role => ({ role, filename: "Écoute l’été !.wav", mimeType: role === "MP3" ? "audio/mpeg" : "audio/wav", sizeBytes: 2048, durationMs: 10000, sampleRate: 48000, bitDepth: role === "WAV_CD" ? 16 : 24, bitrateKbps: role === "MP3" ? 320 : null, integratedLufs: -17, truePeakDbtp: -1.4, audioUrl: `/api/admin/digital/studio/${id}/audio/${role}`, sha256: "a".repeat(64), metadataVerified: true } satisfies StudioArtifactView));
  const job: StudioJobView = { id, trackId: id, title: "Écoute l’été !", status: "READY", binding: "b".repeat(64), sourceLossy: false, baseMasterId: id, approved: false, hasAcquisitions: true, artifacts, report: { humanListening: "NOT_PERFORMED_BY_ALGORITHM" } };
  const html = renderToStaticMarkup(<StudioJob job={job} onChanged={async () => { throw Error("SSR must never mutate"); }}/>);
  assert.equal((html.match(/<audio /g) ?? []).length, 4); assert.equal((html.match(/preload="none"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /autoPlay|autoplay|https:\/\/.*\.wav/);
  const consents = [...html.matchAll(/<label class="confirm">([\s\S]*?)<\/label>/g)];
  assert.equal(consents.length, 3); for (const [, consent] of consents) assert.doesNotMatch(consent, /checked=""/);
  assert.match(html, /translate="no" class="notranslate">Écoute l’été !<\/h3>/);
  assert.match(html, /Confirmation nécessaire pour les achats existants/);
  const warning = "Ce nouveau master exige une nouvelle vérification de ses droits et de son extrait.";
  assert.ok(html.includes(warning)); assert.match(html, /les nouvelles ventes peuvent être suspendues jusqu’à ces validations/);
  assert.match(html, /Les achats déjà acquis et leurs fichiers restent conservés/);
  assert.ok(html.indexOf(warning) < html.indexOf("Je confirme explicitement la mise à disposition"));
  assert.match(html, /<button type="button" disabled="">Valider les fichiers<\/button>/);
  const approved = renderToStaticMarkup(<StudioJob job={{ ...job, approved: true }} onChanged={async () => { throw Error("SSR must never restore"); }}/>);
  assert.match(approved, /disabled="">Préparer le retour vers cette version/); assert.match(approved, /Préparation du retour indisponible/);
  const rejected = renderToStaticMarkup(<StudioJob job={{ ...job, decision: "REJECTED", attempt: 1 }} onChanged={async () => { throw Error("SSR must never approve rejected"); }}/>);
  assert.match(rejected, /Tentative 1/); assert.match(rejected, /Refusé — versions conservées/);
  assert.match(rejected, /Écoute administrateur : refusée/); assert.doesNotMatch(rejected, /en attente d’écoute|J’ai personnellement écouté/);
  assert.match(rejected, /disabled="">Valider les fichiers/); assert.match(rejected, /Retraiter l’original privé/);
  const next = renderToStaticMarkup(<StudioJob job={{ ...job, decision: "PENDING", attempt: 2 }} onChanged={async () => { throw Error("SSR must not mutate next attempt"); }}/>);
  assert.match(next, /Tentative 2/); assert.match(next, /en attente d’écoute/);
  const firstVersion = renderToStaticMarkup(<StudioJob job={{ ...job, baseMasterId: null, hasAcquisitions: false }} onChanged={async () => { throw Error("SSR must not publish new track"); }}/>);
  assert.ok(!firstVersion.includes(warning));
});
test("A historical approved version offers private preparation only, with fresh unchecked consent tied to current acquisitions", () => {
  const job: StudioJobView = { id, trackId: id, title: "Ça l’fait — 東京", status: "READY", binding: "a".repeat(64), sourceLossy: false, baseMasterId: null,
    approved: true, decision: "APPROVED", restoreAllowed: true, hasAcquisitions: false,
    restoreCurrent: { masterId: id, version: 4, binding: "b".repeat(64), hasAcquisitions: true }, artifacts: [], report: null };
  const html = renderToStaticMarkup(<StudioJob job={job} onChanged={async () => { throw Error("SSR cannot prepare or approve"); }}/>);
  assert.match(html, /nouvelle candidate privée, décision PENDING/); assert.match(html, /version 4/);
  assert.match(html, /Votre nouvelle écoute puis votre validation explicites seront nécessaires/);
  assert.match(html, /revue des droits et de son extrait avant les nouvelles ventes/);
  assert.match(html, /sans rétablir une approbation ni remplacer le master courant/);
  assert.match(html, /contrats déjà acquis de la version courante/);
  for (const [, consent] of html.matchAll(/<label class="confirm">([\s\S]*?)<\/label>/g)) assert.doesNotMatch(consent, /checked=""/);
  assert.doesNotMatch(html, /J’ai personnellement écouté|Je confirme explicitement la mise à disposition/);
  assert.match(html, /disabled="">Préparer le retour vers cette version/);
  const noAcquisitions = renderToStaticMarkup(<StudioJob job={{ ...job, hasAcquisitions: true, restoreCurrent: { ...job.restoreCurrent!, hasAcquisitions: false } }} onChanged={async () => { throw Error("SSR cannot mutate"); }}/>);
  assert.doesNotMatch(noAcquisitions, /contrats déjà acquis de la version courante/);
});
test("Preparing an existing private source starts only from its per-title button and does not approve or publish", () => {
  const html = renderToStaticMarkup(<StudioExistingSource source={{ masterId: id, trackId: id, expectedVersion: 3, sourceAssetId: id, sourceSha256: "a".repeat(64), expectedMetadataHash: "b".repeat(64), title: "Ça l’fait — 東京" }} onQueued={async () => { throw Error("SSR must not enqueue"); }}/>);
  assert.match(html, /Préparer les formats depuis le fichier actuel/); assert.match(html, /Fichier actuel · version 3/);
  assert.match(html, /sans remplacer les versions déjà acquises/); assert.doesNotMatch(html, /Valider les fichiers|Vérifier et publier|checked=""/);
  assert.match(html, /translate="no" class="notranslate">Ça l’fait — 東京/);
});
