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

test("mobile editorial cleanup uses one compact Commander progress indicator", async () => {
  const [homepage, shop, orderForm, globalCss, commanderCss] = await Promise.all([
    source("app/page.tsx"),
    source("app/boutique/page.tsx"),
    source("components/music-order-form.tsx"),
    source("app/globals.css"),
    source("app/v084-commander.css"),
  ]);

  assert.match(homepage, /number: "01"/);
  assert.match(shop, /shop-card__index">01 · MUSIQUE/);
  assert.match(orderForm, /order-progress__number/);
  assert.match(orderForm, /<progress max=\{steps\.length\} value=\{step \+ 1\}/);
  assert.match(globalCss, /@media \(max-width: 700px\)[\s\S]*?\.home-perspective > span \{ display: none; \}[\s\S]*?\.home-perspective h3 \{ margin-top: 0; \}[\s\S]*?\.shop-card \{ justify-content: flex-end; \}[\s\S]*?\.shop-card__index \{ display: none; \}/);
  assert.match(commanderCss, /@media \(max-width: 600px\)[\s\S]*?\.commander-v084 \.order-progress \{ display: none; \}/);
  assert.match(commanderCss, /\.commander-v084 \.order-progress__summary \{[\s\S]*?display: grid;/);
  assert.match(commanderCss, /\.order-step-heading__index \{ display: none; \}/);
});

test("shared mobile polish groups the Home promise and keeps the global rails compact", async () => {
  const [homepage, layout, css, footer, quickAccess] = await Promise.all([
    source("app/page.tsx"),
    source("app/layout.tsx"),
    source("app/v085-mobile-polish.css"),
    source("components/site-footer.tsx"),
    source("components/quick-access-bar.tsx"),
  ]);

  assert.match(homepage, /home-hero__eyebrow-story-key">Les histoires<\/span> deviennent musique/);
  assert.doesNotMatch(homepage, /home-hero__eyebrow-brand|home-hero__eyebrow-separator/);
  assert.ok(
    homepage.indexOf('id="home-hero-title"') < homepage.indexOf("home-hero__eyebrow-story"),
    "la promesse éditoriale doit suivre la marque principale dans l’ordre DOM",
  );
  assert.match(css, /\.home-hero__eyebrow-story-key \{ white-space: nowrap; \}/);
  assert.match(css, /@media \(min-width: 601px\) and \(max-width: 820px\)[\s\S]*?\.home-hero h1 \{[\s\S]*?font-size: clamp\(4\.65rem, 12\.8vw, 6\.6rem\);/);
  assert.match(css, /@media \(min-width: 601px\) and \(max-width: 820px\)[\s\S]*?\.page-hero \{[\s\S]*?min-height: 0;/);
  assert.match(css, /@media \(min-width: 601px\) and \(max-width: 820px\)[\s\S]*?\.page-hero h1 \{[\s\S]*?font-size: clamp\(4rem, 9vw, 4\.8rem\);/);
  assert.match(css, /@media \(min-width: 821px\) and \(max-width: 1100px\)[\s\S]*?\.page-hero__grid \{ grid-template-columns: 1fr;/);
  assert.match(css, /@media \(min-width: 821px\) and \(max-width: 1100px\)[\s\S]*?\.contact-hero__inner > div \{ max-width: min\(100%, 760px\); \}/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.quick-access__rail \{[\s\S]*?overflow-x: auto;/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.site-footer__group-links \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(layout, /import "\.\/v085-mobile-polish\.css"/);
  assert.doesNotMatch(layout, /import "\.\/v084-commander\.css"/);
  assert.match(footer, /<details className="site-footer__group">/);
  assert.match(footer, /<summary>Les portes<\/summary>/);
  assert.match(quickAccess, /quick-access__rail/);
});

test("external links share an accessible SVG icon instead of a Unicode glyph", async () => {
  const paths = [
    "components/button.tsx",
    "components/platform-link.tsx",
    "components/project-platforms.tsx",
    "components/admin-navigation.tsx",
    "app/admin/catalogue/[slug]/page.tsx",
  ];
  const sources = await Promise.all(paths.map(source));
  const icon = await source("components/link-icons.tsx");

  assert.match(icon, /export function ExternalLinkIcon/);
  assert.match(icon, /aria-hidden="true"/);
  for (const [index, fileSource] of sources.entries()) {
    assert.match(fileSource, /ExternalLinkIcon/, paths[index]);
    assert.doesNotMatch(fileSource, /↗/, paths[index]);
  }
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
