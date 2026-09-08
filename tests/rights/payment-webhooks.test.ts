import assert from "node:assert/strict";
import test from "node:test";

import type { VerifiedPaypalWebhookEvent } from "@/lib/payments/paypal-webhook";
import { normalizeRightsPaypalWebhookEvidence } from "@/lib/rights/payment-webhooks";

test("PayPal capture evidence keeps order and capture identifiers distinct", () => {
  const event: VerifiedPaypalWebhookEvent = {
    id: "WH-RIGHTS-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    create_time: "2026-09-08T12:00:00.000Z",
    resource: {
      id: "CAPTURE-RIGHTS-1",
      custom_id: "11111111-1111-4111-8111-111111111111",
      amount: { value: "150.00", currency_code: "EUR" },
      supplementary_data: { related_ids: { order_id: "ORDER-RIGHTS-1" } },
    },
  };

  assert.deepEqual(normalizeRightsPaypalWebhookEvidence(event), {
    resource: event.resource,
    paymentId: "11111111-1111-4111-8111-111111111111",
    rightsRequestId: null,
    providerOrderId: "ORDER-RIGHTS-1",
    captureId: "CAPTURE-RIGHTS-1",
    amountValue: "150.00",
    currency: "EUR",
  });
});

test("PayPal approval evidence reads the immutable purchase-unit snapshot", () => {
  const event: VerifiedPaypalWebhookEvent = {
    id: "WH-RIGHTS-2",
    event_type: "CHECKOUT.ORDER.APPROVED",
    create_time: "2026-09-08T12:00:00.000Z",
    resource: {
      id: "ORDER-RIGHTS-2",
      purchase_units: [{
        custom_id: "22222222-2222-4222-8222-222222222222",
        reference_id: "33333333-3333-4333-8333-333333333333",
        amount: { value: "150.00", currency_code: "EUR" },
      }],
    },
  };

  const evidence = normalizeRightsPaypalWebhookEvidence(event);
  assert.equal(evidence.providerOrderId, "ORDER-RIGHTS-2");
  assert.equal(evidence.captureId, undefined);
  assert.equal(evidence.paymentId, "22222222-2222-4222-8222-222222222222");
  assert.equal(evidence.rightsRequestId, "33333333-3333-4333-8333-333333333333");
  assert.equal(evidence.amountValue, "150.00");
  assert.equal(evidence.currency, "EUR");
});
