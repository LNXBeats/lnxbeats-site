import "server-only";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { DigitalError } from "./domain";
import { DIGITAL_POSTAL_REFERENCE_SOURCE_SHA, DIGITAL_POSTAL_REFERENCE_VERSION, digitalPostalAddressCoherent } from "./postal-reference";
import { DIGITAL_FRANCE_RESIDENCE_V2_POLICY, DIGITAL_FRANCE_RESIDENCE_V2_POLICY_HASH, evaluateDigitalFranceResidenceV2, type DigitalFranceBillingContext, type DigitalFranceResidenceDeclarationV2, type DigitalFranceResidenceSnapshotV2 } from "./france-residence-v2-policy";

export const DIGITAL_ADDRESS_CHECKOUT_POLICY = "DCN-FR-DECLARED-ADDRESS-CHECKOUT-1" as const;
export const DIGITAL_ADDRESS_CHECKOUT_POLICY_HASH = billingSnapshotHash({
  policy: DIGITAL_ADDRESS_CHECKOUT_POLICY, scope: "FR_METROPOLITAN_CORSICA_ONLY", basis: "BUYER_DECLARATION_AND_SERVER_COHERENCE_NOT_RESIDENCE_CERTIFICATION",
  postalReference: DIGITAL_POSTAL_REFERENCE_VERSION, sourceSha256: DIGITAL_POSTAL_REFERENCE_SOURCE_SHA,
  billing: "SAME_ADDRESS_ONLY_NO_KNOWN_CONFLICT", historicalManualReview: "UNCHANGED_NO_AUTOMATIC_OVERRIDE", validityDays: 365,
});
export type DigitalDeclaredAddressSnapshot = {
  policy: typeof DIGITAL_ADDRESS_CHECKOUT_POLICY; policyHash: string; territory: "METROPOLITAN_CORSICA"; subjectUserId: string; countryCode: "FR";
  residenceDeclarationId: string; declarationRecordHash: string; addressHash: string; residencePostalCode: string; billingPostalCode: string;
  billingContextHash: string; billingDocumentIds: string[]; basis: "BUYER_DECLARATION_AND_SERVER_COHERENCE";
  declarationRecordedAt: string; expiresAt: string; postalReferenceVersion: string; postalReferenceSourceSha256: string;
};
export type DigitalCheckoutResidenceSnapshot = DigitalFranceResidenceSnapshotV2 | DigitalDeclaredAddressSnapshot;
export type DigitalAddressCheckoutAssessment = {
  eligible: boolean; code: string; residenceVerified: boolean; paymentAllowed: false;
  basis: "MANUAL_REVIEW" | "DECLARED_ADDRESS_CHECKS" | null; snapshot?: DigitalCheckoutResidenceSnapshot;
};
export const blockedAddressCheckout = (code: string): DigitalAddressCheckoutAssessment => ({ eligible: false, code, residenceVerified: false, paymentAllowed: false, basis: null });

/** Buyer statement + local routing/billing coherence. Never an Admin approval,
 * proof of occupation, identity check or second independent residence proof.
 * Call only with this buyer's freshly loaded, immutable repository records.
 */
export function evaluateDeclaredAddressCheckout(input: { residenceDeclarationId: string; addressHash: string; billingPostalCode: string },
  userId: string, declaration: DigitalFranceResidenceDeclarationV2 | null, billing: DigitalFranceBillingContext, now = new Date()): DigitalAddressCheckoutAssessment {
  const base = evaluateDigitalFranceResidenceV2(input, userId, declaration, null, billing, now);
  if (base.status !== "PREPARED" || base.code !== "FRANCE_RESIDENCE_MANUAL_REVIEW_REQUIRED" || !declaration) return blockedAddressCheckout(base.code);
  if (declaration.address.postalCode !== declaration.billingPostalCode) return blockedAddressCheckout("FRANCE_BILLING_ADDRESS_DIFFERENT_REQUIRES_REVIEW");
  if (billing.status === "CONFLICT" || billing.documents.some(d => d.addressAvailable &&
    (d.countryCode !== "FR" || d.postalCode !== declaration.billingPostalCode))) return blockedAddressCheckout("FRANCE_RESIDENCE_BILLING_CONFLICT_REVIEW_REQUIRED");
  if (!digitalPostalAddressCoherent(declaration.address.countryCode, declaration.address.postalCode, declaration.address.city)) return blockedAddressCheckout("FRANCE_ADDRESS_POSTAL_CITY_MISMATCH");
  const expiresAt = new Date(Date.parse(declaration.createdAt) + 365 * 86_400_000).toISOString();
  if (Date.parse(expiresAt) <= now.getTime()) return blockedAddressCheckout("FRANCE_ADDRESS_DECLARATION_EXPIRED");
  return { eligible: true, code: "FRANCE_DECLARED_ADDRESS_ELIGIBLE", residenceVerified: false, paymentAllowed: false, basis: "DECLARED_ADDRESS_CHECKS", snapshot: {
    policy: DIGITAL_ADDRESS_CHECKOUT_POLICY, policyHash: DIGITAL_ADDRESS_CHECKOUT_POLICY_HASH, territory: "METROPOLITAN_CORSICA", subjectUserId: userId, countryCode: "FR",
    residenceDeclarationId: declaration.eventId, declarationRecordHash: declaration.recordHash, addressHash: declaration.addressHash,
    residencePostalCode: declaration.address.postalCode, billingPostalCode: declaration.billingPostalCode,
    billingContextHash: billing.hash, billingDocumentIds: billing.documents.map(d => d.id), basis: "BUYER_DECLARATION_AND_SERVER_COHERENCE",
    declarationRecordedAt: declaration.createdAt, expiresAt, postalReferenceVersion: DIGITAL_POSTAL_REFERENCE_VERSION, postalReferenceSourceSha256: DIGITAL_POSTAL_REFERENCE_SOURCE_SHA,
  } };
}
export function assertDigitalAddressCheckoutPrepared(value: DigitalAddressCheckoutAssessment) {
  if (!value.eligible || !value.snapshot) throw new DigitalError(value.code, 409);
  if (value.snapshot.policy === DIGITAL_ADDRESS_CHECKOUT_POLICY) {
    if (value.basis !== "DECLARED_ADDRESS_CHECKS" || value.residenceVerified || value.snapshot.policyHash !== DIGITAL_ADDRESS_CHECKOUT_POLICY_HASH) throw new DigitalError("FRANCE_RESIDENCE_BINDING_INVALID", 409);
  } else if (!value.residenceVerified || value.basis !== "MANUAL_REVIEW" || value.snapshot.policy !== DIGITAL_FRANCE_RESIDENCE_V2_POLICY || value.snapshot.policyHash !== DIGITAL_FRANCE_RESIDENCE_V2_POLICY_HASH) throw new DigitalError("FRANCE_RESIDENCE_BINDING_INVALID", 409);
  return value.snapshot;
}
