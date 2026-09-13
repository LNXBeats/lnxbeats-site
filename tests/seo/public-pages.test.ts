import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("every principal static page declares complete page-specific social metadata", async () => {
  for (const pathname of ["discographie", "commander", "boutique", "a-propos", "contact"]) {
    const source = await readFile(new URL(`app/${pathname}/page.tsx`, root), "utf8");
    assert.match(source, /createPublicPageMetadata\(\{/);
    assert.match(source, new RegExp(`pathname: "\\/${pathname}"`));
  }
});

test("discography exposes one crawlable direct link per public project without duplicating the jukebox", async () => {
  const source = await readFile(new URL("app/discographie/page.tsx", root), "utf8");
  assert.equal(source.match(/<ProjectJukebox\b/g)?.length, 1);
  assert.match(source, /<details className="discography-directory">/);
  assert.match(source, /sceneProjects\.map\(\(project\)/);
  assert.match(source, /href=\{`\/album\/\$\{project\.slug\}`\}/);
  assert.doesNotMatch(source, /CompactProjectCatalog/);
});

test("dynamic album and product pages render specific JSON-LD from public data", async () => {
  const [album, product] = await Promise.all([
    readFile(new URL("app/album/[slug]/page.tsx", root), "utf8"),
    readFile(new URL("app/boutique/[slug]/page.tsx", root), "utf8"),
  ]);
  assert.match(album, /buildProjectStructuredData\(project\)/);
  assert.match(product, /buildProductStructuredData\(product\)/);
  assert.match(product, /createPublicPageMetadata\(\{/);
});

test("the sitemap reuses the published product query without filtering sold-out products", async () => {
  const [sitemap, shopService] = await Promise.all([
    readFile(new URL("app/sitemap.ts", root), "utf8"),
    readFile(new URL("lib/shop/order-service.ts", root), "utf8"),
  ]);
  assert.match(sitemap, /listPublicShopProducts\(\)/);
  const publicQuery = shopService.slice(shopService.indexOf("export async function listPublicShopProducts"), shopService.indexOf("export async function getPublicShopProduct"));
  assert.match(publicQuery, /status: "PUBLISHED"/);
  assert.doesNotMatch(publicQuery, /stock:\s*\{[^}]*gt:/);
  assert.doesNotMatch(publicQuery, /availabilityState/);
});
