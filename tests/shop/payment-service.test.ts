import assert from "node:assert/strict";
import test from "node:test";

import type { HostedCheckoutRequest, HostedCheckoutSession } from "@/lib/payments/stripe-client";
import type { PaypalCreateOrderRequest, PaypalGateway } from "@/lib/payments/paypal-client";
import {
  capturePaypalOrderForShopOrder,
  createPaypalOrderForShopOrder,
  createStripeCheckoutForShopOrder,
  ShopPaymentServiceError,
  shopPaymentReturnUrls,
  type ShopPaymentCaptureRepository,
  type ShopPaymentCheckoutRepository,
} from "@/lib/shop/payment-service";
import type { ReservedShopPaymentAttempt, ShopPaymentActor } from "@/lib/shop/payment-types";
import type { ShopPaymentProviderEvent } from "@/lib/shop/payment-types";

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "shop-member@example.invalid",
  role: "MEMBER",
  status: "ACTIVE",
  emailVerified: true,
} as const satisfies ShopPaymentActor;

const attempt = {
  shopOrderId: "22222222-2222-4222-8222-222222222222",
  orderNumber: "LNX-SHOP-2026-000001",
  paymentId: "33333333-3333-4333-8333-333333333333",
  provider: "STRIPE",
  mode: "TEST",
  idempotencyKey: "shop:stripe:33333333-3333-4333-8333-333333333333",
  amountCents: 3_000,
  shippingCents: 500,
  currency: "EUR",
  pricingVersion: "shop-order-v1",
  reservationExpiresAt: new Date("2026-08-27T20:30:00.000Z"),
  lines: [{
    productId: "44444444-4444-4444-8444-444444444444",
    title: "Vinyle QA",
    quantity: 2,
    unitPriceCents: 1_250,
    lineTotalCents: 2_500,
  }],
} as const satisfies ReservedShopPaymentAttempt;

function checkoutRepository(events: string[]) {
  const accepted: unknown[] = [];
  const sessions: HostedCheckoutSession[] = [];
  const repository: ShopPaymentCheckoutRepository = {
    async enforceRateLimit(actorId) {
      events.push(`rate:${actorId}`);
    },
    async reserveAttempt(actorId, orderNumber, provider, mode, termsAccepted) {
      events.push(`reserve:${actorId}:${orderNumber}:${provider}:${mode}`);
      accepted.push(termsAccepted);
      return { ...attempt, provider, mode };
    },
    async recordSession(paymentId, provider, session) {
      events.push(`record:${paymentId}:${provider}`);
      sessions.push(session);
    },
  };
  return { repository, accepted, sessions };
}

function paypalGateway(
  createOrder: PaypalGateway["createOrder"],
  captureOrder?: PaypalGateway["captureOrder"],
): PaypalGateway {
  return {
    createOrder,
    async retrieveOrder() {
      throw new Error("unexpected retrieve");
    },
    captureOrder: captureOrder ?? (async () => { throw new Error("unexpected capture"); }),
    async verifyWebhook() {
      throw new Error("unexpected webhook verification");
    },
  };
}

test("prepares Stripe Checkout exclusively from the persisted ShopOrder snapshot", async () => {
  const events: string[] = [];
  const local = checkoutRepository(events);
  let request: HostedCheckoutRequest | undefined;
  let key: string | undefined;
  const session = { id: "cs_test_shop", url: "https://checkout.stripe.test/shop" } as const;
  const result = await createStripeCheckoutForShopOrder(actor, attempt.orderNumber, true, {
    repository: local.repository,
    mode: "TEST",
    baseUrl: "http://127.0.0.1:3000/untrusted-path",
    gateway: {
      async createHostedCheckout(value, idempotencyKey) {
        request = value;
        key = idempotencyKey;
        events.push("stripe");
        return session;
      },
      async retrieveHostedCheckout() {
        throw new Error("unexpected retrieve");
      },
    },
  });

  assert.deepEqual(result, { checkoutUrl: session.url });
  assert.equal(key, attempt.idempotencyKey);
  assert.equal(request?.paymentSource, "SHOP_ORDER");
  assert.equal(request?.shopOrderId, attempt.shopOrderId);
  assert.equal(request?.orderNumber, attempt.orderNumber);
  assert.equal(request?.lineItems.reduce((sum, item) => sum + item.price_data.unit_amount, 0), 3_000);
  assert.deepEqual(request?.lineItems.map((item) => item.price_data.product_data.name), [
    "Vinyle QA × 2",
    "Livraison",
  ]);
  assert.equal(request?.successUrl, "http://127.0.0.1:3000/compte/achats/LNX-SHOP-2026-000001?paiement=retour&session_id={CHECKOUT_SESSION_ID}");
  assert.deepEqual(local.accepted, [true]);
  assert.deepEqual(events, [
    `rate:${actor.id}`,
    `reserve:${actor.id}:${attempt.orderNumber}:STRIPE:TEST`,
    "stripe",
    `record:${attempt.paymentId}:STRIPE`,
  ]);
});

test("prepares PayPal from the same immutable total and source identity", async () => {
  const events: string[] = [];
  const local = checkoutRepository(events);
  let request: PaypalCreateOrderRequest | undefined;
  const result = await createPaypalOrderForShopOrder(actor, attempt.orderNumber, true, {
    repository: local.repository,
    mode: "TEST",
    baseUrl: "http://localhost:3000",
    gateway: paypalGateway(async (value, key) => {
      request = value;
      assert.equal(key, attempt.idempotencyKey);
      return {
        id: "PAYPAL-SHOP-ORDER",
        status: "PAYER_ACTION_REQUIRED",
        approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-SHOP-ORDER",
      };
    }),
  });

  assert.equal(result.approvalUrl, "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-SHOP-ORDER");
  assert.equal(request?.paymentSource, "SHOP_ORDER");
  assert.equal(request?.shopOrderId, attempt.shopOrderId);
  assert.equal(request?.amountCents, 3_000);
  assert.equal(request?.currency, "EUR");
});

test("missing terms and non-member actors are refused before any repository or provider call", async () => {
  const events: string[] = [];
  const local = checkoutRepository(events);
  const gateway = {
    async createHostedCheckout() {
      events.push("provider");
      return { id: "unexpected", url: "https://example.test" };
    },
    async retrieveHostedCheckout() {
      throw new Error("unexpected");
    },
  };

  await assert.rejects(
    createStripeCheckoutForShopOrder(actor, attempt.orderNumber, false, {
      repository: local.repository,
      gateway,
      baseUrl: "http://127.0.0.1:3000",
      mode: "TEST",
    }),
    (error: unknown) => error instanceof ShopPaymentServiceError && error.code === "TERMS_NOT_ACCEPTED",
  );
  await assert.rejects(
    createStripeCheckoutForShopOrder({ ...actor, role: "ADMIN" }, attempt.orderNumber, true, {
      repository: local.repository,
      gateway,
      baseUrl: "http://127.0.0.1:3000",
      mode: "TEST",
    }),
    (error: unknown) => error instanceof ShopPaymentServiceError && error.code === "PAYMENT_ACCESS_DENIED",
  );
  assert.deepEqual(events, []);
});

test("PayPal capture uses the persisted attempt and delegates only verified evidence to reconciliation", async () => {
  const reconciled: ShopPaymentProviderEvent[] = [];
  let rateLimitChecks = 0;
  const repository: ShopPaymentCaptureRepository = {
    async enforceRateLimit() {
      rateLimitChecks += 1;
    },
    async reservePaypalCapture() {
      return {
        paymentId: attempt.paymentId,
        shopOrderId: attempt.shopOrderId,
        orderNumber: attempt.orderNumber,
        providerOrderId: "PAYPAL-SHOP-ORDER",
        captureIdempotencyKey: `shop:paypal:capture:${attempt.paymentId}`,
        amountCents: attempt.amountCents,
        currency: "EUR",
        pricingVersion: "shop-order-v1",
      };
    },
    async reconcile(event) {
      reconciled.push(event);
      return {
        outcome: "PROCESSED",
        duplicate: false,
        shopOrderPaid: true,
        stockConfirmed: true,
        winningPaymentId: attempt.paymentId,
      };
    },
  };
  const result = await capturePaypalOrderForShopOrder(actor, attempt.orderNumber, "PAYPAL-SHOP-ORDER", {
    repository,
    mode: "TEST",
    gateway: paypalGateway(
      async () => { throw new Error("unexpected create"); },
      async (_providerOrderId, key) => {
        assert.equal(key, `shop:paypal:capture:${attempt.paymentId}`);
        return {
          providerOrderId: "PAYPAL-SHOP-ORDER",
          captureId: "CAPTURE-SHOP-1",
          status: "COMPLETED",
          paymentId: attempt.paymentId,
          amountCents: attempt.amountCents,
          currency: "EUR",
          occurredAt: new Date("2026-08-27T20:00:00.000Z"),
        };
      },
    ),
  });
  assert.deepEqual(result, { confirmed: true, pending: false, requiresReview: false });
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0]?.status, "SUCCEEDED");
  assert.equal(reconciled[0]?.providerPaymentId, "CAPTURE-SHOP-1");
  assert.equal(rateLimitChecks, 1);
});

test("a captured PayPal response with divergent metadata is persisted for review instead of being dropped", async () => {
  const reconciled: ShopPaymentProviderEvent[] = [];
  const repository: ShopPaymentCaptureRepository = {
    async enforceRateLimit() {},
    async reservePaypalCapture() {
      return {
        paymentId: attempt.paymentId,
        shopOrderId: attempt.shopOrderId,
        orderNumber: attempt.orderNumber,
        providerOrderId: "PAYPAL-SHOP-ORDER",
        captureIdempotencyKey: `shop:paypal:capture:${attempt.paymentId}`,
        amountCents: attempt.amountCents,
        currency: "EUR",
        pricingVersion: "shop-order-v1",
      };
    },
    async reconcile(event) {
      reconciled.push(event);
      return {
        outcome: "REQUIRES_REVIEW",
        duplicate: false,
        shopOrderPaid: false,
        stockConfirmed: false,
        reviewCode: "SHOP_PAYMENT_EVIDENCE_MISMATCH",
      };
    },
  };
  const result = await capturePaypalOrderForShopOrder(actor, attempt.orderNumber, "PAYPAL-SHOP-ORDER", {
    repository,
    mode: "TEST",
    gateway: paypalGateway(
      async () => { throw new Error("unexpected create"); },
      async () => ({
        providerOrderId: "PAYPAL-DIVERGENT-ORDER",
        captureId: "CAPTURE-SHOP-DIVERGENT",
        status: "COMPLETED",
        paymentId: "44444444-4444-4444-8444-444444444444",
        amountCents: attempt.amountCents + 1,
        currency: "EUR",
        occurredAt: new Date("2026-08-27T20:10:00.000Z"),
      }),
    ),
  });
  assert.deepEqual(result, { confirmed: false, pending: false, requiresReview: true });
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0]?.paymentId, attempt.paymentId);
  assert.equal(reconciled[0]?.providerSourcePaymentId, "44444444-4444-4444-8444-444444444444");
  assert.equal(reconciled[0]?.providerCheckoutId, "PAYPAL-DIVERGENT-ORDER");
  assert.equal(reconciled[0]?.providerPaymentId, "CAPTURE-SHOP-DIVERGENT");
  assert.equal(reconciled[0]?.amountCents, attempt.amountCents + 1);
});

test("direct PayPal capture persists amount, currency and malformed evidence for review", async () => {
  const variants = [
    {
      label: "amount",
      capture: {
        paymentId: attempt.paymentId,
        amountCents: attempt.amountCents + 1,
        currency: "EUR",
        evidenceConsistent: false,
      },
    },
    {
      label: "currency",
      capture: {
        paymentId: attempt.paymentId,
        amountCents: attempt.amountCents,
        currency: "USD",
        evidenceConsistent: false,
      },
    },
    {
      label: "malformed",
      capture: {
        paymentId: attempt.paymentId,
        evidenceConsistent: false,
      },
    },
    {
      label: "missing-capture-id",
      capture: {
        captureId: undefined,
        paymentId: attempt.paymentId,
        amountCents: attempt.amountCents,
        currency: "EUR",
        evidenceConsistent: false,
      },
    },
  ] as const;

  for (const variant of variants) {
    const reconciled: ShopPaymentProviderEvent[] = [];
    let providerCalls = 0;
    let stockOrNotificationCalls = 0;
    const result = await capturePaypalOrderForShopOrder(actor, attempt.orderNumber, "PAYPAL-SHOP-ORDER", {
      mode: "TEST",
      repository: {
        async enforceRateLimit() {},
        async reservePaypalCapture() {
          return {
            paymentId: attempt.paymentId,
            shopOrderId: attempt.shopOrderId,
            orderNumber: attempt.orderNumber,
            providerOrderId: "PAYPAL-SHOP-ORDER",
            captureIdempotencyKey: `shop:paypal:capture:${attempt.paymentId}`,
            amountCents: attempt.amountCents,
            currency: "EUR",
            pricingVersion: "shop-order-v1",
          };
        },
        async reconcile(event) {
          reconciled.push(event);
          return {
            outcome: "REQUIRES_REVIEW",
            duplicate: false,
            shopOrderPaid: false,
            stockConfirmed: false,
            reviewCode: "SHOP_PAYMENT_EVIDENCE_MISMATCH",
          };
        },
      },
      gateway: paypalGateway(
        async () => { throw new Error("unexpected create"); },
        async () => {
          providerCalls += 1;
          return {
            providerOrderId: "PAYPAL-SHOP-ORDER",
            captureId: `CAPTURE-${variant.label}`,
            status: "COMPLETED",
            occurredAt: new Date("2026-08-27T20:10:00.000Z"),
            ...variant.capture,
          };
        },
      ),
    });

    assert.deepEqual(result, { confirmed: false, pending: false, requiresReview: true });
    assert.equal(providerCalls, 1);
    assert.equal(stockOrNotificationCalls, 0);
    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0]?.paymentId, attempt.paymentId);
    assert.equal(reconciled[0]?.status, "SUCCEEDED");
    assert.equal(reconciled[0]?.evidenceConsistent, false);
    assert.equal(
      reconciled[0]?.providerPaymentId,
      variant.label === "missing-capture-id" ? undefined : `CAPTURE-${variant.label}`,
    );
    stockOrNotificationCalls = 0;
  }
});

test("PayPal capture stops before the provider when the persisted ShopOrder review gate is closed", async () => {
  let gatewayCalls = 0;
  await assert.rejects(
    () => capturePaypalOrderForShopOrder(actor, attempt.orderNumber, "PAYPAL-SHOP-ORDER", {
      mode: "TEST",
      repository: {
        async enforceRateLimit() {},
        async reservePaypalCapture() {
          throw new ShopPaymentServiceError(409, "ORDER_NOT_PAYABLE");
        },
        async reconcile() {
          throw new Error("reconciliation must not run");
        },
      },
      gateway: paypalGateway(
        async () => { throw new Error("unexpected create"); },
        async () => {
          gatewayCalls += 1;
          throw new Error("capture must not run");
        },
      ),
    }),
    (error: unknown) => error instanceof ShopPaymentServiceError && error.code === "ORDER_NOT_PAYABLE",
  );
  assert.equal(gatewayCalls, 0);
});

test("Shop return URLs keep the canonical origin and never trust a caller path", () => {
  assert.deepEqual(shopPaymentReturnUrls(attempt.orderNumber, "https://www.lnxbeats.fr/ignored?x=1"), {
    stripeSuccessUrl: "https://www.lnxbeats.fr/compte/achats/LNX-SHOP-2026-000001?paiement=retour&session_id={CHECKOUT_SESSION_ID}",
    stripeCancelUrl: "https://www.lnxbeats.fr/compte/achats/LNX-SHOP-2026-000001?paiement=annule",
    paypalReturnUrl: "https://www.lnxbeats.fr/compte/achats/LNX-SHOP-2026-000001?paiement=paypal-retour",
    paypalCancelUrl: "https://www.lnxbeats.fr/compte/achats/LNX-SHOP-2026-000001?paiement=paypal-annule",
  });
});
