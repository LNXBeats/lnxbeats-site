import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  externalProductPublicationBlockers,
  formatExternalProductPrice,
  parseDistroKidProductUrl,
  parseExternalProductEditorInput,
} from "@/lib/shop/external-product-domain";

const exactUrl = "https://direct.distrokid.com/lnxbeats2/product/1407201-vie-de-chien-ceramic-mug";

test("DistroKid external product input is closed, normalized and price-optional", () => {
  assert.deepEqual(parseExternalProductEditorInput({
    title: "Vie de chien — Mug céramique", providerLabel: "PRODUIT DÉRIVÉ · DISTROKID",
    externalUrl: exactUrl, priceCents: 1700, currency: "EUR", position: 3,
  }), {
    title: "Vie de chien — Mug céramique", provider: "DISTROKID", providerLabel: "PRODUIT DÉRIVÉ · DISTROKID",
    externalUrl: exactUrl, priceCents: 1700, currency: "EUR", position: 3,
  });
  assert.equal(formatExternalProductPrice(null), "Prix sur DistroKid");
  assert.equal(formatExternalProductPrice(1700), "17,00 €");
  assert.throws(() => parseExternalProductEditorInput({ title: "Mug", providerLabel: "DISTROKID", externalUrl: exactUrl, priceCents: null, currency: "EUR", position: 3, stock: 1 }), /champ inattendu/);
});

test("DistroKid URL allowlist is HTTPS-only and rejects arbitrary or deceptive destinations", () => {
  assert.equal(parseDistroKidProductUrl(exactUrl), exactUrl);
  for (const value of [
    "http://direct.distrokid.com/lnxbeats2/product/1407201",
    "https://evil.example/product/1407201",
    "https://direct.distrokid.com.evil.example/product/1407201",
    "https://user:secret@direct.distrokid.com/product/1407201",
    "javascript:alert(1)", "data:text/html,test", "/relative",
  ]) assert.throws(() => parseDistroKidProductUrl(value));
});

test("publication requires a cleared public image but does not invent a price", () => {
  const base = { title: "Mug", externalUrl: exactUrl, image: null };
  assert.deepEqual(externalProductPublicationBlockers(base), ["IMAGE_MISSING"]);
  assert.deepEqual(externalProductPublicationBlockers({ ...base, image: { type: "IMAGE", mimeType: "image/webp", visibility: "PUBLIC", rightsStatus: "CLEARED", alt: "Mug Vie de chien" } }), []);
});

test("the public external card is editorial-only and leaves internal commerce untouched", async () => {
  const [page, card, support, media, sitemap, feed] = await Promise.all([
    readFile(new URL("../../app/boutique/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/shop-external-product-card.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/shop-support-card.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/media/boutique/[assetId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/seo/sitemap.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/merchant/product-feed.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /listPublicShopProducts\(\), listPublicExternalProducts\(\)/);
  assert.match(page, /collection\.map/);
  assert.match(page, /<ShopSupportCard \/>/);
  assert.match(page, /prix et conditions définitifs affichés sur DistroKid/);
  assert.match(card, /target="_blank" rel="noopener noreferrer"/);
  assert.match(card, /Acheter sur DistroKid/);
  assert.doesNotMatch(card, /ShopAddButton|Ajouter au panier|stock|checkout|ShopOrder|stripe|paypal/i);
  assert.match(media, /externalShopProduct: \{ is: \{ status: "PUBLISHED" \} \}/);
  assert.doesNotMatch(`${sitemap}\n${feed}`, /externalShopProduct|DistroKid/);
  assert.match(support, /href="\/soutenir"/);
});

test("Admin offers generic external creation, update, visibility, ordering and image management", async () => {
  const [list, create, detail, actions, service, imageRoute] = await Promise.all([
    readFile(new URL("../../app/admin/boutique/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/externe/nouveau/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/externe/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/externe/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/external-product-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/admin/boutique/external-products/[productId]/image/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(list, /TYPE · Produit externe DistroKid/);
  assert.match(create, /createExternalProductAction/);
  assert.match(detail, /Rendre visible/);
  assert.match(detail, />Masquer</);
  assert.match(detail, /AdminProductImageForm/);
  assert.match(actions, /isSameOriginMutation/);
  assert.match(actions, /requireAdmin/);
  assert.match(service, /orderBy: \[\{ position: "asc" \}/);
  assert.match(service, /status: "PUBLISHED"/);
  assert.match(imageRoute, /requireAdmin/);
});

test("migration is additive and keeps external products outside LNX orders, stock and billing", async () => {
  const sql = await readFile(new URL("../../prisma/migrations/20261004230000_external_shop_products/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE "external_shop_products"/);
  assert.match(sql, /CREATE TABLE "external_shop_product_audit_events"/);
  assert.doesNotMatch(sql, /DROP |ALTER TABLE "products"|shop_order|stock|invoice|payment/i);
});

test("the supplied mug review visual is preserved byte-for-byte", async () => {
  const bytes = await readFile(new URL("../fixtures/shop/vie-de-chien-mug.png", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "829b2aee2d0f72774724f2bceca4b11ae12d5d442220d7d271a4f4144239cda8");
});
