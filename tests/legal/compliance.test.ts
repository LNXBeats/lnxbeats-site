import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertCandidateLegalRegistry,
  consumerMediatorInformation,
  legalCandidateHistory,
  legalCandidates,
  legalNoticesCandidate,
  musicTermsCandidate,
  phase4b1LegalNoticesCandidate,
  phase4bLegalNoticesCandidate,
  phase4bMusicTermsCandidate,
  phase4bPrivacyCandidate,
  phase4bShopTermsCandidate,
  phase4cMusicTermsCandidate,
  phase4cShopTermsCandidate,
  phase4cWithdrawalNoticeCandidate,
  privacyCandidate,
  releaseBPrivacyCandidate,
  releaseBShopTermsCandidate,
  shopTermsCandidate,
  withdrawalNoticeCandidate,
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

test("all legal documents are immutable-looking, hashed, non-approved candidates", () => {
  assert.equal(assertCandidateLegalRegistry(), legalCandidates);
  assert.equal(legalCandidates.length, 5);
  for (const document of legalCandidates) {
    assert.match(document.version, /-(?:draft|candidate)$/);
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
    "MUSIC_CONTRACT_CLASSIFICATION", "EARLY_PERFORMANCE_WITHDRAWAL_WORDING",
    "SHOP_CONTRACT_FORMATION_TIME", "SEALED_AUDIO_WITHDRAWAL_EXACT_WORDING",
  ]) assert.match(body, new RegExp(code));
  for (const resolvedCode of ["VAT_AND_INVOICING_STATUS", "MUSIC_DELIVERY_DELAY", "MUSIC_REVISION_POLICY", "B2B_TERMS_SCOPE"]) {
    assert.doesNotMatch(body, new RegExp(resolvedCode), `${resolvedCode} must not remain a candidate blocker.`);
  }
});

test("Phase 4B creates new immutable candidates without rewriting Phase 4A hashes", () => {
  assert.equal(legalNoticesCandidate.version, "legal-notices-2026-01-draft");
  assert.equal(musicTermsCandidate.version, "music-cgv-2026-01-draft");
  assert.equal(phase4bLegalNoticesCandidate.version, "legal-notices-2026-02-draft");
  assert.equal(phase4bMusicTermsCandidate.version, "music-cgv-2026-02-draft");
  assert.equal(phase4bShopTermsCandidate.version, "shop-cgv-2026-02-draft");
  assert.equal(phase4bPrivacyCandidate.version, "privacy-2026-02-draft");
  assert.notEqual(phase4bMusicTermsCandidate.hashSha256, musicTermsCandidate.hashSha256);
  assert.match(JSON.stringify(phase4bLegalNoticesCandidate), /entrepreneur individuel/i);
  assert.doesNotMatch(JSON.stringify(phase4bLegalNoticesCandidate), /micro-entrepreneur|auto-entrepreneur/i);
  assert.match(JSON.stringify(phase4bMusicTermsCandidate), /sept à quatorze jours/);
  assert.match(JSON.stringify(phase4bShopTermsCandidate), /Colissimo avec signature/);
  assert.match(JSON.stringify(phase4bPrivacyCandidate), /dix ans/);
});

test("Phase 4B.1 publishes complete CM2C candidate metadata through a new immutable revision", () => {
  assert.equal(phase4bLegalNoticesCandidate.version, "legal-notices-2026-02-draft");
  assert.equal(phase4b1LegalNoticesCandidate.version, "legal-notices-2026-03-draft");
  assert.notEqual(phase4b1LegalNoticesCandidate.hashSha256, phase4bLegalNoticesCandidate.hashSha256);
  assert.ok(legalCandidateHistory.includes(phase4bLegalNoticesCandidate));
  assert.ok(legalCandidateHistory.includes(phase4b1LegalNoticesCandidate));
  assert.equal(consumerMediatorInformation.name, "Centre de la Médiation de la Consommation de Conciliateurs de Justice — CM2C");
  assert.deepEqual(consumerMediatorInformation.addressLines, ["49 rue de Ponthieu", "75008 Paris", "France"]);
  assert.equal(consumerMediatorInformation.phone, "01 89 47 00 14");
  assert.equal(consumerMediatorInformation.phoneE164, "+33189470014");
  assert.equal(consumerMediatorInformation.website, "https://www.cm2c.net/");
  const candidate = JSON.stringify(phase4b1LegalNoticesCandidate);
  assert.match(candidate, /49 rue de Ponthieu/);
  assert.match(candidate, /01 89 47 00 14/);
  assert.match(candidate, /https:\/\/www\.cm2c\.net\//);
  assert.notEqual(professionalInformation.phone, consumerMediatorInformation.phone);
  const page = source("app/mentions-legales/page.tsx");
  assert.match(page, /phase4b1LegalNoticesCandidate/);
  const component = source("components/legal-candidate-document.tsx");
  assert.match(component, /consumerMediatorInformation\.phone/);
  assert.match(component, /consumerMediatorInformation\.website/);
});

test("Phase 4C creates explicit candidate revisions without rewriting legal history", () => {
  assert.equal(phase4cMusicTermsCandidate.version, "music-cgv-2026-03-draft");
  assert.equal(phase4cShopTermsCandidate.version, "shop-cgv-2026-03-draft");
  assert.equal(phase4cWithdrawalNoticeCandidate.version, "withdrawal-2026-02-draft");
  for (const candidate of [phase4cMusicTermsCandidate, phase4cShopTermsCandidate, phase4cWithdrawalNoticeCandidate]) {
    assert.equal(candidate.status, "AWAITING_LEGAL_REVIEW");
    assert.equal(candidate.effectiveAt, null);
    assert.equal(candidate.approvedAt, null);
    assert.equal(candidate.approvedBy, null);
  }
  for (const historical of [
    musicTermsCandidate, phase4bMusicTermsCandidate,
    shopTermsCandidate, phase4bShopTermsCandidate,
    withdrawalNoticeCandidate,
  ]) assert.ok(legalCandidateHistory.includes(historical));
  assert.notEqual(phase4cMusicTermsCandidate.hashSha256, phase4bMusicTermsCandidate.hashSha256);
  assert.notEqual(phase4cShopTermsCandidate.hashSha256, phase4bShopTermsCandidate.hashSha256);
  assert.notEqual(phase4cWithdrawalNoticeCandidate.hashSha256, withdrawalNoticeCandidate.hashSha256);
});

test("Release B creates new Shop and privacy candidates without approving or rewriting Phase 4C", () => {
  assert.equal(releaseBShopTermsCandidate.version, "shop-cgv-2026-04-candidate");
  assert.equal(releaseBPrivacyCandidate.version, "privacy-2026-03-candidate");
  for (const candidate of [releaseBShopTermsCandidate, releaseBPrivacyCandidate]) {
    assert.equal(candidate.status, "AWAITING_LEGAL_REVIEW");
    assert.equal(candidate.effectiveAt, null);
    assert.equal(candidate.approvedAt, null);
    assert.equal(candidate.approvedBy, null);
  }
  assert.ok(legalCandidateHistory.includes(phase4cShopTermsCandidate));
  assert.ok(legalCandidateHistory.includes(phase4bPrivacyCandidate));
  assert.notEqual(releaseBShopTermsCandidate.hashSha256, phase4cShopTermsCandidate.hashSha256);
  assert.notEqual(releaseBPrivacyCandidate.hashSha256, phase4bPrivacyCandidate.hashSha256);
});

test("Phase 4C music wording treats the order as a creative service and preserves withdrawal rights", () => {
  const body = JSON.stringify(phase4cMusicTermsCandidate);
  assert.match(body, /prestation de services créatifs réalisée sur commande, donnant lieu à la livraison d’un contenu numérique/);
  assert.match(body, /Je demande expressément que LNX Beats commence l’exécution de ma commande avant la fin du délai légal de rétractation de 14 jours/);
  assert.match(body, /une fois la prestation entièrement exécutée, je ne pourrai plus exercer mon droit de rétractation/);
  assert.match(body, /proportionnellement au service fourni, conformément à l’article L\. 221-25/);
  assert.match(body, /case non précochée/);
  assert.match(body, /Le commencement de la prestation ne provoque pas une renonciation immédiate/);
  assert.doesNotMatch(body, /bien personnalisé[^.]*exclu(?:t|sion)|aucun droit de rétractation car personnalis/i);
});

test("Phase 4C Shop wording ties formation to server-confirmed payment and keeps sealed-audio guarantees", () => {
  const body = JSON.stringify(phase4cShopTermsCandidate);
  assert.match(body, /La vente est définitivement conclue après validation du paiement et confirmation de la commande par LNX Beats/);
  assert.match(body, /En cas de refus ou d’échec du paiement, la commande n’est pas considérée comme définitivement validée/);
  assert.match(body, /Le simple retour du navigateur depuis Stripe ou PayPal ne constitue jamais une preuve de paiement/);
  assert.match(body, /le droit de rétractation ne peut être exercé pour les enregistrements audio descellés par le consommateur après leur livraison/);
  assert.match(body, /Tant que le produit demeure scellé, le droit de rétractation reste applicable/);
  assert.match(body, /garantie légale de conformité/);
  assert.doesNotMatch(body, /CD non repris ni échangé/i);
});

test("Phase 4C keeps early-performance consent out of runtime until separate evidence exists", () => {
  const commander = source("components/music-order-form.tsx");
  const versioning = source("docs/LEGAL_VERSIONING.md");
  assert.doesNotMatch(commander, /Je demande expressément que LNX Beats commence l’exécution/);
  assert.match(versioning, /case distincte, non précochée/);
  assert.match(versioning, /choix, la version, l’empreinte SHA-256 et l’horodatage côté serveur/);
  assert.match(versioning, /Les champs `personalUseTerms\*` existants ne constituent pas une preuve distincte adaptée/);
  assert.match(versioning, /Aucune migration ni collecte runtime n’est introduite en Phase 4C/);
});

test("the CM2C convention review dates are internal reminders and not candidate effective dates", () => {
  const register = source("docs/LEGAL_SOURCE_REGISTER.md");
  assert.match(register, /expire le \*\*27\/08\/2029\*\*/);
  assert.match(register, /à partir du \*\*27\/05\/2029\*\*/);
  assert.match(register, /rappel interne/i);
  assert.equal(phase4b1LegalNoticesCandidate.effectiveAt, null);
  assert.equal(phase4b1LegalNoticesCandidate.approvedAt, null);
});

test("Phase 4C preserves CM2C and every unresolved source recheck marker", () => {
  const body = JSON.stringify(legalCandidates);
  assert.match(body, /Centre de la Médiation de la Consommation de Conciliateurs de Justice — CM2C/);
  for (const code of [
    "RAILWAY_LEGAL_ENTITY_AND_ADDRESS",
    "CLOUDFLARE_LEGAL_ENTITY_AND_ADDRESS",
    "OVHCLOUD_LEGAL_ENTITY_AND_ADDRESS",
    "CM2C_CONTACT_DETAILS_BEFORE_PUBLICATION",
    "PROCESSOR_TRANSFER_MECHANISMS",
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
  assert.match(source("app/cgv/creation-musicale/page.tsx"), /phase4cMusicTermsCandidate/);
  assert.match(source("app/cgv/boutique/page.tsx"), /releaseBShopTermsCandidate/);
  assert.match(source("app/confidentialite/page.tsx"), /releaseBPrivacyCandidate/);
  assert.match(source("app/retractation/page.tsx"), /phase4cWithdrawalNoticeCandidate/);
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
