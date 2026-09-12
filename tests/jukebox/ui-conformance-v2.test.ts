import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

const bytes = (path: string) => readFile(new URL(`../../${path}`, import.meta.url));
const source = async (path: string) => (await bytes(path)).toString("utf8");
const sha256 = async (path: string) => createHash("sha256").update(await bytes(path)).digest("hex");

test("V2 preserves the approved pack assets and the user-supplied signature byte-for-byte", async () => {
  assert.equal(await sha256("public/assets/v2/hero-ludovic-dog-exact.jpeg"), "2c4168c5c6964a08d229fe9e2d6575014804f84c13fe1e12b45654fad3efb2c7");
  assert.equal(await sha256("public/assets/v2/lnx-beats-apple-artist-logo-exact.jpeg"), "0f86e74b10bcfb2ddec01e9941d60a50a6b0970968ebf52a653b77efad7993d7");
  assert.equal(await sha256("public/assets/v2/lnx-beats-signature-user-exact.jpg"), "d138714dd5b700a5ff9f648b148db060fea3f6f2d20d002e47bd692a1ef166e3");
  assert.equal(await sha256("public/assets/v2/lnx-beats-signature-user-transparent.png"), "41eea84cd7db50aaf491aea6936685b828b241e8be2bf2e5acad4fe36dd72bfd");
  assert.deepEqual((await bytes("public/assets/v2/lnx-beats-signature-user-transparent.png")).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal((await sharp(await bytes("public/assets/v2/lnx-beats-signature-user-transparent.png")).metadata()).hasAlpha, true);
});

test("the exact V2 hero and stylesheet remain available as the preserved lower visual layer", async () => {
  const [layout, css] = await Promise.all([
    source("app/layout.tsx"),
    source("app/v120-ui-conformance-v2.css"),
  ]);

  assert.match(layout, /import "\.\/v120-ui-conformance-v2\.css";/);
  assert.match(css, /url\("\/assets\/v2\/hero-ludovic-dog-exact\.jpeg"\)/);
  assert.doesNotMatch(css, /DO_NOT_(?:USE|REGENERATE)/);
});

test("V2 reshapes every approved page without changing its business actions", async () => {
  const [album, commander, shop, product, about, discography, css] = await Promise.all([
    source("app/album/[slug]/page.tsx"),
    source("app/commander/page.tsx"),
    source("app/boutique/page.tsx"),
    source("app/boutique/[slug]/page.tsx"),
    source("app/a-propos/page.tsx"),
    source("app/discographie/page.tsx"),
    source("app/v120-ui-conformance-v2.css"),
  ]);

  assert.match(album, /album-hero__backdrop/);
  assert.match(commander, /commander-hero-v2__backdrop/);
  assert.match(shop, /shop-commerce-hero__backdrop/);
  assert.match(about, /about-final-cta/);
  assert.match(discography, /Chaque projet, une histoire\./);
  assert.match(product, /Livraison Colissimo à domicile avec signature/);
  assert.match(product, /France métropolitaine uniquement · frais calculés selon le poids du panier\./);
  assert.match(css, /\.discography-jukebox \.home-jukebox__item\.is-previous/);
  assert.match(css, /\.discography-jukebox \.home-jukebox__item\.is-next/);
  assert.match(css, /\.shop-product-grid:has\(> :only-child\)/);
  assert.doesNotMatch(shop, /Etsy/i);
});

test("responsive and motion safeguards remain explicit", async () => {
  const [css, motion, header] = await Promise.all([
    source("app/v120-ui-conformance-v2.css"),
    source("components/site-motion.tsx"),
    source("components/site-header.tsx"),
  ]);

  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /@media \(min-width: 1600px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(motion, /IntersectionObserver/);
  assert.match(motion, /requestAnimationFrame/);
  assert.match(header, /HEADER_COMPACT_SCROLL_THRESHOLD = 72/);
  assert.match(header, /event\.key === "Escape"/);
  assert.match(header, /menuButtonRef\.current\?\.focus\(\)/);
});

test("the public shop remains qualitative and DistroKid remains distinct", async () => {
  const [shop, product, site] = await Promise.all([
    source("app/boutique/page.tsx"),
    source("app/boutique/[slug]/page.tsx"),
    source("data/site.ts"),
  ]);

  assert.match(shop, /Boutique DistroKid/);
  assert.match(site, /https:\/\/direct\.distrokid\.com\/lnxbeats2\//);
  assert.match(product, /Disponible\./);
  assert.doesNotMatch(product, /\{product\.availableQuantity\}\s+(?:exemplaire|en stock)/);
});
