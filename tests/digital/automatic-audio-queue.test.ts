import assert from "node:assert/strict";
import test from "node:test";
import { automaticAudioStarts } from "../../lib/digital/automatic-audio-queue";
const rows = [1,2,3].map(n => ({ id: `file-${n}`, trackId: `track-${n}`, valid: true, state: "waiting" }));
const entries = rows.map(({id, trackId}) => ({id, trackId}));
test("Explicit per-title files start automatically, at most two, without changing their binding", () => {
  assert.deepEqual(automaticAudioStarts(rows, entries, new Set(), 0), ["file-1", "file-2"]);
  assert.deepEqual(automaticAudioStarts(rows, entries, new Set(["file-1"]), 1), ["file-2"]);
  assert.deepEqual(automaticAudioStarts(rows, entries, new Set(), 2), []);
});
test("No guessed association, invalid replacement, automatic retry or duplicate dispatch", () => {
  assert.deepEqual(automaticAudioStarts(rows, [{id:"file-1"}], new Set(), 0), []);
  assert.deepEqual(automaticAudioStarts(rows.map(r=>({...r,valid:false})), entries, new Set(), 0), []);
  for (const state of ["error", "paused", "ready", "busy"]) assert.deepEqual(automaticAudioStarts(rows.map(r=>({...r,state})), entries, new Set(), 0), []);
  assert.deepEqual(automaticAudioStarts(rows, entries, new Set(rows.map(r=>r.id)), 0), []);
});
test("A running manual upload reserves a slot; only the next unattempted file starts", () => {
  assert.deepEqual(automaticAudioStarts([{...rows[0],state:"busy"},...rows.slice(1)],entries,new Set(["file-1"]),0),["file-2"]);
});
