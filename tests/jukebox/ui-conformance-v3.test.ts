import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

const bytes = (path: string) => readFile(new URL(`../../${path}`, import.meta.url));
const source = async (path: string) => (await bytes(path)).toString("utf8");
const sha256 = async (path: string) => createHash("sha256").update(await bytes(path)).digest("hex");

test("V3 preserves both exact pack assets and derives a real transparent Apple Artist wordmark", async () => {
  const heroPath = "public/assets/v3/hero-main-ludovic-dog-exact.jpg";
  const wordmarkSourcePath = "public/assets/v3/lnx-beats-signature-source-apple-artist.jpg";
  const transparentWordmarkPath = "public/assets/v3/lnx-beats-signature-transparent.png";

  assert.equal(await sha256(heroPath), "2c4168c5c6964a08d229fe9e2d6575014804f84c13fe1e12b45654fad3efb2c7");
  assert.equal(await sha256(wordmarkSourcePath), "0f86e74b10bcfb2ddec01e9941d60a50a6b0970968ebf52a653b77efad7993d7");
  assert.equal(await sha256(transparentWordmarkPath), "b8b1d6e76541c2f2452d47ad7b0a30fb686b17b3532c919ed889bd663ddfee79");

  const transparentWordmark = await bytes(transparentWordmarkPath);
  assert.deepEqual(transparentWordmark.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const { data, info } = await sharp(transparentWordmark).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(info.width, 1501);
  assert.equal(info.height, 348);

  const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
  for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
    assert.equal(alphaAt(x, y), 0, `the exterior corner ${x},${y} must be transparent`);
  }
  assert.equal(alphaAt(440, 150), 0, "the narrow exterior field enclosed between N and X must be transparent");
  assert.equal(alphaAt(1165, 170), 0, "the narrow exterior field enclosed between A and T must be transparent");
  for (const [x, y] of [[300, 150], [540, 150], [900, 150]]) {
    assert.equal(alphaAt(x, y), 255, `the interior letterform ${x},${y} must stay opaque`);
  }

  let transparentPixels = 0;
  let opaquePixels = 0;
  let opaqueLightPixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alpha = data[offset + 3];
    if (alpha === 0) transparentPixels += 1;
    if (alpha >= 250) {
      opaquePixels += 1;
      if (data[offset] >= 210 && data[offset + 1] >= 210 && data[offset + 2] >= 210) opaqueLightPixels += 1;
    }
  }
  const pixelCount = info.width * info.height;
  assert.ok(transparentPixels / pixelCount > 0.3, "the exterior white field must not remain as a rectangle");
  assert.ok(opaquePixels / pixelCount > 0.15, "the wordmark must remain materially visible");
  assert.ok(opaqueLightPixels > 25_000, "the white letterforms must survive the transparency conversion");

  const publicAssets = await readdir(new URL("../../public/assets/v3/", import.meta.url));
  assert.equal(publicAssets.some((name) => /DOG_REFERENCE|FACE_REFERENCE|IDENTITY_REFERENCE/i.test(name)), false);
});

test("V3 drives the shared public identity while retaining V2 as the lower stylesheet layer", async () => {
  const [layout, home, header, footer] = await Promise.all([
    source("app/layout.tsx"),
    source("app/page.tsx"),
    source("components/site-header.tsx"),
    source("components/site-footer.tsx"),
  ]);

  const v2Index = layout.indexOf('import "./v120-ui-conformance-v2.css";');
  const v3Index = layout.indexOf('import "./v130-ui-refinement.css";');
  assert.ok(v2Index >= 0, "the already validated V2 base must stay imported");
  assert.ok(v3Index > v2Index, "the focused V3 refinement must load after V2");

  assert.match(home, /\/assets\/v3\/hero-main-ludovic-dog-exact\.jpg/);
  for (const [name, fileSource] of [["Home", home], ["header", header], ["footer", footer]] as const) {
    assert.match(fileSource, /\/assets\/v3\/lnx-beats-signature-transparent\.png/, `${name} must use the transparent Apple Artist wordmark`);
    assert.doesNotMatch(fileSource, /lnx-beats-signature-user-transparent/, `${name} must not retain the rejected replacement signature`);
    assert.doesNotMatch(fileSource, /lnx-beats-signature-source-apple-artist/, `${name} must not render the white source rectangle directly`);
  }
});

test("V3 follows the page rules without inventing catalogue or Commander behavior", async () => {
  const [home, commanderForm, shop, product, about, contact, media] = await Promise.all([
    source("app/page.tsx"),
    source("components/music-order-form.tsx"),
    source("app/boutique/page.tsx"),
    source("app/boutique/[slug]/page.tsx"),
    source("app/a-propos/page.tsx"),
    source("app/contact/page.tsx"),
    source("components/shop-product-media.tsx"),
  ]);

  assert.doesNotMatch(home, /home-perspectives|Une musique qui prend le réel au sérieux/);
  assert.match(home, /href="\/discographie"/);
  assert.match(home, /href="\/commander"/);

  const stepDeclaration = commanderForm.match(/const steps = \[([^\]]+)\] as const;/)?.[1] ?? "";
  const commanderSteps = [...stepDeclaration.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(commanderSteps, ["Projet", "Histoire", "Options", "Références", "Compte", "Récapitulatif & paiement"]);

  assert.match(shop, /Boutique DistroKid/);
  assert.doesNotMatch(shop, /Etsy/i);
  assert.match(shop, /ShopProductMedia/);
  assert.match(product, /ShopProductMedia/);
  assert.match(product, /Livraison Colissimo à domicile avec signature/);
  assert.match(product, /France métropolitaine uniquement · frais calculés selon le poids du panier\./);
  assert.doesNotMatch(product, /\{product\.availableQuantity\}\s+(?:exemplaire|en stock)/);

  assert.match(media, /onError=/);
  assert.match(media, /className="shop-product-media shop-product-media--fallback"/);
  assert.match(media, /role="img"/);

  assert.match(about, /artistBiography\.principal\.map/);
  assert.match(about, /href="\/discographie"/);
  assert.match(about, /\/assets\/v3\/hero-main-ludovic-dog-exact\.jpg/);
  assert.match(contact, /contact-hero contact-hero--v3/);
  assert.match(contact, /\/assets\/v3\/hero-main-ludovic-dog-exact\.jpg/);
});

test("V3 keeps responsive, low-height and reduced-motion safeguards explicit", async () => {
  const [css, header] = await Promise.all([
    source("app/v130-ui-refinement.css"),
    source("components/site-header.tsx"),
  ]);

  const benefitRail = css.match(/body main#contenu \.home-hero--editorial \.home-hero__signature \{([^}]+)\}/)?.[1] ?? "";
  assert.match(benefitRail, /position:\s*relative\s*!important/);
  assert.match(benefitRail, /grid-row:\s*2/);
  assert.doesNotMatch(benefitRail, /position:\s*absolute/);

  const discographyStage = css.match(/body main#contenu \.v064-discography-stage \{([^}]+)\}/)?.[1] ?? "";
  assert.match(discographyStage, /overflow-x:\s*clip/);
  assert.match(discographyStage, /overflow-y:\s*visible/);
  assert.match(css, /body main#contenu \.discography-jukebox \.home-jukebox__rail \{[^}]*display:\s*flex;[^}]*height:\s*auto\s*!important;[^}]*overflow-x:\s*auto;/s);
  assert.match(css, /body main#contenu \.discography-jukebox \.home-jukebox__item[^{}]*\{[^}]*position:\s*relative;[^}]*flex:\s*0 0 var\(--discography-card-width\);/s);

  const aboutSurface = css.match(/body main#contenu \.about-teaser--editorial \{([^}]+)\}/)?.[1] ?? "";
  assert.match(aboutSurface, /border:\s*0\s*!important/);
  assert.match(aboutSurface, /background:\s*transparent\s*!important/);

  assert.match(css, /\.shop-product-media--fallback/);
  assert.match(css, /\.contact-hero--v3/);
  assert.match(css, /\.shop-commerce-hero \.shop-commerce-hero__inner/);
  assert.match(css, /body main#contenu \.album-hero \{[^}]*padding-top:\s*calc\(var\(--header-height\) \+ 1rem\)\s*!important;/s);
  assert.ok((css.match(/url\("\/assets\/v3\/hero-main-ludovic-dog-exact\.jpg"\)/g) ?? []).length >= 4);
  assert.match(css, /@media \(max-width:\s*1100px\)/);
  assert.match(css, /@media \(max-width:\s*820px\)/);
  assert.match(css, /@media \(max-width:\s*430px\)/);
  assert.match(css, /@media \(max-width:\s*390px\)/);
  assert.match(css, /@media \(max-height:/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);

  assert.match(header, /event\.key === "Escape"/);
  assert.match(header, /menuButtonRef\.current\?\.focus\(\)/);
  assert.match(header, /aria-expanded=\{open\}/);
  assert.match(header, /aria-controls="mobile-navigation"/);
});
