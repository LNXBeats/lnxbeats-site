import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("les offres bloquées ne sont pas exposées, mais les demandes existantes restent suivables", async () => {
  const component = await readFile("components/rights-options-section.tsx", "utf8");
  const articles = component.match(/<article\b/g) ?? [];
  const publicationIndex = component.indexOf("rights-publication-title");
  const partnershipIndex = component.indexOf("rights-partnership-title");

  assert.equal(articles.length, 2);
  assert.ok(publicationIndex >= 0 && partnershipIndex > publicationIndex);
  assert.doesNotMatch(component, /import \{ rightsOffers \} from "@\/data\/rights-offer"/);
  assert.match(component, /formatEuro\(publication\.requestedPriceCents\)/);
  assert.match(component, /formatEuro\(partnership\.requestedPriceCents\)/);
  assert.doesNotMatch(component, /formatEuro\((?:15_000|150_000)\)/);
  assert.match(component, /if \(!publication && !partnership\) return null/);
  assert.doesNotMatch(component, /commandes\/\$\{encodeURIComponent\([^)]*\)\}\/droits\/(?:licence|partenariat)/);
  assert.match(component, /compte\/droits\/\$\{encodeURIComponent\(publication\.requestNumber\)\}/);
  assert.match(component, /compte\/droits\/\$\{encodeURIComponent\(partnership\.requestNumber\)\}/);
  assert.match(component, /Aucune facturation\./);
  assert.match(component, /Validation manuelle de LNX Beats obligatoire avant tout contrat ou paiement\./);
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
  assert.match(partnershipPage, /if \(!RIGHTS_NEW_REQUESTS_ENABLED\) notFound\(\)/);
  assert.match(api, /createMemberRightsDraft/);
  assert.doesNotMatch(api, /\bcreateRightsDraft\b/);
  assert.ok(api.indexOf("assertRightsNewRequestsEnabled();") < api.indexOf('enforceOrderRateLimit(actor.id, "rights")'));
  assert.match(service, /if \(!RIGHTS_NEW_REQUESTS_ENABLED\)/);
  assert.match(service, /RIGHTS_COMMERCE_NOT_OPEN/);
});

test("le layout aligne les CTA en deux colonnes puis passe à une colonne sur mobile", async () => {
  const css = await readFile("app/v072-rights.css", "utf8");

  assert.match(css, /\.rights-options__grid\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.rights-option-card\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  assert.match(css, /\.rights-option-card__cta\s*\{[^}]*margin-top:\s*auto;/s);
  assert.match(css, /\.rights-option-card__action\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*100%;[^}]*min-height:\s*56px;/s);
  assert.match(css, /\.rights-option-card__notice\s*\{[^}]*min-height:\s*88px;/s);
  assert.match(css, /\.rights-option-card--partnership\s*\{[^}]*border-color:/s);
  assert.match(css, /\.rights-options__legal\s*\{[^}]*display:\s*grid;/s);
  assert.match(css, /@media \(max-width:\s*720px\)\s*\{[\s\S]*?\.rights-options__grid\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\);/);
});
