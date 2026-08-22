import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("les offres de droits restent distinctes, sans paiement ni changement de routes", async () => {
  const component = await readFile("components/rights-options-section.tsx", "utf8");
  const articles = component.match(/<article\b/g) ?? [];
  const publicationIndex = component.indexOf("rights-publication-title");
  const partnershipIndex = component.indexOf("rights-partnership-title");

  assert.equal(articles.length, 2);
  assert.ok(publicationIndex >= 0 && partnershipIndex > publicationIndex);
  assert.match(component, /formatEuro\(15_000\)/);
  assert.match(component, /formatEuro\(150_000\)/);
  assert.match(component, /droits\/licence/);
  assert.match(component, /droits\/partenariat/);
  assert.match(component, /compte\/droits\/\$\{encodeURIComponent\(publication\.requestNumber\)\}/);
  assert.match(component, /compte\/droits\/\$\{encodeURIComponent\(partnership\.requestNumber\)\}/);
  assert.match(component, /Aucune facturation\./);
  assert.match(component, /Validation manuelle de LNX Beats obligatoire avant tout contrat ou paiement\./);
  assert.match(component, /className="rights-options__legal" role="note"/);
  assert.match(component, /<span aria-hidden="true">i<\/span>/);
  assert.doesNotMatch(component, /Stripe|PaymentIntent|checkout/i);
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
