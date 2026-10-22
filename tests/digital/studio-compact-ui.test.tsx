import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioArtifactRole, StudioArtifactView, StudioJobView } from "../../lib/digital/studio-presentation";

// Rendering proofs only: these tests do not claim browser playback or listening.
registerHooks({ load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", source: "export default new Proxy({}, { get: (_target, key) => String(key) });", shortCircuit: true };
  return next(url, context);
} });
const { StudioJob } = await import("../../components/studio-review");
const id = "34c3f87c-9d7e-4655-a155-8e689f0e2cdd";
const artifact = (role: StudioArtifactRole): StudioArtifactView => ({
  role, filename: `Titre.${role === "MP3" ? "mp3" : "wav"}`, mimeType: role === "MP3" ? "audio/mpeg" : "audio/wav",
  sizeBytes: 123456, durationMs: 125000, sampleRate: 44100, bitDepth: role === "MP3" ? null : 16,
  bitrateKbps: role === "MP3" ? 320 : null, integratedLufs: -16, truePeakDbtp: -1,
  audioUrl: `/api/admin/digital/studio/${id}/audio/${role}`, sha256: "a".repeat(64), metadataVerified: true,
});
const job: StudioJobView = {
  id, trackId: id, title: "Titre synthétique", status: "READY", phase: "READY", binding: "a".repeat(64),
  sourceLossy: false, baseMasterId: null, approved: false, decision: "PENDING",
  artifacts: (["MP3", "WAV_CD", "WAV_24"] as const).map(artifact), report: { synthetic: true },
};
const render = (value = job, compact = true) => renderToStaticMarkup(<StudioJob job={value} compact={compact} onChanged={async () => { throw Error("Rendering must not mutate or approve"); }} />);

test("Compact per-title review offers two complete private audio players with metadata preload", () => {
  const html = render();
  assert.equal((html.match(/<audio /g) ?? []).length, 2);
  assert.equal((html.match(/preload="metadata"/g) ?? []).length, 2);
  assert.match(html, /2:05 · fichier entier/);
  assert.match(html, new RegExp(`/api/admin/digital/studio/${id}/audio/MP3`));
  assert.match(html, new RegExp(`/api/admin/digital/studio/${id}/audio/WAV_CD`));
  assert.doesNotMatch(html, /\/audio\/WAV_24|\/audio\/PREVIEW|autoplay|autoPlay/);
  assert.match(html, /J’ai écouté — utiliser ces fichiers/);
  assert.doesNotMatch(html, /type="checkbox"|checked=""/);
});

test("A lossy source is honestly labelled and never described as an original WAV master", () => {
  const html = render({ ...job, sourceLossy: true });
  assert.match(html, /WAV converti/);
  assert.match(html, /le WAV est une conversion, pas un original sans perte/);
  assert.doesNotMatch(html, /WAV — Master 24 bits/);
});

test("Existing master and acquisition confirmations remain unchecked and block compact approval", () => {
  const html = render({ ...job, baseMasterId: id, hasAcquisitions: true });
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /conservant les versions et achats antérieurs/);
  assert.match(html, /conservation des fichiers déjà achetés/);
  assert.match(html, /<button type="button" disabled="">J’ai écouté — utiliser ces fichiers<\/button>/);
});

test("Failed processing keeps the original and offers only an explicit retry", () => {
  const html = render({ ...job, status: "FAILED", phase: "FAILED", errorCode: "INVALID_AUDIO", artifacts: [] });
  assert.match(html, /INVALID_AUDIO/);
  assert.match(html, /Votre fichier reste conservé/);
  assert.match(html, /Réessayer le traitement/);
  assert.equal((html.match(/<audio /g) ?? []).length, 0);
  assert.match(html, /<button type="button" disabled="">J’ai écouté — utiliser ces fichiers<\/button>/);
});

test("Compact players refuse forged external URLs and never substitute a public excerpt", () => {
  const html = render({ ...job, artifacts: job.artifacts.map(file => ({ ...file, audioUrl: "https://invalid.example/master.wav" })) });
  assert.equal((html.match(/<audio /g) ?? []).length, 0);
  assert.match(html, /Lecture privée indisponible/);
  assert.doesNotMatch(html, /https:\/\/invalid\.example/);
});

test("An approved compact version is not offered another approval action", () => {
  const html = render({ ...job, approved: true, decision: "APPROVED" });
  assert.match(html, /Fichiers prêts — écoute validée/);
  assert.doesNotMatch(html, /J’ai écouté — utiliser ces fichiers|type="checkbox"/);
});

test("Default Studio review retains its original deliberate listening workflow", () => {
  const html = render(job, false);
  assert.match(html, /J’ai personnellement écouté/);
  assert.match(html, /<button type="button" disabled="">Valider les fichiers<\/button>/);
  assert.doesNotMatch(html, /compactPlayers|J’ai écouté — utiliser ces fichiers/);
  assert.equal((html.match(/preload="none"/g) ?? []).length, 3);
});
