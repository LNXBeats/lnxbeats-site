import test from "node:test";
import assert from "node:assert/strict";
import { editorialLiveMessages } from "../../lib/i18n/messages-editorial-live";
import { brandSafeTranslation } from "../../lib/i18n/protected-content";
import { editorialLookupText, editorialSafeTranslation } from "../../lib/i18n/editorial-content";

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

test("editorial lookup handles CRLF and CR without changing identities or accepting unknown prose", () => {
  for (const [source, values] of Object.entries(editorialLiveMessages)) {
    for (const lineEnding of ["\r\n", "\r"]) {
      const stored = source.replace(/\n/g, lineEnding);
      const lookup = editorialLookupText(stored);
      assert.equal(lookup, source);
      for (const translated of values) {
        assert.equal(editorialSafeTranslation(lookup, brandSafeTranslation(lookup, translated), ["VIE DE CHIEN", "LNX Beats Studio"]), translated);
      }
      assert.equal(stored, source.replace(/\n/g, lineEnding), "input remains untouched");
    }
  }
  assert.equal(editorialLookupText("Un texte inconnu\r\nLNX Beats"), "Un texte inconnu\nLNX Beats");
  assert.equal(editorialLookupText("VIE DE CHIEN – J’AI DIT PROMENADE ?"), "VIE DE CHIEN – J’AI DIT PROMENADE ?");
  assert.notEqual(editorialLookupText("VIE DE CHIEN  part d'une idée simple"), "VIE DE CHIEN part d'une idée simple", "no fuzzy title/text matching");
});
