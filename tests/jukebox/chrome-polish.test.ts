import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { officialLinks } from "@/data/site";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the fixed header enters a compact desktop state without changing shared page offsets", async () => {
  const [header, chrome, globals, layout] = await Promise.all([
    source("components/site-header.tsx"),
    source("app/v110-chrome-polish.css"),
    source("app/globals.css"),
    source("app/layout.tsx"),
  ]);

  assert.match(layout, /import "\.\/v110-chrome-polish\.css";/);
  assert.match(globals, /\.site-header \{[\s\S]*?position: fixed;/);
  assert.match(header, /const HEADER_COMPACT_SCROLL_THRESHOLD = 72;/);
  assert.match(header, /window\.addEventListener\("scroll", handleScroll, \{ passive: true \}\)/);
  assert.match(header, /window\.requestAnimationFrame\(updateCompactState\)/);
  assert.match(header, /window\.cancelAnimationFrame\(animationFrame\)/);
  assert.match(header, /compact && !open \? "site-header--compact" : ""/);
  assert.match(chrome, /@media \(min-width: 821px\) \{[\s\S]*?\.site-header\.site-header--compact \{ height: 64px; \}/);
  assert.match(chrome, /\.site-header--compact \.site-header__inner \{ padding-inline: clamp\(0\.85rem, 1\.5vw, 1\.4rem\); \}/);
  assert.match(chrome, /\.site-header--compact \.brand \{ min-width: 84px; \}/);
  assert.match(chrome, /\.site-header--compact \.brand__lnx \{ font-size: 1\.5rem; \}/);
  assert.match(chrome, /\.site-header--compact \.brand__beats \{ font-size: 0\.52rem; letter-spacing: 0\.41em; \}/);
  assert.match(chrome, /\.site-header--compact \.desktop-navigation__cta \{ padding: 0\.65rem 1rem; \}/);

  const compactRule = chrome.match(/\.site-header\.site-header--compact \{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(compactRule, /--header-height|position|margin|padding/);
  const mobileRules = chrome.split("@media (max-width: 820px)")[1]?.split("@media (max-width: 380px)")[0] ?? "";
  assert.doesNotMatch(mobileRules, /site-header--compact/);
  assert.match(chrome, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.site-header,[\s\S]*?\.brand__beats,[\s\S]*?transition: none;/);
});

test("the mobile menu keeps focus, scroll lock and viewport changes fail-safe", async () => {
  const [header, chrome] = await Promise.all([
    source("components/site-header.tsx"),
    source("app/v110-chrome-polish.css"),
  ]);

  assert.match(header, /aria-expanded=\{open\}/);
  assert.match(header, /aria-controls="mobile-navigation"/);
  assert.match(header, /aria-hidden=\{!open\}/);
  assert.match(header, /inert=\{!open\}/);
  assert.match(header, /event\.key === "Escape"[\s\S]*?menuButtonRef\.current\?\.focus\(\)/);
  assert.match(header, /firstLinkRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(header, /const previousOverflow = document\.body\.style\.overflow;/);
  assert.match(header, /document\.body\.style\.overflow = previousOverflow;/);
  assert.match(header, /window\.matchMedia\("\(min-width: 821px\)"\)/);
  assert.match(header, /desktopMedia\.addEventListener\("change", closeAtDesktopWidth\)/);
  assert.match(header, /window\.addEventListener\("popstate", closeAfterHistoryNavigation\)/);
  assert.match(chrome, /\.desktop-navigation__link,[\s\S]*?\.menu-button \{[\s\S]*?min-height: 44px;/);
});

test("the footer is compact, complete and keeps DistroKid visibly external on desktop and mobile", async () => {
  const [footer, chrome] = await Promise.all([
    source("components/site-footer.tsx"),
    source("app/v110-chrome-polish.css"),
  ]);

  assert.equal(officialLinks.distroKid, "https://direct.distrokid.com/lnxbeats2/");
  assert.match(footer, /ExternalLinkIcon/);
  assert.match(footer, /site-footer__shop-link/);
  assert.match(footer, /site-footer__external-icon/);
  assert.equal((footer.match(/<details className="site-footer__group">/g) ?? []).length, 3);
  assert.match(footer, /aria-label="Informations légales"/);
  assert.match(footer, /Médiation CM2C/);
  assert.doesNotMatch(`${footer}\n${chrome}`, /etsy/i);

  assert.match(chrome, /\.site-footer \{[\s\S]*?padding-top: clamp\(2\.5rem, 5vw, 4\.5rem\);/);
  assert.match(chrome, /main:has\(> \.v064-discography-stage\) \+ \.site-footer \{[\s\S]*?padding-top: clamp\(2\.5rem, 5vw, 4\.5rem\);/);
  assert.match(chrome, /\.site-footer__signature span:first-child \{[\s\S]*?font-size: clamp\(3\.35rem, 7vw, 6\.5rem\);/);
  assert.match(chrome, /\.site-footer__top \{[\s\S]*?padding-bottom: clamp\(1\.7rem, 3vw, 2\.6rem\);/);
  assert.match(chrome, /@media \(max-width: 820px\) \{[\s\S]*?\.site-footer__group > summary,[\s\S]*?min-height: 44px;/);
  assert.match(chrome, /@media \(max-width: 820px\) \{[\s\S]*?\.site-footer__top \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(chrome, /@media \(max-width: 820px\) \{[\s\S]*?main:has\(> \.v064-discography-stage\) \+ \.site-footer \{[\s\S]*?padding-top: 1\.15rem;/);
  assert.match(chrome, /\.site-footer__external-icon \{[\s\S]*?width: 0\.8rem;[\s\S]*?opacity: 0\.72;/);
});
