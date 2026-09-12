import assert from "node:assert/strict";
import test from "node:test";
import {
  initialJukeboxPlayerState,
  jukeboxPlayerMetadataSlug,
  reduceJukeboxPlayerState,
  type JukeboxPlayerAction,
} from "../../lib/catalog/jukebox-player";

function transition(
  state: ReturnType<typeof initialJukeboxPlayerState>,
  action: JukeboxPlayerAction,
) {
  return reduceJukeboxPlayerState(state, action);
}

test("idle selection keeps player metadata synchronized with A, B and C", () => {
  let state = initialJukeboxPlayerState("a");
  assert.deepEqual(state, { selectedSlug: "a", playingSlug: null });
  assert.equal(jukeboxPlayerMetadataSlug(state), "a");

  state = transition(state, { type: "select", slug: "b" });
  assert.deepEqual(state, { selectedSlug: "b", playingSlug: null });
  assert.equal(jukeboxPlayerMetadataSlug(state), "b");

  state = transition(state, { type: "select", slug: "c" });
  assert.deepEqual(state, { selectedSlug: "c", playingSlug: null });
  assert.equal(jukeboxPlayerMetadataSlug(state), "c");
});

test("playing B remains explicit while C is selected, then pause resynchronizes metadata to C", () => {
  let state = initialJukeboxPlayerState("a");
  state = transition(state, { type: "select", slug: "b" });
  state = transition(state, { type: "play", slug: "b" });
  assert.deepEqual(state, { selectedSlug: "b", playingSlug: "b" });
  assert.equal(jukeboxPlayerMetadataSlug(state), "b");

  state = transition(state, { type: "select", slug: "c" });
  assert.deepEqual(state, { selectedSlug: "c", playingSlug: "b" });
  assert.equal(jukeboxPlayerMetadataSlug(state), "b");

  state = transition(state, { type: "pause", slug: "b" });
  assert.deepEqual(state, { selectedSlug: "c", playingSlug: null });
  assert.equal(jukeboxPlayerMetadataSlug(state), "c");

  state = transition(state, { type: "select", slug: "a" });
  state = transition(state, { type: "play", slug: "a" });
  assert.deepEqual(state, { selectedSlug: "a", playingSlug: "a" });
});

test("rapid A to B to C selection has no stale timer state", () => {
  let state = initialJukeboxPlayerState("a");
  state = transition(state, { type: "select", slug: "b" });
  state = transition(state, { type: "select", slug: "c" });
  assert.deepEqual(state, { selectedSlug: "c", playingSlug: null });
  assert.equal(jukeboxPlayerMetadataSlug(state), "c");
});

test("late media events cannot stop a newer playing project", () => {
  let state = initialJukeboxPlayerState("a");
  state = transition(state, { type: "play", slug: "a" });
  state = transition(state, { type: "play", slug: "b" });
  state = transition(state, { type: "pause", slug: "a" });
  assert.deepEqual(state, { selectedSlug: "a", playingSlug: "b" });
  assert.equal(jukeboxPlayerMetadataSlug(state), "b");

  state = transition(state, { type: "stop" });
  assert.deepEqual(state, { selectedSlug: "a", playingSlug: null });
});
