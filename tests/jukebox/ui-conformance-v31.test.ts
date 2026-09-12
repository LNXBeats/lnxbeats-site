import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (path: string) => (await readFile(new URL(`../../${path}`, import.meta.url))).toString("utf8");

test("V3.1 keeps the complete Shop heading below the fixed header without negative positioning", async () => {
  const css = await source("app/v130-ui-refinement.css");
  const page = await source("app/boutique/page.tsx");

  assert.match(page, /<h1><span>Boutique<\/span> LNX Beats<\/h1>/);
  assert.match(
    css,
    /body main#contenu \.shop-commerce-hero \.shop-commerce-hero__inner \{[^}]*box-sizing:\s*border-box;[^}]*align-content:\s*center;[^}]*padding-top:\s*calc\(var\(--header-height\) \+ 1\.75rem\)\s*!important;/s,
  );
  assert.match(
    css,
    /@media \(max-width:\s*820px\)[\s\S]*?body main#contenu \.shop-commerce-hero \.shop-commerce-hero__inner \{[^}]*align-content:\s*end;[^}]*padding-top:\s*calc\(var\(--header-height\) \+ 1\.5rem\)\s*!important;/,
  );

  const headingRule = css.match(/body main#contenu \.shop-commerce-hero h1 \{([^}]+)\}/)?.[1] ?? "";
  assert.doesNotMatch(headingRule, /margin-(?:top|block-start):\s*-/);
  assert.doesNotMatch(headingRule, /translate|transform/);
});

test("V3.1 renders the complete public Shop source without product hardcoding or limits", async () => {
  const [service, page, refinementCss] = await Promise.all([
    source("lib/shop/order-service.ts"),
    source("app/boutique/page.tsx"),
    source("app/v130-ui-refinement.css"),
  ]);
  const listStart = service.indexOf("export async function listPublicShopProducts");
  const listEnd = service.indexOf("export async function getPublicShopProduct", listStart);
  const listFunction = service.slice(listStart, listEnd);

  assert.ok(listStart >= 0 && listEnd > listStart);
  assert.match(listFunction, /prisma\.product\.findMany\(/);
  assert.doesNotMatch(listFunction, /\b(?:take|skip|cursor)\s*:/);
  assert.match(listFunction, /return products\.map\(/);
  assert.match(page, /const products = await listPublicShopProducts\(\)/);
  assert.match(page, /\{products\.map\(\(product\) => \(/);
  assert.doesNotMatch(page, /products\.(?:filter|slice)\(/);
  assert.doesNotMatch(page, /lnx-v110-phase2-qa-product|j-ai-adopte-un-humain-cd/);
  assert.match(refinementCss, /\.shop-product-grid:not\(:has\(> :only-child\)\) \{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(refinementCss, /@media \(max-width:\s*1100px\) \{\s*body main#contenu \.shop-product-grid:not\(:has\(> :only-child\)\) \{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
});

test("V3.1 makes real Shop media and fallback mutually exclusive with stable geometry", async () => {
  const [component, shopCss, refinementCss] = await Promise.all([
    source("components/shop-product-media.tsx"),
    source("app/boutique/shop.css"),
    source("app/v130-ui-refinement.css"),
  ]);

  assert.match(component, /if \(!image \|\| !source \|\| failedSource === source\) \{\s*return \(/s);
  assert.match(component, /onError=\{\(\) => setFailedSource\(source\)\}/);
  assert.match(component, /src=\{source\}/);
  assert.match(shopCss, /\.shop-product-card__image \{\s*aspect-ratio:\s*1 \/ 1;/);
  assert.match(shopCss, /\.shop-product-detail__image \{[^}]*aspect-ratio:\s*1 \/ 1;/s);
  assert.match(refinementCss, /\.shop-product-media \{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s);
  assert.match(refinementCss, /\.shop-product-media > img \{[^}]*display:\s*block;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*cover;[^}]*object-position:\s*center;/s);
});
