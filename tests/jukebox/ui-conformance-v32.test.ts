import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const requiredViewports = [
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1728, 1117],
  [1920, 1080],
  [2560, 1440],
  [1024, 768],
  [768, 1024],
  [430, 932],
  [390, 844],
  [375, 812],
  [360, 800],
] as const;

function ruleBody(css: string, selector: string) {
  const selectorStart = css.indexOf(selector);
  assert.notEqual(selectorStart, -1, `missing selector: ${selector}`);
  const blockStart = css.indexOf("{", selectorStart);
  const blockEnd = css.indexOf("}", blockStart);
  assert.ok(blockStart > selectorStart && blockEnd > blockStart, `invalid rule: ${selector}`);
  return css.slice(blockStart + 1, blockEnd);
}

test("V3.2 loads after V3.0 and documents the complete width, height and aspect viewport matrix", async () => {
  const [layout, css] = await Promise.all([
    source("app/layout.tsx"),
    source("app/v132-fluid-motion.css"),
  ]);

  const v130Import = layout.indexOf('import "./v130-ui-refinement.css";');
  const v132Import = layout.indexOf('import "./v132-fluid-motion.css";');
  assert.ok(v130Import >= 0 && v132Import > v130Import, "V3.2 must remain the final cascade layer after V3.0");

  assert.deepEqual(
    requiredViewports.map(([width, height]) => `${width}x${height}`),
    [
      "1366x768",
      "1440x900",
      "1536x864",
      "1728x1117",
      "1920x1080",
      "2560x1440",
      "1024x768",
      "768x1024",
      "430x932",
      "390x844",
      "375x812",
      "360x800",
    ],
  );
  assert.equal(requiredViewports.filter(([width]) => width >= 1441).length, 4);
  assert.equal(requiredViewports.filter(([width, height]) => width >= 1200 && height >= 800).length, 5);
  assert.equal(requiredViewports.filter(([width, height]) => width > height).length, 7);
  assert.equal(requiredViewports.filter(([width, height]) => width < height).length, 5);

  assert.match(css, /--v32-frame-wide:\s*2160px;/);
  assert.match(css, /--v32-frame-reading:\s*1680px;/);
  assert.match(css, /@media \(min-width: 1200px\) and \(min-height: 800px\)/);
  assert.match(css, /@media \(max-height: 780px\) and \(min-width: 821px\)/);
  assert.match(css, /@media \(min-width: 1600px\) and \(min-height: 900px\) and \(min-aspect-ratio: 16 \/ 10\)/);
  assert.match(css, /@media \(min-width: 1600px\) and \(min-height: 1050px\) and \(max-aspect-ratio: 8 \/ 5\)/);
  assert.match(css, /clamp\([^;]+svh[^;]+\)/);
});

test("V3.2 gives Discography and Commander bounded large-screen stages", async () => {
  const css = await source("app/v132-fluid-motion.css");
  const wideStart = css.indexOf("@media (min-width: 1441px)");
  const ultraWideStart = css.indexOf("@media (min-width: 2200px)");
  assert.ok(wideStart >= 0 && ultraWideStart > wideStart);
  const wideCss = css.slice(wideStart, ultraWideStart);

  assert.match(wideCss, /\.v064-discography-container\s*\{[^}]*var\(--v32-frame-wide\)[^}]*max-width:\s*var\(--v32-frame-wide\);/s);
  assert.match(wideCss, /\.discography-jukebox__toolbar\s*\{[^}]*width:\s*min\(1600px, 92%\);/s);
  assert.match(wideCss, /--jukebox-cover-size:\s*clamp\(350px, 20vw, 500px\)\s*!important;/);
  assert.match(wideCss, /--discography-card-body:\s*clamp\(100px, 7vw, 118px\);/);
  assert.match(wideCss, /\.discography-jukebox \.home-jukebox__rail\s*\{[^}]*height:\s*calc\(var\(--discography-card-width\) \+ var\(--discography-card-body\)\)[^}]*perspective:\s*1480px;/s);

  assert.match(wideCss, /\.commander-hero-v084 \.page-hero__grid,[\s\S]*?\.commander-meeting-v084 > div\s*\{[^}]*width:\s*min\(100%, 2000px\)\s*!important;[^}]*max-width:\s*2000px\s*!important;/);
  assert.match(wideCss, /\.commander-v084\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) clamp\(340px, 19vw, 420px\);[^}]*gap:\s*clamp\(1\.5rem, 2vw, 2\.5rem\);/s);
});

test("V3.2 keeps Shop source-driven and defines exhaustive one, two, three and four-card layouts", async () => {
  const [page, css] = await Promise.all([
    source("app/boutique/page.tsx"),
    source("app/v132-fluid-motion.css"),
  ]);

  assert.match(page, /const products = await listPublicShopProducts\(\);/);
  assert.match(page, /\{products\.map\(\(product\) => \(/);
  assert.doesNotMatch(page, /products\.(?:filter|slice|splice|sort)\(/);
  assert.doesNotMatch(page, /const products\s*=\s*\[/);

  const layouts = [
    [".shop-product-grid:has(> :only-child)", /grid-template-columns:\s*minmax\(0, 680px\);/],
    [".shop-product-grid:has(> :nth-child(2):last-child)", /grid-template-columns:\s*repeat\(2, minmax\(0, 760px\)\);/],
    [".shop-product-grid:has(> :nth-child(3))", /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/],
    [".shop-product-grid:has(> :nth-child(4))", /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/],
  ] as const;

  for (const [selector, declaration] of layouts) {
    assert.match(ruleBody(css, selector), declaration);
  }
  assert.match(css, /@media \(min-width: 2200px\)[\s\S]*?\.shop-product-grid:has\(> :nth-child\(4\)\)/);
});

test("V3.2 makes YouTube the sole featured Contact destination without duplicating platform data", async () => {
  const [contact, css] = await Promise.all([
    source("app/contact/page.tsx"),
    source("app/v132-fluid-motion.css"),
  ]);

  const youtubeFirst = contact.indexOf('quickAccessPlatforms.filter(({ name }) => name === "YouTube")');
  const remainingPlatforms = contact.indexOf('quickAccessPlatforms.filter(({ name }) => name !== "YouTube")');
  assert.ok(youtubeFirst >= 0 && remainingPlatforms > youtubeFirst);
  assert.match(contact, /const isFeatured = name === "YouTube";/);
  assert.match(contact, /data-contact-featured=\{isFeatured \? "true" : undefined\}/);
  assert.match(contact, /<PlatformLink icon=\{icon\} name=\{name\} url=\{url\} featured=\{isFeatured\} \/>/);

  assert.match(css, /li\[data-contact-platform="amazon"\]\s*\{[^}]*grid-column:\s*auto;/s);
  assert.match(css, /li\[data-contact-featured="true"\]\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
  assert.match(css, /\.platform-link--featured\s*\{[^}]*min-height:\s*116px;[^}]*border-color:[^}]*background:/s);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.platform-link--featured\s*\{[^}]*min-height:\s*96px;/);
});

test("V3.2 tilt is fine-pointer only and reduced motion removes every transform owner", async () => {
  const css = await source("app/v132-fluid-motion.css");
  const finePointerStart = css.indexOf("@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
  const routeMotionStart = css.indexOf("@media (prefers-reduced-motion: no-preference)", finePointerStart + 1);
  const mobileStart = css.indexOf("@media (max-width: 820px)");
  const shortHeightStart = css.indexOf("@media (max-height: 780px)");
  const reducedStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(finePointerStart >= 0 && routeMotionStart > finePointerStart && reducedStart > routeMotionStart);
  assert.ok(mobileStart >= 0 && shortHeightStart > mobileStart);

  const finePointerCss = css.slice(finePointerStart, routeMotionStart);
  const mobileCss = css.slice(mobileStart, shortHeightStart);
  const reducedCss = css.slice(reducedStart);

  assert.match(finePointerCss, /\[data-motion-tilt\][\s\S]*?perspective\(1100px\)[\s\S]*?rotateX\(calc\(var\(--motion-y\) \* -1\.5deg\)\)[\s\S]*?rotateY\(calc\(var\(--motion-x\) \* 2deg\)\)/);
  assert.doesNotMatch(mobileCss, /data-motion-tilt|rotate[XY]\(|--motion-card-lift/);
  assert.match(reducedCss, /\[data-motion-layer\],[\s\S]*?\[data-motion-tilt\],[\s\S]*?animation:\s*none\s*!important;[\s\S]*?transition:\s*none\s*!important;[\s\S]*?transform:\s*none\s*!important;/);
});

test("V3.2 remains a presentation-only layer with no data or commerce implementation", async () => {
  const css = await source("app/v132-fluid-motion.css");
  const declarationsOnly = css.replace(/\/\*[\s\S]*?\*\//g, "");

  for (const implementationTerm of [
    "rights",
    "prisma",
    "stripe",
    "paypal",
    "webhook",
    "refund",
    "database",
    "migration",
    "schema",
    "checkout",
    "invoice",
    "payment",
  ]) {
    assert.doesNotMatch(declarationsOnly, new RegExp(`\\b${implementationTerm}\\b`, "i"));
  }
});
