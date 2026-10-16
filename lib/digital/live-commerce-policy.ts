import type { DigitalMode } from "./runtime-policy";
import type { DigitalJurisdictionSnapshot } from "./jurisdictions";

/** Reuse the exact approved tax snapshot. No implicit exemption or foreign market.
 * Taxed completion needs a reviewed allocation policy, never a guessed VAT credit.
 */
export function digitalCompletionJurisdictionAllowed(snapshot: DigitalJurisdictionSnapshot, mode: DigitalMode) {
  if(mode==="TEST")return snapshot.approvalScope==="LOCAL_QA";
  return snapshot.approvalScope==="LIVE"&&snapshot.countryCode==="FR"&&snapshot.subdivisionCode==="FR-MET"
    &&snapshot.tax.treatment==="EXEMPT_APPROVED"&&snapshot.tax.rateBasisPoints===0&&snapshot.tax.priceIncludesTax===true;
}
