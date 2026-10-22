import assert from "node:assert/strict";
import test from "node:test";
import { bindExpressTrackFiles, selectExpressTrackFile, type ExpressLocalAudioSelection } from "@/lib/digital/express-audio-selection";

const file = (name: string, size = 42, lastModified = 1) => ({ name, size, lastModified, type: /\.mp3$/i.test(name) ? "audio/mpeg" : "audio/wav" });
type LocalFile = ReturnType<typeof file>;

test("Thirty explicit title-row selections bind thirty original files to thirty saved IDs", () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({ key: `opaque-${index}`, id: null }));
  const saved = rows.map((_, index) => ({ id: `saved-${index}` }));
  const originals = rows.map((_, index) => file(`Fichier indépendant ${index}.wav`));
  let selected: ExpressLocalAudioSelection<LocalFile> = {};
  for (let index = 0; index < rows.length; index++) {
    const next = selectExpressTrackFile(selected, rows[index].key, [originals[index]]);
    assert.equal(next.error, null); selected = next.files;
  }
  const bound = bindExpressTrackFiles(selected, rows, saved);
  assert.equal(bound.length, 30);
  for (let index = 0; index < rows.length; index++) {
    assert.equal(bound[index].file, originals[index]); assert.equal(bound[index].trackId, saved[index].id);
  }
});

test("Reordering moves stable keys and selected files together, without filename matching", () => {
  const a = file("Ne ressemble pas au titre.mp3"), b = file("Autre.wav");
  const selected = { "stable-a": a, "stable-b": b };
  const rows = [{ key: "stable-b", id: "id-b" }, { key: "stable-a", id: "id-a" }];
  assert.deepEqual(bindExpressTrackFiles(selected, rows, [{ id: "id-b" }, { id: "id-a" }]), [
    { file: b, trackId: "id-b" }, { file: a, trackId: "id-a" },
  ]);
});

test("Renaming a title never changes its file association", () => {
  const source = file("Sans correspondance.wav"), selected = { "stable-a": source };
  const before = [{ key: "stable-a", id: "id-a", title: "Ancien titre" }];
  const after = [{ ...before[0], title: "Nouveau titre" }];
  assert.deepEqual(bindExpressTrackFiles(selected, before, [{ id: "id-a" }]), bindExpressTrackFiles(selected, after, [{ id: "id-a" }]));
});

test("Replacing the file on the same explicit row preserves all other row selections", () => {
  const original = file("Original.wav"), other = file("Autre.mp3"), replacement = file("Correction.MP3");
  const current = { a: original, b: other }, result = selectExpressTrackFile(current, "a", [replacement]);
  assert.equal(result.error, null); assert.equal(result.files.a, replacement); assert.equal(result.files.b, other);
  assert.equal(current.a, original);
});

test("Repeated drops on one row are harmless but do not assign the same multipart identity to another row", () => {
  const original = file("Source.wav"), current = { a: original };
  assert.equal(selectExpressTrackFile(current, "a", [{ ...original }]).error, null);
  const duplicate = selectExpressTrackFile(current, "b", [{ ...original }]);
  assert.equal(duplicate.files, current); assert.match(duplicate.error!, /déjà associé à un autre titre/);
});

test("A row rejects zero or multiple files, including duplicated drops, without altering any selection", () => {
  const original = file("Original.wav"), current = { a: original };
  for (const incoming of [[], [original, original], [file("Un.wav"), file("Deux.mp3")]]) {
    const result = selectExpressTrackFile(current, "a", incoming);
    assert.equal(result.files, current); assert.match(result.error!, /un seul fichier WAV ou MP3/);
  }
});

test("Invalid, empty or oversized incoming files preserve the entire previous selection", () => {
  const current = { a: file("Conservé.wav"), b: file("Autre.mp3") };
  for (const candidate of [file("Invalide.exe"), file("Vide.wav", 0), file("Fraction.wav", .5), file("Trop.wav", 512 * 1024 * 1024 + 1), file("Trop.mp3", 96 * 1024 * 1024)]) {
    const result = selectExpressTrackFile(current, "a", [candidate]);
    assert.equal(result.files, current); assert.ok(result.error);
  }
});

test("Different file metadata is not mistaken for a proven shared recording", () => {
  const original = file("Même nom.wav"), different = file("Même nom.wav", 43);
  const result = selectExpressTrackFile({ a: original }, "b", [different]);
  assert.equal(result.error, null); assert.equal(result.files.b, different);
});

test("All mapping mismatches fail before any files are returned for upload", () => {
  const files = { a: file("Source.wav") }, rows = [{ key: "a", id: "known-id" }], saved = [{ id: "known-id" }];
  const cases: Array<Parameters<typeof bindExpressTrackFiles<LocalFile>>> = [
    [files, rows, []],
    [files, rows, [{ id: "changed-id" }]],
    [files, [{ key: "a", id: null }, { key: "a", id: null }], [{ id: "one" }, { id: "two" }]],
    [files, [{ key: "a", id: null }, { key: "b", id: null }], [{ id: "same" }, { id: "same" }]],
    [files, [{ key: "a", id: null }], [{ id: "" }]],
    [{ ...files, removed: file("Orphelin.mp3") }, rows, saved],
    [{ a: files.a, b: { ...files.a } }, [{ key: "a", id: null }, { key: "b", id: null }], [{ id: "one" }, { id: "two" }]],
  ];
  for (const args of cases) assert.throws(() => bindExpressTrackFiles(...args), /^Error: AUDIO_TRACK_MAPPING_CHANGED$/);
});

test("Rows without a selected file are skipped and empty forms produce no implicit uploads", () => {
  const source = file("Titre choisi.mp3");
  assert.deepEqual(bindExpressTrackFiles({ b: source }, [{ key: "a", id: "one" }, { key: "b", id: "two" }], [{ id: "one" }, { id: "two" }]), [{ file: source, trackId: "two" }]);
  assert.deepEqual(bindExpressTrackFiles({}, [], []), []);
});

test("Opaque keys are never interpreted as titles, positions or object prototype mutations", () => {
  const source = file("Source.wav"), result = selectExpressTrackFile({}, "__proto__", [source]);
  assert.equal(result.error, null); assert.equal(Object.getPrototypeOf(result.files), Object.prototype);
  assert.equal(Object.hasOwn(result.files, "__proto__"), true);
  assert.deepEqual(bindExpressTrackFiles(result.files, [{ key: "__proto__", id: null }], [{ id: "saved-id" }]), [{ file: source, trackId: "saved-id" }]);
});

test("Selection and binding never read, encode, store or transmit file bytes", () => {
  const source = file("Local.wav");
  Object.defineProperties(source, { arrayBuffer: { get() { throw Error("No file read"); } }, stream: { get() { throw Error("No transmission"); } } });
  const selected = selectExpressTrackFile({}, "a", [source]);
  assert.equal(bindExpressTrackFiles(selected.files, [{ key: "a", id: null }], [{ id: "saved-id" }])[0].file, source);
});
