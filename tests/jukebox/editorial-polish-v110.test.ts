import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Home mounts the isolated editorial layer without changing its copy or destinations", async () => {
  const [page, css] = await Promise.all([
    source("app/page.tsx"),
    source("app/v110-editorial-polish.css"),
  ]);

  assert.match(page, /import "\.\/v110-editorial-polish\.css"/);
  assert.match(page, /home-hero home-hero--editorial/);
  assert.match(page, /home-featured home-featured--editorial/);
  assert.match(page, /home-perspectives home-perspectives--editorial/);
  assert.match(page, /home-perspectives__texture" aria-hidden="true"/);
  assert.match(page, /home-perspective home-perspective--editorial/);
  assert.match(page, /home-perspective__number/);
  assert.match(page, /href="\/discographie"/);
  assert.match(page, /href="\/commander"/);
  assert.match(page, /href="\/contact"/);
  assert.equal((page.match(/title: "(?:Histoires|Univers|Sur mesure)"/g) ?? []).length, 3);
  assert.match(css, /\.home-perspectives--editorial \{[\s\S]*?overflow: clip;[\s\S]*?radial-gradient/);
  assert.match(css, /\.home-perspectives__texture \{[\s\S]*?repeating-linear-gradient/);
  assert.match(css, /\.home-perspective--editorial::before \{[\s\S]*?repeating-radial-gradient/);
  assert.match(css, /\.home-featured--editorial \.home-project-lead__copy h3 \{[\s\S]*?max-width: min\(12ch, 100%\);[\s\S]*?overflow-wrap: break-word;[\s\S]*?word-break: normal;/);
  assert.doesNotMatch(css, /url\(/);
});

test("About keeps the existing biography, quotation and portrait in a readable editorial measure", async () => {
  const [page, css] = await Promise.all([
    source("app/a-propos/page.tsx"),
    source("app/v110-editorial-polish.css"),
  ]);

  assert.match(page, /import "\.\.\/v110-editorial-polish\.css"/);
  assert.match(page, /about-hero about-hero--editorial/);
  assert.match(page, /src="\/assets\/hero-mobile\.jpg"/);
  assert.equal((page.match(/<Image\b/g) ?? []).length, 1);
  assert.match(page, /artistBiography\.principal\.map/);
  assert.match(page, /about-editorial__biography/);
  assert.match(page, /<blockquote>Chaque histoire mérite sa musique\.<\/blockquote>/);
  assert.match(css, /\.about-editorial__copy \{[\s\S]*?width: min\(100%, 46rem\)/);
  assert.match(css, /\.about-editorial__biography > p \{[\s\S]*?max-width: 68ch;[\s\S]*?line-height: 1\.85;/);
  assert.match(css, /\.about-story-scene__thread--editorial > p \{[\s\S]*?max-width: 62ch;/);
  assert.match(css, /\.about-story-scene__thread--editorial blockquote \{[\s\S]*?text-wrap: balance;/);
});

test("the editorial layer covers tablet, mobile, focus, overflow and reduced motion", async () => {
  const css = await source("app/v110-editorial-polish.css");

  assert.match(css, /@media \(min-width: 701px\) and \(max-width: 1100px\)/);
  assert.match(css, /@media \(min-width: 701px\) and \(max-width: 820px\)[\s\S]*?\.home-project-lead__art \.project-artwork \{[\s\S]*?min-height: 0;[\s\S]*?aspect-ratio: 1;/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.home-featured--editorial \.home-project-lead \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.home-hero--editorial \.home-hero__actions \.button:focus-visible/);
  assert.match(css, /\.home-perspective--editorial,[\s\S]*?transition: none;/);
  assert.match(css, /transform: none;/);
  assert.match(css, /min-width: 0;/);
  assert.ok((css.match(/overflow: clip;/g) ?? []).length >= 5);
  assert.match(css, /\.home-perspectives--editorial \.home-perspectives__grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.about-teaser--editorial \{[\s\S]*?width: 100%;/);
});
