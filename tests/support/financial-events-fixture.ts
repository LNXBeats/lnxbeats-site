import type { CheckoutReviewEvidence, FinancialReviewSnapshot } from "@/lib/admin/financial-event-policy";
import type { VerifiedStripeWebhookEvent } from "@/lib/payments/webhook";
export const supportId = "11111111-1111-4111-8111-111111111111";
export const supportProof: CheckoutReviewEvidence = { sessionId: "cs_test_reconciled", livemode: false,
  verifiedAt: Date.now(),
  status: "complete", paymentStatus: "paid", paymentIntentId: "pi_fixture", amountCents: 300, currency: "eur",
  contributionId: supportId, clientReferenceId: supportId, purpose: "SUPPORT_LNX_BEATS", expectedOrder: false,
  payment: { id: "pi_fixture", livemode: false, status: "succeeded", amountReceived: 300, currency: "eur",
    contributionId: supportId, purpose: "SUPPORT_LNX_BEATS", captured: true, refunded: false, amountRefunded: 0 } };
export const supportRow: FinancialReviewSnapshot = { provider: "STRIPE", type: "checkout.session.completed",
  objectId: supportProof.sessionId, livemode: false, outcome: "REQUIRES_REVIEW", paymentId: null,
  refundAttemptId: null, incidentId: null, reviewed: false, matchingPayments: 0, supportCandidates: 1,
  support: { id: supportId, provider: "STRIPE", providerReference: supportProof.sessionId, mode: "TEST",
    status: "SUCCEEDED", amountCents: 300, currency: "EUR", paymentReference: "pi_fixture", refundReference: null } };
export const supportEvent: VerifiedStripeWebhookEvent = { id: "evt_support_reconciled", type: "checkout.session.completed",
  livemode: false, created: 1770000000, data: { object: { object: "checkout.session", id: supportProof.sessionId,
    livemode: false, status: "complete", payment_status: "paid", payment_intent: "pi_fixture", amount_total: 300,
    currency: "eur", client_reference_id: supportId, metadata: { purpose: "SUPPORT_LNX_BEATS", contributionId: supportId } } } };
