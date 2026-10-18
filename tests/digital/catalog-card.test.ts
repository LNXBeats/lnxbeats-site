import test from "node:test";
import assert from "node:assert/strict";
import { digitalCardOffer } from "../../lib/digital/catalog-card";
test("a single exposes its eligible track and exact price directly", () => {
  assert.deepEqual(digitalCardOffer("single", { album: null, tracks: [{ offer: { id: "single", priceCents: 129 } }] }), { id: "single", priceCents: 129, label: "Ajouter le single" });
});
test("an album retains its independent album offer", () => {
  assert.deepEqual(digitalCardOffer("album", { album: { id: "album", priceCents: 990 }, tracks: [] }), { id: "album", priceCents: 990, label: "Ajouter l’album" });
});
test("missing, ambiguous or inactive single offers never gain a purchase button", () => {
  assert.equal(digitalCardOffer("single", null), null);
  assert.equal(digitalCardOffer("single", { album: { id: "not-a-single", priceCents: 990 }, tracks: [{ offer: null }] }), null);
  assert.equal(digitalCardOffer("single", { album: null, tracks: [{ offer: { id: "a", priceCents: 129 } }, { offer: { id: "b", priceCents: 129 } }] }), null);
});
