import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertCandidateLegalRegistry,
  legalCandidates,
  legalNoticesCandidate,
  musicTermsCandidate,
  privacyCandidate,
  shopTermsCandidate,
} from "../../data/legal";
import { professionalInformation } from "../../data/professional";
import { checkoutPaymentCtaLabel } from "../../lib/payments/presentation";
import { formatEuro } from "../../lib/orders/domain";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("professional identity is exact, complete and never presents LNX STUDIO as a company", () => {
  assert.equal(professionalInformation.name, "Ludovic Mickaël Mathon");
  assert.equal(professionalInformation.legalForm, "Entrepreneur individuel");
  assert.equal(professionalInformation.serviceName, "LNX STUDIO");
  assert.equal(professionalInformation.siren.replaceAll(" ", ""), "106870850");
  assert.equal(professionalInformation.siret.replaceAll(" ", ""), "10687085000018");
  assert.equal(professionalInformation.apeCodeCommunicated, "9003B");
  assert.deepEqual(professionalInformation.addressLines, ["35 Impasse des Orties", "07370 Ozon", "France"]);
  assert.equal(professionalInformation.email, "lnx.beats.pro@gmail.com");
  assert.equal(professionalInformation.phone, "06 71 66 70 32");
  assert.equal(professionalInformation.publicationDirector, "Ludovic Mickaël Mathon");
  assert.doesNotMatch(JSON.stringify(legalCandidates), /LNX STUDIO (?:SAS|SARL|SASU|est une société)/i);
});

test("all Phase 4 legal documents are immutable-looking, hashed, non-approved candidates", () => {
  assert.equal(assertCandidateLegalRegistry(), legalCandidates);
  assert.equal(legalCandidates.length, 5);
  for (const document of legalCandidates) {
    assert.match(document.version, /-draft$/);
    assert.match(document.hashSha256, /^[0-9a-f]{64}$/);
    assert.equal(document.status, "AWAITING_LEGAL_REVIEW");
    assert.equal(document.effectiveAt, null);
    assert.equal(document.approvedAt, null);
    assert.equal(document.approvedBy, null);
  }
  assert.notEqual(musicTermsCandidate.hashSha256, shopTermsCandidate.hashSha256);
  assert.notEqual(privacyCandidate.hashSha256, legalNoticesCandidate.hashSha256);
});

test("the mandatory human decisions are visible in the candidate corpus", () => {
  const body = JSON.stringify(legalCandidates);
  for (const code of [
    "MUSIC_CONTRACT_CLASSIFICATION", "EARLY_PERFORMANCE_OF_MUSIC_SERVICE", "MUSIC_DELIVERY_DELAY",
    "MUSIC_REVISION_POLICY", "SHOP_CONTRACT_FORMATION_TIME", "SEALED_AUDIO_PRODUCT_POLICY",
    "WHO_PAYS_WITHDRAWAL_RETURN_COSTS", "MUSIC_REFERENCE_FILE_RETENTION", "B2B_TERMS_SCOPE",
    "VAT_AND_INVOICING_STATUS", "ACCOUNTING_RETENTION_AND_INVOICE_FORMAT", "DELIVERY_COUNTRIES",
    "HANDLING_TIME", "DELIVERY_ESTIMATE", "RETURN_ADDRESS", "MINIMUM_BILLABLE_WEIGHT_150G",
    "COLISSIMO_RATE_POLICY", "COLISSIMO_SIGNATURE_POLICY", "TRACKING_POLICY",
  ]) assert.match(body, new RegExp(code));
});

test("Shop payment labels visibly state payment obligation while music labels stay stable", () => {
  assert.equal(checkoutPaymentCtaLabel("stripe", 3000), `Payer ${formatEuro(3000)} en toute sécurité`);
  assert.equal(checkoutPaymentCtaLabel("paypal", 3000), `Payer ${formatEuro(3000)} avec PayPal`);
  for (const provider of ["stripe", "paypal"] as const) {
    assert.equal(checkoutPaymentCtaLabel(provider, 3000, "shop"), `Payer ${formatEuro(3000)} — commande avec obligation de paiement`);
  }
});

test("public legal surfaces expose distinct terms, withdrawal, CM2C and no obsolete ODR link", () => {
  const files = [
    "app/mentions-legales/page.tsx", "app/cgv/page.tsx", "app/cgv/creation-musicale/page.tsx",
    "app/cgv/boutique/page.tsx", "app/confidentialite/page.tsx", "app/retractation/page.tsx",
    "components/legal-candidate-document.tsx", "components/site-footer.tsx",
  ].map(source).join("\n");
  assert.match(files, /cgv\/creation-musicale/);
  assert.match(files, /cgv\/boutique/);
  assert.match(files, /Exercer mon droit de rétractation/);
  assert.match(files, /CM2C/);
  assert.doesNotMatch(files, /ec\.europa\.eu\/consumers\/odr/i);
  assert.doesNotMatch(files, /date de naissance|sécurité sociale|pièce d’identité/i);
});

test("QA terms remain forbidden in production and candidates are not registered as approved", () => {
  const legal = source("lib/shop/legal.ts");
  assert.match(legal, /A QA-only Shop terms version is forbidden in a production runtime/);
  assert.doesNotMatch(legal, /shop-cgv-2026-01-draft/);
  assert.doesNotMatch(legal, /music-cgv-2026-01-draft/);
});

test("legal CSS is scoped, responsive, printable and keeps accessible touch targets", () => {
  const css = source("app/legal-compliance.css");
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media print/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(css.split("@media print")[0] ?? css, /!important/, "Runtime layout must not rely on important overrides.");
});
