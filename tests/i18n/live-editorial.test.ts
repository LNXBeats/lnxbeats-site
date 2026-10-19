import test from "node:test";
import assert from "node:assert/strict";
import { editorialLiveMessages } from "../../lib/i18n/messages-editorial-live";
import { brandSafeTranslation } from "../../lib/i18n/protected-content";
import { editorialSafeTranslation } from "../../lib/i18n/editorial-content";

const occurrences = (text: string, literal: string) => text.split(literal).length - 1;

test("three exact public editorial fields of VIE DE CHIEN have five complete translations", () => {
  const entries = Object.entries(editorialLiveMessages);
  assert.equal(entries.length, 3);
  assert.ok(entries.some(([source]) => source === "Le quotidien raconté par ceux qui nous observent vraiment"));
  const long = entries.find(([source]) => source.startsWith("VIE DE CHIEN part d'une idée simple :"));
  assert.ok(long);
  assert.equal(long[0].split("\n\n").length, 6);
  for (const [source, values] of entries) {
    assert.equal(values.length, 5, source);
    for (const translated of values) {
      assert.ok(translated.trim());
      assert.notEqual(translated, source);
      for (const identity of ["VIE DE CHIEN", "LNX Beats"]) {
        assert.equal(occurrences(translated, identity), occurrences(source, identity), identity);
      }
      assert.equal(brandSafeTranslation(source, translated), translated);
      assert.equal(editorialSafeTranslation(source, translated, ["VIE DE CHIEN"]), translated);
    }
  }
  for (const translated of long[1]) assert.equal(translated.split("\n\n").length, 6);
});
