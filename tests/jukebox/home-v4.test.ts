import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("V4 home has compact whole-card destinations, no duplicate CTA row or cropped copy", async () => {
  const [home, css] = await Promise.all([source("app/page.tsx"), source("app/home-v4.module.css")]);
  assert.match(home, /data-v4-doors/);
  for (const route of ["discographie", "creations", "commander"]) assert.match(home, new RegExp(`href="/${route}"`));
  assert.match(css, /grid-template-columns: 46px minmax\(0, 1fr\) 20px/);
  assert.match(css, /min-height: 108px/);
  assert.match(css, /font-size: 15px; line-height: 1.5/);
  assert.doesNotMatch(css, /!important|line-clamp|100vh|scale\(/);
  assert.doesNotMatch(home, /home-universe-vfinal__link|aria-hidden="true">[→↗▶♥]/);
});

test("V4 support is one honest test panel with one navigation and the unchanged financial flag", async () => {
  const [home, layout] = await Promise.all([source("app/page.tsx"), source("app/layout.tsx")]);
  assert.equal((home.match(/href="\/soutenir"/g) ?? []).length, 1);
  assert.match(home, /isSupportEnabled\(\) \? <section/);
  assert.match(home, /Préversion · mode test uniquement\. Aucun reçu fiscal/);
  assert.match(layout, /<SiteHeader supportAvailable=\{isSupportEnabled\(\)\}/);
});

test("V4 photo and catalogue stay real, uncropped and independently readable", async () => {
  const [home, css] = await Promise.all([source("app/page.tsx"), source("app/home-v4.module.css")]);
  assert.match(home, /getHomepageProjects\(\)/);
  assert.match(home, /leadProject\.audioPreview \?/);
  assert.match(home, /ProjectArtwork project=\{leadProject\}/);
  assert.match(css, /\.heroPhoto img \{[^}]*object-fit: contain/);
  assert.match(css, /\.artwork img \{ object-fit: contain/);
  assert.doesNotMatch(home, /autoPlay|favorites|shuffle|setInterval/);
});

test("V4 jukebox has one play control per source and no opaque control over a cover", async () => {
  const component = await source("components/home-jukebox.tsx");
  assert.doesNotMatch(component, /discography-card__play-hit|const playBadge/);
  assert.equal((component.match(/className="discography-jukebox__player-toggle"/g) ?? []).length, 1);
  assert.match(component, /playingProject && playingProject\.slug !== active\.slug && active\.audioPreview \? <button/);
  assert.match(component, /Lire la sélection : \{active\.title\}/);
  assert.match(component, /onClick=\{\(\) => handleCoverClick\(globalIndex\)\}/);
});
