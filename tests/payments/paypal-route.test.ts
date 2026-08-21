import assert from "node:assert/strict";
import test from "node:test";

import type { OrderActor } from "@/lib/orders/domain";
import {
  handlePaypalCapturePost,
  handlePaypalCheckoutPost,
  PAYPAL_CAPTURE_REQUEST_MAX_BYTES,
  type PaypalCaptureRouteDependencies,
  type PaypalCheckoutRouteDependencies,
} from "@/lib/payments/paypal-route-handler";

const actor = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "member@example.test",
  name: "Member QA",
  role: "MEMBER",
  status: "ACTIVE",
  emailVerified: true,
} as const satisfies OrderActor;
const context = { params: Promise.resolve({ orderNumber: "LNX-2026-000001" }) };
const base = "https://staging.example.test/api/orders/LNX-2026-000001/payments/paypal";

function common() {
  return {
    isAllowedMutation: () => true,
    assertRuntime: async () => {},
    actorFromHeaders: async () => actor,
  };
}

test("PayPal checkout requires trusted origin and verified authentication", async () => {
  let called = false;
  const dependencies: PaypalCheckoutRouteDependencies = {
    ...common(),
    isAllowedMutation: () => false,
    async createOrder() { called = true; return { approvalUrl: "https://never.invalid" }; },
  };
  const response = await handlePaypalCheckoutPost(new Request(`${base}/checkout`, { method: "POST" }), context, dependencies);
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("PayPal capture passes only the bounded provider order id to the service", async () => {
  let input: string | undefined;
  const dependencies: PaypalCaptureRouteDependencies = {
    ...common(),
    async captureOrder(_actor, _orderNumber, providerOrderId) {
      input = providerOrderId;
      return { confirmed: true, pending: false };
    },
  };
  const response = await handlePaypalCapturePost(new Request(`${base}/capture`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://staging.example.test" },
    body: JSON.stringify({
      providerOrderId: "PAYPAL-ORDER-01",
      amountCents: 1,
      currency: "USD",
      paymentId: "forged",
    }),
  }), context, dependencies);
  assert.equal(response.status, 200);
  assert.equal(input, "PAYPAL-ORDER-01");
});

test("PayPal capture rejects invalid media types and an oversized streamed body", async () => {
  const dependencies: PaypalCaptureRouteDependencies = {
    ...common(),
    async captureOrder() { throw new Error("must not be called"); },
  };
  const unsupported = await handlePaypalCapturePost(new Request(`${base}/capture`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "PAYPAL-ORDER-01",
  }), context, dependencies);
  assert.equal(unsupported.status, 415);

  const oversized = await handlePaypalCapturePost(new Request(`${base}/capture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerOrderId: "A".repeat(PAYPAL_CAPTURE_REQUEST_MAX_BYTES + 1) }),
  }), context, dependencies);
  assert.equal(oversized.status, 413);
});
