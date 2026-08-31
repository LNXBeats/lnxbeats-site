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
  assert.match(button, /disabled \? unavailableLabel : limitReached \? "Maximum au panier"/);
  assert.match(button, /add\(productId, showQuantity \? selectedQuantity : 1\)/);
  assert.match(button, /if \(!showQuantity\) return button/);
  assert.match(provider, /add\(productId: string, quantity\?: number\): void/);
  assert.match(provider, /line\.quantity \+ quantity/);
  assert.match(css, /\.shop-product-purchase \{[\s\S]*grid-template-columns: 7rem minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*\.shop-product-purchase \{[\s\S]*grid-template-columns: 1fr/);
});

test("public shop presentation distinguishes unavailable reservations from sold stock", async () => {
  const [cataloguePage, productPage, cart] = await Promise.all([
    readFile(new URL("../../app/boutique/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/boutique/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/shop-cart.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(cataloguePage, /availabilityState === "SOLD_OUT"[\s\S]*"Épuisé"[\s\S]*availabilityState === "TEMPORARILY_UNAVAILABLE"[\s\S]*"Temporairement indisponible"/);
  assert.match(cataloguePage, /unavailableLabel=\{product\.availabilityState === "TEMPORARILY_UNAVAILABLE"/);
  assert.match(productPage, /Indisponible temporairement : les derniers exemplaires sont réservés/);
  assert.match(productPage, /unavailableLabel=\{product\.availabilityState === "TEMPORARILY_UNAVAILABLE"/);
  assert.match(cart, /product\.availabilityState !== "AVAILABLE"/);
  assert.match(cart, /availabilityState === "SOLD_OUT" \? <em>Épuisé<\/em>/);
  assert.match(cart, /availabilityState === "TEMPORARILY_UNAVAILABLE" \? <em>Temporairement indisponible<\/em>/);
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

test("France-only checkout remains server-backed while member logistics copy hides internal QA identifiers", async () => {
  const [cart, orderPage, productPage] = await Promise.all([
    readFile(new URL("../../components/shop-cart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/compte/achats/[orderNumber]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/boutique/[slug]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(cart, /franceOnly = allowedCountries\.length === 1 && allowedCountries\[0\] === "FR"/);
  assert.match(cart, /<strong>France<\/strong>[\s\S]*<input name="countryCode" type="hidden" value="FR"/);
  assert.match(cart, /Mode de livraison[\s\S]*shopShippingMethodLabel\(quote\.shippingMethod\)/);
  assert.doesNotMatch(cart, /Devis serveur \{quote\.shippingQuoteVersion\}/);
  assert.doesNotMatch(cart, /Fixture QA interne, non contractuelle/);
  assert.match(orderPage, /shopCountryLabel\(order\.shippingCountryCode\)/);
  assert.match(orderPage, /shopCustomerRequestStatusLabel\(request\.status\)/);
  assert.doesNotMatch(orderPage, /<dt>Devis logistique<\/dt>/);
  assert.doesNotMatch(orderPage, /<dt>Poids facturable<\/dt>/);
  assert.doesNotMatch(productPage, /grille QA active/);
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

test("Phase 5E admin details reflow before action panels become narrow", async () => {
  const [css, logistics] = await Promise.all([
    readFile(new URL("../../app/admin/admin.css", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/logistique/page.tsx", import.meta.url), "utf8"),
  ]);
  const intermediateStart = css.indexOf("@media (max-width: 1120px)");
  const compactStart = css.indexOf("@media (max-width: 900px)", intermediateStart);
  const mobileStart = css.indexOf("@media (max-width: 760px)", compactStart);
  const intermediate = css.slice(intermediateStart, compactStart);
  const compact = css.slice(compactStart, mobileStart);
  assert.match(intermediate, /\.admin-order-detail__grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(intermediate, /\.admin-order-detail__aside \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(compact, /\.admin-order-detail__grid,[\s\S]*\.admin-order-detail__aside \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.admin-order-detail__grid > \*,[\s\S]*\.admin-side-window label,[\s\S]*min-width: 0/);
  assert.match(css, /\.admin-logistics-tier-list li \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(logistics, /className="admin-rights-timeline admin-logistics-tier-list"/);
});

test("Phase 5E visual stock fixture belongs to another QA member and remains local-only", async () => {
  const fixture = await readFile(new URL("../../scripts/shop-phase5e-fixture.ts", import.meta.url), "utf8");
  assert.match(fixture, /RESERVATION_OWNER_EMAIL/);
  assert.match(fixture, /VISUAL_RESERVATION_WINDOW_MS/);
  assert.match(fixture, /memberId: reservationOwner\.id/);
  assert.match(fixture, /orderNumber: "LNX-SHOP-2026-550005"/);
  assert.match(fixture, /activeBadgeReservation\._sum\.quantity, 1/);
  assert.doesNotMatch(fixture, /fetch\s*\(/);
});
