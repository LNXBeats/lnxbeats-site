import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { Prisma } from "@/generated/prisma/client";
import { parseDigitalCustomerTerritory, digitalLocalTerritoryFixtureAllowed, reserveDigitalJurisdiction, checkDigitalAcquiredJurisdiction } from "@/lib/digital/checkout-jurisdiction";
import { DIGITAL_TERMS_VERSION } from "@/lib/digital/domain";
import { localQaDigitalCountryRule, type DigitalCountryTaxRuleView } from "@/lib/digital/jurisdictions";
import { LOCAL_REVIEW_MERCHANT } from "@/lib/digital/local-review-policy";
const env = { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_LOCAL_REVIEW_AUTHORIZED: "true", DCN_NEW_PAYMENTS_ENABLED: "false",
  DATABASE_URL: "postgresql://dcn_runtime_a:fixture_never_connect_20261015@127.0.0.1:55473/lnx_dcn_consolidation_test", AUTH_URL: "http://127.0.0.1:3140", MEDIA_STORAGE_DRIVER: "local", EMAIL_PROVIDER: "capture" };
const territory = () => ({ countryCode: "FR", residenceCountryCode: "FR", billingCountryCode: "FR", customerType: "B2C" });
async function withLocalEnv<T>(run: () => T | Promise<T>, changes: Record<string,string|undefined> = {}): Promise<T> {
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) if (/(?:^|_)(?:STRIPE|PAYPAL|RESEND)(?:_|$)/.test(key)) delete process.env[key];
    for (const [key, value] of Object.entries({ ...env, ...changes })) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    return await run();
  } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
}
function repo(rule: DigitalCountryTaxRuleView | null = null) {
  let reads = 0;
  const databaseRule = rule ? { ...rule, reviewedAt: rule.reviewedAt ? new Date(rule.reviewedAt) : null, validFrom: rule.validFrom ? new Date(rule.validFrom) : null,
    expiresAt: rule.expiresAt ? new Date(rule.expiresAt) : null, notes: null, createdAt: new Date("2026-10-14T00:00:00.000Z") } : null;
  const tx = { digitalCountryTaxRule: { async findFirst() { reads++; return databaseRule; } } } as unknown as Prisma.TransactionClient;
  return { tx, reads: () => reads };
}
test("browser country input accepts evidence only, never server approval flags, modes, policy overrides or provider identity", () => {
  assert.deepEqual(parseDigitalCustomerTerritory(territory()), territory());
  for (const injected of [{ localQaFixtureAuthorized: true }, { localQaFixture: true }, { ruleOverride: {} }, { mode: "TEST" }, { rightsApproved: true },
    { providerAllowed: true }, { formatsReady: true }, { merchantId: LOCAL_REVIEW_MERCHANT }, { tax: { rateBasisPoints: 0 } }]) {
    assert.throws(() => parseDigitalCustomerTerritory({ ...territory(), ...injected }), { code: "INVALID_TERRITORY_INPUT" });
  }
  for (const value of [null, [], "FR", { ...territory(), countryCode: "fr" }, { ...territory(), customerType: "B2B" }, { ...territory(), billingCountryCode: "" }]) assert.throws(() => parseDigitalCustomerTerritory(value));
});
test("injected QA fixture works only in isolated TEST profile and does not read country policy DB", async () => {
  await withLocalEnv(async () => {
    const f = repo();
    const s = await reserveDigitalJurisdiction(territory(), f.tx, true);
    assert.equal(s.approvalScope, "LOCAL_QA"); assert.equal(s.tax.treatment, "QA_ONLY"); assert.equal(f.reads(), 0);
    assert.equal(digitalLocalTerritoryFixtureAllowed(LOCAL_REVIEW_MERCHANT), true);
    assert.equal(digitalLocalTerritoryFixtureAllowed("acct_actual_provider_not_double"), false);
  });
  for (const patch of [{ DCN_LOCAL_REVIEW_AUTHORIZED: undefined }, { DCN_MODE: "LIVE" }, { DATABASE_URL: "postgresql://dcn_owner:fixture_never_connect_20261015@127.0.0.1:55473/lnx_dcn_consolidation_test" },
    { EMAIL_PROVIDER: "resend" }, { PAYPAL_CLIENT_SECRET: "synthetic_not_a_real_secret" }, { DATABASE_URL: "postgresql://dcn_runtime_a:fixture_never_connect_20261015@remote.example.invalid:5432/qa" }]) {
    await withLocalEnv(async () => { const f = repo(); await assert.rejects(() => reserveDigitalJurisdiction(territory(), f.tx, true)); assert.equal(f.reads(), 0); }, patch);
  }
});
test("persisted provider-country=null round-trips and reconciles, instead of creating false country contradiction", async () => {
  await withLocalEnv(async () => {
    const f = repo(), s = await reserveDigitalJurisdiction(territory(), f.tx, true);
    assert.equal(s.providerCountryCode, null);
    const current = await checkDigitalAcquiredJurisdiction(JSON.parse(JSON.stringify(s)), f.tx, LOCAL_REVIEW_MERCHANT);
    assert.deepEqual(current, s); assert.equal(f.reads(), 0);
  });
});
test("non-QA/mismatched merchant cannot reuse a synthetic country policy", async () => {
  await withLocalEnv(async () => {
    const f = repo(), s = await reserveDigitalJurisdiction(territory(), f.tx, true);
    await assert.rejects(() => checkDigitalAcquiredJurisdiction(s, f.tx, "actual-paypal-merchant"), { code: "TERRITORY_POLICY_MISSING" });
    assert.equal(f.reads(), 1);
    const dbFixture = repo(localQaDigitalCountryRule(DIGITAL_TERMS_VERSION));
    await assert.rejects(() => checkDigitalAcquiredJurisdiction(s, dbFixture.tx, "actual-paypal-merchant"), { code: "LOCAL_QA_POLICY_NOT_AUTHORIZED" });
  });
});
test("missing/expired policies refuse initial delivery; null legacy snapshot retained without invented evidence", async () => {
  await withLocalEnv(async () => {
    const f = repo(); await assert.rejects(() => reserveDigitalJurisdiction(territory(), f.tx, false), { code: "FRANCE_RESIDENCE_DECLARATION_REQUIRED" });
    const expired = { ...localQaDigitalCountryRule(DIGITAL_TERMS_VERSION), expiresAt: "2020-01-01T00:00:00.000Z" };
    await assert.rejects(() => reserveDigitalJurisdiction(territory(), repo(expired).tx, false), { code: "FRANCE_RESIDENCE_DECLARATION_REQUIRED" });
    const initialReads = f.reads();
    assert.equal(await checkDigitalAcquiredJurisdiction(null, f.tx), undefined); assert.equal(await checkDigitalAcquiredJurisdiction(undefined, f.tx), undefined);
    assert.equal(f.reads(), initialReads);
    for (const corrupted of [0, "", {}, { ...territory(), approvalScope: "LOCAL_QA" }]) await assert.rejects(() => checkDigitalAcquiredJurisdiction(corrupted, f.tx));
  });
});
test("checkout routes never parse browser QA capability; scope is server-derived and same-origin wrapper preserved", async () => {
  for (const path of ["../../app/api/digital/checkout/route.ts", "../../app/api/digital/local-review/checkout/route.ts"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /withDigitalApi\(request/); assert.match(source, /parseDigitalCustomerTerritory\(b\.jurisdiction\)/);
    assert.doesNotMatch(source, /b\.(?:localQaFixture|localQaFixtureAuthorized|ruleOverride|merchantId|rightsApproved|providerAllowed|formatsReady)/);
  }
});
