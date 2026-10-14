import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { acknowledgeDigitalContract } from "@/lib/digital/documents";
import { DIGITAL_TERMS_VERSION } from "@/lib/digital/domain";
import { evaluateDigitalJurisdiction, assertDigitalJurisdictionDecision, localQaDigitalCountryRule, type DigitalCountryTaxRuleView } from "@/lib/digital/jurisdictions";
import { digitalContractSnapshot } from "@/lib/digital/fulfillment-policy";
import type { DigitalPinnedMasterProof } from "@/lib/digital/pinned-media-policy";
const qaEnv = { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_LOCAL_REVIEW_AUTHORIZED: "true", DCN_NEW_PAYMENTS_ENABLED: "false",
  DATABASE_URL: "postgresql://dcn_runtime_a:fixture_never_connect_20261015@127.0.0.1:55473/lnx_dcn_consolidation_test", AUTH_URL: "http://127.0.0.1:3140", MEDIA_STORAGE_DRIVER: "local", EMAIL_PROVIDER: "capture" };

/** Actual acknowledgment service, repository doubles only. No PostgreSQL/provider/contract-law approval claim. */
function fixture() {
  const userId = randomUUID(), orderId = randomUUID(), documentId = randomUUID(), masterId = randomUUID(), trackId = randomUUID(), wavId = randomUUID(), mp3Id = randomUUID();
  const input = { countryCode: "FR", residenceCountryCode: "FR", billingCountryCode: "FR", customerType: "B2C", mode: "TEST" as const, termsVersion: DIGITAL_TERMS_VERSION,
    locale: "fr", providerAllowed: true, rightsApproved: true, formatsReady: true, localQaFixtureAuthorized: true };
  const snapshot = assertDigitalJurisdictionDecision(evaluateDigitalJurisdiction(input, localQaDigitalCountryRule(DIGITAL_TERMS_VERSION)));
  const track = { trackId, masterId, title: "QA only", position: 1, formats: ["WAV", "MP3"], wavAssetId: wavId, mp3AssetId: mp3Id };
  const master: DigitalPinnedMasterProof = { id: masterId, trackId, status: "READY", masterAssetId: wavId, mp3AssetId: mp3Id,
    masterAsset: { id: wavId, visibility: "PRIVATE", rightsStatus: "CLEARED", mimeType: "audio/wav", checksumSha256: "a".repeat(64) },
    mp3Asset: { id: mp3Id, visibility: "PRIVATE", rightsStatus: "CLEARED", mimeType: "audio/mpeg", checksumSha256: "b".repeat(64) },
    track: { status: "RELEASED", project: { status: "PUBLISHED", publicVisible: true } } };
  const order = { id: orderId, userId, status: "PAID", jurisdictionSnapshot: snapshot, contractSnapshot: digitalContractSnapshot({ email: "qa@example.invalid", name: "QA only" }, new Date()) };
  const fulfillment = { confirmationAt: null as Date | null, accessReadyAt: null as Date | null };
  let accountActive = true, accessWrites = 0, masterReads = 0, lineReads = 0, policyReads = 0, notifications = 0;
  let countryRule: Record<string, unknown> | null = null;
  const tx = {
    async $queryRaw() { return []; },
    digitalOrder: {
      async findFirst({ where }: { where: { user: { status: string; emailVerified: boolean } } }) { assert.equal(where.user.status, "ACTIVE"); assert.equal(where.user.emailVerified, true); return accountActive ? order : null; },
      async findUniqueOrThrow() { return { ...order, lines: [{ title: "QA only" }], user: { email: "qa@example.invalid" }, totalCents: 990 }; },
    },
    digitalDocument: { async findFirst() { return { id: documentId, orderId, kind: "CONTRACT", status: "READY", snapshotHash: "c".repeat(64) }; } },
    digitalEvent: { async findFirst() { return { id: randomUUID() }; }, async create() { return { id: randomUUID() }; } },
    digitalFulfillment: { async findUniqueOrThrow() { return fulfillment; }, async update({ data }: { data: { confirmationAt: Date; accessReadyAt: Date } }) { accessWrites++; Object.assign(fulfillment, data); return fulfillment; } },
    digitalOrderLine: { async findMany() { lineReads++; return [{ trackSnapshot: [track], completionSnapshot: null }]; } },
    digitalMaster: { async findMany() { masterReads++; return [master]; } },
    digitalCountryTaxRule: { async findFirst() { policyReads++; return countryRule; } },
    digitalNotification: { async upsert() { notifications++; return {}; } },
  } as unknown as Prisma.TransactionClient;
  return { tx, userId, orderId, documentId, master, snapshot, order, fulfillment,
    state: () => ({ accessWrites, masterReads, lineReads, policyReads, notifications }),
    inactive: () => { accountActive = false; }, rule: (r: Record<string,unknown>) => { countryRule = r; } };
}
async function run(f: ReturnType<typeof fixture>) {
  const saved = { ...process.env }, originalTransaction = prisma.$transaction;
  try {
    for (const key of Object.keys(process.env)) if (/(?:^|_)(?:STRIPE|PAYPAL|RESEND)(?:_|$)/.test(key)) delete process.env[key];
    Object.assign(process.env, qaEnv);
    prisma.$transaction = (async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(f.tx)) as unknown as typeof prisma.$transaction;
    return await acknowledgeDigitalContract(f.userId, f.orderId, f.documentId, "c".repeat(64));
  } finally { prisma.$transaction = originalTransaction; for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
}
test("initial delivery: paid/verified/ready private formats grant access only after fresh revalidation", async () => {
  const f = fixture(); assert.deepEqual(await run(f), { acknowledged: true }); assert.equal(f.state().accessWrites, 1);
  assert.equal(f.state().masterReads, 1); assert.equal(f.state().notifications, 1); assert.ok(f.fulfillment.accessReadyAt);
});
test("initial delivery: rights revoked after paid prevent accessReadyAt and access-ready notification", async () => {
  const f = fixture(); f.master.masterAsset.rightsStatus = "PENDING";
  await assert.rejects(() => run(f), { code: "ACQUIRED_RIGHTS_REQUIRES_REVIEW" }); assert.equal(f.state().accessWrites, 0); assert.equal(f.state().notifications, 0);
});
test("initial delivery: changed/missing MP3 or hidden release after payment blocks new access", async () => {
  for (const issue of ["mp3", "catalogue"]) {
    const f = fixture(); if (issue === "mp3") f.master.mp3Asset = null; else f.master.track.project.publicVisible = false;
    await assert.rejects(() => run(f)); assert.equal(f.state().accessWrites, 0); assert.equal(f.fulfillment.accessReadyAt, null);
  }
});
test("initial delivery: policy expired after payment prevents access without rewriting the stored jurisdiction", async () => {
  const f = fixture(), base = localQaDigitalCountryRule(DIGITAL_TERMS_VERSION);
  const live = { ...base, approvalScope: "LIVE", taxRule: { ...base.taxRule!, treatment: "EXEMPT_APPROVED", regimeCode: "SYNTHETIC_EXEMPTION_TEST_ONLY", legalBasisReference: "SYNTHETIC_REVIEW_ONLY" } } as DigitalCountryTaxRuleView;
  const s = assertDigitalJurisdictionDecision(evaluateDigitalJurisdiction({ countryCode: "FR", residenceCountryCode: "FR", billingCountryCode: "FR", customerType: "B2C", mode: "TEST",
    termsVersion: DIGITAL_TERMS_VERSION, locale: "fr", providerAllowed: true, rightsApproved: true, formatsReady: true }, live));
  f.order.jurisdictionSnapshot = s;
  const originalSnapshot = JSON.stringify(s);
  f.rule({ ...live, reviewedAt: new Date(live.reviewedAt!), validFrom: new Date(live.validFrom!), expiresAt: new Date("2020-01-01T00:00:00.000Z") });
  await assert.rejects(() => run(f), { code: "TERRITORY_POLICY_EXPIRED" }); assert.equal(f.state().accessWrites, 0); assert.equal(f.state().masterReads, 0);
  assert.equal(JSON.stringify(f.order.jurisdictionSnapshot), originalSnapshot);
});
test("initial delivery: lost active/verified account prevents delivery despite old payment proof", async () => {
  const f = fixture(); f.inactive(); await assert.rejects(() => run(f), { code: "CONTRACT_RECEIPT_REQUIRED" }); assert.equal(f.state().accessWrites, 0); assert.equal(f.state().masterReads, 0);
});
test("already delivered: repeated acknowledgment returns before new country/media gates, no rights downgrade or duplicate notification", async () => {
  const f = fixture(); f.fulfillment.confirmationAt = new Date(); f.fulfillment.accessReadyAt = new Date(); f.master.masterAsset.rightsStatus = "PENDING";
  f.order.jurisdictionSnapshot = { ...f.snapshot, expiresAt: "2020-01-01T00:00:00.000Z" };
  const before = f.fulfillment.accessReadyAt;
  assert.deepEqual(await run(f), { acknowledged: true }); assert.equal(f.state().accessWrites, 0); assert.equal(f.state().policyReads, 0);
  assert.equal(f.state().masterReads, 0); assert.equal(f.state().lineReads, 0); assert.equal(f.state().notifications, 0); assert.equal(f.fulfillment.accessReadyAt, before);
});
