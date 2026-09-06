import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { officialLinks, siteConfig } from "@/data/site";
import { isEtsyCatalogLink, isEtsyCatalogUrl, isPublicCatalogLink } from "@/lib/catalog/public-link-policy";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const DISTROKID_MERCH_URL = "https://direct.distrokid.com/lnxbeats2/";

test("the public shop configuration contains only the verified DistroKid merchandise destination", () => {
  assert.equal(officialLinks.distroKid, DISTROKID_MERCH_URL);
  assert.equal("etsy" in officialLinks, false);
  assert.deepEqual(siteConfig.shops, [
    { name: "Produits dérivés — DistroKid", url: DISTROKID_MERCH_URL },
  ]);
});

test("the desktop and mobile footer render DistroKid merchandising without an Etsy fallback", async () => {
  const footer = await source("components/site-footer.tsx");
  const shopListCount = footer.split("...siteConfig.shops").length - 1;

  assert.equal(shopListCount, 2, "desktop and mobile footer variants must consume the same curated shop list");
  assert.match(footer, /site-footer__columns--desktop/);
  assert.match(footer, /site-footer__columns--mobile/);
  assert.match(footer, /<details className="site-footer__group">/);
  assert.doesNotMatch(footer, /etsy/i);
});

test("the public Boutique keeps its internal commerce journey and exposes the external merchandise shop in every state", async () => {
  const shop = await source("app/boutique/page.tsx");

  assert.match(shop, /const distroKidMerchShop = siteConfig\.shops\[0\]/);
  assert.equal((shop.match(/<DistroKidMerchSection(?: soft)? \/>/g) ?? []).length, 3);
  assert.match(shop, /href="\/boutique\/panier"/);
  assert.match(shop, /href=\{`\/boutique\/\$\{encodeURIComponent\(product\.slug\)\}`\}/);
  assert.match(shop, /distincte de la Boutique LNX/);
  assert.doesNotMatch(shop, /etsy/i);
});

test("no deployable public surface can reintroduce Etsy from static configuration", async () => {
  const paths = [
    "data/site.ts",
    "components/site-footer.tsx",
    "components/site-header.tsx",
    "app/layout.tsx",
    "app/page.tsx",
    "app/boutique/page.tsx",
  ];
  const publicSources = await Promise.all(paths.map(source));

  for (const [index, publicSource] of publicSources.entries()) {
    assert.doesNotMatch(publicSource, /etsy(?:\.com)?/i, paths[index]);
  }
});

test("legacy Etsy catalogue links remain private even if they still exist in persisted history", async () => {
  const publicQueries = await source("lib/catalog/queries.ts");
  const publicMapper = await source("lib/catalog/mapper.ts");
  const adminService = await source("lib/catalog/service.ts");
  const adminPage = await source("app/admin/catalogue/[slug]/page.tsx");

  assert.match(publicQueries, /platform: \{ not: "ETSY" as const \}/);
  assert.match(publicQueries, /platformLinks: \{ where: publicPlatformLinkWhere/);
  assert.match(publicMapper, /filter\(isPublicCatalogLink\)/);
  assert.match(adminService, /platformLinks: \{ where:/, "admin history remains readable instead of being deleted");
  assert.match(adminService, /isEtsyCatalogLink\(current\)/);
  assert.match(adminService, /platform: \{ not: "ETSY" \}/);
  assert.match(adminPage, /Etsy — historique masqué/);
  assert.match(adminPage, /historicalEtsy[\s\S]*?Modification désactivée[\s\S]*?: <details><summary>Modifier/);
});

test("Etsy hostnames stay hidden even after a legacy platform fallback", () => {
  const disguisedLegacyLink = { platform: "OTHER", url: "https://lnxbeats.etsy.com/listing/example" };

  assert.equal(isEtsyCatalogUrl("https://www.etsy.com/fr/listing/example"), true);
  assert.equal(isEtsyCatalogUrl("https://etsy.me/example"), true);
  assert.equal(isEtsyCatalogUrl("https://notetsy.example/etsy.com"), false);
  assert.equal(isEtsyCatalogLink({ platform: "ETSY", url: "https://example.invalid/history" }), true);
  assert.equal(isEtsyCatalogLink(disguisedLegacyLink), true);
  assert.equal(isPublicCatalogLink(disguisedLegacyLink), false);
  assert.equal(isPublicCatalogLink({ platform: "DISTROKID", url: DISTROKID_MERCH_URL }), true);
});
