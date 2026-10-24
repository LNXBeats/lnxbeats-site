import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

// Asset/source contracts only: these checks do not claim browser playback,
// Safari behaviour, Production deployment, or any catalogue/database mutation.
const bytes = (path: string) => readFile(new URL(`../../${path}`, import.meta.url));
const source = async (path: string) => (await bytes(path)).toString("utf8");
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const pngPath = "public/assets/signature-20261024/lnx-beats-fixe-1600.png";
const svgPath = "public/assets/signature-20261024/lnx-beats-anime.svg";
const componentPath = "components/brand-signature.tsx";

test("the two web signatures preserve the exact owner-supplied asset bytes", async () => {
  const [png, svg] = await Promise.all([bytes(pngPath), bytes(svgPath)]);
  assert.equal(sha256(png), "af92db804e3c00ccccb6e8feca3511f4a5e49c2627abadfbeb62dcb6ad375b09");
  assert.equal(sha256(svg), "f9f4906d6e468b917a3eeba64f77201b684c5ba1b7ab36b3b61dc4c3ba3319b1");
});

test("the static fallback has the declared 4:1 dimensions and real transparency", async () => {
  const png = await bytes(pngPath);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 400);
  assert.equal(metadata.hasAlpha, true);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  for (const [x, y] of [[0, 0], [1599, 0], [0, 399], [1599, 399]]) {
    assert.equal(data[(y * info.width + x) * info.channels + 3], 0, `corner ${x},${y} remains transparent`);
  }
  let transparent = 0;
  let visible = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] === 0) transparent += 1;
    if (data[offset] >= 250) visible += 1;
  }
  assert.ok(transparent > info.width * info.height * 0.3, "no opaque rectangular background is introduced");
  assert.ok(visible > info.width * info.height * 0.1, "the fallback contains a materially visible signature");
});

test("the animated SVG is self-contained, script-free and retains the eight-second owner animation", async () => {
  const svg = await source(svgPath);
  assert.match(svg, /<svg\b[^>]*\bwidth="1600"[^>]*\bheight="400"[^>]*\bviewBox="0 0 1600 400"/);
  assert.doesNotMatch(svg, /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed|audio|video|a)\b/i);
  assert.doesNotMatch(svg, /\s+on[a-z][\w:-]*\s*=/i);
  assert.doesNotMatch(svg, /@import|javascript\s*:|expression\s*\(/i);
  const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const references = [...svg.matchAll(/\b(?:xlink:)?href\s*=\s*"([^"]*)"/g)].map(match => match[1]);
  assert.ok(references.length > 1);
  const embeddedImages = references.filter(value => value.startsWith("data:"));
  assert.equal(embeddedImages.length, 1);
  assert.match(embeddedImages[0], /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  for (const reference of references.filter(value => !value.startsWith("data:"))) {
    assert.ok(reference.startsWith("#") && ids.has(reference.slice(1)), "all non-data image/path references stay inside this SVG");
  }
  for (const [, reference] of svg.matchAll(/url\(\s*([^\s)]+)\s*\)/g)) {
    assert.ok(reference.startsWith("#") && ids.has(reference.slice(1)), "filter/style references are local fragments only");
  }
  const animations = [...svg.matchAll(/<(animate|animateMotion)\b[^>]*>/g)].map(match => match[0]);
  assert.equal(animations.length, 25);
  for (const animation of animations) {
    assert.match(animation, /\bdur="8s"/);
    assert.match(animation, /\brepeatCount="indefinite"/);
    if (animation.startsWith("<animate ")) assert.match(animation, /\battributeName="(?:opacity|stroke-dashoffset)"/);
  }
  assert.deepEqual([...svg.matchAll(/\bdata-letter="([A-Z])"/g)].map(match => match[1]), ["B", "E", "A", "T", "S"]);
  assert.match(svg, /@media\s*\(prefers-reduced-motion:\s*reduce\)\{\.lnx-motion\{display:none!important\}\}/);
  const embedded = Buffer.from(embeddedImages[0].slice("data:image/png;base64,".length), "base64");
  const metadata = await sharp(embedded).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1501);
  assert.equal(metadata.height, 348);
  assert.equal(metadata.hasAlpha, true);
});

test("the same signature is wired to all six public/Admin brand positions without Next/Image conversion", async () => {
  const entries = [
    ["components/site-header.tsx", 2],
    ["components/site-footer.tsx", 1],
    ["app/page.tsx", 2],
    ["components/admin-navigation.tsx", 1],
  ] as const;
  for (const [path, count] of entries) {
    const text = await source(path);
    assert.equal((text.match(/<BrandSignature\b/g) ?? []).length, count, path);
    assert.match(text, /from "@\/components\/brand-signature"/);
    assert.doesNotMatch(text, /lnx-beats-signature-(?:transparent\.png|source-apple-artist\.jpg)/);
  }
  const component = await source(componentPath);
  assert.doesNotMatch(component, /from ["']next\/image["']|<Image\b|dangerouslySetInnerHTML|<object\b|<iframe\b/);
  assert.match(component, /<picture\b[^>]*\btranslate="no"[^>]*\bdata-brand-signature/);
  assert.match(component, /<img\b[^>]*\bsrc=\{STILL\}[^>]*\bwidth=\{1600\}[^>]*\bheight=\{400\}[^>]*\balt=\{alt\}/s);
  assert.match(component, /loading=\{priority \? "eager" : "lazy"\}/);
  assert.match(component, /fetchPriority=\{priority \? "high" : "auto"\}/);
  assert.doesNotMatch(component, /\.webp|\.mp4|\.webm/);
});

test("reduced motion and no-JavaScript rendering select a still signature, with one shared persistent pause preference", async () => {
  const [component, css, footer, admin] = await Promise.all([
    source(componentPath), source("components/brand-signature.module.css"),
    source("components/site-footer.tsx"), source("components/admin-navigation.tsx"),
  ]);
  assert.match(component, /const serverPaused = \(\) => true/);
  assert.match(component, /useSyncExternalStore\(subscribe, isPaused, serverPaused\)/);
  assert.match(component, /<source media="\(prefers-reduced-motion: reduce\)" srcSet=\{STILL\} type="image\/png"\s*\/>/);
  assert.match(component, /<source srcSet=\{paused \? STILL : ANIMATED\}/);
  assert.ok(component.indexOf('media="(prefers-reduced-motion: reduce)"') < component.indexOf("srcSet={paused ? STILL : ANIMATED}"));
  assert.match(component, /window\.localStorage\.getItem\(PREFERENCE\) === "true"/);
  assert.match(component, /window\.localStorage\.setItem\(PREFERENCE, String\(pausedInMemory\)\)/);
  assert.match(component, /pausedInMemory = !paused/);
  assert.match(component, /window\.dispatchEvent\(new Event\(PREFERENCE_EVENT\)\)/);
  assert.match(component, /window\.addEventListener\("storage", storageListener\)/);
  assert.match(component, /window\.removeEventListener\("storage", storageListener\)/);
  assert.match(component, /window\.addEventListener\(PREFERENCE_EVENT, listener\)/);
  assert.match(component, /window\.removeEventListener\(PREFERENCE_EVENT, listener\)/);
  assert.equal((footer.match(/<BrandMotionToggle\s*\/>/g) ?? []).length, 1);
  assert.equal((admin.match(/<BrandMotionToggle\s*\/>/g) ?? []).length, 1);
  assert.match(css, /aspect-ratio:\s*4\s*\/\s*1/);
  assert.match(css, /\.motionToggle:focus-visible\s*\{[^}]*outline:/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.motionToggle\s*\{\s*display:\s*none/);
});

test("the animation control is a named keyboard button in each of the six UI languages", async () => {
  const [component, config, header, home, admin] = await Promise.all([
    source(componentPath), source("lib/i18n/config.ts"), source("components/site-header.tsx"),
    source("app/page.tsx"), source("components/admin-navigation.tsx"),
  ]);
  const languages = [...config.matchAll(/\{ code: "([a-z]+)"/g)].map(match => match[1]);
  const labels = [...component.matchAll(/^\s*([a-z]+): \{ pause: "([^"]+)", resume: "([^"]+)" \},$/gm)];
  assert.deepEqual(labels.map(match => match[1]), languages);
  assert.equal(languages.length, 6);
  for (const [, language, pause, resume] of labels) {
    assert.ok(pause.trim().length > 0 && resume.trim().length > 0 && pause !== resume, language);
  }
  assert.match(component, /<button type="button"[^>]*data-brand-motion-toggle/);
  assert.match(component, /const serverReady = \(\) => false/);
  assert.match(component, /useSyncExternalStore\(subscribeReady, clientReady, serverReady\)/);
  assert.match(component, /disabled=\{!ready\}/);
  assert.match(component, /\{paused \? controlLabels\[locale\]\.resume : controlLabels\[locale\]\.pause\}/);
  assert.match(header, /aria-label=\{t\("LNX Beats — accueil"\)\}/);
  assert.match(home, /<OriginalName>LNX Beats<\/OriginalName><\/span><BrandSignature priority/);
  assert.match(home, /<BrandSignature[^>]*alt="LNX Beats"/);
  assert.match(admin, /aria-label="LNX Beats — Administration"><BrandSignature priority\s*\/><span>Admin<\/span>/);
});

test("the earlier approved wordmarks and photography remain intact rather than being overwritten", async () => {
  const preserved = {
    "public/assets/v2/hero-ludovic-dog-exact.jpeg": "2c4168c5c6964a08d229fe9e2d6575014804f84c13fe1e12b45654fad3efb2c7",
    "public/assets/v2/lnx-beats-apple-artist-logo-exact.jpeg": "0f86e74b10bcfb2ddec01e9941d60a50a6b0970968ebf52a653b77efad7993d7",
    "public/assets/v2/lnx-beats-signature-user-exact.jpg": "d138714dd5b700a5ff9f648b148db060fea3f6f2d20d002e47bd692a1ef166e3",
    "public/assets/v2/lnx-beats-signature-user-transparent.png": "41eea84cd7db50aaf491aea6936685b828b241e8be2bf2e5acad4fe36dd72bfd",
    "public/assets/v3/hero-main-ludovic-dog-exact.jpg": "2c4168c5c6964a08d229fe9e2d6575014804f84c13fe1e12b45654fad3efb2c7",
    "public/assets/v3/lnx-beats-signature-source-apple-artist.jpg": "0f86e74b10bcfb2ddec01e9941d60a50a6b0970968ebf52a653b77efad7993d7",
    "public/assets/v3/lnx-beats-signature-transparent.png": "b8b1d6e76541c2f2452d47ad7b0a30fb686b17b3532c919ed889bd663ddfee79",
  };
  for (const [path, expected] of Object.entries(preserved)) assert.equal(sha256(await bytes(path)), expected, path);
});
