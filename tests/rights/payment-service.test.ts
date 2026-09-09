import assert from "node:assert/strict";
import test from "node:test";

import { capturePaypalOrderForRights, createPaypalOrderForRights, createStripeCheckoutForRights, rightsPaymentReturnUrls } from "@/lib/rights/payment-service";
import type { RightsPaymentActor, ReservedRightsPaymentAttempt } from "@/lib/rights/payment-types";

const actor: RightsPaymentActor = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.invalid", role: "MEMBER", status: "ACTIVE", emailVerified: true };
const attempt: ReservedRightsPaymentAttempt = {
  rightsRequestId: "22222222-2222-4222-8222-222222222222", requestNumber: "LNX-LIC-2027-000001",
  orderId: "33333333-3333-4333-8333-333333333333", orderNumber: "LNX-2027-000001", workTitle: "Œuvre fictive",
  paymentId: "44444444-4444-4444-8444-444444444444", provider: "STRIPE", mode: "TEST",
  idempotencyKey: "rights-fixture", amountCents: 15_000, currency: "EUR", pricingVersion: "2026-09-publication-license-v1",
};

function repository() {
  return {
    reserveAttempt: async (_actorId: string, _requestNumber: string, provider: "STRIPE" | "PAYPAL") => ({ ...attempt, provider }),
    recordSession: async () => undefined,
    reservePaypalCapture: async () => ({ paymentId: attempt.paymentId, providerOrderId: "PAYPAL-ORDER", captureIdempotencyKey: "capture-key", amountCents: 15_000 as const, currency: "EUR" as const }),
    reconcile: async () => ({ outcome: "PROCESSED" as const, duplicate: false, paid: true, waitingWithdrawal: true }),
  };
}

test("Rights return URLs are server-owned and stay on the request page", () => {
  const urls = rightsPaymentReturnUrls(attempt.requestNumber, "https://www.lnxbeats.fr/ignored/path");
  assert.equal(urls.stripeSuccess, `https://www.lnxbeats.fr/compte/droits/${attempt.requestNumber}?paiement=retour&session_id={CHECKOUT_SESSION_ID}`);
  assert.equal(urls.paypalCancel, `https://www.lnxbeats.fr/compte/droits/${attempt.requestNumber}?paiement=paypal-annule`);
  assert.throws(() => rightsPaymentReturnUrls("../../private", "https://www.lnxbeats.fr"));
});

test("Stripe receives exactly one server-priced 150 EUR Rights line", async () => {
  let observed: unknown;
  const result = await createStripeCheckoutForRights(actor, attempt.requestNumber, true, {
    repository: repository() as never, baseUrl: "https://www.lnxbeats.fr", mode: "TEST", skipGate: true,
    stripe: {
      createHostedCheckout: async (request) => { observed = request; return { id: "cs_test_rights", url: "https://checkout.example.invalid" }; },
      retrieveHostedCheckout: async () => { throw new Error("unexpected retrieve"); },
    },
  });
  const request = observed as { paymentSource: string; rightsRequestId: string; lineItems: Array<{ quantity: number; price_data: { currency: string; unit_amount: number } }> };
  assert.equal(result.checkoutUrl, "https://checkout.example.invalid");
  assert.equal(request.paymentSource, "RIGHTS_REQUEST");
  assert.equal(request.rightsRequestId, attempt.rightsRequestId);
  assert.equal(request.lineItems.length, 1);
  assert.equal(request.lineItems[0]?.quantity, 1);
  assert.equal(request.lineItems[0]?.price_data.currency, "eur");
  assert.equal(request.lineItems[0]?.price_data.unit_amount, 15_000);
});

test("PayPal receives the immutable 150 EUR snapshot and no caller price", async () => {
  let observed: unknown;
  const result = await createPaypalOrderForRights(actor, attempt.requestNumber, true, {
    repository: repository() as never, baseUrl: "https://www.lnxbeats.fr", mode: "TEST", skipGate: true,
    paypal: {
      createOrder: async (request) => { observed = request; return { id: "PAYPAL-ORDER", status: "CREATED", approvalUrl: "https://paypal.example.invalid/approve" }; },
      retrieveOrder: async () => { throw new Error("unexpected retrieve"); },
      captureOrder: async () => { throw new Error("unexpected capture"); },
      verifyWebhook: async () => false,
    },
  });
  const request = observed as { paymentSource: string; rightsRequestId: string; amountCents: number; currency: string };
  assert.equal(result.approvalUrl, "https://paypal.example.invalid/approve");
  assert.deepEqual(request, { ...request, paymentSource: "RIGHTS_REQUEST", rightsRequestId: attempt.rightsRequestId, amountCents: 15_000, currency: "EUR" });
});

test("contract acceptance is mandatory before any repository or provider operation", async () => {
  let called = false;
  const deps = { repository: { ...repository(), reserveAttempt: async () => { called = true; return attempt; } } as never, baseUrl: "https://www.lnxbeats.fr", mode: "TEST" as const, skipGate: true };
  await assert.rejects(createStripeCheckoutForRights(actor, attempt.requestNumber, false, deps), /RIGHTS_CONTRACT_ACCEPTANCE_REQUIRED/);
  assert.equal(called, false);
});

test("closing new sales does not strand capture of an existing PayPal order", async () => {
  let captured = 0;
  const result = await capturePaypalOrderForRights(actor, attempt.requestNumber, "PAYPAL-ORDER", {
    repository: repository() as never,
    baseUrl: "https://www.lnxbeats.fr",
    mode: "TEST",
    paypal: {
      createOrder: async () => { throw new Error("unexpected create"); },
      retrieveOrder: async () => { throw new Error("unexpected retrieve"); },
      captureOrder: async () => {
        captured += 1;
        return { providerOrderId: "PAYPAL-ORDER", captureId: "CAPTURE-FICTIVE", status: "COMPLETED", amountCents: 15_000, currency: "EUR", occurredAt: new Date(), paymentId: attempt.paymentId, evidenceConsistent: true };
      },
      verifyWebhook: async () => false,
    },
  });
  assert.equal(captured, 1);
  assert.equal(result.outcome, "PROCESSED");
});
