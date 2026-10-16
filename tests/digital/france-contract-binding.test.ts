import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Prisma } from "@/generated/prisma/client";
import { digitalContractSnapshot, digitalContractTerms, verifyContractSnapshot, DIGITAL_FRANCE_CONTRACT_POLICY } from "@/lib/digital/fulfillment-policy";
import { DIGITAL_FRANCE_TERMS_VERSION, DIGITAL_FRANCE_TERMS_TEXT_HASH, digitalFranceTermsDraft } from "@/lib/digital/france-legal";
import { DIGITAL_TERMS_VERSION, DIGITAL_TERMS_TEXT } from "@/lib/digital/domain";
import { reserveDigitalJurisdiction, checkDigitalAcquiredJurisdiction } from "@/lib/digital/checkout-jurisdiction";

const at = new Date("2026-10-15T12:00:00.000Z");
const customer = { name: "Synthetic QA", email: "fr-contract@example.invalid" };
const candidate = () => digitalContractSnapshot(customer, at, DIGITAL_FRANCE_TERMS_VERSION);
test("published France draft 02 is immutable and must remain an additive registry entry in future revisions", () => {
  const terms = digitalContractTerms("digital-music-france-cgv-20261015-draft-02");
  assert.equal(terms.hash, "5e350e6bddb003b6ff0d2cd0236aa6876857b2d0376f8c99dd8362e8a1babe48");
  assert.equal(digitalFranceTermsDraft.hashSha256, "30c7ac06586dad083f13c334affd4763ba4c9b215b3c8f4cc28522e400ef042c");
});
test("new France QA contract binds exact draft text, hashes and three distinct positive choices", () => {
  const s = candidate(), terms = digitalContractTerms(DIGITAL_FRANCE_TERMS_VERSION);
  assert.equal(s.policy, DIGITAL_FRANCE_CONTRACT_POLICY); assert.equal(s.mode, "TEST"); assert.equal(s.approvedForLive, false);
  assert.equal(s.terms.status, "DRAFT"); assert.equal(s.terms.expresslyAccepted, true);
  assert.equal(s.terms.hashSha256, terms.hash); assert.equal(s.terms.documentHashSha256, digitalFranceTermsDraft.hashSha256);
  assert.equal(verifyContractSnapshot(s, terms.version, terms.hash).snapshot.acceptedAt, at.toISOString());
  assert.equal(s.earlyDelivery.text, terms.earlyDeliveryText); assert.equal(s.withdrawal.text, terms.withdrawalText);
  assert.notEqual(s.earlyDelivery.text, s.withdrawal.text);
  assert.throws(() => digitalContractTerms("unknown"), { code: "CONTRACT_REQUIRES_REVIEW" });
});
test("new France policy refuses truthy consent, missing exact wording, invalid timestamp and disguised LIVE approval", () => {
  const s = candidate();
  const invalid: unknown[] = [
    { ...s, policy: "DCN-CONSOLIDATION-QA-EXPLICIT-RECEIPT" }, { ...s, mode: "LIVE" }, { ...s, approvedForLive: true },
    { ...s, acceptedAt: "not-a-date" }, { ...s, acceptedAt: "2026-10-15T14:00:00+02:00" },
    { ...s, customer: { ...s.customer, name: " " } },
    { ...s, terms: { ...s.terms, expresslyAccepted: "true" } }, { ...s, terms: { ...s.terms, hashSha256: "a".repeat(64) } },
    { ...s, terms: { ...s.terms, documentHashSha256: "b".repeat(64) } }, { ...s, terms: { ...s.terms, status: "APPROVED" } },
    { ...s, terms: { ...s.terms, sections: undefined } }, { ...s, terms: { ...s.terms, sections: [] } },
    { ...s, earlyDelivery: { ...s.earlyDelivery, expresslyRequested: "true" } }, { ...s, earlyDelivery: { expresslyRequested: true } },
    { ...s, withdrawal: { ...s.withdrawal, expresslyAcknowledged: 1 } }, { ...s, withdrawal: { expresslyAcknowledged: true } },
  ];
  for (const v of invalid) assert.throws(() => verifyContractSnapshot(v, DIGITAL_FRANCE_TERMS_VERSION, DIGITAL_FRANCE_TERMS_TEXT_HASH), { code: "CONTRACT_REQUIRES_REVIEW" });
  const rewritten = { ...s, terms: { ...s.terms, text: "Substituted conditions" } };
  assert.throws(() => verifyContractSnapshot(rewritten, DIGITAL_FRANCE_TERMS_VERSION, createHash("sha256").update(rewritten.terms.text).digest("hex")), { code: "CONTRACT_REQUIRES_REVIEW" });
});
test("historical snapshots and hashes are retained without inferring a new express acceptance or France terms", () => {
  const legacy = digitalContractSnapshot(customer, at);
  assert.equal(legacy.terms.version, DIGITAL_TERMS_VERSION); assert.equal(legacy.terms.expresslyAccepted, undefined);
  assert.equal(legacy.approvedForLive, undefined);
  const old = { ...legacy, policy: "DCN-1.1-QA-EXPLICIT-RECEIPT", terms: { version: "DCN-1.0-LOCAL-REVIEW", text: DIGITAL_TERMS_TEXT } };
  const before = JSON.stringify(old), hash = createHash("sha256").update(DIGITAL_TERMS_TEXT).digest("hex");
  assert.equal(verifyContractSnapshot(JSON.parse(before), old.terms.version, hash).snapshot.terms.text, DIGITAL_TERMS_TEXT);
  assert.equal(JSON.stringify(old), before);
});
test("local jurisdiction follows each acquired contract version rather than rebinding old purchases to the new template", async () => {
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) if (/STRIPE|PAYPAL|RESEND|RAILWAY|MEDIA_DEPLOYMENT_ENV|PAYMENT_DEPLOYMENT_ENV/.test(key)) delete process.env[key];
    Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_LOCAL_REVIEW_AUTHORIZED: "true", DCN_NEW_PAYMENTS_ENABLED: "false",
      DATABASE_URL: "postgresql://dcn_runtime_a:fixture_never_connect_20261015@127.0.0.1:55473/lnx_dcn_consolidation_test", AUTH_URL: "http://127.0.0.1:3140", MEDIA_STORAGE_DRIVER: "local", EMAIL_PROVIDER: "capture" });
    const tx = {} as Prisma.TransactionClient, territory = { countryCode: "FR", residenceCountryCode: "FR", billingCountryCode: "FR", customerType: "B2C" };
    for (const version of [DIGITAL_TERMS_VERSION, DIGITAL_FRANCE_TERMS_VERSION]) {
      const s = await reserveDigitalJurisdiction(territory, tx, true, undefined, version), before = JSON.stringify(s);
      assert.equal(s.termsVersion, version); await checkDigitalAcquiredJurisdiction(JSON.parse(before), tx);
      assert.equal(JSON.stringify(s), before);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved);
  }
});
test("checkout links and displays the France version it submits, with explicit terms acceptance and free-completion action", async () => {
  const page = await readFile("app/musique/checkout/page.tsx", "utf8"), form = await readFile("components/digital-checkout.tsx", "utf8"), legalPage = await readFile("app/musique/conditions/page.tsx", "utf8");
  assert.match(page, /termsVersion=\{live\?DIGITAL_FRANCE_LIVE_CONTRACT_VERSION:DIGITAL_FRANCE_TERMS_VERSION\}/);
  assert.match(page, /termsHash=\{live\?DIGITAL_FRANCE_LIVE_CONTRACT_TEXT_HASH:DIGITAL_FRANCE_TERMS_TEXT_HASH\}/);
  assert.match(page, /approvedDigitalFranceContract\(prisma\)/);
  assert.match(form, /conditions#dcn-france-terms/); assert.match(legalPage, /dcn-france-terms/);
  assert.match(form, /termsAccepted/); assert.match(form, /!termsAccepted/);
  assert.match(form, /Obtenir le complément sans paiement/); assert.match(form, /\/api\/digital\/completion\/grant/);
  assert.match(form, /localReviewAllowed\|\|freeCompletion\?\{\}:\{provider\}/);
  assert.match(form, /localReviewAllowed=!copy.live&&localReview/);
});
