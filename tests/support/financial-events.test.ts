import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyFinancialReview, supportPaymentReconciled, type FinancialReviewSnapshot, type CheckoutReviewEvidence } from "@/lib/admin/financial-event-policy";
import { isSupportFinancialEvent, signedSupportMatches, processVerifiedSupportFinancialEvent } from "@/lib/support/financial-events";
import { supportProof as p, supportRow as r, supportEvent as e } from "./financial-events-fixture";
test("3 EUR paid/captured unique SUCCEEDED Support is reconciled, never classified as expired", () => {
  assert.equal(supportPaymentReconciled(r, p), true);
  const c = classifyFinancialReview(r, p);
  assert.equal(c.reconciliationEligible, true); assert.equal(c.eligible, false);
  assert.match(c.reason, /SUPPORT_PAYMENT_RECONCILED/);
});
const badRows: Record<string, Partial<FinancialReviewSnapshot>> = {
  absent: { support: null }, multiple: { supportCandidates: 2 }, unknownCount: { supportCandidates: undefined },
  amount: { support: { ...r.support!, amountCents: 301 } }, currency: { support: { ...r.support!, currency: "USD" } },
  intent: { support: { ...r.support!, paymentReference: "pi_other" } }, missingIntent: { support: { ...r.support!, paymentReference: null } },
  session: { support: { ...r.support!, providerReference: "cs_other" } }, failed: { support: { ...r.support!, status: "FAILED" } },
  pending: { support: { ...r.support!, status: "PENDING" } }, provider: { support: { ...r.support!, provider: "PAYPAL" } },
  live: { support: { ...r.support!, mode: "LIVE" } }, refund: { support: { ...r.support!, refundReference: "re_fixture" } },
  order: { matchingPayments: 1 }, correlated: { paymentId: "payment" }, incident: { incidentId: "incident" },
  unknownEvent: { type: "unknown" }, wrongEventMode: { livemode: true }, wrongEventProvider: { provider: "PAYPAL" },
};
for (const [name, patch] of Object.entries(badRows)) test(`fail closed: ${name}`, () => assert.equal(supportPaymentReconciled({ ...r, ...patch }, p), false));
const badProofs: Record<string, Partial<CheckoutReviewEvidence>> = {
  stale: { verifiedAt: Date.now() - 31_000 }, missingFreshness: { verifiedAt: undefined },
  unpaid: { paymentStatus: "unpaid" }, open: { status: "open" }, otherSupport: { contributionId: "other" },
  source: { purpose: null }, expectedOrder: { expectedOrder: true }, missingPayment: { payment: null },
  capture: { payment: { ...p.payment!, captured: false } }, refunded: { payment: { ...p.payment!, amountRefunded: 1 } },
  piMode: { payment: { ...p.payment!, livemode: true } }, piStatus: { payment: { ...p.payment!, status: "processing" } },
  piAmount: { payment: { ...p.payment!, amountReceived: 299 } }, piPurpose: { payment: { ...p.payment!, purpose: null } },
  checkoutSession: { sessionId: "cs_other" }, checkoutCurrency: { currency: "usd" }, noClientReference: { clientReferenceId: null },
  piReference: { payment: { ...p.payment!, id: "pi_other" } }, piCurrency: { payment: { ...p.payment!, currency: "usd" } },
  refundedBoolean: { payment: { ...p.payment!, refunded: true } },
};
for (const [name, patch] of Object.entries(badProofs)) test(`fail closed provider: ${name}`, () => assert.equal(supportPaymentReconciled(r, { ...p, ...patch }), false));
test("unavailable proof and signed/fresh contradictions stay REVIEW", () => {
  assert.equal(supportPaymentReconciled(r, null), false); assert.equal(signedSupportMatches(e, p), true);
  assert.equal(signedSupportMatches(e, { ...p, amountCents: 999 }), false);
  assert.equal(signedSupportMatches(e, { ...p, paymentIntentId: "pi_other" }), false);
  assert.equal(signedSupportMatches({ ...e, account: "acct_foreign_fixture" }, p), false);
  assert.equal(isSupportFinancialEvent({ ...e, data: { object: { metadata: { paymentId: "order" } } } }), false);
});
test("Support routing reads fresh evidence outside persistence; no payment operation", async () => {
  const calls: string[] = [];
  await processVerifiedSupportFinancialEvent(e, { reconcile: async (_e, proof) => {
    calls.push("persist"); assert.deepEqual(proof, p); return { outcome: "PROCESSED", duplicate: false };
  } }, async () => { calls.push("GET"); return p; });
  assert.deepEqual(calls, ["GET", "persist"]);
});
test("expired keeps REVIEW receipt and unchanged explicit expired Admin workflow", async () => {
  await processVerifiedSupportFinancialEvent({ ...e, type: "checkout.session.expired" }, {
    reconcile: async (_e, proof) => { assert.equal(proof, null); return { outcome: "REQUIRES_REVIEW", duplicate: false }; },
  }, async () => { throw Error("expired reader not expected"); });
  assert.equal(classifyFinancialReview({ ...r, type: "checkout.session.expired" }, p).eligible, false);
});
test("future receipt and audit only: no fulfillment/refund/email; Order fallback and historical review immutability", async () => {
  const src = await readFile(new URL("../../lib/support/financial-events.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /(?:supportContribution|payment|order|shopOrder|supportNotification)\.(?:create|update|delete|upsert)/);
  assert.doesNotMatch(src, /enqueue|refund\(|capture\(/);
  assert.match(src, /if \(prior\) return/); assert.match(src, /supportContributionEvent.create/);
  const route = await readFile(new URL("../../lib/payments/webhook-route-handler.ts", import.meta.url), "utf8");
  assert.match(route, /if \(isSupportFinancialEvent\(event\)\) return processVerifiedSupportFinancialEvent/);
  assert.match(route, /: processVerifiedStripeWebhookEvent\(event\)/);
});
