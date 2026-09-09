import assert from "node:assert/strict";
import test from "node:test";

import { paypalRefundApplicationReference } from "@/lib/payments/paypal-client";
import { refundRightsWithdrawal, RIGHTS_WITHDRAWAL_DECLARATION } from "@/lib/rights/withdrawal";

const admin = { id: "11111111-1111-4111-8111-111111111111", email: "admin@example.invalid", name: "Admin Test", role: "ADMIN" as const, status: "ACTIVE" as const, emailVerified: true as const };
const attempt = {
  id: "22222222-2222-4222-8222-222222222222",
  paymentId: "33333333-3333-4333-8333-333333333333",
  provider: "PAYPAL" as const,
  providerIdempotencyKey: "rights-withdrawal:paypal:fixture",
  providerRefundId: null,
  status: "PROCESSING" as const,
};

test("the declaration is explicit and never asks the customer for a refund amount", () => {
  assert.match(RIGHTS_WITHDRAWAL_DECLARATION, /150,00 €/);
  assert.match(RIGHTS_WITHDRAWAL_DECLARATION, /moyen de paiement d’origine/);
});

test("a Rights withdrawal makes one provider request with the immutable 150 EUR amount", async () => {
  let requests = 0;
  let observed: unknown;
  const result = await refundRightsWithdrawal(admin, "LNX-RET-LIC-2027-ABCDEF123456", {
    assertRuntime: async () => ({ mode: "TEST", liveRefundsEnabled: false, liveRefundsArmed: false }),
    repository: {
      reserveRefund: async () => attempt,
      getAttempt: async () => ({ ...attempt, payment: { providerPaymentId: "CAPTURE-FICTIVE", mode: "TEST" } }),
      applyEvidence: async (_id: string, evidence: unknown) => { observed = evidence; return { status: "SUCCEEDED" as const, confirmed: true, creditNoteNumber: "AV-LNX-TEST" }; },
    } as never,
    gateway: () => ({
      request: async (input) => {
        requests += 1;
        assert.equal(input.amountCents, 15_000);
        assert.equal(input.providerPaymentId, "CAPTURE-FICTIVE");
        return {
          provider: "PAYPAL", providerRefundId: "REFUND-FICTIF", providerPaymentId: "CAPTURE-FICTIVE",
          status: "SUCCEEDED", amountCents: 15_000, currency: "EUR", occurredAt: new Date("2027-01-01T00:00:00Z"),
          applicationEvidence: { kind: "PAYPAL_INVOICE_REFERENCE", present: true, value: paypalRefundApplicationReference(attempt.providerIdempotencyKey) },
        };
      },
      retrieve: async () => { throw new Error("unexpected retrieve"); },
    }),
  });
  assert.equal(requests, 1);
  assert.equal(result.status, "SUCCEEDED");
  assert.equal((observed as { amountCents: number }).amountCents, 15_000);
});

test("an existing provider refund is retrieved and never created again", async () => {
  let created = 0;
  let retrieved = 0;
  await refundRightsWithdrawal(admin, "LNX-RET-LIC-2027-ABCDEF123456", {
    assertRuntime: async () => ({ mode: "TEST", liveRefundsEnabled: false, liveRefundsArmed: false }),
    repository: {
      reserveRefund: async () => ({ ...attempt, providerRefundId: "REFUND-EXISTANT", status: "PENDING" }),
      applyEvidence: async () => ({ status: "SUCCEEDED" as const, confirmed: true }),
    } as never,
    gateway: () => ({
      request: async () => { created += 1; throw new Error("unexpected request"); },
      retrieve: async () => { retrieved += 1; return { provider: "PAYPAL", providerRefundId: "REFUND-EXISTANT", providerPaymentId: "CAPTURE-FICTIVE", status: "SUCCEEDED", amountCents: 15_000, currency: "EUR", occurredAt: new Date(), applicationEvidence: { kind: "PAYPAL_INVOICE_REFERENCE", present: true, value: paypalRefundApplicationReference(attempt.providerIdempotencyKey) } }; },
    }),
  });
  assert.equal(created, 0);
  assert.equal(retrieved, 1);
});
