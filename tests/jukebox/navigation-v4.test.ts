import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("V4 modal navigation covers the dynamic viewport and makes the page natively inert", async () => {
  const [header, css] = await Promise.all([source("components/site-header.tsx"), source("components/site-header.module.css")]);
  assert.match(header, /<dialog[\s\S]*?id="mobile-navigation"[\s\S]*?aria-modal="true"/);
  assert.match(header, /dialog\.showModal\(\)/);
  assert.match(header, /dialog\.close\(\)/);
  assert.match(header, /event\.key === "Escape"[\s\S]*?event\.preventDefault\(\)/);
  assert.match(header, /event\.shiftKey[\s\S]*?last\?\.focus\(\)/);
  assert.match(header, /!event\.shiftKey[\s\S]*?first\?\.focus\(\)/);
  assert.match(header, /document\.body\.style\.overflow = previousOverflow/);
  assert.match(header, /document\.documentElement\.style\.overflow = previousRootOverflow/);
  assert.match(header, /menuButton\?\.focus\(\)/);
  assert.match(css, /inset: 0;[\s\S]*?height: 100dvh;[\s\S]*?overflow-y: auto;/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.doesNotMatch(css, /overflow:\s*hidden|!important|max-height:\s*\d|transform:\s*scale/);
});

test("V4 menu uses compact grouped SVG navigation and server-controlled support availability", async () => {
  const [header, css] = await Promise.all([source("components/site-header.tsx"), source("components/site-header.module.css")]);
  for (const label of ["Découvrir", "Créer et acheter", "Autour du projet"]) assert.ok(header.includes(label));
  assert.match(header, /supportAvailable = false/);
  assert.match(header, /&& supportAvailable \?/);
  assert.match(header, /UiIcon name=\{routeIcons\[item\.href\]\}/);
  assert.match(header, /quickAccessPlatforms\.map/);
  assert.match(header, /target="_blank" rel="noopener noreferrer"/);
  assert.match(css, /\.menuLink \{[\s\S]*?min-height: 48px;/);
  assert.match(css, /\.socials a \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
  assert.doesNotMatch(header, /♙|↗|▶|♥/);
});

test("V4 platform rows escape legacy uppercase and stretched tile rules without clipping content", async () => {
  const [component, css, contactCss] = await Promise.all([
    source("components/platform-link.tsx"), source("components/platform-link.module.css"), source("app/contact/contact.module.css"),
  ]);
  assert.match(component, /data-platform-link/);
  assert.match(component, /ExternalLinkIcon className=\{styles\.arrow\}/);
  assert.match(component, /aria-label=\{`\$\{action\} — nouvel onglet`\}/);
  assert.match(css, /grid-template-columns: 40px minmax\(0, 1fr\) 34px/);
  assert.match(css, /min-height: 72px/);
  assert.match(css, /\.featured \{ min-height: 80px/);
  assert.match(css, /text-transform: none/);
  assert.match(contactCss, /li\[data-contact-featured="true"\] \{ grid-column: 1 \/ -1/);
  assert.doesNotMatch(`${css}\n${contactCss}`, /!important|overflow:\s*hidden|max-height:\s*\d|line-clamp/);
});
