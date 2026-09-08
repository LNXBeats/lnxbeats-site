import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { rightsOffers, type RightsOfferType } from "@/data/rights-offer";
import {
  assertRightsCommerceOpen,
  evaluateRightsCommerceReadiness,
  RIGHTS_NEW_REQUESTS_ENABLED,
  type RightsCommerceTemplate,
} from "@/lib/rights/commerce";

function template(
  type: RightsOfferType,
  input: Partial<RightsCommerceTemplate> = {},
): RightsCommerceTemplate {
  return {
    type,
    version: 1,
    status: "APPROVED",
    sourceMarkup: "# Conditions {{contractNumber}} — {{workTitle}}",
    approvedAt: new Date("2026-09-08T10:00:00.000Z"),
    approvedByAdminId: "00000000-0000-4000-8000-000000000001",
    legalReviewReference: "REVUE-JURIDIQUE-QA",
    ...input,
  };
}

test("rights commerce publishes the two server-owned offer snapshots", () => {
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
  assert.deepEqual(
    {
      priceCents: offers.EXPLOITATION_PARTNERSHIP?.priceCents,
      currency: offers.EXPLOITATION_PARTNERSHIP?.currency,
      pricingVersion: offers.EXPLOITATION_PARTNERSHIP?.pricingVersion,
      requiredTemplateType: offers.EXPLOITATION_PARTNERSHIP?.requiredTemplateType,
    },
    {
      priceCents: rightsOffers.EXPLOITATION_PARTNERSHIP.priceCents,
      currency: rightsOffers.EXPLOITATION_PARTNERSHIP.currency,
      pricingVersion: rightsOffers.EXPLOITATION_PARTNERSHIP.pricingVersion,
      requiredTemplateType: "EXPLOITATION_PARTNERSHIP",
    },
  );
});

test("new member rights requests are explicitly closed while offers are blocked", () => {
  assert.equal(RIGHTS_NEW_REQUESTS_ENABLED, false);
});

test("rights commerce is blocked when required legal templates are absent", () => {
  const readiness = evaluateRightsCommerceReadiness([]);

  assert.equal(readiness.state, "BLOCKED");
  assert.equal(readiness.open, false);
  assert.equal(readiness.openingRequested, false);
  assert.ok(readiness.offers.every((offer) => offer.templateVersion === null));
  assert.ok(readiness.offers.every((offer) => offer.reasons.includes("REQUIRED_TEMPLATE_MISSING")));
  assert.ok(readiness.offers.every((offer) => offer.reasons.includes("LEGAL_REVIEW_REQUIRED")));
});

test("legal approval alone cannot open commerce without renderer, billing, payment and activation", () => {
  const readiness = evaluateRightsCommerceReadiness([
    template("PUBLICATION_LICENSE"),
    template("EXPLOITATION_PARTNERSHIP"),
  ]);

  assert.equal(readiness.state, "BLOCKED");
  assert.equal(readiness.open, false);
  assert.ok(readiness.offers.every((offer) => offer.templateSourceValid));
  assert.ok(readiness.offers.every((offer) => offer.legalReviewApproved));
  assert.ok(readiness.offers.every((offer) => !offer.rendererBound));
  assert.ok(readiness.offers.every((offer) => !offer.billingReady));
  assert.ok(readiness.offers.every((offer) => !offer.paymentReady));
  assert.ok(readiness.offers.every((offer) => !offer.activationReady));
  assert.deepEqual(readiness.reasons, [
    "TEMPLATE_RENDERER_BINDING_MISSING",
    "RIGHTS_BILLING_UNAVAILABLE",
    "RIGHTS_PAYMENT_UNAVAILABLE",
    "RIGHTS_ACTIVATION_UNAVAILABLE",
  ]);
  assert.throws(
    () => assertRightsCommerceOpen([
      template("PUBLICATION_LICENSE"),
      template("EXPLOITATION_PARTNERSHIP"),
    ]),
    /RIGHTS_COMMERCE_NOT_OPEN/,
  );
});

test("the latest required template must itself carry a valid legal approval", () => {
  const readiness = evaluateRightsCommerceReadiness([
    template("PUBLICATION_LICENSE", { version: 1 }),
    template("PUBLICATION_LICENSE", {
      version: 2,
      status: "DRAFT",
      approvedAt: null,
      approvedByAdminId: null,
      legalReviewReference: null,
    }),
    template("EXPLOITATION_PARTNERSHIP"),
  ]);
  const publication = readiness.offers.find((offer) => offer.type === "PUBLICATION_LICENSE");

  assert.equal(publication?.templateVersion, 2);
  assert.equal(publication?.templateStatus, "DRAFT");
  assert.equal(publication?.legalReviewApproved, false);
  assert.ok(publication?.reasons.includes("LEGAL_REVIEW_REQUIRED"));
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
  assert.match(page, /MODULE DROITS &amp; CONTRATS NON OUVERT/);
  assert.match(page, /Validation juridique des modèles/);
  assert.match(page, /Les 1 500 € correspondent à l’offre LNX Beats de partenariat d’exploitation/);
  assert.match(page, /Ce n’est ni un tarif SACEM, ni une garantie d’éligibilité, de déclaration ou de répartition/);
  assert.match(page, /<dt>Paiement activable<\/dt><dd>\{offer\.paymentReady && commerce\.open \? "Oui" : "Non"\}<\/dd>/);
  assert.match(page, /Achat public désactivé/);
  assert.match(page, /evaluateRightsCommerceReadiness\(templates\)/);
  assert.match(page, /<details className="admin-technical-details">/);
  assert.match(page, /<summary>DIAGNOSTIC AVANCÉ<\/summary>/);
  assert.doesNotMatch(page, /PRODUCTION BLOQUÉE/);
  assert.doesNotMatch(commerce, /process\.env|RAILWAY|STRIPE|PAYPAL/);
});
