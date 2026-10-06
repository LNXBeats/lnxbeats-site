import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { supportEvent, supportProof, supportId } from "@/tests/support/financial-events-fixture";
const runtime = new URL(process.env.DATABASE_URL ?? ""), migration = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
for (const url of [runtime, migration]) {
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55502");
  assert.equal(url.pathname, "/lnx_support_financial_qa"); assert.equal(url.password, "");
}
assert.equal(process.env.NODE_ENV, "test"); assert.notEqual(runtime.username, migration.username);
const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: migration.toString() }) });
const { prisma } = await import("@/lib/prisma");
const { processVerifiedSupportFinancialEvent } = await import("@/lib/support/financial-events");
const { resolveFinancialEventReview, getFinancialEventReview } = await import("@/lib/admin/financial-event-review");
const { reconcileSupportEvidence } = await import("@/lib/support/service");
const fresh = async () => ({ ...supportProof, verifiedAt: Date.now() });
try {
  assert.equal(await owner.supportContribution.count(), 0);
  const admin = await owner.user.create({ data: { email: "admin-financial@example.invalid", role: "ADMIN", status: "ACTIVE" } });
  await owner.supportContribution.create({ data: { ...supportProofToData() } });
  const before = await owner.supportContribution.findUniqueOrThrow({ where: { id: supportId } });
  const baseline = { orders: await owner.order.count(), payments: await owner.payment.count(), notifications: await owner.supportNotification.count(), attempts: await owner.supportContributionAttempt.count() };
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => processVerifiedSupportFinancialEvent(supportEvent, undefined, fresh)));
  assert.equal(concurrent.filter(r => !r.duplicate).length, 1); assert.ok(concurrent.every(r => r.outcome === "PROCESSED"));
  assert.equal(await owner.providerEvent.count(), 1); assert.equal(await owner.supportContributionEvent.count(), 1);
  assert.equal(await owner.supportNotification.count(), baseline.notifications);
  assert.deepEqual(await owner.supportContribution.findUniqueOrThrow({ where: { id: supportId } }), before);
  assert.equal((await processVerifiedSupportFinancialEvent(supportEvent, undefined, fresh)).duplicate, true);
  assert.equal((await processVerifiedSupportFinancialEvent({ ...supportEvent, id: "evt_support_bad_reference" }, undefined,
    async () => ({ ...await fresh(), contributionId: "-".repeat(36) }))).outcome, "REQUIRES_REVIEW");
  // Inverse arrival: generic receipt observes PENDING first; dedicated Support API later confirms.
  // The immutable historical REVIEW needs explicit, fresh Admin reconciliation, not replay.
  await owner.supportContribution.update({ where: { id: supportId }, data: { status: "PENDING" } });
  const inverse = { ...supportEvent, id: "evt_support_inverse" };
  assert.equal((await processVerifiedSupportFinancialEvent(inverse, undefined, fresh)).outcome, "REQUIRES_REVIEW");
  await reconcileSupportEvidence({ mode: "TEST", contributionId: supportId, provider: "STRIPE", providerReference: supportProof.sessionId,
    paymentReference: "pi_fixture", amountCents: 300, currency: "EUR", status: "SUCCEEDED" }, "stripe:synthetic_inverse");
  const legitimateQueue = await owner.supportNotification.count();
  assert.equal(legitimateQueue, 1); // Normal synthetic pending -> paid confirmation, not financial-review replay.
  assert.equal((await processVerifiedSupportFinancialEvent(inverse, undefined, fresh)).outcome, "REQUIRES_REVIEW");
  const receipt = await owner.providerEvent.findUniqueOrThrow({ where: { provider_providerEventId: { provider: "STRIPE", providerEventId: inverse.id } } });
  assert.equal((await getFinancialEventReview(receipt.id, fresh))?.classification.reconciliationEligible, true);
  // Synthetic TEST fixture only. Concurrent explicit approvals append exactly one immutable audit.
  const results = await Promise.all(Array.from({ length: 4 }, () => resolveFinancialEventReview(receipt.id, admin.id, fresh, "SUPPORT_PAYMENT_RECONCILED")));
  assert.equal(results.filter(r => r === "REVIEWED").length, 1);
  assert.equal(await owner.providerEventTechnicalReview.count(), 1);
  assert.deepEqual(await owner.providerEvent.findUnique({ where: { id: receipt.id } }), receipt);
  assert.equal((await owner.providerEventTechnicalReview.findFirstOrThrow()).reason, "SUPPORT_PAYMENT_RECONCILED");
  await assert.rejects(prisma.providerEventTechnicalReview.updateMany({ data: { reason: "FORBIDDEN" } }));
  await assert.rejects(prisma.supportContributionEvent.deleteMany());
  const expired = { ...supportEvent, id: "evt_support_expired", type: "checkout.session.expired" };
  assert.equal((await processVerifiedSupportFinancialEvent(expired, undefined, fresh)).outcome, "REQUIRES_REVIEW");
  const expiredReceipt = await owner.providerEvent.findUniqueOrThrow({ where: { provider_providerEventId: { provider: "STRIPE", providerEventId: expired.id } } });
  await assert.rejects(owner.providerEventTechnicalReview.create({ data: { eventId: expiredReceipt.id, actorId: admin.id,
    reason: "ARBITRARY_FINANCIAL_CLASSIFICATION", evidence: {} } }), /provider_event_technical_reviews_reason_check/);
  await owner.providerEventTechnicalReview.create({ data: { eventId: expiredReceipt.id, actorId: admin.id,
    reason: "EXPIRED_UNPAID_SUPPORT_CHECKOUT", evidence: { fixture: true } } });
  assert.deepEqual({ orders: await owner.order.count(), payments: await owner.payment.count(), notifications: await owner.supportNotification.count(), attempts: await owner.supportContributionAttempt.count() }, { ...baseline, notifications: legitimateQueue });
  assert.equal((await owner.supportContribution.findUniqueOrThrow({ where: { id: supportId } })).refundReference, null);
  console.log(JSON.stringify({ status: "PASS", database: "synthetic isolated", nonOwnerRuntime: true,
    concurrentReceipt: "8 calls / 1 receipt / 1 support audit", inverseArrival: "fresh explicit audit / historical receipt unchanged",
    concurrentAdminReview: "4 approvals / 1 append-only audit", noOrder: true, noRefund: true, noRetroactiveNotification: true }));
} finally { await owner.$disconnect(); await prisma.$disconnect(); }
function supportProofToData() {
  return { id: supportId, ownerHash: "a".repeat(64), idempotencyKey: randomUUID(), provider: "STRIPE", mode: "TEST",
    status: "SUCCEEDED", amountCents: 300, currency: "EUR", providerReference: supportProof.sessionId, paymentReference: "pi_fixture" };
}
