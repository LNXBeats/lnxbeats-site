import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the wide gallery uses the viewport without shrinking it into a sidebar", async () => {
  const publicCss = await readFile(new URL("../../app/immersive-public.css", import.meta.url), "utf8");
  const desktopGallery = publicCss.slice(publicCss.indexOf("/* A full-width gallery"));
  assert.match(desktopGallery, /@media \(min-width: 1000px\)/);
  assert.match(desktopGallery, /\.v064-discography-container \{ width: 100%; max-width: none/);
  assert.match(desktopGallery, /--immersive-canvas-height: clamp\(440px, 38vw, 940px\); display: block/);
  assert.match(desktopGallery, /height: calc\(var\(--immersive-canvas-height\) \+ 118px\)/);
  assert.doesNotMatch(desktopGallery, /grid-column: 2|grid-template-columns: minmax\(0, 1fr\) minmax\(220px, 280px\)/);
  assert.doesNotMatch(desktopGallery, /zoom:|scale\(\s*(?:1\.[5-9]|[2-9])/);
});

test("the expanded cover scene is opt-in and the listening controls stay below it", async () => {
  const source = await readFile(new URL("../../app/immersive-public.css", import.meta.url), "utf8");
  const desktop = source.slice(source.indexOf("/* A full-width gallery"));
  assert.match(desktop, /\.home-jukebox__scene:has\(canvas\[data-scene-ready="true"\]\) \{ min-height:/);
  assert.match(desktop, /\.discography-jukebox__player-context \{ width: min\(640px, 100%\); min-width: 0; margin: 0 auto/);
  assert.doesNotMatch(desktop, /\.home-jukebox__scene \{ min-height:|display: none|visibility: hidden/);
});

test("only the decorative navigation instruction is removed, not the actual accessible controls", async () => {
  const source = await readFile(new URL("../../components/home-jukebox.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /home-jukebox__navigation-hint|Faites défiler les projets|Glissez pour parcourir/);
  assert.match(source, /aria-label=\{t\("Projet précédent"\)\}/);
  assert.match(source, /aria-label=\{t\("Projet suivant"\)\}/);
  assert.match(source, /event.key === "ArrowLeft"/);
  assert.match(source, /event.key === "ArrowRight"/);
  assert.match(source, /Math.abs\(dx\) >= 48/);
});

test("background lights and prominent controls remain pauseable and keyboard-visible", async () => {
  const source = await readFile(new URL("../../app/immersive-public.css", import.meta.url), "utf8");
  assert.match(source, /\.home-jukebox__background \{ inset: 140px -3vw 90px;.*animation: discography-backlight-drift/);
  assert.match(source, /\.home-jukebox__arrow \{.*width: 64px; min-height: 64px/);
  assert.match(source, /\.home-jukebox__arrow:focus-visible \{ outline: 3px solid/);
  assert.match(source, /\.home-jukebox__arrow-symbol::before \{[^}]*border: 0; border-top: 2px solid currentColor; border-right: 2px solid currentColor/);
  assert.match(source, /\.home-jukebox__scene:has\(canvas\[data-scene-ready="true"\]\) \.home-jukebox__arrow:disabled \{ opacity: \.28;/);
  assert.match(source, /html\[data-visual-motion="paused"\].*\.home-jukebox__arrow-symbol \{ animation: none !important/);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\) \{\s*\.discography-jukebox :is\(\.home-jukebox__background, \.home-jukebox__arrow-symbol\) \{ animation: none !important/);
});
