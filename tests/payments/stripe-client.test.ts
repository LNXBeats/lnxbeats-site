import assert from "node:assert/strict";
import test from "node:test";

import { hostedCheckoutParameters } from "@/lib/payments/stripe-client";

test("builds a hosted Checkout request with only the canonical internal metadata", () => {
  const parameters = hostedCheckoutParameters({
    orderId: "11111111-1111-4111-8111-111111111111",
    paymentId: "22222222-2222-4222-8222-222222222222",
    pricingVersion: "2026-08-v1",
    lineItems: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: 5_000,
        product_data: { name: "Création musicale personnalisée LNX Beats" },
      },
    }],
    customerEmail: "verified-owner@example.test",
    successUrl: "https://lnxbeats.example.test/compte/commandes/LNX-2026-000001?paiement=retour&session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://lnxbeats.example.test/compte/commandes/LNX-2026-000001?paiement=annule",
  });

  assert.equal(parameters.mode, "payment");
  assert.deepEqual(parameters.adaptive_pricing, { enabled: false });
  assert.equal(parameters.locale, "fr");
  assert.equal(parameters.allow_promotion_codes, false);
  assert.deepEqual(parameters.automatic_tax, { enabled: false });
  assert.equal(parameters.billing_address_collection, "auto");
  assert.deepEqual(parameters.invoice_creation, { enabled: false });
  assert.equal("shipping_address_collection" in parameters, false);
  assert.equal("custom_text" in parameters, false);
  assert.equal(parameters.client_reference_id, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(parameters.metadata, {
    paymentId: "22222222-2222-4222-8222-222222222222",
    orderId: "11111111-1111-4111-8111-111111111111",
    pricingVersion: "2026-08-v1",
  });
  assert.deepEqual(parameters.payment_intent_data?.metadata, parameters.metadata);
  assert.equal(parameters.customer_email, "verified-owner@example.test");
  assert.deepEqual(parameters.line_items, [{
    quantity: 1,
    price_data: {
      currency: "eur",
      unit_amount: 5_000,
      product_data: { name: "Création musicale personnalisée LNX Beats" },
    },
  }]);
  assert.equal("payment_method_types" in parameters, false);
  assert.equal(JSON.stringify(parameters).includes("sk_test_"), false);
});
