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
