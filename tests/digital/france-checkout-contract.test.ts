import test from "node:test";
import assert from "node:assert/strict";
import { syntheticExistingExcerptApproval } from "./fixtures/excerpt-approval";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { createDigitalCheckout } from "@/lib/digital/commerce";
import { selectionFingerprint } from "@/lib/digital/catalog";
import { DIGITAL_TERMS_VERSION, type DigitalSelection } from "@/lib/digital/domain";
import { DIGITAL_FRANCE_TERMS_VERSION, DIGITAL_FRANCE_TERMS_TEXT_HASH } from "@/lib/digital/france-legal";
import { digitalContractSnapshot, verifyContractSnapshot } from "@/lib/digital/fulfillment-policy";
import { LOCAL_REVIEW_BUYER, LOCAL_REVIEW_MERCHANT } from "@/lib/digital/local-review-policy";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DIGITAL_RIGHTS_REVIEW_POLICY, DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_RIGHTS_ATTESTATION, digitalRightsMasterBinding, digitalRightsReviewHash } from "@/lib/digital/rights-review-policy";

/** Actual paid-checkout service; all persistence and gateway work is doubled. Never a provider test. */
function fixture() {
  const actor: OrderActor = { id: randomUUID(), name: "Synthetic buyer", email: LOCAL_REVIEW_BUYER, status: "ACTIVE", role: "MEMBER", emailVerified: true };
  const reviewer = { id: randomUUID(), role: "ADMIN", status: "ACTIVE", emailVerified: true };
  const trackId = randomUUID(), masterId = randomUUID(), wavId = randomUUID(), mp3Id = randomUUID(), previewId = randomUUID();
  const asset = (id: string, mimeType: string, visibility = "PRIVATE", durationMs = 120000) => ({ id, type: mimeType === "audio/wav" ? "AUDIO" : "AUDIO_PREVIEW", mimeType, visibility, durationMs, rightsStatus: "CLEARED", checksumSha256: "a".repeat(64), sizeBytes: 400000n });
  const master = { id: masterId, trackId, version: 1, masterAssetId: wavId, mp3AssetId: mp3Id, previewAssetId: previewId, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION,
    mp3BitrateKbps: 320, previewStartMs: 0, previewDurationMs: 59900, masterAsset: asset(wavId, "audio/wav"), mp3Asset: asset(mp3Id, "audio/mpeg"), previewAsset: asset(previewId, "audio/mpeg", "PUBLIC", 59900) };
  const at = new Date(), proof = { policy: DIGITAL_RIGHTS_REVIEW_POLICY, binding: digitalRightsMasterBinding(master), status: "APPROVED", privateEvidenceReference: "private-evidence:synthetic-only/contract-test",
    evidenceSha256: "b".repeat(64), attestation: DIGITAL_RIGHTS_ATTESTATION, reason: null, reviewedAt: at.toISOString(), requestHash: "c".repeat(64) };
  const rights = { id: randomUUID(), actorId: reviewer.id, kind: DIGITAL_RIGHTS_REVIEW_EVENT, createdAt: at, details: { ...proof, recordHash: digitalRightsReviewHash({ actorId: reviewer.id, ...proof }) } };
  const artistic = syntheticExistingExcerptApproval(master, reviewer.id);
  const selected: DigitalSelection = { id: randomUUID(), scope: "TRACK", title: "Synthetic track", priceCents: 129, version: 1,
    tracks: [{ trackId, masterId, title: "Synthetic track", position: 1, formats: ["WAV", "MP3"], wavAssetId: wavId, mp3AssetId: mp3Id }] };
  type Attempt = { id: string; provider: string; status: string; checkoutUrl: string | null; providerReference: string | null; idempotencyKey: string };
  type Order = { id: string; userId: string; cartRevision: number; status: string; mode: string; totalCents: number; termsVersion: string; termsHash: string; contractSnapshot: unknown; jurisdictionSnapshot: unknown;
    user: { email: string }; lines: Array<{ id: string; title: string; priceCents: number }>; attempts: Attempt[] };
  let order: Order | null = null, creates = 0, gatewayCalls = 0, cartReads = 0;
  const tx = {
    async $queryRaw(parts: TemplateStringsArray) { const sql = parts.join("?");
      if (sql.includes("dcn-excerpt-current-masters")) return [{ id: master.id, trackId: master.trackId }];
      if (sql.includes("dcn-excerpt-latest-artistic-events")) return [artistic];
      return []; },
    user: { async findUnique({ where }: { where: { id: string } }) { return where.id === reviewer.id ? reviewer : { ...actor, displayName: actor.name }; }, async findMany() { return [reviewer]; } },
    digitalOrder: { async findUnique() { return order; }, async findFirst() { return null; }, async create({ data }: { data: Record<string, unknown> }) {
      creates++; order = { ...data, id: randomUUID(), status: "PENDING", user: { email: actor.email }, lines: [{ id: randomUUID(), title: selected.title, priceCents: selected.priceCents }], attempts: [] } as unknown as Order; return order;
    } },
    digitalCart: { async findUnique() { cartReads++; return { revision: 1, lines: [{ offerId: selected.id, offerVersion: selected.version, priceCents: selected.priceCents, selectionHash: selectionFingerprint(selected) }] }; } },
    digitalEntitlement: { async findMany() { return []; } },
    digitalOffer: { async findMany() { return [{ id: selected.id, scope: "TRACK", trackId, priceCents: selected.priceCents, version: 1, active: true, rightsConfirmed: true,
      project: { status: "PUBLISHED", publicVisible: true, tracks: [{ id: trackId, title: selected.title, position: 1, digitalMasters: [master] }] } }]; } },
    digitalMaster: { async findMany() { return [master]; } },
    digitalEvent: { async findFirst() { return rights; }, async create() { return {}; } },
    digitalPaymentAttempt: { async create({ data }: { data: Attempt }) { const attempt = { ...data, id: randomUUID(), status: "CREATING", checkoutUrl: null, providerReference: null }; order!.attempts.push(attempt); return attempt; } },
  } as unknown as Prisma.TransactionClient;
  const gateway = { merchantId: LOCAL_REVIEW_MERCHANT, async create() { gatewayCalls++; return { id: "cs_test_double_only", url: "https://checkout.stripe.com/c/local_simulated_only" }; }, async recover() { return null; } };
  const input = { revision: 1, idempotencyKey: randomUUID(), provider: "STRIPE", termsVersion: DIGITAL_FRANCE_TERMS_VERSION, termsAccepted: true, earlyDelivery: true, withdrawalAcknowledged: true,
    jurisdiction: { countryCode: "FR", residenceCountryCode: "FR", billingCountryCode: "FR", customerType: "B2C" } };
  return { actor, tx, gateway, input, state: () => ({ order, creates, gatewayCalls, cartReads }),
    legacy: () => { order = { id: randomUUID(), userId: actor.id, cartRevision: 1, status: "PENDING", mode: "TEST", totalCents: 129, termsVersion: DIGITAL_TERMS_VERSION, termsHash: "a".repeat(64),
      contractSnapshot: digitalContractSnapshot({ name: actor.name!, email: actor.email }, at), jurisdictionSnapshot: null, user: { email: actor.email }, lines: [],
      attempts: [{ id: randomUUID(), provider: "STRIPE", status: "OPEN", checkoutUrl: "https://checkout.stripe.com/c/legacy", providerReference: "old", idempotencyKey: "legacy" }] }; return order; } };
}
async function isolated<T>(f: ReturnType<typeof fixture>, run: () => Promise<T>) {
  const env = { ...process.env }, transaction = prisma.$transaction, find = prisma.digitalOrder.findFirst, update = prisma.digitalPaymentAttempt.updateMany;
  try {
    for (const key of Object.keys(process.env)) if (/STRIPE|PAYPAL|RESEND|RAILWAY|MEDIA_DEPLOYMENT_ENV|PAYMENT_DEPLOYMENT_ENV/.test(key)) delete process.env[key];
    Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_LOCAL_REVIEW_AUTHORIZED: "true", DCN_NEW_PAYMENTS_ENABLED: "false", DCN_EXTERNAL_TEST_AUTHORIZED: "false",
      DATABASE_URL: "postgresql://dcn_runtime_a:fixture_never_connect_20261015@127.0.0.1:55473/lnx_dcn_consolidation_test", AUTH_URL: "http://127.0.0.1:3140", MEDIA_STORAGE_DRIVER: "local", EMAIL_PROVIDER: "capture" });
    prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<T>) => callback(f.tx)) as unknown as typeof transaction;
    prisma.digitalOrder.findFirst = (async () => f.state().order) as unknown as typeof find;
    prisma.digitalPaymentAttempt.updateMany = (async ({ data }: { data: Record<string, unknown> }) => { Object.assign(f.state().order!.attempts[0], data); return { count: 1 }; }) as unknown as typeof update;
    return await run();
  } finally {
    prisma.$transaction = transaction; prisma.digitalOrder.findFirst = find; prisma.digitalPaymentAttempt.updateMany = update;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env);
  }
}
test("paid France checkout persists the exact accepted candidate before one doubled gateway call", async () => {
  const f = fixture(); await isolated(f, () => createDigitalCheckout(f.actor, f.input, f.gateway, { localReview: true }));
  const state = f.state(), order = state.order!;
  assert.equal(state.creates, 1); assert.equal(state.gatewayCalls, 1); assert.equal(order.termsVersion, DIGITAL_FRANCE_TERMS_VERSION); assert.equal(order.termsHash, DIGITAL_FRANCE_TERMS_TEXT_HASH);
  assert.equal((order.jurisdictionSnapshot as { termsVersion: string }).termsVersion, DIGITAL_FRANCE_TERMS_VERSION);
  assert.equal(verifyContractSnapshot(order.contractSnapshot, order.termsVersion, order.termsHash).snapshot.terms.expresslyAccepted, true);
});
test("new paid checkout refuses absent terms acceptance and an old draft before an order or gateway call", async () => {
  for (const patch of [{ termsAccepted: false }, { termsAccepted: undefined }, { termsVersion: DIGITAL_TERMS_VERSION }]) {
    const f = fixture(); await assert.rejects(() => isolated(f, () => createDigitalCheckout(f.actor, { ...f.input, ...patch }, f.gateway, { localReview: true })));
    assert.equal(f.state().creates, 0); assert.equal(f.state().gatewayCalls, 0);
  }
});
test("historical checkout retry returns its original contract without adopting the new template or calling the gateway", async () => {
  const f = fixture(), legacy = f.legacy(), before = JSON.stringify(legacy.contractSnapshot);
  const result = await isolated(f, () => createDigitalCheckout(f.actor, { ...f.input, termsVersion: DIGITAL_TERMS_VERSION, termsAccepted: undefined }, f.gateway, { localReview: true }));
  assert.equal(result.orderId, legacy.id); assert.equal(result.checkoutUrl, legacy.attempts[0].checkoutUrl); assert.equal(f.state().gatewayCalls, 0); assert.equal(f.state().cartReads, 0);
  assert.equal(JSON.stringify(legacy.contractSnapshot), before);
  await assert.rejects(() => isolated(f, () => createDigitalCheckout(f.actor, f.input, f.gateway, { localReview: true })), { code: "IDEMPOTENCY_CONFLICT" });
});
