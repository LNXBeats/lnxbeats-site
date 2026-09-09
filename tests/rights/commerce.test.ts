import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { rightsOffers, type RightsOfferType } from "@/data/rights-offer";
import {
  assertRightsCommerceOpen,
  evaluateRightsCommerceReadiness,
  type RightsCommerceTemplate,
} from "@/lib/rights/commerce";
import { publicationLicenseDraftTemplate } from "@/lib/rights/templates";

function template(
  type: RightsOfferType,
  input: Partial<RightsCommerceTemplate> = {},
): RightsCommerceTemplate {
  return {
    type,
    version: 3,
    status: "APPROVED",
    sourceMarkup: publicationLicenseDraftTemplate,
    approvedAt: new Date("2026-09-08T10:00:00.000Z"),
    approvedByAdminId: "00000000-0000-4000-8000-000000000001",
    legalReviewReference: "REVUE-JURIDIQUE-QA",
    ...input,
  };
}

test("rights commerce publishes only the server-owned 150 euro offer", () => {
  const readiness = evaluateRightsCommerceReadiness([]);
  const offers = Object.fromEntries(readiness.offers.map((offer) => [offer.type, offer]));

  assert.deepEqual(
    {
      priceCents: offers.PUBLICATION_LICENSE?.priceCents,
      currency: offers.PUBLICATION_LICENSE?.currency,
      pricingVersion: offers.PUBLICATION_LICENSE?.pricingVersion,
      requiredTemplateType: offers.PUBLICATION_LICENSE?.requiredTemplateType,
    },
    {
      priceCents: rightsOffers.PUBLICATION_LICENSE.priceCents,
      currency: rightsOffers.PUBLICATION_LICENSE.currency,
      pricingVersion: rightsOffers.PUBLICATION_LICENSE.pricingVersion,
      requiredTemplateType: "PUBLICATION_LICENSE",
    },
  );
  assert.equal(readiness.offers.length, 1);
  assert.equal(offers.EXPLOITATION_PARTNERSHIP, undefined);
});

test("rights commerce is blocked when required legal templates are absent", () => {
  const readiness = evaluateRightsCommerceReadiness([], {});

  assert.equal(readiness.state, "BLOCKED");
  assert.equal(readiness.open, false);
  assert.equal(readiness.openingRequested, false);
  assert.ok(readiness.offers.every((offer) => offer.templateVersion === null));
  assert.ok(readiness.offers.every((offer) => offer.reasons.includes("REQUIRED_TEMPLATE_MISSING")));
  assert.ok(readiness.offers.every((offer) => offer.reasons.includes("LEGAL_REVIEW_REQUIRED")));
});

test("tested code capabilities remain ready but closed when no opening is requested", () => {
  const readiness = evaluateRightsCommerceReadiness([
    template("PUBLICATION_LICENSE"),
  ], {});

  assert.equal(readiness.state, "READY_NOT_OPEN");
  assert.equal(readiness.open, false);
  assert.equal(readiness.openingRequested, false);
  assert.ok(readiness.offers.every((offer) => offer.templateSourceValid));
  assert.ok(readiness.offers.every((offer) => offer.legalReviewApproved));
  assert.ok(readiness.offers.every((offer) => offer.rendererBound));
  assert.ok(readiness.offers.every((offer) => offer.billingReady));
  assert.ok(readiness.offers.every((offer) => offer.paymentReady));
  assert.ok(readiness.offers.every((offer) => offer.activationReady));
  assert.deepEqual(readiness.reasons, []);
  assert.throws(
    () => assertRightsCommerceOpen([
      template("PUBLICATION_LICENSE"),
    ], {}),
    /RIGHTS_COMMERCE_NOT_OPEN/,
  );
});

test("a partial opening request is blocked with actionable runtime reasons", () => {
  const readiness = evaluateRightsCommerceReadiness([
    template("PUBLICATION_LICENSE"),
  ], { RIGHTS_COMMERCE_ENABLED: "true" });

  assert.equal(readiness.state, "BLOCKED");
  assert.equal(readiness.openingRequested, true);
  assert.deepEqual(readiness.reasons, ["RIGHTS_PAYMENT_CONFIGURATION_INCOMPLETE"]);
});

test("complete local configuration opens only an approved valid template", () => {
  const environment = { RIGHTS_COMMERCE_ENABLED: "true", RIGHTS_PAYMENTS_ENABLED: "true" };
  const readiness = evaluateRightsCommerceReadiness([template("PUBLICATION_LICENSE")], environment);
  assert.equal(readiness.state, "OPEN");
  assert.equal(readiness.open, true);
  assert.doesNotThrow(() => assertRightsCommerceOpen([template("PUBLICATION_LICENSE")], environment));

  const draft = evaluateRightsCommerceReadiness([template("PUBLICATION_LICENSE", {
    status: "DRAFT", approvedAt: null, approvedByAdminId: null, legalReviewReference: null,
  })], environment);
  assert.equal(draft.state, "BLOCKED");
  assert.ok(draft.reasons.includes("LEGAL_REVIEW_REQUIRED"));
});

test("Production needs the exact dedicated confirmation", () => {
  const base = { NODE_ENV: "production", RIGHTS_COMMERCE_ENABLED: "true", RIGHTS_PAYMENTS_ENABLED: "true" };
  const missing = evaluateRightsCommerceReadiness([template("PUBLICATION_LICENSE")], base);
  assert.equal(missing.state, "BLOCKED");
  assert.ok(missing.reasons.includes("RIGHTS_PRODUCTION_CONFIRMATION_REQUIRED"));
});

test("the offer is bound to the exact required v3 template, not a later draft", () => {
  const readiness = evaluateRightsCommerceReadiness([
    template("PUBLICATION_LICENSE"),
    template("PUBLICATION_LICENSE", {
      version: 4,
      status: "DRAFT",
      approvedAt: null,
      approvedByAdminId: null,
      legalReviewReference: null,
    }),
  ], {});
  const publication = readiness.offers.find((offer) => offer.type === "PUBLICATION_LICENSE");

  assert.equal(publication?.templateVersion, 3);
  assert.equal(publication?.templateStatus, "APPROVED");
  assert.equal(publication?.legalReviewApproved, true);
  assert.equal(publication?.rendererBound, true);
});

test("a syntactically valid but altered v3 source is not renderer-bound", () => {
  const readiness = evaluateRightsCommerceReadiness([
    template("PUBLICATION_LICENSE", { sourceMarkup: `${publicationLicenseDraftTemplate}\nTexte ajouté.` }),
  ], { RIGHTS_COMMERCE_ENABLED: "true", RIGHTS_PAYMENTS_ENABLED: "true" });
  assert.equal(readiness.state, "BLOCKED");
  assert.ok(readiness.reasons.includes("TEMPLATE_RENDERER_BINDING_MISSING"));
});

test("the Admin rights page separates offers, requests, legal models and fail-closed diagnostics", async () => {
  const [page, commerce] = await Promise.all([
    readFile("app/admin/droits/page.tsx", "utf8"),
    readFile("lib/rights/commerce.ts", "utf8"),
  ]);

  const offersIndex = page.indexOf(">Offres<");
  const requestsIndex = page.indexOf(">Demandes<");
  const templatesIndex = page.indexOf(">Modèles<");
  const diagnosticIndex = page.indexOf(">Diagnostic<");
  assert.ok(offersIndex >= 0 && requestsIndex > offersIndex && templatesIndex > requestsIndex && diagnosticIndex > templatesIndex);
  assert.match(page, /MODULE DROITS & CONTRATS NON OUVERT/);
  assert.match(page, /Validation juridique des modèles/);
  assert.match(page, /contractTemplateTypeLabels/);
  assert.match(page, /admin-template-grid admin-template-grid--offers/);
  assert.match(await readFile("app/admin/admin.css", "utf8"), /\.admin-template-grid--offers \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(page, /PUBLICATION_LICENSE: "Licence de publication"/);
  assert.match(page, /EXPLOITATION_PARTNERSHIP: "Partenariat d’exploitation"/);
  assert.doesNotMatch(page, /<dt>Modèle<\/dt><dd>\{offer\.requiredTemplateType\}<\/dd>/);
  assert.match(page, /Ancien périmètre 1 500 € non proposé/);
  assert.match(page, /Aucun produit, tarif, CTA ou checkout public n’est disponible/);
  assert.match(page, /<dt>Paiement activable<\/dt><dd>\{offer\.paymentReady && commerce\.open \? "Oui" : "Non"\}<\/dd>/);
  assert.match(page, /Achat public désactivé/);
  assert.match(page, /evaluateRightsCommerceReadiness\(templates\)/);
  assert.match(page, /<details className="admin-technical-details">/);
  assert.match(page, /<summary>DIAGNOSTIC AVANCÉ<\/summary>/);
  assert.doesNotMatch(page, /PRODUCTION BLOQUÉE/);
  assert.doesNotMatch(commerce, /RAILWAY|STRIPE|PAYPAL/);
});
