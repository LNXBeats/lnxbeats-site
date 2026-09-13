import { siteConfig } from "@/data/site";
import { canonicalPublicUrl } from "@/lib/seo/canonical";

export const MERCHANT_CENTER_FEED_PATH = "/merchant-center.xml" as const;
export const MERCHANT_CENTER_FEED_CONTENT_TYPE = "application/xml; charset=utf-8" as const;

export const MERCHANT_MPN_BY_PRODUCT_SLUG = Object.freeze({
  "j-ai-adopte-un-humain-cd": "LNX-CD-JAI-ADOPTE-UN-HUMAIN",
  "badge-lnx-beats": "LNX-BADGE-001",
} as const);

const merchantMpns = Object.values(MERCHANT_MPN_BY_PRODUCT_SLUG);
if (new Set(merchantMpns).size !== merchantMpns.length) {
  throw new Error("Merchant manufacturer part numbers must be unique.");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/;

export type MerchantFeedProduct = Readonly<{
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  availabilityState: "AVAILABLE" | "TEMPORARILY_UNAVAILABLE" | "SOLD_OUT";
  shippingRequired: boolean;
  image: Readonly<{
    id: string;
    alt: string;
    width: number | null;
    height: number | null;
  }> | null;
}>;

export type MerchantFeedItem = Readonly<{
  id: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  availability: "in_stock" | "out_of_stock";
  price: string;
  condition: "new";
  brand: string;
  mpn: string;
}>;

export function merchantMpnForProductSlug(slug: string) {
  return MERCHANT_MPN_BY_PRODUCT_SLUG[slug as keyof typeof MERCHANT_MPN_BY_PRODUCT_SLUG] ?? null;
}

function validXmlCharacters(value: string) {
  return [...value].filter((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint === 0x09
      || codePoint === 0x0a
      || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
  }).join("");
}

export function escapeMerchantXml(value: string) {
  return validXmlCharacters(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function toMerchantFeedItem(product: MerchantFeedProduct): MerchantFeedItem | null {
  const title = product.title.trim();
  const description = product.description.trim();
  const mpn = merchantMpnForProductSlug(product.slug);
  if (
    !product.shippingRequired
    || !UUID_PATTERN.test(product.id)
    || !SLUG_PATTERN.test(product.slug)
    || !title
    || title.length > 150
    || !description
    || description.length > 5_000
    || !Number.isSafeInteger(product.priceCents)
    || product.priceCents <= 0
    || product.currency !== "EUR"
    || !product.image
    || !UUID_PATTERN.test(product.image.id)
    || !mpn
  ) return null;

  return {
    id: product.id,
    title,
    description,
    link: canonicalPublicUrl(`/boutique/${product.slug}`),
    imageLink: canonicalPublicUrl(`/media/boutique/${product.image.id}`),
    availability: product.availabilityState === "AVAILABLE" ? "in_stock" : "out_of_stock",
    price: `${(product.priceCents / 100).toFixed(2)} EUR`,
    condition: "new",
    brand: siteConfig.name,
    mpn,
  };
}

function element(name: string, value: string) {
  return `    <${name}>${escapeMerchantXml(value)}</${name}>`;
}

function serializeItem(item: MerchantFeedItem) {
  return [
    "  <item>",
    element("g:id", item.id),
    element("g:title", item.title),
    element("g:description", item.description),
    element("g:link", item.link),
    element("g:image_link", item.imageLink),
    element("g:availability", item.availability),
    element("g:price", item.price),
    element("g:condition", item.condition),
    element("g:brand", item.brand),
    element("g:mpn", item.mpn),
    "  </item>",
  ].join("\n");
}

export function buildMerchantCenterFeed(products: readonly MerchantFeedProduct[]) {
  const items = products
    .map(toMerchantFeedItem)
    .filter((item): item is MerchantFeedItem => item !== null);
  const serializedItems = items.map(serializeItem);
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<rss version=\"2.0\" xmlns:g=\"http://base.google.com/ns/1.0\">",
    "<channel>",
    `  <title>${escapeMerchantXml(siteConfig.name)}</title>`,
    `  <link>${escapeMerchantXml(canonicalPublicUrl("/boutique"))}</link>`,
    "  <description>Produits physiques officiels LNX Beats</description>",
    ...serializedItems,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}

export function createMerchantCenterFeedResponse(products: readonly MerchantFeedProduct[]) {
  return new Response(buildMerchantCenterFeed(products), {
    status: 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": MERCHANT_CENTER_FEED_CONTENT_TYPE,
      "X-Robots-Tag": "noindex",
    },
  });
}
