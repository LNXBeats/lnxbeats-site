import "server-only";

import { rightsOffers, type PublicRightsOfferType } from "@/data/rights-offer";
import { prisma } from "@/lib/prisma";
import { isLegalTemplateUsable } from "@/lib/rights/domain";
import { rightsOpeningConfiguration } from "@/lib/rights/opening-config";
import { isPublicationLicenseV3CanonicalSource, validateContractTemplate } from "@/lib/rights/templates";

export type RightsCommerceState = "BLOCKED" | "READY_NOT_OPEN" | "OPEN";

export type RightsCommerceTemplate = Readonly<{
  type: string;
  version: number;
  status: string;
  sourceMarkup: string;
  approvedAt: Date | null;
  approvedByAdminId: string | null;
  legalReviewReference: string | null;
}>;

export type RightsCommerceReason =
  | "REQUIRED_TEMPLATE_MISSING"
  | "TEMPLATE_SOURCE_INVALID"
  | "LEGAL_REVIEW_REQUIRED"
  | "TEMPLATE_RENDERER_BINDING_MISSING"
  | "RIGHTS_BILLING_UNAVAILABLE"
  | "RIGHTS_PAYMENT_UNAVAILABLE"
  | "RIGHTS_ACTIVATION_UNAVAILABLE"
  | "RIGHTS_COMMERCE_CONFIGURATION_INCOMPLETE"
  | "RIGHTS_PAYMENT_CONFIGURATION_INCOMPLETE"
  | "RIGHTS_PRODUCTION_CONFIRMATION_REQUIRED";

type RightsCommerceCapabilities = Readonly<{
  rendererBindingReady: boolean;
  billingReady: boolean;
  paymentReady: boolean;
  activationReady: boolean;
}>;

// These are tested code capabilities, not opening flags. Production remains
// fail-closed through the dedicated runtime configuration and the approved
// contract template even when this technical readiness is complete.
export const rightsCommerceCapabilities: RightsCommerceCapabilities = Object.freeze({
  rendererBindingReady: true,
  billingReady: true,
  paymentReady: true,
  activationReady: true,
});

export type RightsOfferCommerceReadiness = Readonly<{
  type: PublicRightsOfferType;
  label: string;
  title: string;
  priceCents: number;
  currency: string;
  pricingVersion: string;
  requiredTemplateType: PublicRightsOfferType;
  requiredTemplateVersion: number;
  templateVersion: number | null;
  templateStatus: string | null;
  templateSourceValid: boolean;
  legalReviewApproved: boolean;
  rendererBound: boolean;
  billingReady: boolean;
  paymentReady: boolean;
  activationReady: boolean;
  reasons: readonly RightsCommerceReason[];
}>;

export type RightsCommerceReadiness = Readonly<{
  state: RightsCommerceState;
  open: boolean;
  openingRequested: boolean;
  offers: readonly RightsOfferCommerceReadiness[];
  reasons: readonly RightsCommerceReason[];
}>;

function templateForOffer(
  templates: readonly RightsCommerceTemplate[],
  type: PublicRightsOfferType,
) {
  const offer = rightsOffers[type];
  return templates.find((template) => template.type === type && template.version === offer.contractTemplateVersion) ?? null;
}

function offerReadiness(
  type: PublicRightsOfferType,
  templates: readonly RightsCommerceTemplate[],
): RightsOfferCommerceReadiness {
  const offer = rightsOffers[type];
  const template = templateForOffer(templates, type);
  const templateSourceValid = Boolean(template && validateContractTemplate(template.sourceMarkup).ok);
  const rendererBound = Boolean(template
    && rightsCommerceCapabilities.rendererBindingReady
    && type === "PUBLICATION_LICENSE"
    && isPublicationLicenseV3CanonicalSource(template.sourceMarkup));
  const legalReviewApproved = Boolean(template && isLegalTemplateUsable(
    template.status,
    template.approvedAt,
    template.approvedByAdminId,
    template.legalReviewReference,
  ));
  const reasons: RightsCommerceReason[] = [];

  if (!template) reasons.push("REQUIRED_TEMPLATE_MISSING");
  else if (!templateSourceValid) reasons.push("TEMPLATE_SOURCE_INVALID");
  if (!legalReviewApproved) reasons.push("LEGAL_REVIEW_REQUIRED");
  if (!rendererBound) reasons.push("TEMPLATE_RENDERER_BINDING_MISSING");
  if (!rightsCommerceCapabilities.billingReady) reasons.push("RIGHTS_BILLING_UNAVAILABLE");
  if (!rightsCommerceCapabilities.paymentReady) reasons.push("RIGHTS_PAYMENT_UNAVAILABLE");
  if (!rightsCommerceCapabilities.activationReady) reasons.push("RIGHTS_ACTIVATION_UNAVAILABLE");

  return {
    type,
    label: offer.label,
    title: offer.title,
    priceCents: offer.priceCents,
    currency: offer.currency,
    pricingVersion: offer.pricingVersion,
    requiredTemplateType: type,
    requiredTemplateVersion: offer.contractTemplateVersion,
    templateVersion: template?.version ?? null,
    templateStatus: template?.status ?? null,
    templateSourceValid,
    legalReviewApproved,
    rendererBound,
    billingReady: rightsCommerceCapabilities.billingReady,
    paymentReady: rightsCommerceCapabilities.paymentReady,
    activationReady: rightsCommerceCapabilities.activationReady,
    reasons,
  };
}

export function evaluateRightsCommerceReadiness(
  templates: readonly RightsCommerceTemplate[],
  environment: Record<string, string | undefined> = process.env,
): RightsCommerceReadiness {
  const offers = (Object.keys(rightsOffers) as PublicRightsOfferType[]).map((type) => offerReadiness(type, templates));
  const opening = rightsOpeningConfiguration(environment);
  const reasons = [...new Set(offers.flatMap((offer) => offer.reasons))];
  if (opening.openingRequested) {
    if (!opening.commerceEnabled) reasons.push("RIGHTS_COMMERCE_CONFIGURATION_INCOMPLETE");
    if (!opening.paymentsEnabled) reasons.push("RIGHTS_PAYMENT_CONFIGURATION_INCOMPLETE");
    if (!opening.productionConfirmed) reasons.push("RIGHTS_PRODUCTION_CONFIRMATION_REQUIRED");
  }
  const ready = reasons.length === 0;
  const state: RightsCommerceState = ready
    ? opening.complete ? "OPEN" : "READY_NOT_OPEN"
    : "BLOCKED";

  return {
    state,
    open: state === "OPEN",
    openingRequested: opening.openingRequested,
    offers,
    reasons,
  };
}

export function assertRightsCommerceOpen(
  templates: readonly RightsCommerceTemplate[],
  environment: Record<string, string | undefined> = process.env,
) {
  const readiness = evaluateRightsCommerceReadiness(templates, environment);
  if (!readiness.open) throw new Error("RIGHTS_COMMERCE_NOT_OPEN");
  return readiness;
}

export async function loadRightsCommerceReadiness(
  environment: Record<string, string | undefined> = process.env,
) {
  const templates = await prisma.contractTemplate.findMany({
    select: {
      type: true,
      version: true,
      status: true,
      sourceMarkup: true,
      approvedAt: true,
      approvedByAdminId: true,
      legalReviewReference: true,
    },
  });
  return evaluateRightsCommerceReadiness(templates, environment);
}
