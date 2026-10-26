import test from "node:test";
import assert from "node:assert/strict";
import { expressCachedSnapshotMatches, expressEditorLocked } from "../../lib/digital/express-presentation";

test("R3: server form and pre-recovery editor cannot accept input that cached state would overwrite", () => {
  for (const busy of [false, true]) for (const active of [false, true]) for (const uncertain of [false, true]) {
    assert.equal(expressEditorLocked(false, busy, active, uncertain), true);
  }
});
test("R3: recovered idle draft is editable without waiting for an extra action", () => {
  assert.equal(expressEditorLocked(true, false, false, false), false);
});
test("recovery guard preserves busy/uncertain locks without locking all other offers of a live album", () => {
  assert.equal(expressEditorLocked(true, true, false, false), true);
  assert.equal(expressEditorLocked(true, false, true, false), false);
  assert.equal(expressEditorLocked(true, false, false, true), true);
});
test("saved review ignores identical automatic cache but actual local edits still return to the editor", () => {
  const defaults = { trackPriceCents: 129, albumPriceCents: 990 };
  const saved = { title: "Album", type: "ALBUM", releaseDate: "2026-10-25", hasCollaborations: false,
    tracks: [{ id: "one", title: "Titre", offer: { priceCents: 249, version: 3 } }], albumOffer: { priceCents: 849 } };
  const cached = { title: "Album", type: "ALBUM", releaseDate: "2026-10-25", hasCollaborations: false, count: "1", albumPrice: "8,49", distinctSingleTitle: false,
    tracks: [{ id: "one", title: "Titre", price: "2,49", expectedOfferVersion: 3 }] };
  assert.equal(expressCachedSnapshotMatches(cached, saved, defaults), true);
  for (const patch of [{ title: "Edit" }, { type: "SINGLE" }, { releaseDate: "2026-10-26" }, { hasCollaborations: true }, { count: "2" }, { albumPrice: "9,90" },
    { tracks: [{ ...cached.tracks[0], price: "1,29" }] }, { tracks: [{ ...cached.tracks[0], expectedOfferVersion: 2 }] }, { distinctSingleTitle: true }]) {
    assert.equal(expressCachedSnapshotMatches({ ...cached, ...patch }, saved, defaults), false);
  }
  for (const malformed of [null, [], { tracks: [null] }, { ...cached, tracks: "invalid" }]) assert.equal(expressCachedSnapshotMatches(malformed, saved, defaults), false);
  assert.equal(expressCachedSnapshotMatches({ ...cached, confirmed: true, rightsDeclaration: "made-up" }, saved, defaults), true); // ignored, never restored
});
