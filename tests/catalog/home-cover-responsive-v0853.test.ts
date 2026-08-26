import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the Home lead artwork preserves the full cover in narrow portrait layouts", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const artwork = readFileSync("components/project-artwork.tsx", "utf8");
  const mobileCss = readFileSync("app/v085-mobile-polish.css", "utf8");
  const globalCss = readFileSync("app/globals.css", "utf8");

  assert.match(page, /className="home-project-lead__art"[\s\S]*?<ProjectArtwork project=\{leadProject\}/);
  assert.match(artwork, /src=\{cover\}/);
  assert.match(mobileCss, /\.home-project-lead \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(mobileCss, /\.home-project-lead__art \.project-artwork \{[\s\S]*?height: auto;[\s\S]*?aspect-ratio: 1 \/ 1;/);
  assert.match(mobileCss, /\.home-project-lead__art \.project-artwork--image img \{ object-fit: contain; object-position: center; \}/);
  assert.doesNotMatch(`${page}\n${artwork}\n${mobileCss}`, /jai-adopte-un-humain/i);
  assert.match(globalCss, /\.project-artwork--image img \{ object-fit: cover;/);
});
