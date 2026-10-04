import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the Home lead artwork preserves the full cover in narrow portrait layouts", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const artwork = readFileSync("components/project-artwork.tsx", "utf8");
  const mobileCss = readFileSync("app/home-v4.module.css", "utf8");
  const globalCss = readFileSync("app/globals.css", "utf8");

  assert.match(page, /className=\{styles.artwork\}[\s\S]*?<ProjectArtwork project=\{leadProject\}/);
  assert.match(artwork, /src=\{cover\}/);
  assert.match(mobileCss, /\.featured \{ grid-template-columns: 112px minmax\(0, 1fr\)/);
  assert.match(mobileCss, /\.artwork \{[^}]*aspect-ratio: 1/);
  assert.match(mobileCss, /\.artwork img \{ object-fit: contain; \}/);
  assert.doesNotMatch(`${page}\n${artwork}\n${mobileCss}`, /jai-adopte-un-humain/i);
  assert.match(globalCss, /\.project-artwork--image img \{ object-fit: cover;/);
});
