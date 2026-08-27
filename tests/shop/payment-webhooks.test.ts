import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PaypalGateway } from "@/lib/payments/paypal-client";
import type { PaypalCaptureRepository } from "@/lib/payments/paypal-service";
import {
  handlePaypalWebhookPost,
  type PaypalWebhookRouteDependencies,
} from "@/lib/payments/paypal-webhook-route-handler";
import type { VerifiedStripeWebhookEvent } from "@/lib/payments/webhook";
import {
  handleStripeWebhookPost,
  type StripeWebhookRouteDependencies,
} from "@/lib/payments/webhook-route-handler";
import {
  createPaypalPaymentSourceLookup,
  enrichShopStripeWebhookEvent,
  normalizeShopStripeWebhookEvent,
  processVerifiedPaypalWebhookEventByPaymentSource,
  processVerifiedShopStripeWebhookEvent,
  resolveShopStripePaymentSource,
} from "@/lib/shop/payment-webhooks";
import type { ShopPaymentProviderEvent } from "@/lib/shop/payment-types";

const paymentId = "11111111-1111-4111-8111-111111111111";
const shopOrderId = "22222222-2222-4222-8222-222222222222";
const occurredAt = "2026-08-27T20:00:00.000Z";

function stripeCheckoutEvent(
  type = "checkout.session.completed",
  overrides: Record<string, unknown> = {},
): VerifiedStripeWebhookEvent {
  return {
    id: `evt_shop_${type.replaceAll(".", "_")}`,
    type,
    livemode: false,
    created: new Date(occurredAt).getTime() / 1_000,
    data: {
      object: {
        id: "cs_test_shop",
        object: "checkout.session",
        mode: "payment",
        livemode: false,
        client_reference_id: shopOrderId,
        metadata: {
          paymentSource: "SHOP_ORDER",
          paymentId,
          shopOrderId,
          orderNumber: "LNX-SHOP-2026-000001",
          pricingVersion: "shop-order-v1",
        },
        amount_total: 3_000,
        currency: "eur",
        payment_status: "paid",
        status: "complete",
        payment_intent: "pi_test_shop",
        ...overrides,
      },
    },
  };
}

function expandedStripeSession() {
  return {
    ...(stripeCheckoutEvent().data.object as Record<string, unknown>),
    payment_intent: {
      id: "pi_test_shop",
      object: "payment_intent",
      livemode: false,
      status: "succeeded",
      amount: 3_000,
      currency: "eur",
      metadata: {
        paymentSource: "SHOP_ORDER",
        paymentId,
        shopOrderId,
        pricingVersion: "shop-order-v1",
      },
      payment_method: { id: "pm_shop", object: "payment_method", type: "card" },
    },
  };
}

test("signed Stripe Shop success is enriched from provider evidence then normalized without PII", async () => {
  let retrieves = 0;
  const enriched = await enrichShopStripeWebhookEvent(
    stripeCheckoutEvent(),
    { mode: "test", secretKey: "sk_test_not_used" },
    async (checkoutId) => {
      retrieves += 1;
      assert.equal(checkoutId, "cs_test_shop");
      return expandedStripeSession();
    },
  );
  const normalized = normalizeShopStripeWebhookEvent(enriched);
  assert.equal(retrieves, 1);
  assert.deepEqual(normalized, {
    eventId: "evt_shop_checkout_session_completed",
    type: "checkout.session.completed",
    provider: "STRIPE",
    livemode: false,
    paymentId,
    providerSourceShopOrderId: shopOrderId,
    providerCheckoutId: "cs_test_shop",
    providerPaymentId: "pi_test_shop",
    amountCents: 3_000,
    currency: "EUR",
    status: "SUCCEEDED",
    occurredAt: new Date(occurredAt),
    paymentMethod: "CARD",
  });
  assert.doesNotMatch(JSON.stringify(normalized), /address|customerEmail|shipping/i);
});

test("Stripe Shop pending, failed, expired and PaymentIntent failure never normalize as success", async () => {
  const pending = normalizeShopStripeWebhookEvent(stripeCheckoutEvent(
    "checkout.session.completed",
    { payment_status: "unpaid", payment_intent: null },
  ));
  const failed = normalizeShopStripeWebhookEvent(stripeCheckoutEvent(
    "checkout.session.async_payment_failed",
    { payment_status: "unpaid", payment_intent: null },
  ));
  const expired = normalizeShopStripeWebhookEvent(stripeCheckoutEvent(
    "checkout.session.expired",
    { payment_status: "unpaid", status: "expired", payment_intent: null },
  ));
  const intentFailure = normalizeShopStripeWebhookEvent({
    id: "evt_shop_payment_intent_failed",
    type: "payment_intent.payment_failed",
    livemode: false,
    created: new Date(occurredAt).getTime() / 1_000,
    data: {
      object: {
        id: "pi_test_shop_failed",
        object: "payment_intent",
        livemode: false,
        status: "requires_payment_method",
        amount: 3_000,
        currency: "eur",
        metadata: {
          paymentSource: "SHOP_ORDER",
          paymentId,
          shopOrderId,
          pricingVersion: "shop-order-v1",
        },
      },
    },
  });
  assert.deepEqual([pending?.status, failed?.status, expired?.status, intentFailure?.status], [
    "PENDING",
    "FAILED",
    "EXPIRED",
    "FAILED",
  ]);
  assert.equal(intentFailure?.providerCheckoutId, undefined);
  assert.equal(intentFailure?.providerPaymentId, "pi_test_shop_failed");
});

test("Shop Stripe processing delegates replay idempotence and malformed signed evidence to the repository", async () => {
  const seen = new Set<string>();
  const reconciled: ShopPaymentProviderEvent[] = [];
  let unmatched = 0;
  const repository = {
    async reconcile(event: ShopPaymentProviderEvent) {
      const duplicate = seen.has(event.eventId);
      seen.add(event.eventId);
      reconciled.push(event);
      return {
        outcome: "PROCESSED" as const,
        duplicate,
        shopOrderPaid: !duplicate,
        stockConfirmed: !duplicate,
      };
    },
    async recordUnmatched() {
      unmatched += 1;
      return {
        outcome: "REQUIRES_REVIEW" as const,
        duplicate: false,
        shopOrderPaid: false,
        stockConfirmed: false,
      };
    },
  };
  const enriched = await enrichShopStripeWebhookEvent(
    stripeCheckoutEvent(),
    { mode: "test", secretKey: "sk_test_not_used" },
    async () => expandedStripeSession(),
  );
  const first = await processVerifiedShopStripeWebhookEvent(enriched, repository);
  const replay = await processVerifiedShopStripeWebhookEvent(enriched, repository);
  assert.deepEqual([first.duplicate, replay.duplicate], [false, true]);
  assert.equal(reconciled.length, 2);

  const malformed = await processVerifiedShopStripeWebhookEvent(stripeCheckoutEvent(
    "checkout.session.completed",
    { amount_total: 3_001 },
  ), repository);
  assert.equal(malformed.outcome, "REQUIRES_REVIEW");
  assert.equal(unmatched, 1);
});

test("signed Stripe Shop amount and currency mismatches stay linked for idempotent review", async () => {
  for (const mismatch of [
    { amount: 3_001, currency: "eur" },
    { amount: 3_000, currency: "usd" },
    { amount: "invalid", currency: "eur" },
    { amount: 3_000, currency: "" },
  ]) {
    const raw = stripeCheckoutEvent("checkout.session.completed", {
      amount_total: mismatch.amount,
      currency: mismatch.currency,
    });
    const expanded = expandedStripeSession();
    const enriched = await enrichShopStripeWebhookEvent(
      raw,
      { mode: "test", secretKey: "sk_test_not_used" },
      async () => ({
        ...expanded,
        amount_total: mismatch.amount,
        currency: mismatch.currency,
        payment_intent: {
          ...(expanded.payment_intent as Record<string, unknown>),
          amount: mismatch.amount,
          currency: mismatch.currency,
        },
      }),
    );
    const seen = new Set<string>();
    const events: ShopPaymentProviderEvent[] = [];
    let unmatched = 0;
    const repository = {
      async reconcile(event: ShopPaymentProviderEvent) {
        const duplicate = seen.has(event.eventId);
        seen.add(event.eventId);
        events.push(event);
        return {
          outcome: "REQUIRES_REVIEW" as const,
          duplicate,
          shopOrderPaid: false,
          stockConfirmed: false,
          reviewCode: "SHOP_PAYMENT_EVIDENCE_MISMATCH",
        };
      },
      async recordUnmatched() {
        unmatched += 1;
        return { outcome: "REQUIRES_REVIEW" as const, duplicate: false, shopOrderPaid: false, stockConfirmed: false };
      },
    };
    const first = await processVerifiedShopStripeWebhookEvent(enriched, repository);
    const replay = await processVerifiedShopStripeWebhookEvent(enriched, repository);
    assert.deepEqual([first.duplicate, replay.duplicate], [false, true]);
    assert.equal(unmatched, 0);
    assert.equal(events[0]?.paymentId, paymentId);
    assert.equal(events[0]?.providerSourceShopOrderId, shopOrderId);
    assert.equal(events[0]?.status, "SUCCEEDED");
    assert.equal(
      events[0]?.amountCents,
      typeof mismatch.amount === "number" ? mismatch.amount : undefined,
    );
    assert.equal(events[0]?.currency, mismatch.currency ? mismatch.currency.toUpperCase() : undefined);
    if (typeof mismatch.amount !== "number" || mismatch.currency !== "eur") {
      assert.equal(events[0]?.evidenceConsistent, false);
    }
  }
});

test("a persisted Stripe Shop Payment overrides missing or contradictory source metadata into linked review", async () => {
  for (const source of [undefined, "MUSIC_ORDER"]) {
    const raw = stripeCheckoutEvent("checkout.session.completed", {
      client_reference_id: "33333333-3333-4333-8333-333333333333",
      metadata: {
        ...(source ? { paymentSource: source } : {}),
        paymentId,
        shopOrderId,
        pricingVersion: "wrong-pricing-version",
      },
    });
    const lookedUp: unknown[] = [];
    const sourced = await resolveShopStripePaymentSource(raw, async (where) => {
      lookedUp.push(where);
      return "id" in where
        ? { id: paymentId, orderId: null, shopOrderId }
        : null;
    });
    const rawObject = raw.data.object as Record<string, unknown>;
    const enriched = await enrichShopStripeWebhookEvent(
      sourced,
      { mode: "test", secretKey: "sk_test_not_used" },
      async () => ({
        ...rawObject,
        payment_intent: {
          id: "pi_test_shop",
          object: "payment_intent",
          livemode: false,
          status: "succeeded",
          amount: 3_000,
          currency: "eur",
          metadata: rawObject.metadata,
          payment_method: { id: "pm_shop", object: "payment_method", type: "card" },
        },
      }),
    );
    const events: ShopPaymentProviderEvent[] = [];
    let unmatched = 0;
    const result = await processVerifiedShopStripeWebhookEvent(enriched, {
      async reconcile(event) {
        events.push(event);
        return {
          outcome: "REQUIRES_REVIEW" as const,
          duplicate: false,
          shopOrderPaid: false,
          stockConfirmed: false,
          reviewCode: "SHOP_PAYMENT_EVIDENCE_MISMATCH",
        };
      },
      async recordUnmatched() {
        unmatched += 1;
        return { outcome: "REQUIRES_REVIEW" as const, duplicate: false, shopOrderPaid: false, stockConfirmed: false };
      },
    });
    assert.deepEqual(lookedUp, [
      { providerCheckoutId: "cs_test_shop", provider: "STRIPE" },
      { providerPaymentId: "pi_test_shop", provider: "STRIPE" },
      { id: paymentId, provider: "STRIPE" },
    ]);
    assert.equal(result.outcome, "REQUIRES_REVIEW");
    assert.equal(unmatched, 0);
    assert.equal(events[0]?.paymentId, paymentId);
    assert.equal(events[0]?.providerPaymentId, "pi_test_shop");
    assert.equal(events[0]?.status, "SUCCEEDED");
    assert.equal(events[0]?.evidenceConsistent, false);
  }
});

test("Stripe persisted provider identity outranks contradictory Shop metadata", async () => {
  const authoritativePaymentId = "44444444-4444-4444-8444-444444444444";
  const authoritativeShopOrderId = "55555555-5555-4555-8555-555555555555";
  const raw = stripeCheckoutEvent();
  const queries: unknown[] = [];
  const sourced = await resolveShopStripePaymentSource(raw, async (where) => {
    queries.push(where);
    return "providerCheckoutId" in where
      ? {
        id: authoritativePaymentId,
        orderId: null,
        shopOrderId: authoritativeShopOrderId,
      }
      : null;
  });
  assert.deepEqual(queries, [
    { providerCheckoutId: "cs_test_shop", provider: "STRIPE" },
  ]);
  const enriched = await enrichShopStripeWebhookEvent(
    sourced,
    { mode: "test", secretKey: "sk_test_not_used" },
    async () => expandedStripeSession(),
  );
  const normalized = normalizeShopStripeWebhookEvent(enriched);
  assert.equal(normalized?.paymentId, authoritativePaymentId);
  assert.equal(normalized?.providerSourceShopOrderId, authoritativeShopOrderId);
  assert.equal(normalized?.providerCheckoutId, "cs_test_shop");
  assert.equal(normalized?.providerPaymentId, "pi_test_shop");
  assert.equal(normalized?.status, "SUCCEEDED");
  assert.equal(normalized?.evidenceConsistent, false);

  const resolvedMusic = await resolveShopStripePaymentSource(raw, async (where) => (
    "providerCheckoutId" in where
      ? { id: "66666666-6666-4666-8666-666666666666", orderId: shopOrderId, shopOrderId: null }
      : null
  ));
  assert.equal(normalizeShopStripeWebhookEvent(resolvedMusic), null);

  const failedIntent = {
    id: "evt_shop_pi_failed_conflicting_metadata",
    type: "payment_intent.payment_failed",
    livemode: false,
    created: new Date(occurredAt).getTime() / 1_000,
    data: {
      object: {
        id: "pi_test_shop_failed_conflict",
        object: "payment_intent",
        livemode: false,
        status: "requires_payment_method",
        amount: 3_000,
        currency: "eur",
        metadata: {
          paymentSource: "SHOP_ORDER",
          paymentId,
          shopOrderId,
          pricingVersion: "shop-order-v1",
        },
      },
    },
  } as const;
  const sourcedIntent = await resolveShopStripePaymentSource(failedIntent, async (where) => (
    "providerPaymentId" in where
      ? { id: authoritativePaymentId, orderId: null, shopOrderId: authoritativeShopOrderId }
      : null
  ));
  const normalizedIntent = normalizeShopStripeWebhookEvent(sourcedIntent);
  assert.equal(normalizedIntent?.paymentId, authoritativePaymentId);
  assert.equal(normalizedIntent?.providerSourceShopOrderId, authoritativeShopOrderId);
  assert.equal(normalizedIntent?.providerPaymentId, "pi_test_shop_failed_conflict");
  assert.equal(normalizedIntent?.status, "FAILED");
  assert.equal(normalizedIntent?.evidenceConsistent, false);
});

test("Stripe source lookup falls back to persisted Checkout and PaymentIntent identifiers", async () => {
  const checkout = stripeCheckoutEvent("checkout.session.completed", {
    metadata: { paymentSource: "SHOP_ORDER" },
  });
  const checkoutQueries: unknown[] = [];
  const sourcedCheckout = await resolveShopStripePaymentSource(checkout, async (where) => {
    checkoutQueries.push(where);
    return "providerCheckoutId" in where
      ? { id: paymentId, orderId: null, shopOrderId }
      : null;
  });
  assert.deepEqual(checkoutQueries, [{ providerCheckoutId: "cs_test_shop", provider: "STRIPE" }]);
  const checkoutObject = checkout.data.object as Record<string, unknown>;
  const enriched = await enrichShopStripeWebhookEvent(
    sourcedCheckout,
    { mode: "test", secretKey: "sk_test_not_used" },
    async () => ({
      ...checkoutObject,
      payment_intent: {
        id: "pi_test_shop",
        object: "payment_intent",
        livemode: false,
        status: "succeeded",
        amount: 3_000,
        currency: "eur",
        metadata: {},
        payment_method: { id: "pm_shop", object: "payment_method", type: "card" },
      },
    }),
  );
  const normalizedCheckout = normalizeShopStripeWebhookEvent(enriched);
  assert.equal(normalizedCheckout?.paymentId, paymentId);
  assert.equal(normalizedCheckout?.providerSourceShopOrderId, shopOrderId);
  assert.equal(normalizedCheckout?.status, "SUCCEEDED");
  assert.equal(normalizedCheckout?.evidenceConsistent, false);

  const failedIntent = {
    id: "evt_shop_pi_failed_source_missing",
    type: "payment_intent.payment_failed",
    livemode: false,
    created: new Date(occurredAt).getTime() / 1_000,
    data: {
      object: {
        id: "pi_test_shop_failed",
        object: "payment_intent",
        livemode: false,
        status: "requires_payment_method",
        amount: 3_000,
        currency: "eur",
        metadata: {},
      },
    },
  } as const;
  const intentQueries: unknown[] = [];
  const sourcedIntent = await resolveShopStripePaymentSource(failedIntent, async (where) => {
    intentQueries.push(where);
    return "providerPaymentId" in where
      ? { id: paymentId, orderId: null, shopOrderId }
      : null;
  });
  assert.deepEqual(intentQueries, [{ providerPaymentId: "pi_test_shop_failed", provider: "STRIPE" }]);
  const normalizedIntent = normalizeShopStripeWebhookEvent(sourcedIntent);
  assert.equal(normalizedIntent?.paymentId, paymentId);
  assert.equal(normalizedIntent?.providerSourceShopOrderId, shopOrderId);
  assert.equal(normalizedIntent?.providerPaymentId, "pi_test_shop_failed");
  assert.equal(normalizedIntent?.status, "FAILED");
  assert.equal(normalizedIntent?.evidenceConsistent, false);
});

function paypalEvent() {
  return {
    id: "WH-SHOP-COMPLETED-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    create_time: occurredAt,
    resource: {
      id: "CAPTURE-SHOP-1",
      status: "COMPLETED",
      amount: { currency_code: "EUR", value: "30.00" },
      supplementary_data: { related_ids: { order_id: "PAYPAL-SHOP-ORDER-1" } },
    },
  } as const;
}

function musicRepository(calls: ShopPaymentProviderEvent[]): PaypalCaptureRepository {
  return {
    async reserveCapture() { throw new Error("not used"); },
    async reconcile(event) {
      calls.push({
        eventId: event.eventId,
        type: event.type,
        provider: "PAYPAL",
        livemode: false,
        paymentId: event.paymentId ?? paymentId,
        providerCheckoutId: event.providerOrderId,
        status: event.status === "COMPLETED" ? "SUCCEEDED" : "PENDING",
        occurredAt: event.occurredAt,
      });
      return { outcome: "PROCESSED", duplicate: false, orderConfirmed: true };
    },
    async recordUnmatched(_id, _type, _objectId, outcome = "REQUIRES_REVIEW") {
      return { outcome, duplicate: false, orderConfirmed: false };
    },
  };
}

test("verified PayPal events route by persisted Payment source, including captures without custom_id", async () => {
  const shopEvents: ShopPaymentProviderEvent[] = [];
  const musicEvents: ShopPaymentProviderEvent[] = [];
  const shopRepository = {
    async reconcile(event: ShopPaymentProviderEvent) {
      shopEvents.push(event);
      return { outcome: "PROCESSED" as const, duplicate: false, shopOrderPaid: true, stockConfirmed: true };
    },
    async recordUnmatched() {
      return { outcome: "REQUIRES_REVIEW" as const, duplicate: false, shopOrderPaid: false, stockConfirmed: false };
    },
  };
  const shop = await processVerifiedPaypalWebhookEventByPaymentSource(paypalEvent(), "sandbox", {
    sourceLookup: {
      async resolvePaypalPayment(providerOrderId, unresolvedPaymentId) {
        assert.equal(providerOrderId, "PAYPAL-SHOP-ORDER-1");
        assert.equal(unresolvedPaymentId, undefined);
        return { id: paymentId, orderId: null, shopOrderId };
      },
    },
    shopRepository,
    musicRepository: musicRepository(musicEvents),
  });
  assert.equal("shopOrderPaid" in shop && shop.shopOrderPaid, true);
  assert.equal(shopEvents.length, 1);
  assert.equal(shopEvents[0]?.paymentId, paymentId);
  assert.equal(shopEvents[0]?.providerPaymentId, "CAPTURE-SHOP-1");
  assert.equal(shopEvents[0]?.paymentMethod, "PAYPAL");
  assert.equal(musicEvents.length, 0);

  await processVerifiedPaypalWebhookEventByPaymentSource(paypalEvent(), "sandbox", {
    sourceLookup: {
      async resolvePaypalPayment() {
        return { id: paymentId, orderId: "33333333-3333-4333-8333-333333333333", shopOrderId: null };
      },
    },
    shopRepository,
    musicRepository: musicRepository(musicEvents),
  });
  assert.equal(musicEvents.length, 1);
});

test("a signed PayPal event recovers a Shop attempt by custom_id after create-order persistence crashes", async () => {
  const shopEvents: ShopPaymentProviderEvent[] = [];
  let lookups = 0;
  const approved = {
    id: "WH-SHOP-APPROVED-AFTER-CRASH",
    event_type: "CHECKOUT.ORDER.APPROVED",
    create_time: occurredAt,
    resource: {
      id: "PAYPAL-SHOP-ORDER-AFTER-CRASH",
      status: "APPROVED",
      purchase_units: [{
        custom_id: paymentId,
        amount: { currency_code: "EUR", value: "30.00" },
      }],
    },
  } as const;
  const dependencies = {
    sourceLookup: {
      async resolvePaypalPayment(providerOrderId: string, unresolvedPaymentId?: string) {
        lookups += 1;
        assert.equal(providerOrderId, "PAYPAL-SHOP-ORDER-AFTER-CRASH");
        assert.equal(unresolvedPaymentId, paymentId);
        return { id: paymentId, orderId: null, shopOrderId };
      },
    },
    shopRepository: {
      async reconcile(event: ShopPaymentProviderEvent) {
        shopEvents.push(event);
        return shopEvents.length === 1
          ? { outcome: "REQUIRES_REVIEW" as const, duplicate: false, shopOrderPaid: false, stockConfirmed: false }
          : { outcome: "REQUIRES_REVIEW" as const, duplicate: true, shopOrderPaid: false, stockConfirmed: false };
      },
      async recordUnmatched() {
        throw new Error("A recoverable Shop attempt must not be consumed as an unmatched music event.");
      },
    },
    musicRepository: musicRepository([]),
  };
  const first = await processVerifiedPaypalWebhookEventByPaymentSource(approved, "sandbox", dependencies);
  const replay = await processVerifiedPaypalWebhookEventByPaymentSource(approved, "sandbox", dependencies);
  assert.equal(first.outcome, "REQUIRES_REVIEW");
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(lookups, 2);
  assert.equal(shopEvents.length, 2);
  assert.equal(shopEvents[0]?.paymentId, paymentId);
  assert.equal(shopEvents[0]?.providerSourcePaymentId, paymentId);
  assert.equal(shopEvents[0]?.providerCheckoutId, "PAYPAL-SHOP-ORDER-AFTER-CRASH");
});

test("the real PayPal source lookup falls back from provider order to signed custom_id", async () => {
  const queries: Array<Readonly<{ provider: "PAYPAL"; providerCheckoutId?: string; id?: string }>> = [];
  const lookup = createPaypalPaymentSourceLookup(async (where) => {
    queries.push(where);
    return where.id === paymentId ? { id: paymentId, orderId: null, shopOrderId } : null;
  });
  assert.deepEqual(
    await lookup.resolvePaypalPayment("PAYPAL-SHOP-ORDER-AFTER-CRASH", paymentId),
    { id: paymentId, orderId: null, shopOrderId },
  );
  assert.deepEqual(queries, [
    { provider: "PAYPAL", providerCheckoutId: "PAYPAL-SHOP-ORDER-AFTER-CRASH" },
    { id: paymentId, provider: "PAYPAL" },
  ]);
});

test("signed PayPal Shop amount and currency mismatches stay linked for idempotent review", async () => {
  for (const mismatch of [
    { value: "30.01", currency: "EUR", status: "COMPLETED" },
    { value: "30.00", currency: "USD", status: "COMPLETED" },
    { value: "30.00", currency: "EUR", status: "PENDING" },
  ]) {
    const event = {
      ...paypalEvent(),
      id: `WH-SHOP-MISMATCH-${mismatch.currency}-${mismatch.value}`,
      resource: {
        ...paypalEvent().resource,
        status: mismatch.status,
        amount: { currency_code: mismatch.currency, value: mismatch.value },
      },
    };
    const seen = new Set<string>();
    const events: ShopPaymentProviderEvent[] = [];
    let musicCalls = 0;
    const dependencies = {
      sourceLookup: {
        async resolvePaypalPayment(providerOrderId: string) {
          assert.equal(providerOrderId, "PAYPAL-SHOP-ORDER-1");
          return { id: paymentId, orderId: null, shopOrderId };
        },
      },
      shopRepository: {
        async reconcile(normalized: ShopPaymentProviderEvent) {
          const duplicate = seen.has(normalized.eventId);
          seen.add(normalized.eventId);
          events.push(normalized);
          return {
            outcome: "REQUIRES_REVIEW" as const,
            duplicate,
            shopOrderPaid: false,
            stockConfirmed: false,
            reviewCode: "SHOP_PAYMENT_EVIDENCE_MISMATCH",
          };
        },
        async recordUnmatched() {
          throw new Error("A resolved Shop financial proof must remain linked.");
        },
      },
      musicRepository: {
        ...musicRepository([]),
        async reconcile() {
          musicCalls += 1;
          return { outcome: "PROCESSED" as const, duplicate: false, orderConfirmed: true };
        },
      },
    };
    const first = await processVerifiedPaypalWebhookEventByPaymentSource(event, "sandbox", dependencies);
    const replay = await processVerifiedPaypalWebhookEventByPaymentSource(event, "sandbox", dependencies);
    assert.deepEqual([first.duplicate, replay.duplicate], [false, true]);
    assert.equal(musicCalls, 0);
    assert.equal(events[0]?.paymentId, paymentId);
    assert.equal(events[0]?.providerCheckoutId, "PAYPAL-SHOP-ORDER-1");
    assert.equal(events[0]?.providerPaymentId, "CAPTURE-SHOP-1");
    assert.equal(events[0]?.status, "SUCCEEDED");
    assert.equal(events[0]?.currency, mismatch.currency);
    if (mismatch.status !== "COMPLETED") {
      assert.equal(events[0]?.evidenceConsistent, false);
    }
  }
});

test("PayPal Shop source metadata cannot redirect a provider order to another Payment", async () => {
  let reconciled = 0;
  let unmatched = 0;
  const event = {
    id: "WH-SHOP-APPROVED-MISMATCH",
    event_type: "CHECKOUT.ORDER.APPROVED",
    create_time: occurredAt,
    resource: {
      id: "PAYPAL-SHOP-ORDER-1",
      status: "APPROVED",
      purchase_units: [{
        custom_id: "33333333-3333-4333-8333-333333333333",
        amount: { currency_code: "EUR", value: "30.00" },
      }],
    },
  } as const;
  const result = await processVerifiedPaypalWebhookEventByPaymentSource(event, "sandbox", {
    sourceLookup: {
      async resolvePaypalPayment() {
        return { id: paymentId, orderId: null, shopOrderId };
      },
    },
    shopRepository: {
      async reconcile(normalized) {
        reconciled += 1;
        assert.equal(normalized.paymentId, paymentId);
        assert.equal(normalized.providerSourcePaymentId, "33333333-3333-4333-8333-333333333333");
        return { outcome: "REQUIRES_REVIEW", duplicate: false, shopOrderPaid: false, stockConfirmed: false };
      },
      async recordUnmatched(input) {
        unmatched += 1;
        assert.equal(input.objectId, "PAYPAL-SHOP-ORDER-1");
        return { outcome: "REQUIRES_REVIEW", duplicate: false, shopOrderPaid: false, stockConfirmed: false };
      },
    },
    musicRepository: musicRepository([]),
  });
  assert.equal(result.outcome, "REQUIRES_REVIEW");
  assert.equal(reconciled, 1);
  assert.equal(unmatched, 0);
});

test("the signed Stripe handler reaches Shop reconciliation without consulting Checkout switches", async () => {
  let reconciled = 0;
  const repository = {
    async reconcile() {
      reconciled += 1;
      return { outcome: "PROCESSED" as const, duplicate: false, shopOrderPaid: true, stockConfirmed: true };
    },
    async recordUnmatched() {
      return { outcome: "REQUIRES_REVIEW" as const, duplicate: false, shopOrderPaid: false, stockConfirmed: false };
    },
  };
  const verified = stripeCheckoutEvent();
  const configuration = {
    provider: "stripe" as const,
    enabled: true as const,
    configured: true as const,
    mode: "test" as const,
    apiVersion: "2026-07-29.dahlia" as const,
    secretKey: "sk_test_not_used",
    webhookSecret: "whsec_not_used",
  };
  const dependencies: StripeWebhookRouteDependencies = {
    async assertQaRuntime() {},
    configuration: () => configuration,
    constructEvent(_body, signature) {
      assert.equal(signature, "signed-shop-fixture");
      return verified;
    },
    enrichEvent(event) {
      return enrichShopStripeWebhookEvent(event, configuration, async () => expandedStripeSession());
    },
    async findDuplicateEvent() { return null; },
    processEvent(event) {
      return processVerifiedShopStripeWebhookEvent(event, repository);
    },
  };
  const response = await handleStripeWebhookPost(new Request("http://localhost/api/payments/stripe/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "signed-shop-fixture" },
    body: "{}",
  }), dependencies);
  assert.equal(response.status, 200);
  assert.equal(reconciled, 1);
});

test("the signature-verified PayPal handler routes a persisted Shop Payment", async () => {
  let reconciled = 0;
  const verificationGateway: PaypalGateway = {
    async createOrder() { throw new Error("not used"); },
    async retrieveOrder() { throw new Error("not used"); },
    async captureOrder() { throw new Error("not used"); },
    async verifyWebhook() { return true; },
  };
  const dependencies: PaypalWebhookRouteDependencies = {
    assertRuntime: async () => ({
      deploymentEnvironment: "development" as const,
      paypal: {
        provider: "paypal" as const,
        enabled: true as const,
        configured: true as const,
        environment: "sandbox" as const,
        clientId: "fixture-client-id",
        clientSecret: "fixture-client-secret",
        webhookId: "fixture-webhook-id",
      },
    }),
    gateway: () => verificationGateway,
    async processEvent(event) {
      const result = await processVerifiedPaypalWebhookEventByPaymentSource(event, "sandbox", {
        sourceLookup: {
          async resolvePaypalPayment() {
            return { id: paymentId, orderId: null, shopOrderId };
          },
        },
        shopRepository: {
          async reconcile() {
            reconciled += 1;
            return { outcome: "PROCESSED", duplicate: false, shopOrderPaid: true, stockConfirmed: true };
          },
          async recordUnmatched() {
            return { outcome: "REQUIRES_REVIEW", duplicate: false, shopOrderPaid: false, stockConfirmed: false };
          },
        },
        musicRepository: musicRepository([]),
      });
      return {
        outcome: result.outcome,
        duplicate: result.duplicate,
        orderConfirmed: "shopOrderPaid" in result ? result.shopOrderPaid : result.orderConfirmed,
      };
    },
  };
  const response = await handlePaypalWebhookPost(new Request("http://localhost/api/payments/paypal/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "paypal-transmission-id": "fixture-transmission",
      "paypal-transmission-time": new Date().toISOString(),
      "paypal-cert-url": "https://api-m.sandbox.paypal.com/v1/notifications/certs/FIXTURE",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-transmission-sig": "signed-shop-fixture",
    },
    body: JSON.stringify(paypalEvent()),
  }), dependencies);
  assert.equal(response.status, 200);
  assert.equal(reconciled, 1);
});

test("the signed Stripe and PayPal route handlers use source-aware historical reconciliation", async () => {
  const stripeSource = await readFile(new URL("../../lib/payments/webhook-route-handler.ts", import.meta.url), "utf8");
  const paypalSource = await readFile(new URL("../../lib/payments/paypal-webhook-route-handler.ts", import.meta.url), "utf8");
  assert.match(stripeSource, /assertStripeWebhookRuntimeEnvironment/);
  assert.match(stripeSource, /isShopStripeWebhookEvent/);
  assert.match(stripeSource, /processVerifiedShopStripeWebhookEvent/);
  assert.match(paypalSource, /assertPaypalWebhookRuntimeEnvironment/);
  assert.match(paypalSource, /createPaypalReconciliationGateway/);
  assert.match(paypalSource, /processVerifiedPaypalWebhookEventByPaymentSource/);
});
