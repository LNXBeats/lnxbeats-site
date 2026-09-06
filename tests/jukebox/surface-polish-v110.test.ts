import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("member financial references use the dedicated responsive identifier treatment", async () => {
  const [account, order, invoice, creditNote, serviceRequest, css] = await Promise.all([
    source("app/compte/page.tsx"),
    source("app/compte/achats/[orderNumber]/page.tsx"),
    source("app/compte/factures/[invoiceNumber]/page.tsx"),
    source("app/compte/avoirs/[creditNoteNumber]/page.tsx"),
    source("app/compte/sav/[requestNumber]/page.tsx"),
    source("app/v110-surface-polish.css"),
  ]);

  assert.match(account, /account-overview-page/);
  assert.match(account, /technical-reference technical-reference--list/);
  assert.match(order, /shop-order-detail-page/);
  assert.match(order, /technical-reference technical-reference--hero/);
  assert.match(invoice, /billing-document-page/);
  assert.match(invoice, /technical-reference technical-reference--hero/);
  assert.match(creditNote, /billing-document-page/);
  assert.match(creditNote, /technical-reference technical-reference--hero/);
  assert.match(serviceRequest, /technical-reference technical-reference--hero/);
  assert.match(css, /\.technical-reference \{[\s\S]*?font-variant-numeric: tabular-nums;[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(css, /\.technical-reference--inline \{[\s\S]*?font-size: max\(1em, 0\.75rem\);/);
  assert.match(css, /\.account-shell \.auth-intro h1\.technical-reference--hero \{/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.account-shell \.auth-intro h1\.technical-reference--hero \{[\s\S]*?font-size: clamp\(1\.55rem, 7\.3vw, 2\.15rem\);/);
});

test("shop order density pairs only the stable article and summary panels on wide screens", async () => {
  const [order, css] = await Promise.all([
    source("app/compte/achats/[orderNumber]/page.tsx"),
    source("app/v110-surface-polish.css"),
  ]);

  assert.match(order, /shop-order-panel--items/);
  assert.match(order, /shop-order-panel--summary/);
  assert.match(css, /\.shop-order-detail-page \.auth-account-stack \{[\s\S]*?grid-template-columns: repeat\(12, minmax\(0, 1fr\)\);[\s\S]*?align-items: start;/);
  assert.match(css, /\.shop-order-detail-page \.shop-order-panel--items \{[\s\S]*?grid-column: 1 \/ span 7;/);
  assert.match(css, /\.shop-order-detail-page \.shop-order-panel--summary \{[\s\S]*?grid-column: 8 \/ -1;/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.shop-order-detail-page \.shop-order-panel--items,[\s\S]*?grid-column: 1 \/ -1;/);
  assert.doesNotMatch(order, /style=\{\{[^}]*grid/);
});

test("commerce polish preserves primary purchase hierarchy and responsive touch targets", async () => {
  const [addButton, cart, css] = await Promise.all([
    source("components/shop-add-button.tsx"),
    source("components/shop-cart.tsx"),
    source("app/v110-surface-polish.css"),
  ]);

  assert.match(addButton, /button button--primary shop-add-button/);
  assert.match(cart, /className="button button--primary"/);
  assert.match(css, /\.shop-commerce-shell \.button,[\s\S]*?min-height: 44px;/);
  assert.match(css, /\.shop-product-card:is\(:hover, :focus-within\) \{[\s\S]*?border-color:[\s\S]*?transform: translateY\(-3px\);/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.shop-product-card__footer \{[\s\S]*?flex-direction: column;/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.account-overview-page \.member-order-list li > a \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.shop-commerce-shell\.shop-product-page,[\s\S]*?padding-block: 2rem 5rem;/);
  assert.doesNotMatch(css, /\.payment-methods__terms/);
});

test("discography exposes an editorial live counter and restrained active treatment", async () => {
  const [jukebox, css] = await Promise.all([
    source("components/home-jukebox.tsx"),
    source("app/v110-surface-polish.css"),
  ]);

  assert.match(jukebox, /home-jukebox__counter"><span>Projet<\/span> <strong>\{currentVisibleIndex \+ 1\}<\/strong> <span>sur<\/span>/);
  assert.match(jukebox, /aria-live="polite" aria-atomic="true"/);
  assert.match(css, /\.discography-card\[data-active="true"\] \{[\s\S]*?border-color: rgba\(226, 196, 126, 0\.7\);/);
  assert.match(css, /\.discography-jukebox__filters button:focus-visible/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.home-jukebox__heading \.home-jukebox__counter \{[\s\S]*?position: static;[\s\S]*?white-space: nowrap;/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.discography-jukebox \.home-jukebox__heading \{[\s\S]*?flex-direction: column;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("surface polish is isolated from transactional and persistence code", async () => {
  const [layout, css] = await Promise.all([
    source("app/layout.tsx"),
    source("app/v110-surface-polish.css"),
  ]);

  assert.match(layout, /import "\.\/v110-chrome-polish\.css"/);
  assert.match(layout, /import "\.\/v110-surface-polish\.css"/);
  assert.doesNotMatch(css, /url\(/);
  assert.doesNotMatch(css, /display:\s*none[^;]*;\s*\/\*.*(?:payment|shipping|refund)/i);
  assert.doesNotMatch(css, /\.payment-checkout|\.refund|\.shipping-operation/);
});
