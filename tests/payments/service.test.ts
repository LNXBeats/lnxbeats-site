import assert from "node:assert/strict";
import test from "node:test";

import type { OrderActor } from "@/lib/orders/domain";
import {
  createStripeCheckoutForOrder,
  paymentReturnUrls,
  PaymentServiceError,
  type CheckoutServiceDependencies,
  type ReservedCheckoutAttempt,
} from "@/lib/payments/service";
import type {
  HostedCheckoutRequest,
  HostedCheckoutSession,
} from "@/lib/payments/stripe-client";

const admin = {
  id: "owner-admin-id",
  email: "owner@example.test",
  name: "Owner",
  role: "ADMIN",
  status: "ACTIVE",
  emailVerified: true,
} as const satisfies OrderActor;

const attempt = {
  orderId: "11111111-1111-4111-8111-111111111111",
  orderNumber: "LNX-2026-000001",
  paymentId: "22222222-2222-4222-8222-222222222222",
  idempotencyKey: "checkout-session:22222222-2222-4222-8222-222222222222",
  snapshot: {
    coverIncluded: true,
    priorityProcessing: false,
    basePriceCents: 5_000,
    coverPriceCents: 1_000,
    priorityPriceCents: 0,
    totalCents: 6_000,
    currency: "EUR",
    pricingVersion: "2026-08-v1",
  },
} as const satisfies ReservedCheckoutAttempt;

function dependencies(events: string[]) {
  const requests: HostedCheckoutRequest[] = [];
  const idempotencyKeys: string[] = [];
  const recorded: Array<{ paymentId: string; session: HostedCheckoutSession }> = [];
  const session = {
    id: "cs_test_checkout",
    url: "https://checkout.stripe.test/session",
    expiresAt: 1_800_000_000,
    paymentIntentId: "pi_test_payment",
  } as const;

  const value: CheckoutServiceDependencies = {
    baseUrl: "https://lnxbeats.example.test/untrusted-path-is-ignored",
    repository: {
      async enforceRateLimit(actorId) {
        events.push(`rate:${actorId}`);
      },
      async reserveAttempt(actorId, orderNumber) {
        events.push(`reserve:${actorId}:${orderNumber}`);
        return attempt;
      },
      async recordSession(paymentId, checkoutSession) {
        events.push(`record:${paymentId}`);
        recorded.push({ paymentId, session: checkoutSession });
      },
    },
    gateway: {
      async createHostedCheckout(request, idempotencyKey) {
        events.push(`stripe:${idempotencyKey}`);
        requests.push(request);
        idempotencyKeys.push(idempotencyKey);
        return session;
      },
      async retrieveHostedCheckout(checkoutId) {
        events.push(`retrieve:${checkoutId}`);
        return session;
      },
    },
  };
  return { value, requests, idempotencyKeys, recorded };
}

test("creates Checkout only after reserving a local server-priced attempt", async () => {
  const events: string[] = [];
  const fake = dependencies(events);
  const result = await createStripeCheckoutForOrder(
    admin,
    attempt.orderNumber,
    fake.value,
  );

  assert.deepEqual(result, { checkoutUrl: "https://checkout.stripe.test/session" });
  assert.deepEqual(events, [
    "rate:owner-admin-id",
    "reserve:owner-admin-id:LNX-2026-000001",
    `stripe:${attempt.idempotencyKey}`,
    `record:${attempt.paymentId}`,
  ]);
  assert.deepEqual(fake.requests[0], {
    orderId: attempt.orderId,
    paymentId: attempt.paymentId,
    pricingVersion: attempt.snapshot.pricingVersion,
    lineItems: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: 5_000,
          product_data: { name: "Création musicale personnalisée LNX Beats" },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: 1_000,
          product_data: { name: "Cover personnalisée" },
        },
      },
    ],
    customerEmail: admin.email,
    successUrl: "https://lnxbeats.example.test/commande/LNX-2026-000001/confirmation?paiement=retour&session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://lnxbeats.example.test/commande/LNX-2026-000001/confirmation?paiement=annule",
  });
  assert.equal(fake.recorded[0]?.paymentId, attempt.paymentId);
  assert.equal(fake.recorded[0]?.session.paymentIntentId, "pi_test_payment");
});

test("retrieves a persisted Checkout Session instead of relying on a remote idempotency window", async () => {
  const events: string[] = [];
  const fake = dependencies(events);
  fake.value.repository.reserveAttempt = async () => ({
    ...attempt,
    providerCheckoutId: "cs_test_existing",
  });

  await createStripeCheckoutForOrder(admin, attempt.orderNumber, fake.value);

  assert.equal(events.includes("retrieve:cs_test_existing"), true);
  assert.equal(events.some((event) => event.startsWith("stripe:")), false);
});

test("retries and double clicks reuse the persisted payment idempotency key", async () => {
  const events: string[] = [];
  const fake = dependencies(events);

  await Promise.all([
    createStripeCheckoutForOrder(admin, attempt.orderNumber, fake.value),
    createStripeCheckoutForOrder(admin, attempt.orderNumber, fake.value),
  ]);

  assert.deepEqual(fake.idempotencyKeys, [attempt.idempotencyKey, attempt.idempotencyKey]);
  assert.equal(fake.requests[0]?.paymentId, fake.requests[1]?.paymentId);
  assert.equal(fake.recorded.length, 2);
});

test("accepts a customer owner and rejects malformed order numbers before any side effect", async () => {
  const events: string[] = [];
  const fake = dependencies(events);
  const member = { ...admin, role: "MEMBER" } as const satisfies OrderActor;

  await createStripeCheckoutForOrder(member, attempt.orderNumber, fake.value);
  assert.equal(events.length > 0, true);
  events.length = 0;
  await assert.rejects(
    createStripeCheckoutForOrder(admin, "../../another-order", fake.value),
    (error: unknown) => error instanceof PaymentServiceError
      && error.code === "INVALID_ORDER_NUMBER",
  );
  assert.deepEqual(events, []);
});

test("keeps remote failures neutral and does not claim that the Session was recorded", async () => {
  const events: string[] = [];
  const fake = dependencies(events);
  const upstreamMessage = "sensitive upstream diagnostic fixture";
  fake.value.gateway.createHostedCheckout = async () => {
    events.push("stripe:failed");
    throw new Error(upstreamMessage);
  };

  await assert.rejects(
    createStripeCheckoutForOrder(admin, attempt.orderNumber, fake.value),
    (error: unknown) => error instanceof PaymentServiceError
      && error.code === "PAYMENT_UNAVAILABLE"
      && !error.message.includes(upstreamMessage),
  );
  assert.deepEqual(events, [
    "rate:owner-admin-id",
    "reserve:owner-admin-id:LNX-2026-000001",
    "stripe:failed",
  ]);
});

test("derives both return URLs from the canonical server origin", () => {
  assert.deepEqual(paymentReturnUrls(attempt.orderNumber, {
    AUTH_URL: "https://preview.example.test/base/path?ignored=yes",
    SITE_URL: "https://public.example.test",
  }), {
    successUrl: "https://preview.example.test/commande/LNX-2026-000001/confirmation?paiement=retour&session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://preview.example.test/commande/LNX-2026-000001/confirmation?paiement=annule",
  });
  assert.throws(() => paymentReturnUrls(attempt.orderNumber, {
    AUTH_URL: "http://public.example.test",
  }));
});
