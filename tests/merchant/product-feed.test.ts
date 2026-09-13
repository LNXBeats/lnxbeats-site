import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMerchantCenterFeed,
  createMerchantCenterFeedResponse,
  escapeMerchantXml,
  MERCHANT_MPN_BY_PRODUCT_SLUG,
  merchantMpnForProductSlug,
  toMerchantFeedItem,
  type MerchantFeedProduct,
} from "@/lib/merchant/product-feed";
import { buildProductStructuredData } from "@/lib/seo/structured-data";
import { buildPublicSitemap, PUBLIC_SITEMAP_PATHS } from "@/lib/seo/sitemap";

const root = new URL("../../", import.meta.url);

function product(overrides: Partial<MerchantFeedProduct> = {}): MerchantFeedProduct {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "j-ai-adopte-un-humain-cd",
    title: "Édition physique LNX Beats",
    description: "Une édition physique neuve et publiée.",
    priceCents: 1_234,
    currency: "EUR",
    availabilityState: "AVAILABLE",
    shippingRequired: true,
    shippingWeightGrams: 25,
    image: {
      id: "22222222-2222-4222-8222-222222222222",
      alt: "Photographie de l’édition physique",
      width: 1_200,
      height: 1_200,
    },
    ...overrides,
  };
}

test("the feed is UTF-8 RSS 2.0 with the Google namespace and LNX Beats channel", () => {
  const xml = buildMerchantCenterFeed([product()]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<rss version="2\.0" xmlns:g="http:\/\/base\.google\.com\/ns\/1\.0">/);
  assert.match(xml, /<title>LNX Beats<\/title>/);
  assert.match(xml, /<link>https:\/\/www\.lnxbeats\.fr\/boutique<\/link>/);
});

test("a product supplied by the public published catalogue is included", () => {
  const xml = buildMerchantCenterFeed([product()]);
  assert.match(xml, /<g:id>11111111-1111-4111-8111-111111111111<\/g:id>/);
  assert.match(xml, /<g:title>Édition physique LNX Beats<\/g:title>/);
});

test("the CD exports its 25 g product weight with the Google unit", () => {
  const xml = buildMerchantCenterFeed([product({ shippingWeightGrams: 25 })]);
  assert.match(xml, /<g:shipping_weight>25 g<\/g:shipping_weight>/);
});

test("the badge exports its measured 10 g product weight", () => {
  const xml = buildMerchantCenterFeed([product({
    slug: "badge-lnx-beats",
    shippingWeightGrams: 10,
  })]);
  assert.match(xml, /<g:shipping_weight>10 g<\/g:shipping_weight>/);
});

test("shipping_weight derives directly from shippingWeightGrams", () => {
  assert.equal(toMerchantFeedItem(product({ shippingWeightGrams: 37 }))?.shippingWeight, "37 g");
});

test("shipping_weight excludes packaging and the checkout billing minimum", () => {
  const xml = buildMerchantCenterFeed([
    product({ shippingWeightGrams: 25 }),
    product({
      id: "33333333-3333-4333-8333-333333333333",
      slug: "badge-lnx-beats",
      shippingWeightGrams: 10,
    }),
  ]);
  assert.match(xml, /<g:shipping_weight>25 g<\/g:shipping_weight>/);
  assert.match(xml, /<g:shipping_weight>10 g<\/g:shipping_weight>/);
  assert.doesNotMatch(xml, /<g:shipping_weight>(?:70|85|250) g<\/g:shipping_weight>/);
});

test("products without a strictly positive integer weight fail closed", () => {
  assert.equal(toMerchantFeedItem(product({ shippingWeightGrams: null })), null);
  assert.equal(toMerchantFeedItem(product({ shippingWeightGrams: 0 })), null);
  assert.equal(toMerchantFeedItem(product({ shippingWeightGrams: -1 })), null);
  assert.equal(toMerchantFeedItem(product({ shippingWeightGrams: 10.5 })), null);
});

test("the route delegates exclusively to the existing published-product reader", async () => {
  const [route, shopService] = await Promise.all([
    readFile(new URL("app/merchant-center.xml/route.ts", root), "utf8"),
    readFile(new URL("lib/shop/order-service.ts", root), "utf8"),
  ]);
  assert.match(route, /listPublicShopProducts\(\)/);
  const publicQuery = shopService.slice(
    shopService.indexOf("export async function listPublicShopProducts"),
    shopService.indexOf("export async function getPublicShopProduct"),
  );
  assert.match(publicQuery, /status: "PUBLISHED"/);
  assert.doesNotMatch(publicQuery, /status: "DRAFT"/);
});

test("a public sold-out product remains in the feed as out_of_stock", () => {
  const xml = buildMerchantCenterFeed([product({ availabilityState: "SOLD_OUT" })]);
  assert.match(xml, /<g:availability>out_of_stock<\/g:availability>/);
  assert.match(xml, /<item>/);
});

test("temporary reservation unavailability maps to out_of_stock", () => {
  const item = toMerchantFeedItem(product({ availabilityState: "TEMPORARILY_UNAVAILABLE" }));
  assert.equal(item?.availability, "out_of_stock");
});

test("available inventory maps to in_stock", () => {
  const item = toMerchantFeedItem(product({ availabilityState: "AVAILABLE" }));
  assert.equal(item?.availability, "in_stock");
});

test("integer and cent prices use invariant EUR formatting", () => {
  assert.equal(toMerchantFeedItem(product({ priceCents: 700 }))?.price, "7.00 EUR");
  assert.equal(toMerchantFeedItem(product({ priceCents: 1_234 }))?.price, "12.34 EUR");
});

test("invalid, zero and negative prices are excluded", () => {
  assert.equal(toMerchantFeedItem(product({ priceCents: 0 })), null);
  assert.equal(toMerchantFeedItem(product({ priceCents: -1 })), null);
  assert.equal(toMerchantFeedItem(product({ priceCents: 1.5 })), null);
});

test("all landing and image URLs are canonical www HTTPS URLs", () => {
  const item = toMerchantFeedItem(product())!;
  assert.equal(item.link, "https://www.lnxbeats.fr/boutique/j-ai-adopte-un-humain-cd");
  assert.equal(item.imageLink, "https://www.lnxbeats.fr/media/boutique/22222222-2222-4222-8222-222222222222");
});

test("a product without a public primary image is safely omitted", () => {
  assert.equal(toMerchantFeedItem(product({ image: null })), null);
});

test("XML special characters and script-like text are escaped", () => {
  const xml = buildMerchantCenterFeed([product({
    title: "CD & badge <collector> \"LNX\"",
    description: "L'histoire d'un artiste > tout </script>.",
  })]);
  assert.match(xml, /CD &amp; badge &lt;collector&gt; &quot;LNX&quot;/);
  assert.match(xml, /L&apos;histoire d&apos;un artiste &gt; tout &lt;\/script&gt;/);
  assert.doesNotMatch(xml, /<script>/i);
});

test("invalid XML control characters are removed without dropping Unicode", () => {
  assert.equal(escapeMerchantXml("Édition\u0000 🎵"), "Édition 🎵");
});

test("the feed never exposes numeric stock or reservations", () => {
  const xml = buildMerchantCenterFeed([product()]);
  assert.doesNotMatch(xml, /<(?:g:)?(?:stock|quantity|availableQuantity|reservation)/i);
});

test("the CD uses its official stable LNX Beats brand and MPN", () => {
  const xml = buildMerchantCenterFeed([product()]);
  assert.match(xml, /<g:brand>LNX Beats<\/g:brand>/);
  assert.match(xml, /<g:mpn>LNX-CD-JAI-ADOPTE-UN-HUMAIN<\/g:mpn>/);
});

test("the badge uses its official stable LNX Beats brand and MPN", () => {
  const xml = buildMerchantCenterFeed([product({ slug: "badge-lnx-beats" })]);
  assert.match(xml, /<g:brand>LNX Beats<\/g:brand>/);
  assert.match(xml, /<g:mpn>LNX-BADGE-001<\/g:mpn>/);
});

test("official MPN values are unique, stable and independent from marketing titles", () => {
  assert.equal(merchantMpnForProductSlug("j-ai-adopte-un-humain-cd"), "LNX-CD-JAI-ADOPTE-UN-HUMAIN");
  assert.equal(merchantMpnForProductSlug("badge-lnx-beats"), "LNX-BADGE-001");
  assert.equal(new Set(Object.values(MERCHANT_MPN_BY_PRODUCT_SLUG)).size, 2);
  assert.equal(
    toMerchantFeedItem(product({ title: "Nouveau titre marketing du CD" }))?.mpn,
    "LNX-CD-JAI-ADOPTE-UN-HUMAIN",
  );
});

test("known MPN products never emit GTIN or identifier_exists", () => {
  const xml = buildMerchantCenterFeed([
    product(),
    product({
      id: "33333333-3333-4333-8333-333333333333",
      slug: "badge-lnx-beats",
      shippingWeightGrams: 10,
      image: {
        id: "44444444-4444-4444-8444-444444444444",
        alt: "Badge LNX Beats",
        width: 1_000,
        height: 1_000,
      },
    }),
  ]);
  assert.doesNotMatch(xml, /<g:gtin>/);
  assert.doesNotMatch(xml, /<g:identifier_exists>/);
});

test("a future product without an explicit Merchant MPN fails closed", () => {
  const future = product({ slug: "nouveau-produit-sans-mpn" });
  assert.equal(merchantMpnForProductSlug(future.slug), null);
  assert.equal(toMerchantFeedItem(future), null);
  assert.doesNotMatch(buildMerchantCenterFeed([future]), /<item>/);
});

test("services and non-physical catalogue entries are excluded", () => {
  const xml = buildMerchantCenterFeed([product({ shippingRequired: false })]);
  assert.doesNotMatch(xml, /<item>/);
});

test("the response is public GET-compatible XML with no-store and Search noindex", async () => {
  const response = createMerchantCenterFeedResponse([product()]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/xml; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  assert.match(await response.text(), /<rss/);
});

test("Merchant and Product JSON-LD derive matching commercial fields", () => {
  const fixture = product();
  const merchant = toMerchantFeedItem(fixture)!;
  const jsonLd = JSON.stringify(buildProductStructuredData(fixture));
  assert.match(jsonLd, new RegExp(`"price":"${merchant.price.split(" ")[0]}"`));
  assert.match(jsonLd, /"priceCurrency":"EUR"/);
  assert.match(jsonLd, /https:\/\/schema\.org\/InStock/);
  assert.match(jsonLd, new RegExp(merchant.link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(jsonLd, new RegExp(merchant.imageLink.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("the SEO sitemap counts its public routes and excludes the Merchant feed", async () => {
  const sitemap = buildPublicSitemap([], [{ slug: "j-ai-adopte-un-humain-cd" }]);
  assert.equal(sitemap.length, PUBLIC_SITEMAP_PATHS.length + 1);
  assert.equal(sitemap.some(({ url }) => url.includes("merchant-center.xml")), false);
  const source = await readFile(new URL("app/sitemap.ts", root), "utf8");
  assert.doesNotMatch(source, /merchant-center\.xml/);
});

test("the feed contains no private commerce or credential vocabulary", () => {
  const xml = buildMerchantCenterFeed([product()]);
  assert.doesNotMatch(xml, /(?:DATABASE_URL|AUTH_SECRET|Stripe|PayPal|customer|invoice|order|email)/i);
});
