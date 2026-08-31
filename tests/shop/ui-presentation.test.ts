import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("guest cart login remains a navigation and does not expose required address fields", async () => {
  const cart = await readFile(new URL("../../components/shop-cart.tsx", import.meta.url), "utf8");

  assert.match(cart, /shippingRequired && authenticated && memberAllowed/);
  assert.match(
    cart,
    /<Link className="button button--primary" href="\/connexion\?retour=%2Fboutique%2Fpanier">/,
  );
  assert.match(cart, /Se connecter pour continuer/);
  assert.match(cart, /formNoValidate=\{!memberAllowed\}/);
  assert.match(cart, /memberProfileRequired = authenticated && !memberAllowed/);
  assert.match(cart, /Compte membre requis/);
  assert.match(cart, /disabled=\{busy \|\| quoting \|\| invalid \|\| !memberAllowed \|\| !quote\}/);
  assert.doesNotMatch(cart, /authenticated \? "Préparer ma commande" : "Se connecter pour continuer"/);
});

test("product detail exposes a bounded accessible quantity selector without changing catalogue cards", async () => {
  const [button, provider, productPage, cataloguePage, css] = await Promise.all([
    readFile(new URL("../../components/shop-add-button.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/shop-cart-provider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/boutique/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/boutique/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/boutique/shop.css", import.meta.url), "utf8"),
  ]);

  assert.match(productPage, /maxQuantity=\{product\.availableQuantity\}/);
  assert.match(cataloguePage, /maxQuantity=\{product\.availableQuantity\}/);
  assert.match(productPage, /showQuantity/);
  assert.doesNotMatch(cataloguePage, /showQuantity/);
  assert.match(button, /<span>Quantité<\/span>[\s\S]*<select/);
  assert.match(button, /remainingQuantity = Math\.max\(0, cartLimit - existingQuantity\)/);
  assert.match(button, /const \{ add, lines, ready \} = useShopCart\(\)/);
  assert.match(button, /const existingQuantity = ready[\s\S]*: 0;/);
  assert.match(button, /const limitReached = remainingQuantity === 0/);
  assert.match(button, /add\(productId, showQuantity \? selectedQuantity : 1\)/);
  assert.match(button, /if \(!showQuantity\) return button/);
  assert.match(provider, /add\(productId: string, quantity\?: number\): void/);
  assert.match(provider, /line\.quantity \+ quantity/);
  assert.match(css, /\.shop-product-purchase \{[\s\S]*grid-template-columns: 7rem minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*\.shop-product-purchase \{[\s\S]*grid-template-columns: 1fr/);
});

test("shop page distinguishes a closed gate from an enabled empty catalogue", async () => {
  const page = await readFile(new URL("../../app/boutique/page.tsx", import.meta.url), "utf8");

  const disabledBranch = page.indexOf("if (!shopEnabled) return <ShopTeaser />");
  const productQuery = page.indexOf("await listPublicShopProducts()");
  const emptyBranch = page.indexOf("if (!products.length) return <ShopEmptyState />");
  assert.ok(disabledBranch >= 0 && productQuery > disabledBranch && emptyBranch > productQuery);
  assert.match(page, /shopEnabled = parseShopConfiguration\(\)\.enabled/);
  assert.match(page, /La Boutique est activée, mais aucun produit publié n’est disponible/);
  assert.doesNotMatch(page, /if \(!products\.length\) return <ShopTeaser \/>/);
  assert.match(page, />Voir le produit<\/Link>/);
});

test("cart identifies changed lines, keeps product imagery and submits an observed version", async () => {
  const cart = await readFile(new URL("../../components/shop-cart.tsx", import.meta.url), "utf8");

  assert.match(cart, /observedLockVersion: productById\.get\(productId\)\?\.lockVersion/);
  assert.match(cart, /body\.productId/);
  assert.match(cart, /shop-cart__line--changed/);
  assert.match(cart, /router\.refresh\(\)/);
  assert.match(cart, /src=\{`\/media\/boutique\/\$\{product\.image\.id\}`\}/);
});

test("cart shipping quote is automatic, race-safe and keeps visible failure feedback", async () => {
  const cart = await readFile(new URL("../../components/shop-cart.tsx", import.meta.url), "utf8");

  assert.match(cart, /useEffect\(\(\) => \{/);
  assert.match(cart, /body: JSON\.stringify\(\{ items: quoteItems \}\)/);
  assert.match(cart, /const controller = new AbortController\(\)/);
  assert.match(cart, /quotingKey === quoteKey/);
  assert.match(cart, /quoted\?\.key === quoteKey \? quoted\.value : null/);
  assert.match(cart, /controller\.abort\(\)/);
  assert.match(cart, /Calcul automatique de la livraison en cours/);
  assert.match(cart, /Réessayer le calcul/);
  assert.doesNotMatch(cart, />Calculer la livraison</);
  assert.doesNotMatch(cart, /reportValidity\(\)/);
});

test("floating cart is present only for a hydrated non-empty cart outside the cart page", async () => {
  const [link, layout, css] = await Promise.all([
    readFile(new URL("../../components/shop-cart-link.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/boutique/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/boutique/shop.css", import.meta.url), "utf8"),
  ]);

  assert.match(link, /usePathname\(\)/);
  assert.match(link, /!portalReady \|\| !ready \|\| itemCount === 0 \|\| pathname\.startsWith\("\/boutique\/panier"\)/);
  assert.match(link, /className="shop-commerce-nav"/);
  assert.match(link, /createPortal\(/);
  assert.match(link, /document\.body/);
  assert.match(layout, /<ShopCartLink \/>/);
  assert.doesNotMatch(layout, /<div className="shop-commerce-nav"/);
  assert.match(css, /\.shop-commerce-nav \{[\s\S]*position: fixed/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(css, /max-width: calc\(100vw -/);
  assert.doesNotMatch(css, /\.shop-commerce-nav \{[\s\S]*?transform: translateZ\(0\)/);
});

test("admin product detail distinguishes physical, reserved and available stock", async () => {
  const [page, service] = await Promise.all([
    readFile(new URL("../../app/admin/boutique/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/product-service.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Stock physique/);
  assert.match(page, /Réservé/);
  assert.match(page, /Disponible/);
  assert.match(page, /activeReservedQuantity/);
  assert.match(page, /availableQuantity/);
  assert.match(service, /status: "ACTIVE", expiresAt: \{ gt: new Date\(\) \}/);
});
