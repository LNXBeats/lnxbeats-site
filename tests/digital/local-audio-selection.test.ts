import assert from "node:assert/strict";
import test from "node:test";
import { appendLocalAudioFiles } from "@/lib/digital/local-audio-selection";

const file = (name: string, size = 42, lastModified = 1) => ({ name, size, lastModified, type: /\.mp3$/i.test(name) ? "audio/mpeg" : "audio/wav" });
test("Local selection accepts complete WAV/MP3 filenames case-insensitively, retaining exact objects", () => {
  const a = file("Titre — 東京.WAV"), b = file("Deuxième.Mp3");
  const result = appendLocalAudioFiles([], [a, b]);
  assert.equal(result.error, null); assert.deepEqual(result.files, [a, b]); assert.equal(result.files[0], a);
});
test("Repeated browser selections collapse only the existing exact multipart identity", () => {
  const a = file("Titre.wav"), b = file("Titre.wav", 43), c = file("Titre.wav", 42, 2);
  const result = appendLocalAudioFiles([a], [{ ...a }, b, c, b]);
  assert.deepEqual(result.files, [a, b, c]); assert.equal(result.error, null);
});
test("An invalid incoming format rejects the whole new batch without losing the previous selection", () => {
  const current = [file("Conservé.wav")];
  for (const name of ["titre.wav.exe", "texte.txt", "audio", "audio.flac", "audio.mp3 "]) {
    const result = appendLocalAudioFiles(current, [file("Valide.mp3"), file(name)]);
    assert.equal(result.files, current); assert.match(result.error!, /uniquement des fichiers WAV ou MP3/);
  }
});
test("Empty, negative, fractional and unsafe file sizes are rejected atomically", () => {
  const current = [file("Conservé.mp3")];
  for (const size of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const result = appendLocalAudioFiles(current, [file("Invalide.wav", size)]);
    assert.equal(result.files, current); assert.match(result.error!, /taille est invalide/);
  }
});
test("Client limits match complete-source boundaries, without reading or converting bytes", () => {
  assert.equal(appendLocalAudioFiles([], [file("Limite.wav", 512 * 1024 * 1024)]).error, null);
  assert.equal(appendLocalAudioFiles([], [file("Limite.mp3", 96 * 1024 * 1024 - 1)]).error, null);
  for (const candidate of [file("Trop.wav", 512 * 1024 * 1024 + 1), file("Trop.mp3", 96 * 1024 * 1024)]) assert.match(appendLocalAudioFiles([], [candidate]).error!, /trop volumineux/);
});
test("Fifty unique local files are allowed, duplicates do not consume extra slots and overflow is atomic", () => {
  const current = Array.from({ length: 49 }, (_, index) => file(`${index}.wav`));
  const fiftieth = file("50.mp3"), result = appendLocalAudioFiles(current, [current[0], fiftieth]);
  assert.equal(result.error, null); assert.equal(result.files.length, 50);
  const overflow = appendLocalAudioFiles(result.files, [file("51.wav")]);
  assert.equal(overflow.files, result.files); assert.match(overflow.error!, /Limite de 50/);
});
test("No selected local file is persisted or uploaded by this pure helper", () => {
  const source = file("Local.wav");
  Object.defineProperties(source, { arrayBuffer: { get() { throw Error("File bytes must not be read"); } }, stream: { get() { throw Error("No transmission"); } } });
  assert.equal(appendLocalAudioFiles([], [source]).files[0], source);
});
