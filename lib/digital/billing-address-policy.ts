import { billingSnapshotHash } from "@/lib/billing/domain";
import { DigitalError } from "./domain";
import { normalizeDigitalFranceResidenceAddress, type DigitalFranceMinimalAddress, type DigitalFranceResidenceSnapshotV2 } from "./france-residence-v2-policy";

/** Deliberately the same minimal, closed FR-MET/Corse schema as residence.
 * A full billing address is a buyer declaration, not independent residence proof.
 */
export function parseDigitalCheckoutBillingAddress(value: unknown) {
  return value === undefined ? undefined : normalizeDigitalFranceResidenceAddress(value);
}
export function resolveDigitalContractBillingAddress(residenceAddress: DigitalFranceMinimalAddress, residence: DigitalFranceResidenceSnapshotV2,
  sameAsResidence: boolean, suppliedAddress?: DigitalFranceMinimalAddress) {
  const address = suppliedAddress === undefined ? undefined : normalizeDigitalFranceResidenceAddress(suppliedAddress);
  if (sameAsResidence === true) {
    if (address && billingSnapshotHash(address) !== billingSnapshotHash(residenceAddress)) throw new DigitalError("FRANCE_BILLING_ADDRESS_REQUIRED", 409);
    if (residenceAddress.postalCode !== residence.billingPostalCode) throw new DigitalError("FRANCE_RESIDENCE_PROOF_CHANGED_REQUIRES_REVIEW", 409);
    return { billingAddress: residenceAddress, billingAddressConfirmedAsResidence: true as const };
  }
  if (!address) throw new DigitalError("FRANCE_BILLING_ADDRESS_REQUIRED", 409);
  // The current review binds the residence address and only the billing postcode.
  // It cannot certify a different full billing address, even with that postcode.
  // Keep the pre-existing review boundary until a separately approved workflow
  // can bind and review the complete different address.
  throw new DigitalError("FRANCE_BILLING_ADDRESS_DIFFERENT_REQUIRES_REVIEW", 409);
}
/** Idempotent retries cannot silently exchange the address of an existing order.
 * Historical same-address snapshots remain byte-for-byte valid.
 */
export function assertDigitalBillingAddressRetry(contract: unknown, sameAsResidence: boolean, suppliedAddress?: DigitalFranceMinimalAddress) {
  const saved = contract as { mode?: string; customer?: { billingAddress?: unknown }; billingAddressSource?: string } | null;
  if (saved?.mode !== "LIVE") return;
  const address = suppliedAddress === undefined ? undefined : normalizeDigitalFranceResidenceAddress(suppliedAddress);
  if (sameAsResidence !== true || saved.billingAddressSource !== "BUYER_CONFIRMED_SAME_AS_REVIEWED_RESIDENCE"
    || address && billingSnapshotHash(address) !== billingSnapshotHash(saved.customer?.billingAddress)) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
}
