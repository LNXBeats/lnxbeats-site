import assert from "node:assert/strict";
import test from "node:test";

import { hostedCheckoutParameters } from "@/lib/payments/stripe-client";

test("builds a hosted Checkout request with only the canonical internal metadata", () => {
  const parameters = hostedCheckoutParameters({
    orderId: "11111111-1111-4111-8111-111111111111",
    paymentId: "22222222-2222-4222-8222-222222222222",
    pricingVersion: "2026-08-v2",
    lineItems: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: 2_000,
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
    pricingVersion: "2026-08-v2",
  });
  assert.deepEqual(parameters.payment_intent_data?.metadata, parameters.metadata);
  assert.equal(parameters.customer_email, "verified-owner@example.test");
  assert.deepEqual(parameters.line_items, [{
    quantity: 1,
    price_data: {
      currency: "eur",
      unit_amount: 2_000,
      product_data: { name: "Création musicale personnalisée LNX Beats" },
    },
  }]);
  assert.equal("payment_method_types" in parameters, false);
  const serializedParameters = JSON.stringify(parameters);
  assert.equal(serializedParameters.includes("sk_test_"), false);
  assert.equal(serializedParameters.includes("storageKey"), false);
  assert.equal(serializedParameters.includes("delivery"), false);
  assert.equal(serializedParameters.includes("storageKey"), false);
});

test("builds Shop Checkout metadata without leaking cart or shipping data", () => {
  const parameters = hostedCheckoutParameters({
    paymentSource: "SHOP_ORDER",
    shopOrderId: "33333333-3333-4333-8333-333333333333",
    orderNumber: "LNX-SHOP-2026-000001",
    paymentId: "44444444-4444-4444-8444-444444444444",
    pricingVersion: "shop-order-v1",
    lineItems: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: 3_000,
        product_data: { name: "Commande Boutique LNX Beats" },
      },
    }],
    customerEmail: "shop-owner@example.invalid",
    successUrl: "https://www.lnxbeats.fr/compte/achats/LNX-SHOP-2026-000001?paiement=retour",
    cancelUrl: "https://www.lnxbeats.fr/compte/achats/LNX-SHOP-2026-000001?paiement=annule",
  });

  assert.equal(parameters.client_reference_id, "33333333-3333-4333-8333-333333333333");
  assert.deepEqual(parameters.metadata, {
    paymentSource: "SHOP_ORDER",
    paymentId: "44444444-4444-4444-8444-444444444444",
    shopOrderId: "33333333-3333-4333-8333-333333333333",
    orderNumber: "LNX-SHOP-2026-000001",
    pricingVersion: "shop-order-v1",
  });
  assert.deepEqual(parameters.payment_intent_data?.metadata, parameters.metadata);
  const serialized = JSON.stringify(parameters);
  assert.equal(serialized.includes("shippingAddress"), false);
  assert.equal(serialized.includes("productId"), false);
});
