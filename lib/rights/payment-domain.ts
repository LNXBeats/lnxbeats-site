import { publicationLicenseOffer, publicationLicenseTerms } from "@/data/rights-offer";
import type { RightsProviderEvent } from "@/lib/rights/payment-types";

export const RIGHTS_AMOUNT_CENTS = publicationLicenseOffer.PUBLICATION_LICENSE.priceCents;
export const RIGHTS_CURRENCY = publicationLicenseOffer.PUBLICATION_LICENSE.currency;
export const RIGHTS_PRICING_VERSION = publicationLicenseOffer.PUBLICATION_LICENSE.pricingVersion;
export const RIGHTS_TERMS_VERSION = publicationLicenseTerms.version;

export function assertRightsProviderEvent(event: RightsProviderEvent, expectedMode: "TEST" | "LIVE") {
  if (
    !event.eventId || event.eventId.length > 255
    || !event.type || event.type.length > 160
    || !event.paymentId
    || Number.isNaN(event.occurredAt.getTime())
    || event.livemode !== (expectedMode === "LIVE")
  ) return "RIGHTS_PROVIDER_EVENT_INVALID" as const;
  if (event.evidenceConsistent === false) return "RIGHTS_PROVIDER_EVIDENCE_INCONSISTENT" as const;
  if (event.status === "SUCCEEDED" && (
    !event.providerPaymentId
    || event.amountCents !== RIGHTS_AMOUNT_CENTS
    || event.currency !== RIGHTS_CURRENCY
  )) return "RIGHTS_PROVIDER_FINANCIAL_MISMATCH" as const;
  return null;
}
