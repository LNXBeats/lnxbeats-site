import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { seoMessages } from "@/lib/i18n/messages-seo";
import { LANGUAGES } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/messages";
import { createPublicPageMetadata } from "@/lib/seo/metadata";

test("SEO six langues : identité, paramètres et textes statiques complets", () => {
  for (const [source, values] of Object.entries(seoMessages)) {
    assert.equal(values.length, 5);
    const tokens = [...source.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
    for (const value of values) {
      assert.ok(value.trim(), source);
      assert.deepEqual([...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort(), tokens, source);
      for (const identity of ["LNX Beats", "LNX STUDIO", "Ludovic Mathon", "DistroKid"]) if (source.includes(identity)) assert.ok(value.includes(identity), source);
    }
  }
});

test("métadonnées principales : langue serveur, canoniques identiques, aucun faux hreflang", () => {
  for (const route of ["discographie", "a-propos", "boutique", "commander", "contact", "creations"]) {
    const source = fs.readFileSync(`app/${route}/page.tsx`, "utf8");
    assert.ok(source.includes("export async function generateMetadata(): Promise<Metadata>"), route);
    assert.ok(source.includes("const locale = await getSiteLocale()"), route);
    assert.ok(source.includes(`pathname: "/${route}"`), route);
    assert.ok(source.includes('imageAlt: serverT(locale, "LNX Beats — Chaque histoire mérite sa musique.")'), route);
    assert.ok(!source.includes("hreflang"), route);
  }
  const home = fs.readFileSync("app/page.tsx", "utf8");
  assert.ok(home.includes('alternates: { canonical: "/" }'));
  assert.ok(home.includes('<OriginalName>{leadProject.title}</OriginalName>'));
  assert.ok(home.includes('names={[leadProject.title]}'));
});

test("SEO localisé conserve la marque et les URLs canoniques et sociales", () => {
  for (const { code } of LANGUAGES) {
    const title = translate(code, "Discographie et albums");
    if (code !== "fr") assert.notEqual(title, "Discographie et albums", code);
    const metadata = createPublicPageMetadata({ title, description: translate(code, "LNX Beats transforme les scènes ordinaires, les souvenirs et les émotions en récits musicaux. Chaque histoire mérite sa musique."), pathname: "/discographie" });
    assert.equal(metadata.alternates?.canonical, "/discographie");
    assert.equal(metadata.openGraph?.url, "/discographie");
    assert.equal(metadata.openGraph?.title, `${title} — LNX Beats`);
    assert.equal(metadata.twitter?.title, `${title} — LNX Beats`);
    assert.ok(String(metadata.description).includes("LNX Beats"));
  }
});
