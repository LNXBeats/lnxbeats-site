import "server-only";

import { rightsOffers, type RightsOfferType } from "@/data/rights-offer";
import { isLegalTemplateUsable } from "@/lib/rights/domain";
import { validateContractTemplate } from "@/lib/rights/templates";

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
  | "RIGHTS_ACTIVATION_UNAVAILABLE";

type RightsCommerceCapabilities = Readonly<{
  rendererBindingReady: boolean;
  billingReady: boolean;
  paymentReady: boolean;
  activationReady: boolean;
}>;

// These are code capabilities, not environment flags. Keeping them false makes
// the current module fail closed even if a template is marked APPROVED in the
// database. Each capability must be replaced by a real, tested implementation
// before an opening can be considered.
export const rightsCommerceCapabilities: RightsCommerceCapabilities = Object.freeze({
  rendererBindingReady: false,
  billingReady: false,
  paymentReady: false,
  activationReady: false,
});

// Opening is an explicit future code decision. It is deliberately not driven by
// a remote variable while the technical and legal contracts are incomplete.
export const RIGHTS_COMMERCE_OPEN_REQUESTED: boolean = false;

// This is the member-facing creation gate. Existing requests remain readable
// through their ownership-protected routes, but a blocked offer must not expose
// or accept a new request merely because its historical form still exists.
export const RIGHTS_NEW_REQUESTS_ENABLED: boolean = false;

export type RightsOfferCommerceReadiness = Readonly<{
  type: RightsOfferType;
  label: string;
  title: string;
  priceCents: number;
  currency: string;
  pricingVersion: string;
  requiredTemplateType: RightsOfferType;
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

function latestTemplateForOffer(
  templates: readonly RightsCommerceTemplate[],
  type: RightsOfferType,
) {
  return templates
    .filter((template) => template.type === type)
    .sort((left, right) => right.version - left.version)[0] ?? null;
}

function offerReadiness(
  type: RightsOfferType,
  templates: readonly RightsCommerceTemplate[],
): RightsOfferCommerceReadiness {
  const offer = rightsOffers[type];
  const template = latestTemplateForOffer(templates, type);
  const templateSourceValid = Boolean(template && validateContractTemplate(template.sourceMarkup).ok);
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
  if (!rightsCommerceCapabilities.rendererBindingReady) reasons.push("TEMPLATE_RENDERER_BINDING_MISSING");
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
    templateVersion: template?.version ?? null,
    templateStatus: template?.status ?? null,
    templateSourceValid,
    legalReviewApproved,
    rendererBound: rightsCommerceCapabilities.rendererBindingReady,
    billingReady: rightsCommerceCapabilities.billingReady,
    paymentReady: rightsCommerceCapabilities.paymentReady,
    activationReady: rightsCommerceCapabilities.activationReady,
    reasons,
  };
}

export function evaluateRightsCommerceReadiness(
  templates: readonly RightsCommerceTemplate[],
): RightsCommerceReadiness {
  const offers = (Object.keys(rightsOffers) as RightsOfferType[]).map((type) => offerReadiness(type, templates));
  const reasons = [...new Set(offers.flatMap((offer) => offer.reasons))];
  const ready = reasons.length === 0;
  const state: RightsCommerceState = ready
    ? RIGHTS_COMMERCE_OPEN_REQUESTED ? "OPEN" : "READY_NOT_OPEN"
    : "BLOCKED";

  return {
    state,
    open: state === "OPEN",
    openingRequested: RIGHTS_COMMERCE_OPEN_REQUESTED,
    offers,
    reasons,
  };
}

export function assertRightsCommerceOpen(templates: readonly RightsCommerceTemplate[]) {
  const readiness = evaluateRightsCommerceReadiness(templates);
  if (!readiness.open) throw new Error("RIGHTS_COMMERCE_NOT_OPEN");
  return readiness;
}
