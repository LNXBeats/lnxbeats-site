import assert from "node:assert/strict";
import test from "node:test";
import { mergeBoundAudioQueue, type BoundAudioQueueEntry } from "@/lib/digital/bound-audio-queue";

const file = (name: string, size = 42, lastModified = 1) => ({ name, size, lastModified, type: /\.mp3$/i.test(name) ? "audio/mpeg" : "audio/wav" });
type LocalFile = ReturnType<typeof file>;
const ids = () => { let allocated = 0; return { make: () => `new-${++allocated}`, count: () => allocated }; };

test("Back-to-back title drops merge into the current queue without doubling earlier rows", () => {
  const identity = ids(), a = file("Un.wav"), b = file("Deux.mp3");
  const first = mergeBoundAudioQueue([], [{ file: a, trackId: "a" }], ["a", "b"], true, identity.make);
  const second = mergeBoundAudioQueue(first.entries, [{ file: a, trackId: "a" }, { file: b, trackId: "b" }], ["a", "b"], true, identity.make);
  assert.equal(first.error, null); assert.equal(second.error, null); assert.equal(second.entries.length, 2);
  assert.equal(second.entries[0], first.entries[0]); assert.equal(second.entries[1].file, b); assert.equal(identity.count(), 2);
});

test("A repeated exact file/destination preserves the existing ID, object and captured processing mode", () => {
  const source = file("Titre.wav"), existing = { id: "old", file: source, trackId: "a", studio: true as const, state: "ready" };
  const entries = [existing], identity = ids();
  const result = mergeBoundAudioQueue(entries, [{ file: { ...source }, trackId: "a" }], ["a"], false, identity.make);
  assert.equal(result.error, null); assert.equal(result.entries, entries); assert.equal(result.entries[0], existing); assert.equal(identity.count(), 0);
});

test("Studio mode is captured only for newly queued rows, with older entries unchanged", () => {
  const old: BoundAudioQueueEntry<LocalFile> = { id: "old", file: file("Ancien.wav"), trackId: "a" }, identity = ids();
  const enabled = mergeBoundAudioQueue([old], [{ file: file("Nouveau.wav"), trackId: "b" }], ["a", "b", "c"], true, identity.make);
  assert.equal(enabled.entries[0], old); assert.equal("studio" in enabled.entries[0], false); assert.equal(enabled.entries[1].studio, true);
  const disabled = mergeBoundAudioQueue(enabled.entries, [{ file: file("Troisième.mp3"), trackId: "c" }], ["a", "b", "c"], false, identity.make);
  assert.equal(disabled.entries[1], enabled.entries[1]); assert.equal(disabled.entries[1].studio, true); assert.equal("studio" in disabled.entries[2], false);
});

test("Thirty explicit bindings retain one file per title, without name inference", () => {
  const incoming = Array.from({ length: 30 }, (_, index) => ({ file: file(`Nom indépendant ${index}.wav`), trackId: `track-${index}` })), identity = ids();
  const result = mergeBoundAudioQueue([], incoming, incoming.map(item => item.trackId), true, identity.make);
  assert.equal(result.error, null); assert.equal(result.entries.length, 30); assert.equal(identity.count(), 30);
  for (let index = 0; index < incoming.length; index++) {
    assert.equal(result.entries[index].file, incoming[index].file); assert.equal(result.entries[index].trackId, incoming[index].trackId);
  }
});

test("A removed, empty or unexpected destination rejects the complete merge before ID allocation", () => {
  const entries = [{ id: "old", file: file("Ancien.wav"), trackId: "a" }];
  for (const trackId of ["removed", ""]) {
    const identity = ids(), result = mergeBoundAudioQueue(entries, [{ file: file("Valide.mp3"), trackId: "b" }, { file: file("Erreur.wav"), trackId }], ["a", "b"], true, identity.make);
    assert.equal(result.entries, entries); assert.match(result.error!, /piste associée a changé/); assert.equal(identity.count(), 0);
  }
});

test("A different file cannot overwrite a destination already queued, regardless of its row state", () => {
  for (const state of ["waiting", "paused", "ready", "error", "uploading"]) {
    const entries = [{ id: "old", file: file("Ancien.wav"), trackId: "a", state }], identity = ids();
    const result = mergeBoundAudioQueue(entries, [{ file: file("Nouveau.mp3"), trackId: "a" }], ["a"], false, identity.make);
    assert.equal(result.entries, entries); assert.match(result.error!, /Retirez-le explicitement/); assert.equal(identity.count(), 0);
  }
});

test("A file already queued for another destination or without one cannot be silently reassigned", () => {
  const source = file("Original.wav");
  for (const old of [{ id: "old", file: source, trackId: "a" }, { id: "old", file: source }]) {
    const entries = [old], identity = ids(), result = mergeBoundAudioQueue(entries, [{ file: { ...source }, trackId: "b" }], ["a", "b"], true, identity.make);
    assert.equal(result.entries, entries); assert.match(result.error!, /autre piste ou sans association/); assert.equal(identity.count(), 0);
  }
});

test("Incoming duplicate file/destination is idempotent but one file targeting two rows is rejected atomically", () => {
  const source = file("Source.wav"), identity = ids();
  const valid = mergeBoundAudioQueue([], [{ file: source, trackId: "a" }, { file: { ...source }, trackId: "a" }], ["a"], true, identity.make);
  assert.equal(valid.error, null); assert.equal(valid.entries.length, 1); assert.equal(identity.count(), 1);
  const entries: BoundAudioQueueEntry<LocalFile>[] = [], rejectedIds = ids();
  const invalid = mergeBoundAudioQueue(entries, [{ file: source, trackId: "a" }, { file: { ...source }, trackId: "b" }], ["a", "b"], true, rejectedIds.make);
  assert.equal(invalid.entries, entries); assert.match(invalid.error!, /deux titres/); assert.equal(rejectedIds.count(), 0);
});

test("Two different incoming files cannot target the same title", () => {
  const entries: BoundAudioQueueEntry<LocalFile>[] = [], identity = ids();
  const result = mergeBoundAudioQueue(entries, [{ file: file("Un.wav"), trackId: "a" }, { file: file("Deux.mp3"), trackId: "a" }], ["a"], true, identity.make);
  assert.equal(result.entries, entries); assert.match(result.error!, /Deux fichiers différents/); assert.equal(identity.count(), 0);
});

test("The fifty-file queue bound includes existing unrelated entries and never allocates IDs on overflow", () => {
  const entries = Array.from({ length: 49 }, (_, index) => ({ id: `old-${index}`, file: file(`Original ${index}.wav`), trackId: `old-${index}` })), identity = ids();
  const incoming = [{ file: file("50.mp3"), trackId: "fifty" }];
  const valid = mergeBoundAudioQueue(entries, incoming, ["fifty"], true, identity.make);
  assert.equal(valid.error, null); assert.equal(valid.entries.length, 50); assert.equal(identity.count(), 1);
  const overflowIds = ids(), invalid = mergeBoundAudioQueue(valid.entries, [{ file: file("51.wav"), trackId: "overflow" }], ["overflow"], true, overflowIds.make);
  assert.equal(invalid.entries, valid.entries); assert.match(invalid.error!, /Limite de 50/); assert.equal(overflowIds.count(), 0);
});

test("Invalid extension, empty and oversized files leave all queued selections intact", () => {
  const entries = [{ id: "old", file: file("Conservé.wav"), trackId: "a" }];
  for (const candidate of [file("Invalide.exe"), file("Vide.wav", 0), file("Trop.wav", 512 * 1024 * 1024 + 1), file("Trop.mp3", 96 * 1024 * 1024)]) {
    const identity = ids(), result = mergeBoundAudioQueue(entries, [{ file: file("Valide.wav"), trackId: "b" }, { file: candidate, trackId: "c" }], ["a", "b", "c"], true, identity.make);
    assert.equal(result.entries, entries); assert.ok(result.error); assert.equal(identity.count(), 0);
  }
});

test("No incoming files means no allocation, transmission, metadata or mode change", () => {
  const source = file("Local.mp3"), entries = [{ id: "old", file: source, trackId: "a" }], identity = ids();
  Object.defineProperties(source, { arrayBuffer: { get() { throw Error("No file read"); } }, stream: { get() { throw Error("No transmission"); } } });
  const empty = mergeBoundAudioQueue(entries, [], ["a"], true, identity.make);
  assert.equal(empty.entries, entries); assert.equal(empty.error, null); assert.equal(identity.count(), 0);
  const repeated = mergeBoundAudioQueue(entries, [{ file: source, trackId: "a" }], ["a"], true, identity.make);
  assert.equal(repeated.entries, entries); assert.equal(repeated.error, null); assert.equal(identity.count(), 0);
});
