import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("la carte premium expose uniquement la licence 150 après éligibilité et ouverture", async () => {
  const component = await readFile("components/rights-options-section.tsx", "utf8");
  const articles = component.match(/<article\b/g) ?? [];
  const publicationIndex = component.indexOf("rights-publication-title");
  assert.equal(articles.length, 1);
  assert.ok(publicationIndex >= 0);
  assert.doesNotMatch(component, /rights-partnership-title|EXPLOITATION_PARTNERSHIP|1 500/);
  assert.match(component, /if \(!publication && !\(eligible && commerceOpen\)\) return null/);
  assert.match(component, /commandes\/\$\{encodeURIComponent\(orderNumber\)\}\/droits\/licence/);
  assert.match(component, /compte\/droits\/\$\{encodeURIComponent\(publication\.requestNumber\)\}/);
  assert.match(component, /Licence de publication via distributeur/);
  assert.match(component, /Offre post-livraison/);
  assert.match(component, /className="rights-options__legal" role="note"/);
  assert.match(component, /<span aria-hidden="true">i<\/span>/);
  assert.doesNotMatch(component, /Stripe|PaymentIntent|checkout/i);
});

test("les routes membre et l’API refusent toute nouvelle demande tant que le commerce est bloqué", async () => {
  const [publicationPage, partnershipPage, api, service, commerce] = await Promise.all([
    readFile("app/compte/commandes/[orderNumber]/droits/licence/page.tsx", "utf8"),
    readFile("app/compte/commandes/[orderNumber]/droits/partenariat/page.tsx", "utf8"),
    readFile("app/api/orders/[orderNumber]/rights/route.ts", "utf8"),
    readFile("lib/rights/service.ts", "utf8"),
    readFile("lib/rights/commerce.ts", "utf8"),
  ]);
  assert.match(commerce, /RIGHTS_NEW_REQUESTS_ENABLED: boolean = false/);
  assert.match(publicationPage, /if \(!RIGHTS_NEW_REQUESTS_ENABLED\) notFound\(\)/);
  assert.doesNotMatch(partnershipPage, /RightsRequestForm|RIGHTS_NEW_REQUESTS_ENABLED/);
  assert.match(partnershipPage, /notFound\(\)/);
  assert.match(api, /createMemberRightsDraft/);
  assert.doesNotMatch(api, /\bcreateRightsDraft\b/);
  assert.ok(api.indexOf("assertRightsNewRequestsEnabled();") < api.indexOf('enforceOrderRateLimit(actor.id, "rights")'));
  assert.match(service, /if \(!RIGHTS_NEW_REQUESTS_ENABLED\)/);
  assert.match(service, /RIGHTS_COMMERCE_NOT_OPEN/);
});

test("le layout garde une carte premium accessible et responsive", async () => {
  const css = await readFile("app/v072-rights.css", "utf8");

  assert.match(css, /\.rights-options__grid\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,1fr\)/s);
  assert.match(css, /\.rights-option-card\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  assert.match(css, /\.rights-option-card__cta\s*\{[^}]*margin-top:\s*auto;/s);
  assert.match(css, /\.rights-option-card__action\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*100%;[^}]*min-height:\s*56px;/s);
  assert.match(css, /\.rights-option-card__notice\s*\{[^}]*min-height:\s*88px;/s);
  assert.match(css, /\.rights-license-hero\s*\{[^}]*display:\s*grid;/s);
  assert.match(css, /\.rights-options__legal\s*\{[^}]*display:\s*grid;/s);
  assert.match(css, /@media \(max-width:\s*720px\)\s*\{[\s\S]*?\.rights-options__grid\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\);/);
});
