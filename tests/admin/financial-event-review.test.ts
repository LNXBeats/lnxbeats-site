import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { classifyFinancialReview, financialEventDetailPath, type CheckoutReviewEvidence, type FinancialReviewSnapshot } from "@/lib/admin/financial-event-policy";
import { adminPaymentReviewEventWhere, adminUncorrelatedPaymentReviewEventWhere } from "@/lib/admin/operation-queries";
const proof: CheckoutReviewEvidence = { sessionId: "cs_test_fixture", livemode: false, status: "expired", paymentStatus: "unpaid",
  paymentIntentId: null, amountCents: 2000, currency: "eur", contributionId: "support-fixture", purpose: "SUPPORT_LNX_BEATS", expectedOrder: false };
const row: FinancialReviewSnapshot = { provider: "STRIPE", type: "checkout.session.expired", objectId: proof.sessionId, livemode: false,
  outcome: "REQUIRES_REVIEW", paymentId: null, refundAttemptId: null, incidentId: null, reviewed: false, matchingPayments: 0,
  support: { id: "support-fixture", provider: "STRIPE", providerReference: proof.sessionId, mode: "TEST", status: "FAILED",
    amountCents: 2000, currency: "EUR", paymentReference: null, refundReference: null } };
test("exact expired unpaid Support state can be technically classified", () => {
  assert.equal(classifyFinancialReview(row, proof).eligible, true);
  assert.equal(classifyFinancialReview(row, proof).captured, "NO");
});
test("captured orphan cannot be hidden", () => {
  const result = classifyFinancialReview(row, { ...proof, paymentStatus: "paid", paymentIntentId: "pi_fixture" });
  assert.equal(result.captured, "YES"); assert.equal(result.eligible, false);
});
test("ambiguous or unavailable provider proof stays fail closed", () => {
  for (const value of [null, { ...proof, paymentIntentId: "pi_fixture" }, { ...proof, status: "open" }]) {
    assert.equal(classifyFinancialReview(row, value).eligible, false);
    assert.equal(classifyFinancialReview(row, value).captured, "UNKNOWN");
  }
});
test("already reviewed is not classified a second time", () => assert.equal(classifyFinancialReview({ ...row, reviewed: true }, proof).eligible, false));
test("financial obligations and mismatched bindings block resolution", () => {
  for (const changed of [{ paymentId: "payment" }, { refundAttemptId: "refund" }, { incidentId: "incident" }, { matchingPayments: 1 },
    { support: null }, { support: { ...row.support!, status: "SUCCEEDED" } }, { support: { ...row.support!, paymentReference: "pi_paid" } },
    { support: { ...row.support!, refundReference: "re_refund" } }, { support: { ...row.support!, amountCents: 1999 } },
    { support: { ...row.support!, mode: "LIVE" } }]) assert.equal(classifyFinancialReview({ ...row, ...changed }, proof).eligible, false);
  for (const changed of [{ expectedOrder: true }, { contributionId: "other" }, { livemode: true }, { sessionId: "other" }, { currency: "usd" }])
    assert.equal(classifyFinancialReview(row, { ...proof, ...changed }).eligible, false);
});
test("counter excludes only audited orphan, not a correlated financial incident", () => {
  assert.deepEqual(adminUncorrelatedPaymentReviewEventWhere.technicalReview, { is: null });
  assert.deepEqual(adminPaymentReviewEventWhere.OR[0].technicalReview, { is: null });
  assert.equal("technicalReview" in adminPaymentReviewEventWhere.OR[1], false);
  assert.equal("technicalReview" in adminPaymentReviewEventWhere.OR[2], false);
});
test("cockpit and orphan Examiner target the exact event; history is available", async () => {
  const cockpit = await readFile(new URL("../../lib/admin/cockpit.ts", import.meta.url), "utf8");
  const list = await readFile(new URL("../../app/admin/commandes/page.tsx", import.meta.url), "utf8");
  assert.match(cockpit, /financialEventDetailPath\(row.id\)/);
  assert.match(list, /financialEventDetailPath\(event.id\)/);
  assert.match(list, /Historique des événements financiers/);
  assert.equal(financialEventDetailPath("fixture-id"), "/admin/evenements-financiers/fixture-id");
});
test("technical classification writes audit only, not receipt, payment, order or provider", async () => {
  const service = await readFile(new URL("../../lib/admin/financial-event-review.ts", import.meta.url), "utf8");
  const gateway = await readFile(new URL("../../lib/admin/financial-event-stripe.ts", import.meta.url), "utf8");
  assert.match(service, /providerEventTechnicalReview.create/);
  assert.doesNotMatch(service, /(?:providerEvent|payment|order|supportContribution)\.(?:update|delete|create)/);
  assert.doesNotMatch(gateway, /\.(?:create|update|capture|cancel|refund|expire)\(/);
  assert.match(gateway, /account.id !== accountId/);
});
test("Admin auth, same origin and explicit confirmation are required", async () => {
  const action = await readFile(new URL("../../app/admin/evenements-financiers/actions.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../../app/admin/evenements-financiers/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(action, /await requireAdmin\(\)/); assert.match(action, /isSameOriginMutation/);
  assert.match(action, /formData.get\("confirmation"\) !== "expired-unpaid"/);
  assert.match(page, /await requireAdmin\(\)/);
  assert.match(page, /classification.eligible/);
});
