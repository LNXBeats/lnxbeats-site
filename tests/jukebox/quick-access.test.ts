import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { quickAccessPlatforms } from "@/data/site";
import { isQuickAccessRoute } from "@/lib/navigation/quick-access";

test("quick access uses the seven configured official destinations in editorial order", () => {
  assert.deepEqual(quickAccessPlatforms.map(({ name }) => name), [
    "Spotify",
    "Apple Music",
    "Deezer",
    "YouTube",
    "Amazon Music",
    "TikTok",
    "Instagram",
  ]);
  assert.equal(new Set(quickAccessPlatforms.map(({ url }) => url)).size, 7);
  assert.equal(quickAccessPlatforms.every(({ url }) => url.startsWith("https://")), true);
  assert.equal(quickAccessPlatforms.every(({ icon }) => icon.startsWith("/brands/") && icon.endsWith(".svg")), true);
});

test("the homepage does not duplicate quick access with the former large platform grid", async () => {
  const [homepage, globals, phaseTwo, phaseThree] = await Promise.all([
    readFile(new URL("../../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../app/visual-phase2.css", import.meta.url), "utf8"),
    readFile(new URL("../../app/visual-phase3.css", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(homepage, /PlatformDestination/);
  assert.doesNotMatch(homepage, /platforms-stage/);
  assert.doesNotMatch(globals, /platforms-(?:stage|grid)|platform-(?:card|destination)/);
  assert.doesNotMatch(phaseTwo, /platforms-(?:stage|grid)|platform-(?:card|destination)/);
  assert.doesNotMatch(phaseThree, /platforms-(?:stage|grid)|platform-(?:card|destination)/);
  assert.doesNotMatch(homepage, /Les histoires continuent ailleurs/);
});

test("quick access is fail-closed outside the exact public allowlist and project pages", () => {
  for (const pathname of ["/", "/discographie", "/boutique", "/a-propos", "/contact", "/album/jai-adopte-un-humain", "/contact/"]) {
    assert.equal(isQuickAccessRoute(pathname), true, pathname);
  }

  for (const pathname of [
    "/commander",
    "/compte",
    "/compte/commandes/LNX-1",
    "/admin",
    "/admin/catalogue",
    "/connexion",
    "/inscription",
    "/mot-de-passe-oublie",
    "/reinitialiser-mot-de-passe",
    "/verifier-email",
    "/renvoyer-verification",
    "/album",
    "/album/projet/piste",
    "/api/health",
  ]) {
    assert.equal(isQuickAccessRoute(pathname), false, pathname);
  }
});

test("the shared route-aware component is mounted once and keeps external links safe", async () => {
  const [layout, component, css] = await Promise.all([
    readFile(new URL("../../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/quick-access-bar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/v064-quick-access.css", import.meta.url), "utf8"),
  ]);

  assert.equal((layout.match(/<QuickAccessBar\s*\/>/g)?.length ?? 0), 1);
  assert.match(component, /usePathname\(\)/);
  assert.match(component, /if \(!isQuickAccessRoute\(pathname\)\) return null/);
  assert.match(component, /target="_blank"/);
  assert.match(component, /rel="noopener noreferrer"/);
  assert.match(component, /aria-label="Accès rapide aux plateformes officielles"/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /animation:/);
});

test("all quick access SVG files are local vectors with an explicit source title", async () => {
  for (const platform of quickAccessPlatforms) {
    const svg = await readFile(new URL(`../../public${platform.icon}`, import.meta.url), "utf8");
    assert.match(svg, /^<!--|^<svg/);
    assert.match(svg, /<svg[\s\S]*viewBox=/);
    assert.match(svg, /<title>/);
    assert.match(svg, /<path/);
  }
});
