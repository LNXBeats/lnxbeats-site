import assert from "node:assert/strict";
import test from "node:test";

import type { OrderActor } from "@/lib/orders/domain";
import {
  handleStripeCheckoutPost,
  type CheckoutRouteDependencies,
} from "@/lib/payments/checkout-route-handler";
import { PaymentServiceError } from "@/lib/payments/service";

const admin = {
  id: "owner-admin-id",
  email: "owner@example.test",
  name: "Owner",
  role: "ADMIN",
  status: "ACTIVE",
  emailVerified: true,
} as const satisfies OrderActor;

const context = {
  params: Promise.resolve({ orderNumber: "LNX-2026-000001" }),
};

function routeDependencies(
  actor: OrderActor | null,
  createCheckout: CheckoutRouteDependencies["createCheckout"] = async () => ({
    checkoutUrl: "https://checkout.stripe.test/session",
  }),
): CheckoutRouteDependencies {
  return {
    isAllowedMutation: () => true,
    assertQaRuntime: async () => {},
    actorFromHeaders: async () => actor,
    createCheckout,
  };
}

function request() {
  return new Request(
    "https://lnxbeats.example.test/api/orders/LNX-2026-000001/payments/stripe/checkout",
    { method: "POST", headers: { origin: "https://lnxbeats.example.test" } },
  );
}

test("fails closed before authentication when the mutation origin is not trusted", async () => {
  let authCalled = false;
  const dependencies: CheckoutRouteDependencies = {
    isAllowedMutation: () => false,
    assertQaRuntime: async () => {},
    actorFromHeaders: async () => {
      authCalled = true;
      return admin;
    },
    createCheckout: async () => ({ checkoutUrl: "https://never.invalid" }),
  };
  const response = await handleStripeCheckoutPost(request(), context, dependencies);
  assert.equal(response.status, 403);
  assert.equal(authCalled, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("requires a verified active session and accepts a customer owner", async () => {
  const unauthenticated = await handleStripeCheckoutPost(
    request(),
    context,
    routeDependencies(null),
  );
  assert.equal(unauthenticated.status, 401);

  const member = await handleStripeCheckoutPost(
    request(),
    context,
    routeDependencies({ ...admin, role: "MEMBER" }),
  );
  assert.equal(member.status, 200);
});

test("fails closed before authentication outside the isolated Stripe QA runtime", async () => {
  let authCalled = false;
  const response = await handleStripeCheckoutPost(request(), context, {
    isAllowedMutation: () => true,
    assertQaRuntime: async () => {
      throw new Error("personal database");
    },
    actorFromHeaders: async () => {
      authCalled = true;
      return admin;
    },
    createCheckout: async () => ({ checkoutUrl: "https://never.invalid" }),
  });
  assert.equal(response.status, 503);
  assert.equal(authCalled, false);
  assert.deepEqual(await response.json(), {
    error: "Le paiement ne peut pas être préparé.",
    code: "PAYMENT_UNAVAILABLE",
  });
});

test("keeps authentication infrastructure failures neutral", async () => {
  const response = await handleStripeCheckoutPost(request(), context, {
    isAllowedMutation: () => true,
    assertQaRuntime: async () => {},
    actorFromHeaders: async () => {
      throw new Error("database fixture detail");
    },
    createCheckout: async () => ({ checkoutUrl: "https://never.invalid" }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Le paiement ne peut pas être préparé.",
    code: "PAYMENT_UNAVAILABLE",
  });
});

test("passes only the authenticated actor and route order number to the service", async () => {
  let received: { actor: OrderActor; orderNumber: string } | undefined;
  const response = await handleStripeCheckoutPost(
    new Request(request().url, {
      method: "POST",
      headers: {
        origin: "https://lnxbeats.example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amountCents: 1,
        currency: "USD",
        userId: "forged-user",
        successUrl: "https://attacker.example.invalid",
      }),
    }),
    context,
    routeDependencies(admin, async (actor, orderNumber) => {
      received = { actor, orderNumber };
      return { checkoutUrl: "https://checkout.stripe.test/session" };
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, { actor: admin, orderNumber: "LNX-2026-000001" });
  assert.deepEqual(await response.json(), {
    checkoutUrl: "https://checkout.stripe.test/session",
  });
});

test("returns bounded neutral service errors", async () => {
  const response = await handleStripeCheckoutPost(
    request(),
    context,
    routeDependencies(admin, async () => {
      throw new PaymentServiceError(409, "PAYMENT_ALREADY_COMPLETED");
    }),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Le paiement ne peut pas être préparé.",
    code: "PAYMENT_ALREADY_COMPLETED",
  });
});
