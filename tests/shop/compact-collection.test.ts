import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("collection cards omit descriptions but preserve price, availability and independent actions", async () => {
  const page = await read("app/boutique/page.tsx");
  const cards = page.slice(page.indexOf("collection.map"));
  assert.doesNotMatch(cards, /product\.description/);
  for (const field of ["item.product.image", "item.product.title", "item.product.priceCents", "item.product.soldOut", "item.product.availableQuantity"]) assert.ok(cards.includes(field), field);
  assert.match(cards, /Voir le produit/);
  assert.match(cards, /<\/Link>\s*<ShopAddButton/);
  assert.doesNotMatch(cards, /stock\}/);
});

test("product detail and SEO retain the stored description unchanged", async () => {
  const page = await read("app/boutique/[slug]/page.tsx");
  assert.match(page, /shop-product-detail__description">\{product.description\}/);
  assert.match(page, /description: product.description.slice\(0, 180\)/);
});

test("compact collection keeps flow-based layout and accessible mobile actions", async () => {
  const css = await read("app/premium-public-vfinal.css");
  assert.match(css, /shop-product-card__footer \{ position: static;/);
  assert.match(css, /shop-product-card__body h3 \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /shop-product-card__actions .text-link \{ min-height: 44px/);
  assert.match(css, /shop-product-card__actions button \{[^}]*min-height: 48px/);
  assert.match(css, /shop-product-card__actions .shop-add-button \{ font-size: .95rem/);
  assert.doesNotMatch(css, /shop-product-card__body > p:not/);
  assert.match(css, /@media \(max-width: 429px\)/);
});
