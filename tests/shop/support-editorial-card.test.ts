import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("support editorial card links only to the existing support module", async () => {
  const card = await read("components/shop-support-card.tsx");
  assert.match(card, /Soutien libre, sans contrepartie\./);
  assert.match(card, /<h3>Soutenir LNX Beats<\/h3>/);
  assert.match(card, /<ButtonLink href="\/soutenir">SOUTENIR LNX BEATS<\/ButtonLink>/);
  assert.match(card, /\/assets\/support\/shop-support-lnx-beats\.png/);
  assert.doesNotMatch(card, /ShopAddButton|priceCents|availableQuantity|Disponible|Voir le produit|Ajouter au panier/);
  assert.doesNotMatch(card, /process\.env|SUPPORT_PAYPAL|parseSupport|prisma|order-service/);
  assert.match(card, /shop-product-card__image/);
  assert.match(card, /shop-product-card__body/);
  assert.match(card, /shop-product-card__footer/);
  assert.match(card, /<\/Link>\s*<div className="shop-product-card__body">/);
});

test("editorial card follows the second product without filtering or mutating products", async () => {
  const page = await read("app/boutique/page.tsx");
  assert.match(page, /products\.map\(\(product, index\)/);
  assert.match(page, /<\/article>\s*\{index === 1 \? <ShopSupportCard \/> : null\}/);
  assert.match(page, /products.length < 2 \? <ShopSupportCard \/> : null/);
  assert.doesNotMatch(page, /products\.(sort|splice|push|filter)\(/);
});

test("support card keeps supplied square asset and accessible flow-based CTA", async () => {
  const image = await readFile(new URL("../../public/assets/support/shop-support-lnx-beats.png", import.meta.url));
  assert.equal(image.readUInt32BE(16), 1254);
  assert.equal(image.readUInt32BE(20), 1254);
  const css = await read("app/premium-public-vfinal.css");
  assert.match(css, /shop-support-card \.button \{[^}]*min-height: 48px/);
  assert.match(css, /shop-support-card__copy \{[^}]*line-height: 1.4/);
});
