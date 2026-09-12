import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the visual motion layer is global, route-aware and progressively enhanced", async () => {
  const [layout, motion, css] = await Promise.all([
    source("app/layout.tsx"),
    source("components/site-motion.tsx"),
    source("app/v120-ui-motion-polish.css"),
  ]);

  assert.match(layout, /import "\.\/v120-ui-motion-polish\.css";/);
  assert.match(layout, /<SiteMotion \/>/);
  assert.match(motion, /usePathname\(\)/);
  assert.match(motion, /IntersectionObserver/);
  assert.match(motion, /prefers-reduced-motion: reduce/);
  assert.match(motion, /requestAnimationFrame/);
  assert.match(motion, /removeEventListener\("pointermove", target\.handlePointerMove\)/);
  assert.match(css, /main#contenu\.route-motion-enter/);
  assert.match(css, /\.motion-reveal\.motion-reveal--pending\.is-revealed/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the public header uses a measured shared active indicator", async () => {
  const [header, css] = await Promise.all([
    source("components/site-header.tsx"),
    source("app/v120-ui-motion-polish.css"),
  ]);

  assert.match(header, /desktopNavigationRef/);
  assert.match(header, /data-nav-active=/);
  assert.match(header, /--active-nav-left/);
  assert.match(header, /--active-nav-width/);
  assert.match(header, /desktop-navigation__active-indicator/);
  assert.match(css, /\.desktop-navigation__active-indicator \{/);
  assert.match(css, /transform: translateX\(var\(--active-nav-left\)\)/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.desktop-navigation__active-indicator \{[\s\S]*?left: var\(--active-nav-left\);[\s\S]*?opacity: var\(--active-nav-opacity\);[\s\S]*?transform: none;/,
  );
});

test("cinematic depth follows existing artwork tones and keeps mobile transforms restrained", async () => {
  const [home, album, about, jukebox, css] = await Promise.all([
    source("app/page.tsx"),
    source("app/album/[slug]/page.tsx"),
    source("app/a-propos/page.tsx"),
    source("components/home-jukebox.tsx"),
    source("app/v120-ui-motion-polish.css"),
  ]);

  assert.match(home, /data-motion-scene="home"/);
  assert.match(album, /data-motion-scene="album"/);
  assert.match(about, /data-motion-scene="about"/);
  assert.match(jukebox, /data-active-tone=\{active\.artworkTone\}/);
  assert.match(css, /home-jukebox\[data-active-tone="gold"\]/);
  assert.match(css, /home-jukebox\[data-active-tone="wine"\]/);
  assert.match(css, /home-jukebox\[data-active-tone="graphite"\]/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\[data-motion-layer\][\s\S]*?transform: none;/);
});

test("the responsive layer names every required breakpoint and prevents horizontal overflow", async () => {
  const css = await source("app/v120-ui-motion-polish.css");

  assert.match(css, /overflow-x: hidden/);
  for (const breakpoint of ["1600", "1320", "1100", "820", "700", "430", "390", "360"]) {
    assert.match(css, new RegExp(`(?:min|max)-width: ${breakpoint}px`));
  }
  assert.match(css, /@media \(max-height: 720px\)/);
  assert.match(css, /\.shop-product-grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.shop-product-purchase \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
});

test("Commander keeps the six-step workflow while transitions remain presentation-only", async () => {
  const [form, css] = await Promise.all([
    source("components/music-order-form.tsx"),
    source("app/v120-ui-motion-polish.css"),
  ]);

  assert.match(form, /Étape \{step \+ 1\} sur \{steps\.length\}/);
  assert.match(form, /key=\{step\}/);
  assert.match(css, /\.order-form--premium \.form-step \{[\s\S]*?animation: v120-form-step/);
  assert.match(css, /\.order-progress__item\[data-state="current"\]/);
  assert.doesNotMatch(css, /display:\s*none[^}]*\.form-step/);
});
