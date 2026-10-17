import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expressDraft } from "../../lib/digital/express-policy";
import { expressEditorTracks, expressDurationLabel, hasDistinctSingleTitle, recoverExpressAttempt, digitalUploadPhaseLabel, expressBatchPercent } from "../../lib/digital/express-presentation";
const row = (title = "", price = "1,29") => ({ id: null, title, price, expectedOfferVersion: 0 });
const draft = () => ({ projectId: null, expectedUpdatedAt: null, title: "Mon inédit", type: "SINGLE" as const, tracks: expressEditorTracks("SINGLE", "Mon inédit", [row()], false), albumPriceCents: 990, expectedAlbumOfferVersion: 0, idempotencyKey: randomUUID() });
test("R2 single: one visible title becomes project and track, one price", () => {
  const v = expressDraft(draft()); assert.equal(v.title, v.tracks[0].title); assert.equal(v.tracks.length, 1); assert.equal(v.tracks[0].priceCents, 129);
});
test("R2 ordinary single follows a changed project title without a stale hidden title", () => {
  assert.equal(expressEditorTracks("SINGLE", "Nouveau nom", [row("Ancien nom")], false)[0].title, "Nouveau nom");
});
test("R2 explicitly distinct single title and existing track ID are preserved", () => {
  const r = { ...row("Autre titre publié", "2,49"), id: randomUUID(), expectedOfferVersion: 7 };
  assert.equal(hasDistinctSingleTitle("Édition", [r]), true);
  assert.deepEqual(expressEditorTracks("SINGLE", "Édition", [r], true)[0], { id: r.id, title: r.title, priceCents: 249, expectedOfferVersion: 7 });
  assert.equal(hasDistinctSingleTitle("Titre", [row("Titre")]), false); assert.equal(hasDistinctSingleTitle("Titre", [row()]), false);
});
test("R2 album: order, per-track prices and exact integer cents stay independent", () => {
  const v = expressDraft({ ...draft(), type: "ALBUM", tracks: expressEditorTracks("ALBUM", "Album", [row("Deux", "1,49"), row("Un", "0,99")], false) });
  assert.deepEqual(v.tracks.map(t => [t.title, t.priceCents]), [["Deux", 149], ["Un", 99]]); assert.equal(v.albumPriceCents, 990);
});
test("R2 incomplete title or price is rejected without supplying invented track names", () => {
  assert.throws(() => expressDraft({ ...draft(), tracks: expressEditorTracks("ALBUM", "Album", [row()], false) }));
  assert.throws(() => expressEditorTracks("SINGLE", "Titre", [row("", "1,299")], false));
});
test("R2 interrupted attempt retains the exact idempotency key, versions and IDs", () => {
  const original = draft(); const recovered = recoverExpressAttempt(JSON.parse(JSON.stringify(original)), null);
  assert.deepEqual(recovered, original); assert.equal(recovered!.idempotencyKey, original.idempotencyKey);
});
test("R2 cached attempt for another project cannot be resumed here", () => {
  const p = randomUUID(); const original = { ...draft(), projectId: p, expectedUpdatedAt: new Date().toISOString(), tracks: [{ ...draft().tracks[0], id: randomUUID() }] };
  assert.deepEqual(recoverExpressAttempt(original, p), original); assert.equal(recoverExpressAttempt(original, randomUUID()), null); assert.equal(recoverExpressAttempt(original, null), null);
});
test("R2 corrupted or privileged cached attempts do not restore publication or consent", () => {
  for (const v of [null, {}, "wrong", { ...draft(), confirmed: true }, { ...draft(), rightsConfirmed: true }, { ...draft(), active: true }, { ...draft(), idempotencyKey: "bad" }]) assert.equal(recoverExpressAttempt(v, null), null);
});
test("R2 duration reads as mm:ss and never mutates exact milliseconds", () => {
  assert.equal(expressDurationLabel(99640), "1:40"); assert.equal(expressDurationLabel(1800000), "30:00"); assert.equal(expressDurationLabel(null), "Durée à analyser"); assert.equal(expressDurationLabel(59950), "1:00");
});
test("R2 WAV phases refer to real WAV processing", () => {
  assert.equal(digitalUploadPhaseLabel("uploading", "Master.WAV"), "Envoi du WAV"); assert.equal(digitalUploadPhaseLabel("transcoding", "Master.wav"), "Création du MP3 et de l’extrait");
});
test("R2 MP3 phases never advertise a WAV master or a generated lossless source", () => {
  for (const phase of ["uploading", "analyzing", "transcoding"]) assert.doesNotMatch(digitalUploadPhaseLabel(phase, "Source.MP3"), /WAV/);
  assert.equal(digitalUploadPhaseLabel("transcoding", "Source.mp3"), "Préparation du brouillon MP3");
});
test("R2 batch has one bounded aggregate, including waiting files and ignoring removed rows", () => {
  assert.equal(expressBatchPercent({ a: { percent: 100 }, b: { percent: 50 } }, ["a", "b", "c"]), 50);
  assert.equal(expressBatchPercent({ a: { percent: 100 }, b: { percent: 50 } }, ["b"]), 50);
  assert.equal(expressBatchPercent({ a: { percent: 200 }, b: { percent: -5 } }, ["a", "b"]), 50);
  assert.equal(expressBatchPercent({}, []), 0);
  assert.equal(expressBatchPercent({ a: { percent: 100 } }, ["a"], {a:"busy"}), 95);
  assert.equal(expressBatchPercent({ a: { percent: 100 } }, ["a"], {a:"ready"}), 100);
});
