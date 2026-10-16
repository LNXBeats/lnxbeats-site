import { DigitalError } from "./domain";
import type { DigitalMode } from "./runtime-policy";
import type { DigitalJurisdictionSnapshot } from "./jurisdictions";

export const DIGITAL_QA_FISCAL_NOTICE = "TEST : fiscalité des contenus numériques à valider. Aucun régime ni taux réel présumé.";

/** The launch uses the approved French exemption, not a rate inferred from SACEM
 * or from a global seller setting. A later taxed policy needs a reviewed renderer.
 */
export function digitalCommercialFiscalNotice(snapshot:unknown,mode:DigitalMode){
  if(mode==="TEST")return DIGITAL_QA_FISCAL_NOTICE;
  const s=snapshot as DigitalJurisdictionSnapshot|null;
  if(s?.policy!=="DCN-TERRITORY-1"||s.approvalScope!=="LIVE"||s.countryCode!=="FR"||s.subdivisionCode!=="FR-MET"
    ||s.tax?.treatment!=="EXEMPT_APPROVED"||s.tax.rateBasisPoints!==0||s.tax.priceIncludesTax!==true
    ||typeof s.tax.legalNotice!=="string"||!s.tax.legalNotice.trim()||!s.ruleId||!s.ruleHash)throw new DigitalError("FISCAL_DOCUMENT_POLICY_REQUIRES_REVIEW",409);
  return s.tax.legalNotice;
}
