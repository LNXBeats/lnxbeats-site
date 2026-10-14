import { createHash } from "node:crypto";
import { digitalUuid, DigitalError } from "./domain";

/** This registry gates DCN only. Historical French invoices and other commerce domains are not re-qualified. */
export type DigitalTerritoryReviewStatus = "DRAFT" | "REVIEW_REQUIRED" | "APPROVED" | "EXPIRED";
export type DigitalTaxRule = {
  treatment: "EXEMPT_APPROVED" | "TAXED_APPROVED" | "QA_ONLY";
  regimeCode: string;
  rateBasisPoints: number;
  priceIncludesTax: boolean;
  legalNotice: string;
  legalBasisReference: string;
  registrationEvidenceReference: string | null;
  rounding: "HALF_UP_CENTS";
};
export type DigitalCountryTaxRuleView = {
  id: string; countryCode: string; subdivisionCode: string; version: number; customerType: string;
  decision: "ALLOW" | "REVIEW" | "BLOCK"; status: DigitalTerritoryReviewStatus;
  approvalScope: "NONE" | "LOCAL_QA" | "LIVE";
  termsVersion: string | null; languageCode: string | null;
  fiscalApproved: boolean; legalApproved: boolean; paymentApproved: boolean;
  reviewedBy: string | null; reviewedAt: string | null; validFrom: string | null; expiresAt: string | null;
  evidenceReference: string | null; evidenceHash: string | null; taxRule: DigitalTaxRule | null;
};
export type DigitalJurisdictionInput = {
  countryCode: string; subdivisionCode?: string; residenceCountryCode: string; billingCountryCode: string;
  providerCountryCode?: string; customerType: string; mode: "TEST" | "LIVE";
  termsVersion: string; locale: string; providerAllowed: boolean; rightsApproved: boolean; formatsReady: boolean;
  /** Internal test-harness capability, never parsed from a browser request. Does not approve any LIVE territory. */
  localQaFixtureAuthorized?: boolean;
};
export type DigitalJurisdictionSnapshot = {
  policy: "DCN-TERRITORY-1"; ruleId: string; ruleVersion: number; ruleHash: string;
  approvalScope: "LOCAL_QA" | "LIVE"; countryCode: string; subdivisionCode: string; customerType: "B2C";
  residenceCountryCode: string; billingCountryCode: string; providerCountryCode: string | null;
  termsVersion: string; languageCode: string; validFrom: string; expiresAt: string; tax: DigitalTaxRule;
};
export type DigitalJurisdictionDecision = {
  decision: "ALLOW" | "REVIEW" | "BLOCK"; code: string; snapshot?: DigitalJurisdictionSnapshot;
};

const countries = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));
const usSubdivisions = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC AS GU MP PR VI".split(" ").map(v => `US-${v}`));
const caSubdivisions = new Set("AB BC MB NB NL NS NT NU ON PE QC SK YT".split(" ").map(v => `CA-${v}`));
const nonBlank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const dateValue = (value: string | null) => value ? Date.parse(value) : NaN;
const result = (decision: "REVIEW" | "BLOCK", code: string): DigitalJurisdictionDecision => ({ decision, code });

export function validDigitalTerritory(countryCode: string, subdivisionCode = "") {
  if (!countries.has(countryCode)) return false;
  if (countryCode === "US") return usSubdivisions.has(subdivisionCode);
  if (countryCode === "CA") return caSubdivisions.has(subdivisionCode);
  return subdivisionCode === "" || new RegExp(`^${countryCode}-[A-Z0-9]{1,3}$`).test(subdivisionCode);
}

function validatedTax(rule: DigitalCountryTaxRuleView): rule is DigitalCountryTaxRuleView & { taxRule: DigitalTaxRule } {
  const tax = rule.taxRule;
  if (!tax || !["EXEMPT_APPROVED", "TAXED_APPROVED", "QA_ONLY"].includes(tax.treatment)
    || !nonBlank(tax.regimeCode) || !nonBlank(tax.legalNotice) || !nonBlank(tax.legalBasisReference)
    || !Number.isSafeInteger(tax.rateBasisPoints) || tax.rateBasisPoints < 0 || tax.rateBasisPoints > 10000
    || typeof tax.priceIncludesTax !== "boolean" || tax.rounding !== "HALF_UP_CENTS") return false;
  if (rule.approvalScope === "LOCAL_QA") return tax.treatment === "QA_ONLY" && tax.regimeCode === "SYNTHETIC_QA_NOT_FISCAL_ADVICE";
  return rule.approvalScope === "LIVE" && tax.treatment !== "QA_ONLY"
    && (tax.treatment === "EXEMPT_APPROVED" ? tax.rateBasisPoints === 0 : tax.rateBasisPoints > 0 && nonBlank(tax.registrationEvidenceReference));
}

export function digitalJurisdictionRuleHash(rule: DigitalCountryTaxRuleView) {
  // Explicit key order: the persisted snapshot does not depend on JSONB property order.
  const tax = rule.taxRule;
  return createHash("sha256").update(JSON.stringify({ id: rule.id, countryCode: rule.countryCode, subdivisionCode: rule.subdivisionCode,
    version: rule.version, customerType: rule.customerType, decision: rule.decision, status: rule.status, approvalScope: rule.approvalScope,
    termsVersion: rule.termsVersion, languageCode: rule.languageCode, fiscalApproved: rule.fiscalApproved, legalApproved: rule.legalApproved,
    paymentApproved: rule.paymentApproved, reviewedBy: rule.reviewedBy, reviewedAt: rule.reviewedAt, validFrom: rule.validFrom, expiresAt: rule.expiresAt,
    evidenceReference: rule.evidenceReference, evidenceHash: rule.evidenceHash,
    tax: tax ? { treatment: tax.treatment, regimeCode: tax.regimeCode, rateBasisPoints: tax.rateBasisPoints, priceIncludesTax: tax.priceIncludesTax,
      legalNotice: tax.legalNotice, legalBasisReference: tax.legalBasisReference, registrationEvidenceReference: tax.registrationEvidenceReference,
      rounding: tax.rounding } : null })).digest("hex");
}

export function evaluateDigitalJurisdiction(input: DigitalJurisdictionInput, rule: DigitalCountryTaxRuleView | null, now = new Date()): DigitalJurisdictionDecision {
  if (!Number.isFinite(now.getTime()) || !["TEST", "LIVE"].includes(input.mode)) return result("BLOCK", "TERRITORY_CONTEXT_INVALID");
  if (input.customerType !== "B2C") return result("BLOCK", "DIGITAL_B2C_ONLY");
  const subdivision = input.subdivisionCode ?? "";
  if (!validDigitalTerritory(input.countryCode, subdivision)) return result("BLOCK", ["US", "CA"].includes(input.countryCode) ? "SUBDIVISION_REQUIRED_OR_INVALID" : "UNKNOWN_TERRITORY");
  if (!countries.has(input.residenceCountryCode) || !countries.has(input.billingCountryCode)) return result("BLOCK", "COUNTRY_EVIDENCE_REQUIRED");
  if (input.countryCode !== input.residenceCountryCode || input.countryCode !== input.billingCountryCode
    || input.providerCountryCode !== undefined && input.providerCountryCode !== input.countryCode) return result("REVIEW", "COUNTRY_EVIDENCE_CONFLICT");
  if (input.providerAllowed !== true) return result("BLOCK", "PROVIDER_TERRITORY_NOT_APPROVED");
  if (input.rightsApproved !== true) return result("BLOCK", "MUSIC_RIGHTS_REVIEW_REQUIRED");
  if (input.formatsReady !== true) return result("BLOCK", "REQUIRED_FORMATS_NOT_READY");
  if (!rule || rule.countryCode !== input.countryCode || rule.subdivisionCode !== subdivision || rule.customerType !== "B2C") return result("BLOCK", "TERRITORY_POLICY_MISSING");
  if (rule.status === "EXPIRED" || Number.isFinite(dateValue(rule.expiresAt)) && dateValue(rule.expiresAt) <= now.getTime()) return result("BLOCK", "TERRITORY_POLICY_EXPIRED");
  if (rule.decision === "BLOCK") return result("BLOCK", "TERRITORY_CHECKOUT_BLOCKED");
  if (rule.status !== "APPROVED" || rule.decision !== "ALLOW") return result("REVIEW", "TERRITORY_REVIEW_REQUIRED");
  if (rule.approvalScope === "LOCAL_QA" && (input.mode !== "TEST" || input.localQaFixtureAuthorized !== true)) return result("BLOCK", "LOCAL_QA_POLICY_NOT_AUTHORIZED");
  if (rule.approvalScope !== "LOCAL_QA" && rule.approvalScope !== "LIVE") return result("BLOCK", "TERRITORY_APPROVAL_SCOPE_MISSING");
  if (!digitalUuid(rule.id) || !Number.isSafeInteger(rule.version) || rule.version < 1 || rule.fiscalApproved !== true || rule.legalApproved !== true || rule.paymentApproved !== true || !nonBlank(rule.reviewedBy)
    || !nonBlank(rule.evidenceReference) || !/^[a-f0-9]{64}$/.test(rule.evidenceHash ?? "")
    || !Number.isFinite(dateValue(rule.reviewedAt)) || dateValue(rule.reviewedAt) > now.getTime()
    || !Number.isFinite(dateValue(rule.validFrom)) || dateValue(rule.validFrom) > now.getTime()
    || !Number.isFinite(dateValue(rule.expiresAt)) || dateValue(rule.expiresAt) <= dateValue(rule.validFrom)) return result("BLOCK", "TERRITORY_APPROVAL_EVIDENCE_INVALID");
  if (!rule.termsVersion || rule.termsVersion !== input.termsVersion || rule.languageCode !== input.locale) return result("BLOCK", "DIGITAL_CONTRACT_TERRITORY_NOT_APPROVED");
  if (!validatedTax(rule)) return result("BLOCK", "TAX_RULE_NOT_APPROVED");
  return { decision: "ALLOW", code: "APPROVED_TERRITORY", snapshot: { policy: "DCN-TERRITORY-1", ruleId: rule.id, ruleVersion: rule.version,
    ruleHash: digitalJurisdictionRuleHash(rule), approvalScope: rule.approvalScope as "LOCAL_QA" | "LIVE", countryCode: input.countryCode,
    subdivisionCode: subdivision, customerType: "B2C", residenceCountryCode: input.residenceCountryCode, billingCountryCode: input.billingCountryCode,
    providerCountryCode: input.providerCountryCode ?? null, termsVersion: rule.termsVersion, languageCode: rule.languageCode!,
    validFrom: rule.validFrom!, expiresAt: rule.expiresAt!, tax: { ...rule.taxRule } } };
}

export function assertDigitalJurisdictionDecision(decision: DigitalJurisdictionDecision) {
  if (decision.decision !== "ALLOW" || !decision.snapshot) throw new DigitalError(decision.code, 409);
  return decision.snapshot;
}

export function revalidateDigitalJurisdiction(snapshot: DigitalJurisdictionSnapshot, input: DigitalJurisdictionInput, rule: DigitalCountryTaxRuleView | null, now = new Date()) {
  const decision = evaluateDigitalJurisdiction(input, rule, now);
  const current = assertDigitalJurisdictionDecision(decision);
  if (snapshot?.policy !== "DCN-TERRITORY-1" || snapshot.ruleId !== current.ruleId || snapshot.ruleVersion !== current.ruleVersion
    || snapshot.ruleHash !== current.ruleHash || snapshot.countryCode !== current.countryCode || snapshot.subdivisionCode !== current.subdivisionCode
    || snapshot.residenceCountryCode !== current.residenceCountryCode || snapshot.billingCountryCode !== current.billingCountryCode
    || snapshot.providerCountryCode !== null && snapshot.providerCountryCode !== current.providerCountryCode
    || snapshot.termsVersion !== current.termsVersion || snapshot.languageCode !== current.languageCode
    || snapshot.approvalScope !== current.approvalScope) throw new DigitalError("TERRITORY_POLICY_CHANGED_REQUIRES_REVIEW", 409);
  return current;
}

export function calculateDigitalTax(input: { grossBeforeCreditCents: number; creditCents: number }, snapshot: DigitalJurisdictionSnapshot) {
  const { grossBeforeCreditCents, creditCents } = input;
  if (![grossBeforeCreditCents, creditCents].every(Number.isSafeInteger) || grossBeforeCreditCents < 1 || grossBeforeCreditCents > 500000
    || creditCents < 0 || creditCents > grossBeforeCreditCents || snapshot?.policy !== "DCN-TERRITORY-1" || !snapshot.tax
    || !validatedTax({ approvalScope: snapshot.approvalScope, taxRule: snapshot.tax } as DigitalCountryTaxRuleView)) throw new DigitalError("INVALID_TAX_CALCULATION", 409);
  const afterCreditCents = grossBeforeCreditCents - creditCents;
  // Zero-price completion is an undecided commercial/legal edge, not a fake PSP session.
  if (afterCreditCents === 0) throw new DigitalError("ZERO_PRICE_COMPLETION_REVIEW_REQUIRED", 409);
  const rate = BigInt(snapshot.tax.rateBasisPoints), amount = BigInt(afterCreditCents);
  const denominator = snapshot.tax.priceIncludesTax ? 10000n + rate : 10000n;
  const vatCents = Number((amount * rate + denominator / 2n) / denominator);
  const totalCents = snapshot.tax.priceIncludesTax ? afterCreditCents : afterCreditCents + vatCents;
  if (totalCents > 500000) throw new DigitalError("INVALID_TOTAL", 409);
  return { currency: "EUR" as const, grossBeforeCreditCents, creditCents, afterCreditCents,
    subtotalCents: snapshot.tax.priceIncludesTax ? afterCreditCents - vatCents : afterCreditCents, vatCents, totalCents,
    taxTreatment: snapshot.tax.treatment, rateBasisPoints: snapshot.tax.rateBasisPoints, legalNotice: snapshot.tax.legalNotice,
    policyId: snapshot.ruleId, policyVersion: snapshot.ruleVersion, policyHash: snapshot.ruleHash };
}

/** A synthetic in-memory fixture. Never inserted by a migration, never a fiscal approval, never valid in LIVE. */
export function localQaDigitalCountryRule(termsVersion: string): DigitalCountryTaxRuleView {
  return { id: "00000000-0000-4000-8000-000000000001", countryCode: "FR", subdivisionCode: "", version: 1, customerType: "B2C",
    decision: "ALLOW", status: "APPROVED", approvalScope: "LOCAL_QA", termsVersion, languageCode: "fr", fiscalApproved: true,
    legalApproved: true, paymentApproved: true, reviewedBy: "SYNTHETIC_QA_HARNESS_NOT_EXPERT", reviewedAt: "2026-10-14T00:00:00.000Z",
    validFrom: "2026-10-14T00:00:00.000Z", expiresAt: "2027-10-14T00:00:00.000Z", evidenceReference: "LOCAL_QA_ONLY_NO_LEGAL_OR_FISCAL_APPROVAL",
    evidenceHash: createHash("sha256").update("DCN synthetic jurisdiction fixture only").digest("hex"), taxRule: { treatment: "QA_ONLY",
      regimeCode: "SYNTHETIC_QA_NOT_FISCAL_ADVICE", rateBasisPoints: 0, priceIncludesTax: true,
      legalNotice: "QA / TEST : aucune règle fiscale réelle ni franchise présumée.", legalBasisReference: "LOCAL_QA_ONLY",
      registrationEvidenceReference: null, rounding: "HALF_UP_CENTS" } };
}
