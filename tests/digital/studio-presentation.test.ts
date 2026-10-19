import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { studioApprovalAvailable, studioAuditionGains, studioAuditionTime, studioClientDownloadUrl, studioExistingSourceRequest, studioFormatLabel, studioJobPending, studioPhaseLabel, studioPrivateAudioUrl, studioReplacementConfirmed, studioRestoreRequest, type StudioArtifactView } from "../../lib/digital/studio-presentation";

const id = "d52ae43e-40b3-4af9-a875-96863cd76dc4", hash = "a".repeat(64);
const artifact = (role: StudioArtifactView["role"]): StudioArtifactView => ({ role, filename: "Célébrons l’été.wav", mimeType: "audio/wav", sizeBytes: 2000, durationMs: 1000, sampleRate: 48000, bitDepth: 24, bitrateKbps: null, integratedLufs: -18, truePeakDbtp: -2, audioUrl: `/api/admin/digital/studio/${id}/audio/${role}`, sha256: hash, metadataVerified: true });
test("Studio players accept only the authenticated exact-job audio route", () => {
  assert.equal(studioPrivateAudioUrl(artifact("WAV_24").audioUrl), `/api/admin/digital/studio/${id}/audio/WAV_24`);
  assert.equal(studioPrivateAudioUrl(artifact("AUDITION_WAV_24").audioUrl), `/api/admin/digital/studio/${id}/audio/AUDITION_WAV_24`);
  for (const value of [null, "//evil.test/audio", "https://evil.test/a.wav", "https://www.lnxbeats.fr/a.wav", "/api/admin/digital/studio/../audio/ORIGINAL", `/api/admin/digital/studio/${id}/audio/ORIGINAL?url=evil`, `/api/admin/digital/studio/${id}/audio/ORIGINAL\r\n`, `/api/admin/digital/studio/${id}/audio/ORIGINAL\\`]) assert.equal(studioPrivateAudioUrl(value), null);
});
test("Studio approval requires all exact output hashes and metadata checks, separately from rights", () => {
  const job = { status: "READY", binding: hash, approved: false, artifacts: [artifact("MP3"), artifact("WAV_CD"), artifact("WAV_24")] };
  assert.equal(studioApprovalAvailable(job), true);
  assert.equal(studioApprovalAvailable({ ...job, approved: true }), false);
  assert.equal(studioApprovalAvailable({ ...job, decision: "REJECTED" }), false);
  assert.equal(studioApprovalAvailable({ ...job, status: "VERIFYING" }), false);
  assert.equal(studioApprovalAvailable({ ...job, binding: "bad" }), false);
  assert.equal(studioApprovalAvailable({ ...job, artifacts: job.artifacts.slice(0, 2) }), false);
  assert.equal(studioApprovalAvailable({ ...job, artifacts: job.artifacts.map(a => a.role === "WAV_24" ? { ...a, metadataVerified: false } : a) }), false);
});
test("A/B loudness matching only attenuates measured audio; unavailable measurements are not invented", () => {
  assert.deepEqual(studioAuditionGains(-20, -20), { original: 1, final: 1 });
  const gains = studioAuditionGains(-20, -14)!; assert.equal(gains.original, 1); assert.ok(Math.abs(gains.final - 0.5011872336) < 0.0000001);
  const inverse = studioAuditionGains(-14, -20)!; assert.equal(inverse.final, 1); assert.equal(inverse.original, gains.final);
  for (const invalid of [null, Number.NaN, Number.POSITIVE_INFINITY, -121, 1]) assert.equal(studioAuditionGains(invalid, -14), null);
  assert.equal(studioAuditionTime(-1, 20), 0); assert.equal(studioAuditionTime(25, 20), 19.99); assert.equal(studioAuditionTime(5, Number.NaN), 0);
});
test("Studio labels never infer publication or 320 kbps from a preserved MP3", () => {
  assert.equal(studioFormatLabel({ role: "MP3", bitrateKbps: 180, sampleRate: 48000 }), "MP3 — 180 kbit/s réels");
  assert.match(studioFormatLabel(artifact("WAV_24")), /48 kHz natifs/);
  assert.match(studioFormatLabel(artifact("AUDITION_WAV_24")), /Écoute encodée privée/);
  assert.equal(studioJobPending("CONVERTING"), true); assert.equal(studioJobPending("PROCESSING"), true); assert.equal(studioJobPending("READY"), false); assert.equal(studioJobPending("FAILED"), false);
  assert.doesNotMatch(studioPhaseLabel("APPROVED"), /publié/i);
});
test("Studio client links stay same-origin, scoped to the acquired line/master and one authorized output role", () => {
  assert.equal(studioClientDownloadUrl(id, "WAV_24", id, id), `/api/digital/studio/${id}/WAV_24?lineId=${id}&masterId=${id}`);
  for (const role of ["ORIGINAL", "PREVIEW", "AUDITION_WAV_24", "https://evil.test", "../WAV_24"]) assert.equal(studioClientDownloadUrl(id, role, id, id), null);
  for (const bad of ["", "../other", `${id}?x=1`, "https://evil.test"]) {
    assert.equal(studioClientDownloadUrl(bad, "MP3", id, id), null); assert.equal(studioClientDownloadUrl(id, "MP3", bad, id), null); assert.equal(studioClientDownloadUrl(id, "MP3", id, bad), null);
  }
});
test("Existing acquisitions require explicit preservation confirmation while new tracks grant nothing silently", () => {
  assert.equal(studioReplacementConfirmed({ baseMasterId: null }, false, false), true);
  assert.equal(studioReplacementConfirmed({ baseMasterId: id, hasAcquisitions: false }, false, false), false);
  assert.equal(studioReplacementConfirmed({ baseMasterId: id, hasAcquisitions: false }, true, false), true);
  assert.equal(studioReplacementConfirmed({ baseMasterId: id, hasAcquisitions: true }, true, false), false);
  assert.equal(studioReplacementConfirmed({ baseMasterId: id, hasAcquisitions: true }, false, true), false);
  assert.equal(studioReplacementConfirmed({ baseMasterId: id, hasAcquisitions: true }, true, true), true);
});
test("Existing-source preparation sends only the exact server version/source/metadata binding after an explicit action", () => {
  const source = { masterId: id, trackId: id, expectedVersion: 2, sourceAssetId: id, sourceSha256: hash, expectedMetadataHash: hash, title: "Ça l’fait — 東京" };
  assert.deepEqual(studioExistingSourceRequest(source), { masterId: id, expectedVersion: 2, sourceAssetId: id, sourceSha256: hash, expectedMetadataHash: hash });
  assert.equal(studioExistingSourceRequest({ ...source, expectedVersion: 0 }), null);
  assert.equal(studioExistingSourceRequest({ ...source, sourceAssetId: "../other" }), null);
  assert.equal(studioExistingSourceRequest({ ...source, expectedMetadataHash: "old" }), null);
});
test("A return prepares only a new private candidate and binds the CURRENT version without copying listening consent", () => {
  const job = { id, status: "READY", binding: hash, approved: true, decision: "APPROVED", restoreAllowed: true,
    restoreCurrent: { masterId: id, version: 3, binding: "b".repeat(64), hasAcquisitions: true } };
  assert.equal(studioRestoreRequest(job, false, true), null);
  assert.equal(studioRestoreRequest(job, true, false), null);
  assert.deepEqual(studioRestoreRequest(job, true, true), { action: "restore", jobId: id, expectedBinding: hash, expectedCurrentBinding: "b".repeat(64), confirmReplacement: true, confirmExistingPurchases: true, humanListened: false });
  assert.equal(studioRestoreRequest({ ...job, approved: false }, true, true), null);
  assert.equal(studioRestoreRequest({ ...job, decision: "REJECTED" }, true, true), null);
  assert.equal(studioRestoreRequest({ ...job, restoreAllowed: false }, true, true), null);
  assert.equal(studioRestoreRequest({ ...job, restoreCurrent: null }, true, true), null);
  assert.equal(studioRestoreRequest({ ...job, restoreCurrent: { ...job.restoreCurrent, binding: "old" } }, true, true), null);
  assert.ok(studioRestoreRequest({ ...job, restoreCurrent: { ...job.restoreCurrent, hasAcquisitions: false } }, true, false));
});
test("Express Studio remains opt-in, private and human-decided without automatic rights or playback", async () => {
  const component = await readFile(new URL("../../components/studio-review.tsx", import.meta.url), "utf8");
  assert.match(component, /humanListened: listened/); assert.match(component, /expectedBinding: job.binding/);
  assert.match(component, /confirmExistingPurchases: purchases/); assert.match(component, /credentials: "same-origin"/);
  assert.match(component, /key=\{`\$\{job\.id\}:\$\{job\.binding\}:\$\{job\.restoreCurrent\?\.binding \?\? "no-current-binding"\}`\}/);
  assert.match(component, /document.visibilityState === "visible"/); assert.match(component, /5000/);
  assert.match(component, /Traitement terminé|studioPhaseLabel/); assert.match(component, /publication : décisions séparées/);
  assert.doesNotMatch(component, /autoPlay|rightsConfirmed:\s*true|active:\s*true|\/offers|\/checkout/);
  const upload = await readFile(new URL("../../components/digital-admin.tsx", import.meta.url), "utf8");
  assert.match(upload, /studio = false/); assert.match(upload, /!!saved.studio === !!entry.studio/);
  assert.match(upload, /entry.studio \? \{ studio: true as const \} : \{\}/);
  assert.match(upload, /onSession: s =>[\s\S]*if \(entry\.studio && studioQueuedSession\.current !== s\.sessionToken\) \{ studioQueuedSession\.current = s\.sessionToken; onStudioQueued\?\.\(\); \}/);
  const express = await readFile(new URL("../../components/music-express.tsx", import.meta.url), "utf8");
  assert.match(express, /onStudioQueued=\{\(\) => setStudioRevision\(old => old \+ 1\)\}/);
});
