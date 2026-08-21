import assert from "node:assert/strict";
import test from "node:test";

import type { OrderActor } from "@/lib/orders/domain";
import { handlePaymentEditPost } from "@/lib/payments/edit-route-handler";
import {
  expireCheckoutAfterCancellation,
  PaymentServiceError,
  prepareOrderForEditing,
  type PaymentEditDependencies,
} from "@/lib/payments/service";

const actor = {
  id: "owner-id",
  email: "owner@example.test",
  name: "Owner",
  role: "MEMBER",
  status: "ACTIVE",
  emailVerified: true,
} as const satisfies OrderActor;

function dependencies(active = true) {
  const events: string[] = [];
  const value: PaymentEditDependencies = {
    repository: {
      async findActiveCheckout(receivedActor, orderNumber) {
        events.push(`find:${receivedActor.id}:${orderNumber}`);
        return active
          ? { orderId: "order-id", stripePaymentId: "payment-id", stripeCheckoutId: "cs_test_fixture", paypalAttemptsCanceled: false }
          : { orderId: "order-id", paypalAttemptsCanceled: false };
      },
      async findCancelledCheckout(orderNumber) {
        events.push(`cancelled:${orderNumber}`);
        return active
          ? { orderId: "order-id", stripePaymentId: "payment-id", stripeCheckoutId: "cs_test_fixture", paypalAttemptsCanceled: false }
          : { orderId: "order-id", paypalAttemptsCanceled: false };
      },
      async markCheckoutExpired(orderId, paymentId) {
        events.push(`expired:${orderId}:${paymentId}`);
      },
      async markCheckoutReview(orderId, paymentId) {
        events.push(`review:${orderId}:${paymentId}`);
      },
    },
    gateway: {
      async expireHostedCheckout(checkoutId, idempotencyKey) {
        events.push(`stripe:${checkoutId}:${idempotencyKey}`);
        return { id: checkoutId, status: "expired" };
      },
    },
    async assertQaRuntime() {
      events.push("guard");
    },
  };
  return { value, events };
}

test("expires the active Checkout before allowing the owner to edit", async () => {
  const fake = dependencies();
  assert.deepEqual(await prepareOrderForEditing(actor, "LNX-2026-000001", fake.value), { editable: true });
  assert.deepEqual(fake.events, [
    "find:owner-id:LNX-2026-000001",
    "guard",
    "stripe:cs_test_fixture:expire-checkout-session:payment-id",
    "expired:order-id:payment-id",
  ]);
});

test("invalidates a PayPal approval before an Order can be edited", async () => {
  const fake = dependencies(false);
  fake.value.repository.findActiveCheckout = async () => ({
    orderId: "order-id",
    paypalAttemptsCanceled: true,
  });
  assert.deepEqual(await prepareOrderForEditing(actor, "LNX-2026-000001", fake.value), { editable: true });
  assert.deepEqual(fake.events, []);
});

test("does not call Stripe when no active Checkout exists", async () => {
  const fake = dependencies(false);
  assert.deepEqual(await prepareOrderForEditing(actor, "LNX-2026-000001", fake.value), { editable: true });
  assert.deepEqual(fake.events, ["find:owner-id:LNX-2026-000001"]);
});

test("fails closed when the active Checkout cannot be expired", async () => {
  const fake = dependencies();
  fake.value.gateway.expireHostedCheckout = async () => {
    throw new Error("provider detail must remain hidden");
  };
  await assert.rejects(
    prepareOrderForEditing(actor, "LNX-2026-000001", fake.value),
    (error: unknown) => error instanceof PaymentServiceError
      && error.code === "PAYMENT_SESSION_EXPIRATION_FAILED"
      && !error.message.includes("provider detail"),
  );
  assert.equal(fake.events.some((event) => event.startsWith("expired:")), false);
});

test("an Admin cancellation expires the Checkout or records a bounded review incident", async () => {
  const success = dependencies();
  assert.deepEqual(await expireCheckoutAfterCancellation("LNX-2026-000001", success.value), { expired: true });
  assert.equal(success.events.includes("expired:order-id:payment-id"), true);

  const failure = dependencies();
  failure.value.gateway.expireHostedCheckout = async () => { throw new Error("upstream"); };
  await assert.rejects(
    expireCheckoutAfterCancellation("LNX-2026-000001", failure.value),
    (error: unknown) => error instanceof PaymentServiceError && error.code === "PAYMENT_SESSION_EXPIRATION_FAILED",
  );
  assert.equal(failure.events.includes("review:order-id:payment-id"), true);
});

test("the prepare-edit route preserves same-origin, authentication and ownership inputs", async () => {
  let received: { actor: OrderActor; orderNumber: string } | undefined;
  const request = new Request("https://lnxbeats.example.test/api/orders/LNX-2026-000001/payments/stripe/prepare-edit", { method: "POST" });
  const context = { params: Promise.resolve({ orderNumber: "LNX-2026-000001" }) };
  const denied = await handlePaymentEditPost(request, context, {
    isAllowedMutation: () => false,
    actorFromHeaders: async () => actor,
    prepare: async () => ({ editable: true }),
  });
  assert.equal(denied.status, 403);

  const response = await handlePaymentEditPost(request, context, {
    isAllowedMutation: () => true,
    actorFromHeaders: async () => actor,
    prepare: async (receivedActor, orderNumber) => {
      received = { actor: receivedActor, orderNumber };
      return { editable: true };
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { actor, orderNumber: "LNX-2026-000001" });
});
