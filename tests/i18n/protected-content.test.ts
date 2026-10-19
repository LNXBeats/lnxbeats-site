import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OriginalName } from "@/components/original-name";
import { LANGUAGES } from "@/lib/i18n/config";
import { messages, translate } from "@/lib/i18n/messages";
import { brandSafeTranslation, brandSegments } from "@/lib/i18n/protected-content";

test("les trois graphies de marque restent littérales, sans segment partiel Studio", () => {
  const text = "Découvrir LNX Beats Studio, LNX Beats et LNX BEATS.";
  const segments = brandSegments(text);
  assert.equal(segments.map(part => part.text).join(""), text);
  assert.deepEqual(segments.filter(part => part.protected).map(part => part.text), ["LNX Beats Studio", "LNX Beats", "LNX BEATS"]);
});

test("une traduction qui renomme, supprime ou ajoute la marque est refusée", () => {
  assert.equal(brandSafeTranslation("Soutenir LNX Beats", "支持 LNX Beats"), "支持 LNX Beats");
  assert.equal(brandSafeTranslation("Soutenir LNX Beats", "支持 LNX 节拍"), "Soutenir LNX Beats");
  assert.equal(brandSafeTranslation("LNX Beats Studio", "LNX Beats"), "LNX Beats Studio");
  assert.equal(brandSafeTranslation("Contact", "Contact LNX Beats"), "Contact");
});

test("toutes les entrées traduites conservent les identités de marque exactes", () => {
  for (const [source, translations] of Object.entries(messages)) {
    for (const value of translations) assert.equal(brandSafeTranslation(source, value), value, `${source} → ${value}`);
  }
});

test("titres et artistes originaux sont protégés de la traduction navigateur, sans HTML interprété", () => {
  for (const name of ["LNX Beats", "LNX Beats Studio", "VIE DE CHIEN", "J’AI DIT PROMENADE ?", "Madame Piécettes", "Ça va l’faire", "Auteur & <collaborateur>"]) {
    const html = renderToStaticMarkup(createElement(OriginalName, null, name));
    assert.ok(html.includes('translate="no"'));
    assert.ok(html.includes('class="notranslate"'));
    assert.ok(!html.includes("<collaborateur>"));
    for (const locale of LANGUAGES) assert.equal(translate(locale.code, name), name);
  }
});

test("les identités catalogue ne sont pas envoyées au dictionnaire d’interface", () => {
  const files = [
    "app/album/[slug]/page.tsx", "app/discographie/page.tsx", "components/home-jukebox.tsx",
    "components/digital-catalog.tsx", "components/digital-cart.tsx", "components/digital-checkout.tsx",
    "components/digital-library.tsx", "components/tracklist.tsx", "components/audio-preview-player.tsx",
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(!/\bt\(\s*(?:project|track|active|playerProject|line|l)\.title\s*\)/.test(source), file);
    assert.ok(!/<T\s+text=\{\s*(?:project|track|active|playerProject|line|l)\.(?:title|primaryArtist)\s*\}/.test(source), file);
    assert.ok(source.includes("OriginalName") || source.includes('translate="no"'), file);
  }
});
