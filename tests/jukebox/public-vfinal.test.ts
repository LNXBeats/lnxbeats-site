import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("VFinal visual layer remains public-only, with an explicit responsive composition", async () => {
  const [layout, css] = await Promise.all([source("app/layout.tsx"), source("app/premium-public-vfinal.css")]);
  assert.ok(layout.indexOf('import "./premium-public-vfinal.css"') > layout.indexOf('import "./v132-fluid-motion.css"'));
  assert.doesNotMatch(css, /\.admin-|\.payment-|\.checkout-|\.rights-/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.home-universe-vfinal__grid[^{}]*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.home-universe-vfinal__grid \{ grid-template-columns: 1fr/);
  assert.match(css, /\.shop-product-grid:has\(> :only-child\) \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.shop-product-card \{ grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(css, /\.shop-product-card__image \{[^}]*aspect-ratio: 1 !important/);
  assert.match(css, /\.shop-product-card__actions button \{[^}]*min-height: 48px !important/);
  assert.match(css, /\.discography-card\[data-active\] \.discography-card__body h3 \{ padding-right: 5\.6rem/);
});

test("home uses real catalogue content, official platform links and an unmodified source signature", async () => {
  const home = await source("app/page.tsx");
  assert.match(home, /getHomepageProjects\(\)/);
  assert.match(home, /leadProject\.title/);
  assert.match(home, /leadProject\.description/);
  assert.match(home, /quickAccessPlatforms\.map/);
  assert.match(home, /signature-source-apple-artist\.jpg[^>]+unoptimized/);
  assert.doesNotMatch(home, /dangerouslySetInnerHTML|autoPlay|setInterval/);
});

test("support discovery is flag-gated and outside Commander and Shop", async () => {
  const [home, footer, commander, shop] = await Promise.all([
    source("app/page.tsx"), source("components/site-footer.tsx"), source("app/commander/page.tsx"), source("app/boutique/page.tsx"),
  ]);
  assert.match(home, /isSupportEnabled\(\) \? <section className="home-support-vfinal"/);
  assert.match(home, /Un soutien libre, sans contrepartie/);
  assert.equal((footer.match(/isSupportEnabled\(\) \? <Link href="\/soutenir"/g) ?? []).length, 2);
  assert.doesNotMatch(commander, /\/soutenir|SupportContribution/);
  assert.doesNotMatch(shop, /\/soutenir|SupportContribution/);
});

test("Commander keeps the same form and About retains the full existing biography", async () => {
  const [commander, about, css] = await Promise.all([source("app/commander/page.tsx"), source("app/a-propos/page.tsx"), source("app/premium-public-vfinal.css")]);
  assert.match(commander, /<MusicOrderForm/);
  for (const field of ["initialDraft", "initialStep", "paymentProviders", "resumeJourney"]) assert.match(commander, new RegExp(`${field}=\\{`));
  assert.match(about, /artistBiography\.principal\.map/);
  assert.doesNotMatch(css, /\.album-hero__content h1[^}]*line-clamp/);
  assert.doesNotMatch(css, /\.about-editorial__biography[^}]*display:\s*none/);
});
