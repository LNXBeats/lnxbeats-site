import assert from "node:assert/strict";
import test from "node:test";

import type { OrderActor } from "@/lib/orders/domain";
import {
  handleShopPaypalCapturePost,
  handleShopPaypalCheckoutPost,
  handleShopStripeCheckoutPost,
} from "@/lib/shop/payment-route-handler";

const ORDER_NUMBER = "LNX-SHOP-2026-000001";
const context = { params: Promise.resolve({ orderNumber: ORDER_NUMBER }) };
const actor: OrderActor = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "lnx-v110-phase3-member@example.invalid",
  name: "Membre Phase 3",
  role: "MEMBER",
  status: "ACTIVE",
  emailVerified: true,
};

function request(body: unknown) {
  return new Request(`http://127.0.0.1:31770/api/shop/orders/${ORDER_NUMBER}/payments/test`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:31770" },
    body: JSON.stringify(body),
  });
}

test("Shop Stripe route requires an exact terms acceptance and a verified member", async () => {
  let calls = 0;
  const dependencies = {
    isAllowedMutation: () => true,
    actorFromHeaders: async () => actor,
    createCheckout: async (receivedActor: { id: string }, orderNumber: string, accepted: true) => {
      calls += 1;
      assert.equal(receivedActor.id, actor.id);
      assert.equal(orderNumber, ORDER_NUMBER);
      assert.equal(accepted, true);
      return { checkoutUrl: "https://checkout.example.invalid/session" };
    },
  };

  const absent = await handleShopStripeCheckoutPost(request({ termsAccepted: false }), context, dependencies);
  assert.equal(absent.status, 409);
  assert.equal(calls, 0);

  const forged = await handleShopStripeCheckoutPost(
    request({ termsAccepted: true, termsVersion: "forged" }),
    context,
    dependencies,
  );
  assert.equal(forged.status, 409);
  assert.equal(calls, 0);

  const accepted = await handleShopStripeCheckoutPost(request({ termsAccepted: true }), context, dependencies);
  assert.equal(accepted.status, 200);
  assert.equal(calls, 1);

  const denied = await handleShopStripeCheckoutPost(request({ termsAccepted: true }), context, {
    ...dependencies,
    actorFromHeaders: async () => ({ ...actor, role: "ADMIN" }),
  });
  assert.equal(denied.status, 403);
  assert.equal(calls, 1);
});

test("Shop PayPal Checkout and capture accept only their closed payloads", async () => {
  let checkoutCalls = 0;
  const checkout = await handleShopPaypalCheckoutPost(request({ termsAccepted: true }), context, {
    isAllowedMutation: () => true,
    actorFromHeaders: async () => actor,
    createOrder: async () => {
      checkoutCalls += 1;
      return { approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=QA" };
    },
  });
  assert.equal(checkout.status, 200);
  assert.equal(checkoutCalls, 1);

  let captureCalls = 0;
  const captured = await handleShopPaypalCapturePost(request({ providerOrderId: "PAYPAL_QA_001" }), context, {
    isAllowedMutation: () => true,
    actorFromHeaders: async () => actor,
    captureOrder: async (_actor, orderNumber, providerOrderId) => {
      captureCalls += 1;
      assert.equal(orderNumber, ORDER_NUMBER);
      assert.equal(providerOrderId, "PAYPAL_QA_001");
      return { confirmed: true, pending: false };
    },
  });
  assert.equal(captured.status, 200);
  assert.equal(captureCalls, 1);

  const extra = await handleShopPaypalCapturePost(
    request({ providerOrderId: "PAYPAL_QA_001", paymentId: "forged" }),
    context,
    {
      isAllowedMutation: () => true,
      actorFromHeaders: async () => actor,
      captureOrder: async () => ({ confirmed: false, pending: false }),
    },
  );
  assert.equal(extra.status, 400);
});

test("Shop payment routes reject cross-origin mutations before parsing credentials", async () => {
  let authCalls = 0;
  const response = await handleShopStripeCheckoutPost(request({ termsAccepted: true }), context, {
    isAllowedMutation: () => false,
    actorFromHeaders: async () => {
      authCalls += 1;
      return actor;
    },
    createCheckout: async () => ({ checkoutUrl: "https://checkout.example.invalid/session" }),
  });
  assert.equal(response.status, 403);
  assert.equal(authCalls, 0);
});
