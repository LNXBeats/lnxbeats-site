import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { evaluateDigitalJurisdiction, assertDigitalJurisdictionDecision, calculateDigitalTax, digitalJurisdictionRuleHash,
  localQaDigitalCountryRule, revalidateDigitalJurisdiction, validDigitalTerritory,
  type DigitalCountryTaxRuleView, type DigitalJurisdictionInput, type DigitalJurisdictionSnapshot } from "@/lib/digital/jurisdictions";
const now = new Date("2026-10-15T12:00:00.000Z"), terms = "digital-terms-test-draft";
const input = (): DigitalJurisdictionInput => ({ countryCode: "FR", residenceCountryCode: "FR", billingCountryCode: "FR", customerType: "B2C",
  mode: "TEST", termsVersion: terms, locale: "fr", providerAllowed: true, rightsApproved: true, formatsReady: true, localQaFixtureAuthorized: true });
const qa = () => localQaDigitalCountryRule(terms);
const snapshot = () => assertDigitalJurisdictionDecision(evaluateDigitalJurisdiction(input(), qa(), now));
function live(): DigitalCountryTaxRuleView { return { ...qa(), id: randomUUID(), approvalScope: "LIVE", reviewedBy: "Fixture expert — synthetic test only",
  evidenceReference: "TEST_FIXTURE_NOT_REAL_APPROVAL", taxRule: { ...qa().taxRule!, treatment: "TAXED_APPROVED", regimeCode: "SYNTHETIC_TAX_TEST",
    rateBasisPoints: 2000, registrationEvidenceReference: "SYNTHETIC_REGISTRATION_TEST" } }; }

test("FR historical franchise never approves DCN automatically; all missing or draft country rules fail closed", () => {
  for (const rule of [null, { ...qa(), decision: "REVIEW", status: "REVIEW_REQUIRED", approvalScope: "NONE", fiscalApproved: false, taxRule: null } as DigitalCountryTaxRuleView,
    { ...qa(), status: "DRAFT" } as DigitalCountryTaxRuleView]) {
    assert.notEqual(evaluateDigitalJurisdiction(input(), rule, now).decision, "ALLOW");
  }
  let providerCalls = 0;
  assert.throws(() => { assertDigitalJurisdictionDecision(evaluateDigitalJurisdiction(input(), null, now)); providerCalls++; }, { code: "TERRITORY_POLICY_MISSING" });
  assert.equal(providerCalls, 0);
});
test("QA approval is explicit, in-memory and incapable of authorizing LIVE", () => {
  assert.equal(evaluateDigitalJurisdiction(input(), qa(), now).decision, "ALLOW");
  for (const patch of [{ mode: "LIVE" }, { localQaFixtureAuthorized: false }, { localQaFixtureAuthorized: undefined }]) {
    assert.equal(evaluateDigitalJurisdiction({ ...input(), ...patch } as DigitalJurisdictionInput, qa(), now).code, "LOCAL_QA_POLICY_NOT_AUTHORIZED");
  }
  assert.equal(snapshot().tax.treatment, "QA_ONLY"); assert.doesNotMatch(snapshot().tax.legalNotice, /293/);
});
test("worldwide catalogue does not bypass UK/AU/unknown country, PSP or music-rights review", () => {
  for (const countryCode of ["GB", "AU", "DE"]) {
    assert.equal(evaluateDigitalJurisdiction({ ...input(), countryCode, residenceCountryCode: countryCode, billingCountryCode: countryCode }, null, now).decision, "BLOCK");
  }
  assert.equal(evaluateDigitalJurisdiction({ ...input(), countryCode: "ZZ" }, qa(), now).code, "UNKNOWN_TERRITORY");
  for (const [patch, code] of [[{ providerAllowed: false }, "PROVIDER_TERRITORY_NOT_APPROVED"], [{ rightsApproved: false }, "MUSIC_RIGHTS_REVIEW_REQUIRED"],
    [{ formatsReady: false }, "REQUIRED_FORMATS_NOT_READY"]] as const) assert.equal(evaluateDigitalJurisdiction({ ...input(), ...patch }, qa(), now).code, code);
});
test("US state and Canadian province required and bound to exact reviewed subdivision", () => {
  for (const countryCode of ["US", "CA"]) {
    const i = { ...input(), countryCode, residenceCountryCode: countryCode, billingCountryCode: countryCode };
    assert.equal(evaluateDigitalJurisdiction(i, null, now).code, "SUBDIVISION_REQUIRED_OR_INVALID");
    assert.equal(evaluateDigitalJurisdiction({ ...i, subdivisionCode: "US-ZZ" }, null, now).code, "SUBDIVISION_REQUIRED_OR_INVALID");
    const subdivisionCode = countryCode === "US" ? "US-CA" : "CA-QC";
    const rule = { ...qa(), countryCode, subdivisionCode };
    assert.equal(evaluateDigitalJurisdiction({ ...i, subdivisionCode }, rule, now).decision, "ALLOW");
    assert.equal(evaluateDigitalJurisdiction({ ...i, subdivisionCode }, { ...rule, subdivisionCode: "" }, now).code, "TERRITORY_POLICY_MISSING");
  }
  assert.equal(validDigitalTerritory("FR", "US-CA"), false);
});
test("B2B, missing country evidence and residence/billing/provider conflicts fail before checkout", () => {
  assert.equal(evaluateDigitalJurisdiction({ ...input(), customerType: "B2B" }, qa(), now).code, "DIGITAL_B2C_ONLY");
  assert.equal(evaluateDigitalJurisdiction({ ...input(), billingCountryCode: "" }, qa(), now).code, "COUNTRY_EVIDENCE_REQUIRED");
  for (const patch of [{ billingCountryCode: "GB" }, { residenceCountryCode: "DE" }, { providerCountryCode: "US" }]) {
    assert.equal(evaluateDigitalJurisdiction({ ...input(), ...patch }, qa(), now).code, "COUNTRY_EVIDENCE_CONFLICT");
  }
});
test("no ALLOW without complete dated fiscal/legal/payment/expert evidence and approved contract/language", () => {
  for (const patch of [{ fiscalApproved: false }, { legalApproved: false }, { paymentApproved: false }, { reviewedBy: "" }, { evidenceReference: "" },
    { evidenceHash: null }, { evidenceHash: "bad" }, { reviewedAt: null }, { reviewedAt: "2027-01-01T00:00:00Z" }, { expiresAt: null },
    { expiresAt: "2026-10-15T12:00:00Z" }, { validFrom: "2026-11-01T00:00:00Z" }, { id: "bad" }, { version: 0 }, { version: 1.5 }]) {
    assert.equal(evaluateDigitalJurisdiction(input(), { ...qa(), ...patch }, now).decision, "BLOCK", JSON.stringify(patch));
  }
  assert.equal(evaluateDigitalJurisdiction({ ...input(), termsVersion: "old" }, qa(), now).code, "DIGITAL_CONTRACT_TERRITORY_NOT_APPROVED");
  assert.equal(evaluateDigitalJurisdiction({ ...input(), locale: "en" }, qa(), now).code, "DIGITAL_CONTRACT_TERRITORY_NOT_APPROVED");
  assert.equal(evaluateDigitalJurisdiction(input(), qa(), new Date("invalid")).decision, "BLOCK");
});
test("no default VAT-zero, foreign 293B assumption or QA tax in LIVE policy", () => {
  for (const patch of [{ taxRule: null }, { taxRule: { ...qa().taxRule!, rateBasisPoints: -1 } }, { taxRule: { ...qa().taxRule!, legalBasisReference: "" } },
    { approvalScope: "LIVE", taxRule: qa().taxRule }, { approvalScope: "LIVE", taxRule: { ...live().taxRule!, rateBasisPoints: 0 } }]) {
    assert.equal(evaluateDigitalJurisdiction(input(), { ...qa(), ...patch } as DigitalCountryTaxRuleView, now).code, "TAX_RULE_NOT_APPROVED");
  }
  const exemption = { ...live(), taxRule: { ...live().taxRule!, treatment: "EXEMPT_APPROVED", rateBasisPoints: 0, registrationEvidenceReference: null } } as DigitalCountryTaxRuleView;
  assert.equal(evaluateDigitalJurisdiction(input(), exemption, now).decision, "ALLOW"); // Synthetic explicit exemption proof, not a real country approval.
});
test("tax calculation uses exact cents, capped paid credit and explicit inclusive/exclusive rounding", () => {
  const i = { ...input(), mode: "LIVE" as const };
  const inclusive = assertDigitalJurisdictionDecision(evaluateDigitalJurisdiction(i, live(), now));
  const a = calculateDigitalTax({ grossBeforeCreditCents: 990, creditCents: 129 }, inclusive);
  assert.equal(a.afterCreditCents, 861); assert.equal(a.totalCents, 861); assert.equal(a.vatCents, 144); assert.equal(a.subtotalCents, 717);
  const exclusive = assertDigitalJurisdictionDecision(evaluateDigitalJurisdiction(i, { ...live(), taxRule: { ...live().taxRule!, priceIncludesTax: false } }, now));
  const b = calculateDigitalTax({ grossBeforeCreditCents: 990, creditCents: 129 }, exclusive);
  assert.equal(b.vatCents, 172); assert.equal(b.totalCents, 1033); assert.equal(b.subtotalCents, 861);
  for (const v of [{ grossBeforeCreditCents: 990, creditCents: 991 }, { grossBeforeCreditCents: 0, creditCents: 0 }, { grossBeforeCreditCents: 990, creditCents: 1.1 },
    { grossBeforeCreditCents: 990, creditCents: -1 }]) assert.throws(() => calculateDigitalTax(v, snapshot()));
  assert.throws(() => calculateDigitalTax({ grossBeforeCreditCents: 990, creditCents: 990 }, snapshot()), { code: "ZERO_PRICE_COMPLETION_REVIEW_REQUIRED" });
  assert.throws(() => calculateDigitalTax({ grossBeforeCreditCents: 990, creditCents: 0 }, { ...snapshot(), tax: { ...snapshot().tax, treatment: "bad" } } as unknown as DigitalJurisdictionSnapshot));
});
test("expired or superseded country policy, changed evidence and terms cannot silently grant files after payment", () => {
  const s = snapshot(); assert.deepEqual(revalidateDigitalJurisdiction(s, input(), qa(), now), s);
  for (const patch of [{ version: 2 }, { evidenceReference: "another-review" }, { reviewedBy: "another-reviewer" }, { paymentApproved: false },
    { expiresAt: "2026-10-15T10:00:00Z" }, { taxRule: { ...qa().taxRule!, rateBasisPoints: 1500 } }]) {
    assert.throws(() => revalidateDigitalJurisdiction(s, input(), { ...qa(), ...patch }, now));
  }
  assert.throws(() => revalidateDigitalJurisdiction(s, { ...input(), billingCountryCode: "GB" }, qa(), now));
  assert.notEqual(digitalJurisdictionRuleHash({ ...qa(), version: 2 }), s.ruleHash);
});
test("additive migration seeds 249 countries under review, preserves legacy orders and enforces append-only rules", async () => {
  const pg = new PGlite();
  try {
    const historicalId = randomUUID();
    await pg.exec(`CREATE TABLE digital_orders(id UUID PRIMARY KEY,status TEXT NOT NULL); INSERT INTO digital_orders(id,status) VALUES('${historicalId}','PAID');`);
    await pg.exec(await readFile(new URL("../../prisma/migrations/20261015030000_digital_country_tax_rules/migration.sql", import.meta.url), "utf8"));
    const counts = await pg.query<{ n: number; opened: number; taxes: number }>(`SELECT count(*)::int AS n,count(*) FILTER(WHERE decision='ALLOW')::int AS opened,count(*) FILTER(WHERE "taxRule" IS NOT NULL)::int AS taxes FROM digital_country_tax_rules`);
    assert.deepEqual(counts.rows[0], { n: 249, opened: 0, taxes: 0 });
    const old = await pg.query(`SELECT status,"jurisdictionSnapshot" FROM digital_orders WHERE id='${historicalId}'`); assert.deepEqual(old.rows[0], { status: "PAID", jurisdictionSnapshot: null });
    await assert.rejects(pg.exec(`UPDATE digital_country_tax_rules SET decision='ALLOW' WHERE "countryCode"='FR'`), /append-only/);
    await assert.rejects(pg.exec(`DELETE FROM digital_country_tax_rules WHERE "countryCode"='FR'`), /append-only/);
    await assert.rejects(pg.exec(`UPDATE digital_orders SET "jurisdictionSnapshot"='{}'::jsonb WHERE id='${historicalId}'`), /immutable digital jurisdiction/);
    await pg.exec(`UPDATE digital_orders SET status='PARTIALLY_REFUNDED' WHERE id='${historicalId}'`);
    await assert.rejects(pg.exec(`INSERT INTO digital_country_tax_rules(id,"countryCode",version,status,decision,"approvalScope","fiscalApproved","legalApproved","paymentApproved","termsVersion","languageCode","reviewedBy","reviewedAt","validFrom","expiresAt","evidenceReference","taxRule") VALUES('${randomUUID()}','FR',2,'APPROVED','ALLOW','LIVE',true,true,true,'draft','fr','someone',now(),now(),now()+interval '1 day','ref','{}')`), /digital_territory_allow_requires_evidence/);
  } finally { await pg.close(); }
});
