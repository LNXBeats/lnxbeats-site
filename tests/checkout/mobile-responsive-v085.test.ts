import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("V0.8.5 Commander owns its scoped stylesheet and collapses secondary mobile content", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  const page = readFileSync("app/commander/page.tsx", "utf8");
  const form = readFileSync("components/music-order-form.tsx", "utf8");
  const css = readFileSync("app/v084-commander.css", "utf8");

  assert.doesNotMatch(layout, /v084-commander\.css/);
  assert.match(page, /import "\.\.\/v084-commander\.css"/);
  assert.match(page, /className="commander-meeting-v084__desktop"/);
  assert.match(page, /<details className="commander-meeting-v084__details commander-meeting-v084__mobile">/);
  assert.match(page, /<summary>Comment ça marche<\/summary>/);
  assert.match(form, /<details className="order-aside__disclosure order-aside__mobile">/);
  assert.match(form, /Récapitulatif en temps réel/);
  assert.match(form, /orderPricingForVersion\(activePricingVersion\)/);
  assert.ok(form.indexOf('className="order-aside order-aside--live"') < form.indexOf('<form className="order-form'), "le résumé doit précéder le formulaire dans l’ordre DOM");
  assert.match(css, /\.commander-meeting-v084__desktop \{ display: block; \}/);
  assert.match(css, /\.commander-meeting-v084__mobile \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.commander-meeting-v084__desktop \{ display: none; \}[\s\S]*?\.commander-meeting-v084__mobile \{ display: block; \}/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.commander-hero-v084 \{[\s\S]*?min-height: 0;/);
  assert.match(css, /\.commander-v084 \.order-aside::after \{ pointer-events: none; \}/);
  assert.match(css, /@media \(max-width: 1100px\) \{[\s\S]*?\.commander-v084 \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(max-width: 1100px\) and \(min-width: 601px\)[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /scroll-margin-top: calc\(var\(--header-height\) \+ max\(6px, env\(safe-area-inset-top\)\) \+ 1\.25rem\);/);
  assert.doesNotMatch(css, /\.illustration-format-choice small \{ display: none; \}/);
});

test("Commander keeps payment assurance fail-closed when providers are unavailable", () => {
  const form = readFileSync("components/music-order-form.tsx", "utf8");

  assert.match(form, /hasPaymentProvider \? "Paiement sécurisé" : "Données protégées"/);
  assert.match(form, /Aucun paiement n’est proposé tant qu’aucun moyen sécurisé n’est disponible/);
});

test("Commander mobile steps remain readable from 320 to 430 pixels", () => {
  const css = readFileSync("app/v084-commander.css", "utf8");

  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.order-direction-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*?\.order-direction-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.order-upload-zone:has\(\+ \.order-upload-input:focus-visible\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
