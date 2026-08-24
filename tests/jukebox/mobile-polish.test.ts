import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the mobile menu keeps its accessible navigation without decorative numbering or icon overflow", async () => {
  const [header, css] = await Promise.all([
    source("components/site-header.tsx"),
    source("app/globals.css"),
  ]);

  assert.doesNotMatch(header, /padStart\(2, "0"\)/);
  assert.doesNotMatch(header, /navigation\.length \+ 1/);
  assert.match(header, /aria-expanded=\{open\}/);
  assert.match(header, /aria-controls="mobile-navigation"/);
  assert.match(header, /aria-current=\{isActive\(item\.href\) \? "page" : undefined\}/);
  assert.match(header, /ref=\{lastLinkRef\}[\s\S]*?>[\s\S]*?Compte/);
  assert.match(css, /\.menu-button \{[\s\S]*?width: auto;[\s\S]*?min-width: 76px;[\s\S]*?flex: 0 0 auto;/);
  assert.match(css, /\.menu-button__icon \{[\s\S]*?flex: 0 0 22px;/);
  assert.doesNotMatch(css, /\.mobile-navigation nav a span\s*\{/);
});

test("mobile-only editorial cleanup preserves functional Commander progress", async () => {
  const [homepage, shop, orderForm, css] = await Promise.all([
    source("app/page.tsx"),
    source("app/boutique/page.tsx"),
    source("components/music-order-form.tsx"),
    source("app/globals.css"),
  ]);

  assert.match(homepage, /number: "01"/);
  assert.match(shop, /shop-card__index">01 · MUSIQUE/);
  assert.match(orderForm, /order-progress__number/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.home-perspective > span \{ display: none; \}[\s\S]*?\.home-perspective h3 \{ margin-top: 0; \}[\s\S]*?\.shop-card \{ justify-content: flex-end; \}[\s\S]*?\.shop-card__index \{ display: none; \}/);
  assert.doesNotMatch(css, /\.order-progress__number\s*\{[^}]*display:\s*none/);
});

test("the discography mobile heading hides only the visual counter", async () => {
  const [component, css] = await Promise.all([
    source("components/home-jukebox.tsx"),
    source("app/v064-discography.css"),
  ]);

  assert.match(component, /<output aria-live="polite" aria-atomic="true">/);
  assert.match(component, /<span className="visually-hidden">Projet actif : \{active\.title\}/);
  assert.match(component, /<span className="home-jukebox__counter">/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.home-jukebox__heading \.home-jukebox__counter \{[\s\S]*?width: 1px;[\s\S]*?clip: rect\(0, 0, 0, 0\);/);
});

test("discography filters form a readable two by two mobile grid", async () => {
  const [component, css] = await Promise.all([
    source("components/home-jukebox.tsx"),
    source("app/v064-discography.css"),
  ]);

  assert.match(component, /\{ value: "development", label: "Projets en développement", mobileLabel: "En développement" \}/);
  assert.match(component, /aria-label=\{`\$\{option\.label\} · \$\{counts\[option\.value\]\} projet/);
  assert.match(component, /discography-jukebox__filter-label--mobile" aria-hidden="true"/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.discography-jukebox__filters \{[\s\S]*?overflow: visible;[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.discography-jukebox__filters button \{[\s\S]*?min-width: 0;[\s\S]*?min-height: 44px;[\s\S]*?white-space: normal;/);
  assert.match(css, /\.discography-jukebox__filter-label--desktop \{ display: none; \}[\s\S]*?\.discography-jukebox__filter-label--mobile \{ display: inline; \}/);
});

test("the mobile carousel centers an 86vw card with restrained neighbour previews", async () => {
  const [component, css] = await Promise.all([
    source("components/home-jukebox.tsx"),
    source("app/v064-discography.css"),
  ]);

  assert.match(component, /sizes="\(max-width: 700px\) 86vw/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?--discography-card-width: 86vw;/);
  assert.match(css, /gap: clamp\(\.45rem, 2vw, \.6rem\);[\s\S]*?padding: \.25rem 7vw 1rem;[\s\S]*?scroll-padding-inline: 7vw;[\s\S]*?scroll-snap-type: x mandatory;/);
  assert.match(css, /scroll-snap-align: center;/);
  assert.match(css, /\.v064-discography-stage \{[\s\S]*?overflow: clip;/);
});
