import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { artistBiography } from "../../data/artist";
import { projects } from "../../data/discography";
import { editorialMessages } from "../../lib/i18n/messages-editorial";
import { editorialIdentityParts, editorialLookupText, editorialSafeTranslation } from "../../lib/i18n/editorial-content";
import { messages, translate } from "../../lib/i18n/messages";

test("existing editorial source and complete biography have five non-empty translations", () => {
  for (const source of [artistBiography.short, ...artistBiography.principal, artistBiography.press,
    ...projects.flatMap(project => [project.subtitle, project.description, project.shortDescription].filter((text): text is string => Boolean(text)))]) {
    assert.ok(Object.hasOwn(editorialMessages, source), source);
    const values = editorialMessages[source];
    assert.equal(values.length, 5, source);
    for (const value of values) {
      assert.ok(value.length > 0, source);
      assert.equal(editorialSafeTranslation(source, value, projects.map(project => project.title)), value, source);
    }
  }
});

test("literal editorial protection handles original title punctuation and overlapping names", () => {
  const title = "Les comptines (version adulte) V2";
  const source = `LNX Beats Studio présente ${title} et J’ai adopté un humain.`;
  const parts = editorialIdentityParts(source, [title]);
  assert.deepEqual(parts.filter(part => part.original).map(part => part.text), ["LNX Beats Studio", title, "J’ai adopté un humain"]);
  assert.equal(parts.map(part => part.text).join(""), source);
  assert.equal(editorialSafeTranslation(source, `LNX Beats Studio presents ${title} and J’ai adopté un humain.`, [title]), `LNX Beats Studio presents ${title} and J’ai adopté un humain.`);
  assert.equal(editorialSafeTranslation(source, "LNX Rhythms presents Adult Nursery Rhymes.", [title]), source);
});

test("unknown live editorial content stays original French rather than gaining an invented translation", () => {
  const component = readFileSync(new URL("../../components/localized-editorial.tsx", import.meta.url), "utf8");
  assert.match(component, /source = editorialLookupText\(text\)/);
  assert.match(component, /Object\.hasOwn\(messages, source\)/);
  const unknown = editorialLookupText("Texte inédit du propriétaire\r\nLNX Beats Studio");
  assert.equal(Object.hasOwn(messages, unknown), false);
  assert.equal(translate("ja", unknown), unknown);
  assert.match(component, /: "fr"/);
  assert.match(component, /OriginalName/);
  assert.doesNotMatch(component, /data\/discography/);
  const album = readFileSync(new URL("../../app/album/[slug]/page.tsx", import.meta.url), "utf8");
  assert.match(album, /getPublicProjectBySlug/);
  assert.doesNotMatch(album, /from ["']@\/data\/discography/);
});
