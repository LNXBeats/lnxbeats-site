import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";

import {
  constructStripeWebhookEvent,
  enrichStripeWebhookEvent,
  handleStripeWebhookPost,
  paymentIntentEvidenceFromCheckoutSession,
  STRIPE_WEBHOOK_MAX_BYTES,
  type StripeWebhookRouteDependencies,
} from "@/lib/payments/webhook-route-handler";
import {
  planStripeCheckoutReconciliation,
  planStripePaymentIntentFailure,
  processVerifiedStripeWebhookEvent,
  type NormalizedStripeCheckoutEvent,
  type NormalizedStripePaymentIntentFailureEvent,
  type PaymentReconciliationSnapshot,
  type PaymentWebhookRepository,
  type VerifiedStripeWebhookEvent,
} from "@/lib/payments/webhook";

const paymentId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const processedAt = new Date("2026-08-14T12:00:00.000Z");
const stripeRouteSecretKey = ["sk", "test", "route-fixture"].join("_");
const stripeRouteWebhookSecret = ["whsec", "route-fixture"].join("_");
const stripeLocalSignatureSecretKey = ["sk", "test", "local-signature-fixture"].join("_");
const stripeLocalSignatureWebhookSecret = ["whsec", "local-signature-fixture"].join("_");

function normalized(
  overrides: Partial<NormalizedStripeCheckoutEvent> = {},
): NormalizedStripeCheckoutEvent {
  const result: NormalizedStripeCheckoutEvent = {
    eventId: "evt_test_checkout_completed",
    type: "checkout.session.completed",
    livemode: false,
    objectId: "cs_test_checkout",
    processedAt,
    paymentId,
    orderId,
    clientReferenceId: orderId,
    pricingVersion: "2026-08-v1",
    amountTotal: 5_000,
    currency: "EUR",
    paymentStatus: "paid",
    checkoutStatus: "complete",
    sessionLivemode: false,
    paymentIntentId: "pi_test_payment",
    paymentIntentEvidence: {
      id: "pi_test_payment",
      amountCents: 5_000,
      currency: "EUR",
      livemode: false,
      status: "succeeded",
      paymentId,
      orderId,
      pricingVersion: "2026-08-v1",
      paymentMethod: "CARD",
    },
    occurredAt: processedAt,
    ...overrides,
  };
  if (overrides.paymentIntentEvidence === undefined) {
    return {
      ...result,
      paymentIntentEvidence: result.paymentIntentId ? {
        id: result.paymentIntentId,
        amountCents: result.amountTotal,
        currency: result.currency,
        livemode: false,
        status: "succeeded",
        paymentId: result.paymentId,
        orderId: result.orderId,
        pricingVersion: result.pricingVersion,
        paymentMethod: "CARD",
      } : null,
    };
  }
  return result;
}

function payment(
  overrides: Partial<PaymentReconciliationSnapshot> = {},
): PaymentReconciliationSnapshot {
  return {
    id: paymentId,
    orderId,
    provider: "STRIPE",
    mode: "TEST",
    status: "PENDING",
    amountCents: 5_000,
    currency: "EUR",
    pricingVersion: "2026-08-v1",
    providerCheckoutId: "cs_test_checkout",
    providerPaymentId: "pi_test_payment",
    paymentMethod: null,
    failureCode: null,
    paidAt: null,
    failedAt: null,
    orderStatus: "AWAITING_PAYMENT",
    orderHasOtherSuccessfulPayment: false,
    orderHasOtherActivePayment: false,
    providerIdentifiersBelongToOtherPayment: false,
    ...overrides,
  };
}

function stripeEvent(
  type = "checkout.session.completed",
  overrides: Partial<VerifiedStripeWebhookEvent> = {},
): VerifiedStripeWebhookEvent {
  return {
    id: "evt_test_checkout_completed",
    type,
    livemode: false,
    created: 1_786_708_800,
    data: {
      object: {
        id: "cs_test_checkout",
        object: "checkout.session",
        mode: "payment",
        client_reference_id: orderId,
        metadata: { paymentId, orderId, pricingVersion: "2026-08-v1" },
        amount_total: 5_000,
        currency: "eur",
        payment_status: "paid",
        status: "complete",
        livemode: false,
        payment_intent: "pi_test_payment",
        payment_method_types: ["card"],
      },
    },
    paymentIntentEvidence: {
      id: "pi_test_payment",
      amountCents: 5_000,
      currency: "EUR",
      livemode: false,
      status: "succeeded",
      paymentId,
      orderId,
      pricingVersion: "2026-08-v1",
      paymentMethod: "CARD",
    },
    ...overrides,
  };
}

function normalizedFailure(
  overrides: Partial<NormalizedStripePaymentIntentFailureEvent> = {},
): NormalizedStripePaymentIntentFailureEvent {
  return {
    eventId: "evt_test_payment_failed",
    type: "payment_intent.payment_failed",
    livemode: false,
    objectId: "pi_test_payment",
    processedAt,
    paymentId,
    orderId,
    pricingVersion: "2026-08-v1",
    paymentIntentId: "pi_test_payment",
    amountTotal: 5_000,
    currency: "EUR",
    paymentIntentStatus: "requires_payment_method",
    occurredAt: processedAt,
    ...overrides,
  };
}

function stripePaymentFailureEvent(
  overrides: Partial<VerifiedStripeWebhookEvent> = {},
): VerifiedStripeWebhookEvent {
  return {
    id: "evt_test_payment_failed",
    type: "payment_intent.payment_failed",
    livemode: false,
    created: 1_786_708_800,
    data: {
      object: {
        id: "pi_test_payment",
        object: "payment_intent",
        amount: 5_000,
        currency: "eur",
        livemode: false,
        status: "requires_payment_method",
        metadata: { paymentId, orderId, pricingVersion: "2026-08-v1" },
        last_payment_error: {
          payment_method: {
            id: "pm_test_declined",
            object: "payment_method",
            type: "card",
          },
        },
      },
    },
    ...overrides,
  };
}

test("derives the normalized method only from an expanded successful PaymentIntent", () => {
  const evidence = paymentIntentEvidenceFromCheckoutSession({
    id: "cs_test_checkout",
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    livemode: false,
    payment_intent: {
      id: "pi_test_payment",
      object: "payment_intent",
      amount: 5_000,
      currency: "eur",
      livemode: false,
      status: "succeeded",
      metadata: { paymentId, orderId, pricingVersion: "2026-08-v1" },
      payment_method: {
        id: "pm_test_payment",
        object: "payment_method",
        type: "card",
      },
    },
  } as unknown as Stripe.Checkout.Session, "cs_test_checkout");
  assert.deepEqual(evidence, {
    id: "pi_test_payment",
    amountCents: 5_000,
    currency: "EUR",
    livemode: false,
    status: "succeeded",
    paymentId,
    orderId,
    pricingVersion: "2026-08-v1",
    paymentMethod: "CARD",
  });

  assert.throws(() => paymentIntentEvidenceFromCheckoutSession({
    id: "cs_test_checkout",
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    livemode: false,
    payment_intent: {
      id: "pi_test_payment",
      object: "payment_intent",
      amount: 5_000,
      currency: "eur",
      livemode: false,
      status: "succeeded",
      metadata: { paymentId, orderId, pricingVersion: "2026-08-v1" },
      payment_method: "pm_test_unexpanded",
    },
  } as unknown as Stripe.Checkout.Session, "cs_test_checkout"));
});

test("does not call Stripe for a signed paid Checkout event unrelated to LNX", async () => {
  const event = stripeEvent("checkout.session.completed", {
    data: {
      object: {
        id: "cs_test_foreign",
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        status: "complete",
        livemode: false,
        metadata: {},
      },
    },
    paymentIntentEvidence: undefined,
  });
  const configuration = {
    provider: "stripe",
    enabled: true,
    configured: true,
    mode: "test",
    apiVersion: "2026-07-29.dahlia",
    secretKey: stripeRouteSecretKey,
    webhookSecret: stripeRouteWebhookSecret,
  } as const;
  assert.equal(await enrichStripeWebhookEvent(event, configuration), event);
});

test("verifies the exact bounded raw body without requiring session or Origin", async () => {
  const raw = "{\n  \"id\": \"evt_raw\"\n}";
  const verifiedBodies: Buffer[] = [];
  let verifiedSignature = "";
  const dependencies: StripeWebhookRouteDependencies = {
    assertQaRuntime: async () => {},
    configuration: () => ({
      provider: "stripe",
      enabled: true,
      configured: true,
      mode: "test",
      apiVersion: "2026-07-29.dahlia",
      secretKey: stripeRouteSecretKey,
      webhookSecret: stripeRouteWebhookSecret,
    }),
    constructEvent(body, signature) {
      verifiedBodies.push(body);
      verifiedSignature = signature;
      return stripeEvent();
    },
    enrichEvent: async (event) => event,
    processEvent: async () => ({ outcome: "PROCESSED", duplicate: false }),
  };
  const response = await handleStripeWebhookPost(new Request(
    "http://127.0.0.1:3000/api/payments/stripe/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "stripe-signature": "t=fixture,v1=signature",
      },
      body: raw,
    },
  ), dependencies);

  assert.equal(response.status, 200);
  assert.equal(Buffer.from(verifiedBodies.at(0) ?? []).toString("utf8"), raw);
  assert.equal(verifiedSignature, "t=fixture,v1=signature");
  assert.deepEqual(await response.json(), {
    received: true,
    outcome: "processed",
    duplicate: false,
  });
});

test("short-circuits an already processed signed event before Stripe enrichment", async () => {
  let enrichments = 0;
  let reconciliations = 0;
  const dependencies: StripeWebhookRouteDependencies = {
    assertQaRuntime: async () => {},
    configuration: () => ({
      provider: "stripe",
      enabled: true,
      configured: true,
      mode: "test",
      apiVersion: "2026-07-29.dahlia",
      secretKey: stripeRouteSecretKey,
      webhookSecret: stripeRouteWebhookSecret,
    }),
    constructEvent: () => stripeEvent(),
    findDuplicateEvent: async () => ({ outcome: "PROCESSED", duplicate: true }),
    enrichEvent: async (event) => {
      enrichments += 1;
      return event;
    },
    processEvent: async () => {
      reconciliations += 1;
      return { outcome: "PROCESSED", duplicate: false };
    },
  };
  const response = await handleStripeWebhookPost(new Request(
    "http://127.0.0.1:31700/api/payments/stripe/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "fixture",
      },
      body: "{}",
    },
  ), dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    received: true,
    outcome: "processed",
    duplicate: true,
  });
  assert.equal(enrichments, 0);
  assert.equal(reconciliations, 0);
});

test("uses stripe-node to reject a changed raw body after signature generation", () => {
  const configuration = {
    provider: "stripe",
    enabled: true,
    configured: true,
    mode: "test",
    apiVersion: "2026-07-29.dahlia",
    secretKey: stripeLocalSignatureSecretKey,
    webhookSecret: stripeLocalSignatureWebhookSecret,
  } as const;
  const payload = JSON.stringify({
    ...stripeEvent(),
    api_version: configuration.apiVersion,
  });
  const stripe = new Stripe(configuration.secretKey, {
    apiVersion: configuration.apiVersion,
    telemetry: false,
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: configuration.webhookSecret,
  });

  assert.equal(
    constructStripeWebhookEvent(Buffer.from(payload), signature, configuration).id,
    "evt_test_checkout_completed",
  );
  assert.throws(() => constructStripeWebhookEvent(
    Buffer.from(`${payload} `),
    signature,
    configuration,
  ));

  const incompatiblePayload = JSON.stringify({
    ...stripeEvent(),
    api_version: "2025-01-01.acacia",
  });
  const incompatibleSignature = stripe.webhooks.generateTestHeaderString({
    payload: incompatiblePayload,
    secret: configuration.webhookSecret,
  });
  assert.throws(() => constructStripeWebhookEvent(
    Buffer.from(incompatiblePayload),
    incompatibleSignature,
    configuration,
  ));
});

test("fails closed for disabled configuration, missing signature and invalid signature", async () => {
  let constructed = 0;
  const enabled = {
    provider: "stripe",
    enabled: true,
    configured: true,
    mode: "test",
    apiVersion: "2026-07-29.dahlia",
    secretKey: stripeRouteSecretKey,
    webhookSecret: stripeRouteWebhookSecret,
  } as const;
  const dependencies: StripeWebhookRouteDependencies = {
    assertQaRuntime: async () => {},
    configuration: () => enabled,
    constructEvent() {
      constructed += 1;
      throw new Error("invalid signature");
    },
    enrichEvent: async (event) => event,
    processEvent: async () => ({ outcome: "PROCESSED", duplicate: false }),
  };
  const request = (headers: Record<string, string> = {}) => new Request(
    "http://127.0.0.1:3000/api/payments/stripe/webhook",
    { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" },
  );

  const disabled = await handleStripeWebhookPost(request({ "stripe-signature": "fixture" }), {
    ...dependencies,
    configuration: () => ({
      provider: "stripe",
      enabled: false,
      configured: false,
      mode: "disabled",
      apiVersion: "2026-07-29.dahlia",
    }),
  });
  assert.equal(disabled.status, 503);
  assert.equal((await handleStripeWebhookPost(request(), dependencies)).status, 400);
  assert.equal((await handleStripeWebhookPost(
    request({ "stripe-signature": "invalid" }),
    dependencies,
  )).status, 400);
  assert.equal(constructed, 1);
});

test("rejects oversized declared and streamed webhook bodies before verification", async () => {
  let constructed = 0;
  const dependencies: StripeWebhookRouteDependencies = {
    assertQaRuntime: async () => {},
    configuration: () => ({
      provider: "stripe",
      enabled: true,
      configured: true,
      mode: "test",
      apiVersion: "2026-07-29.dahlia",
      secretKey: stripeRouteSecretKey,
      webhookSecret: stripeRouteWebhookSecret,
    }),
    constructEvent() {
      constructed += 1;
      return stripeEvent();
    },
    enrichEvent: async (event) => event,
    processEvent: async () => ({ outcome: "PROCESSED", duplicate: false }),
  };
  const declared = await handleStripeWebhookPost(new Request(
    "http://127.0.0.1:3000/api/payments/stripe/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(STRIPE_WEBHOOK_MAX_BYTES + 1),
        "stripe-signature": "fixture",
      },
      body: "{}",
    },
  ), dependencies);
  const streamed = await handleStripeWebhookPost(new Request(
    "http://127.0.0.1:3000/api/payments/stripe/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "fixture",
      },
      body: "x".repeat(STRIPE_WEBHOOK_MAX_BYTES + 1),
    },
  ), dependencies);
  assert.equal(declared.status, 413);
  assert.equal(streamed.status, 413);
  assert.equal(constructed, 0);
});

test("rejects ambiguous media types and oversized signature headers", async () => {
  let constructed = 0;
  const dependencies: StripeWebhookRouteDependencies = {
    assertQaRuntime: async () => {},
    configuration: () => ({
      provider: "stripe",
      enabled: true,
      configured: true,
      mode: "test",
      apiVersion: "2026-07-29.dahlia",
      secretKey: stripeRouteSecretKey,
      webhookSecret: stripeRouteWebhookSecret,
    }),
    constructEvent() {
      constructed += 1;
      return stripeEvent();
    },
    enrichEvent: async (event) => event,
    processEvent: async () => ({ outcome: "PROCESSED", duplicate: false }),
  };
  const request = (contentType: string, signature: string) => new Request(
    "http://127.0.0.1:3000/api/payments/stripe/webhook",
    {
      method: "POST",
      headers: {
        "content-type": contentType,
        "stripe-signature": signature,
      },
      body: "{}",
    },
  );

  assert.equal((await handleStripeWebhookPost(
    request("application/jsonp", "fixture"),
    dependencies,
  )).status, 415);
  assert.equal((await handleStripeWebhookPost(
    request("application/json", "x".repeat(8_193)),
    dependencies,
  )).status, 400);
  assert.equal(constructed, 0);
});

test("ignores unknown signed events and quarantines live or malformed Checkout events", async () => {
  const recorded: Array<{ outcome: string; type: string }> = [];
  let reconciled = 0;
  const repository: PaymentWebhookRepository = {
    async record(receipt, outcome) {
      recorded.push({ outcome, type: receipt.type });
      return { outcome, duplicate: false };
    },
    async reconcile() {
      reconciled += 1;
      return { outcome: "PROCESSED", duplicate: false };
    },
    async reconcileFailure() {
      reconciled += 1;
      return { outcome: "PROCESSED", duplicate: false };
    },
  };

  assert.deepEqual(await processVerifiedStripeWebhookEvent(
    stripeEvent("customer.created"),
    repository,
  ), { outcome: "IGNORED", duplicate: false });
  assert.deepEqual(await processVerifiedStripeWebhookEvent(
    stripeEvent("checkout.session.completed", { livemode: true }),
    repository,
  ), { outcome: "REQUIRES_REVIEW", duplicate: false });
  assert.deepEqual(await processVerifiedStripeWebhookEvent(
    stripeEvent("checkout.session.completed", { data: { object: { id: "cs_test_bad" } } }),
    repository,
  ), { outcome: "REQUIRES_REVIEW", duplicate: false });
  assert.deepEqual(recorded, [
    { outcome: "IGNORED", type: "customer.created" },
    { outcome: "REQUIRES_REVIEW", type: "checkout.session.completed" },
    { outcome: "REQUIRES_REVIEW", type: "checkout.session.completed" },
  ]);
  assert.equal(reconciled, 0);
});

test("requires exact provider, metadata, IDs, amount, currency and pricing snapshot", () => {
  const scenarios = [
    [payment({ provider: "OTHER" }), normalized(), "WEBHOOK_PROVIDER_MISMATCH"],
    [payment({ mode: "LIVE" }), normalized(), "WEBHOOK_MODE_MISMATCH"],
    [payment(), normalized({ paymentId: "33333333-3333-4333-8333-333333333333" }), "WEBHOOK_PAYMENT_ID_MISMATCH"],
    [payment(), normalized({ orderId: "33333333-3333-4333-8333-333333333333" }), "WEBHOOK_ORDER_ID_MISMATCH"],
    [payment(), normalized({ clientReferenceId: "33333333-3333-4333-8333-333333333333" }), "WEBHOOK_ORDER_ID_MISMATCH"],
    [payment(), normalized({ objectId: "cs_test_other" }), "WEBHOOK_CHECKOUT_ID_MISMATCH"],
    [payment(), normalized({ paymentIntentId: "pi_test_other" }), "WEBHOOK_PAYMENT_INTENT_MISMATCH"],
    [payment(), normalized({ amountTotal: 4_999 }), "WEBHOOK_AMOUNT_MISMATCH"],
    [payment(), normalized({ currency: "USD" }), "WEBHOOK_CURRENCY_MISMATCH"],
    [payment(), normalized({ pricingVersion: "legacy" }), "WEBHOOK_PRICING_VERSION_MISMATCH"],
    [payment({ providerIdentifiersBelongToOtherPayment: true }), normalized(), "WEBHOOK_PROVIDER_ID_CONFLICT"],
  ] as const;

  for (const [current, event, expected] of scenarios) {
    const plan = planStripeCheckoutReconciliation(current, event);
    assert.equal(plan.outcome, "REQUIRES_REVIEW");
    assert.equal(plan.mismatch, expected);
    assert.equal(plan.paymentUpdate.status, "REQUIRES_REVIEW");
    assert.equal(plan.confirmOrder, false);
  }
});

test("records an immediate card refusal as retryable FAILED on the same Checkout attempt", () => {
  const firstFailure = planStripePaymentIntentFailure(payment(), normalizedFailure());
  assert.deepEqual(firstFailure.paymentUpdate, {
    status: "FAILED",
    failureCode: "STRIPE_PAYMENT_ATTEMPT_FAILED",
    failedAt: processedAt,
  });
  assert.equal(firstFailure.confirmOrder, false);

  const repeatedFailure = planStripePaymentIntentFailure(payment({
    status: "FAILED",
    failureCode: "STRIPE_PAYMENT_ATTEMPT_FAILED",
    failedAt: processedAt,
    paymentMethod: "CARD",
  }), normalizedFailure({ eventId: "evt_test_payment_failed_again" }));
  assert.equal(repeatedFailure.paymentUpdate.status, "FAILED");
  assert.equal(repeatedFailure.paymentUpdate.failedAt, processedAt);
  assert.equal(repeatedFailure.confirmOrder, false);
});

test("never confirms an Order from mismatched payment-intent failure evidence", () => {
  const mismatched = planStripePaymentIntentFailure(
    payment(),
    normalizedFailure({ amountTotal: 4_999 }),
  );
  assert.equal(mismatched.outcome, "REQUIRES_REVIEW");
  assert.equal(mismatched.mismatch, "WEBHOOK_AMOUNT_MISMATCH");
  assert.equal(mismatched.confirmOrder, false);
});

test("lets the same failed Checkout recover, expire, or become terminal without a second session", () => {
  const retryable = payment({
    status: "FAILED",
    failureCode: "STRIPE_PAYMENT_ATTEMPT_FAILED",
    failedAt: processedAt,
  });
  const success = planStripeCheckoutReconciliation(retryable, normalized({
    paymentIntentEvidence: {
      id: "pi_test_payment",
      amountCents: 5_000,
      currency: "EUR",
      livemode: false,
      status: "succeeded",
      paymentId,
      orderId,
      pricingVersion: "2026-08-v1",
      paymentMethod: "PAYPAL",
    },
  }));
  assert.equal(success.paymentUpdate.status, "SUCCEEDED");
  assert.equal(success.paymentUpdate.failureCode, null);
  assert.equal(success.paymentUpdate.paymentMethod, "PAYPAL");
  assert.equal(success.confirmOrder, true);

  const expired = planStripeCheckoutReconciliation(retryable, normalized({
    type: "checkout.session.expired",
    paymentStatus: "unpaid",
    checkoutStatus: "expired",
    paymentIntentEvidence: null,
  }));
  assert.equal(expired.paymentUpdate.status, "EXPIRED");
  assert.equal(expired.paymentUpdate.expiredAt, processedAt);

  const terminal = planStripeCheckoutReconciliation(retryable, normalized({
    type: "checkout.session.async_payment_failed",
    paymentStatus: "unpaid",
    checkoutStatus: "complete",
    paymentIntentEvidence: null,
  }));
  assert.equal(terminal.paymentUpdate.status, "FAILED");
  assert.equal(terminal.paymentUpdate.failureCode, "STRIPE_ASYNC_PAYMENT_FAILED");
});

test("normalizes and dispatches a verified payment_intent.payment_failed event", async () => {
  const normalizedEvents: NormalizedStripePaymentIntentFailureEvent[] = [];
  const repository: PaymentWebhookRepository = {
    async record(_receipt, outcome) {
      return { outcome, duplicate: false };
    },
    async reconcile() {
      throw new Error("Checkout reconciliation must not run.");
    },
    async reconcileFailure(event) {
      normalizedEvents.push(event);
      return { outcome: "PROCESSED", duplicate: false };
    },
  };
  const result = await processVerifiedStripeWebhookEvent(
    stripePaymentFailureEvent(),
    repository,
  );
  assert.deepEqual(result, { outcome: "PROCESSED", duplicate: false });
  assert.equal(normalizedEvents.at(0)?.paymentIntentStatus, "requires_payment_method");
});

test("rejects contradictory Checkout lifecycle states", () => {
  const scenarios = [
    normalized({
      type: "checkout.session.expired",
      checkoutStatus: "expired",
      paymentStatus: "paid",
    }),
    normalized({
      type: "checkout.session.async_payment_failed",
      paymentStatus: "paid",
    }),
    normalized({ paymentIntentId: null }),
  ];
  for (const event of scenarios) {
    const plan = planStripeCheckoutReconciliation(payment(), event);
    assert.equal(plan.outcome, "REQUIRES_REVIEW");
    assert.equal(plan.paymentUpdate.status, "REQUIRES_REVIEW");
    assert.equal(plan.confirmOrder, false);
  }
});

test("lets the first provider success win but routes an already-paid Order to manual review", () => {
  const secondPayment = planStripeCheckoutReconciliation(
    payment({ orderHasOtherSuccessfulPayment: true }),
    normalized(),
  );
  assert.equal(secondPayment.outcome, "REQUIRES_REVIEW");
  assert.equal(secondPayment.mismatch, "WEBHOOK_ORDER_ALREADY_PAID");
  assert.equal(secondPayment.paymentUpdate.status, "REQUIRES_REVIEW");
  assert.equal(secondPayment.confirmOrder, false);

  const staleAttempt = planStripeCheckoutReconciliation(
    payment({ status: "FAILED", orderHasOtherActivePayment: true }),
    normalized(),
  );
  assert.equal(staleAttempt.outcome, "PROCESSED");
  assert.equal(staleAttempt.mismatch, undefined);
  assert.equal(staleAttempt.paymentUpdate.status, "SUCCEEDED");
  assert.equal(staleAttempt.confirmOrder, true);

  const impossibleOrder = planStripeCheckoutReconciliation(
    payment({ status: "SUCCEEDED", orderStatus: "DRAFT", paidAt: processedAt }),
    normalized(),
  );
  assert.equal(impossibleOrder.outcome, "REQUIRES_REVIEW");
  assert.equal(impossibleOrder.mismatch, "WEBHOOK_ORDER_STATUS_MISMATCH");
  assert.equal(impossibleOrder.paymentUpdate.status, undefined);
  assert.equal(impossibleOrder.confirmOrder, false);

  const refundedAttempt = planStripeCheckoutReconciliation(
    payment({ status: "REFUNDED", paidAt: processedAt }),
    normalized(),
  );
  assert.equal(refundedAttempt.outcome, "REQUIRES_REVIEW");
  assert.equal(refundedAttempt.confirmOrder, false);
});

test("records review without violating the single-active-attempt constraint", () => {
  const plan = planStripeCheckoutReconciliation(
    payment({ status: "EXPIRED", orderHasOtherActivePayment: true }),
    normalized({ amountTotal: 4_999 }),
  );
  assert.equal(plan.outcome, "REQUIRES_REVIEW");
  assert.equal(plan.paymentUpdate.status, undefined);
  assert.equal(plan.paymentUpdate.failureCode, "WEBHOOK_AMOUNT_MISMATCH");
  assert.equal(plan.confirmOrder, false);
});

test("keeps payment transitions monotone when Checkout events arrive out of order", () => {
  const success = planStripeCheckoutReconciliation(payment(), normalized());
  assert.deepEqual(success.paymentUpdate, {
    status: "SUCCEEDED",
    paidAt: processedAt,
    failureCode: null,
    paymentMethod: "CARD",
  });
  assert.equal(success.confirmOrder, true);

  const lateFailure = planStripeCheckoutReconciliation(
    payment({ status: "SUCCEEDED", paidAt: processedAt, orderStatus: "PAYMENT_CONFIRMED" }),
    normalized({
      eventId: "evt_late_failure",
      type: "checkout.session.async_payment_failed",
      paymentStatus: "unpaid",
      checkoutStatus: "complete",
    }),
  );
  assert.equal(lateFailure.paymentUpdate.status, undefined);
  assert.equal(lateFailure.confirmOrder, false);

  const pending = planStripeCheckoutReconciliation(
    payment({ status: "CREATED" }),
    normalized({ paymentStatus: "unpaid" }),
  );
  assert.equal(pending.paymentUpdate.status, "PENDING");

  const expired = planStripeCheckoutReconciliation(
    payment(),
    normalized({
      type: "checkout.session.expired",
      paymentStatus: "unpaid",
      checkoutStatus: "expired",
    }),
  );
  assert.equal(expired.paymentUpdate.status, "EXPIRED");
  assert.equal(expired.paymentUpdate.expiredAt, processedAt);

  const asyncSuccess = planStripeCheckoutReconciliation(
    payment({ status: "FAILED", providerPaymentId: null }),
    normalized({
      type: "checkout.session.async_payment_succeeded",
      checkoutStatus: "complete",
    }),
  );
  assert.equal(asyncSuccess.paymentUpdate.status, "SUCCEEDED");
  assert.equal(asyncSuccess.paymentUpdate.providerPaymentId, "pi_test_payment");
  assert.equal(asyncSuccess.confirmOrder, true);

  const manualReview = planStripeCheckoutReconciliation(
    payment({ status: "REQUIRES_REVIEW" }),
    normalized(),
  );
  assert.equal(manualReview.outcome, "REQUIRES_REVIEW");
  assert.equal(manualReview.paymentUpdate.status, undefined);
});

test("passes each verified event once to an injected deduplicating repository", async () => {
  const seen = new Set<string>();
  let reconciliations = 0;
  const repository: PaymentWebhookRepository = {
    async record(receipt, outcome) {
      const duplicate = seen.has(receipt.eventId);
      seen.add(receipt.eventId);
      return { outcome, duplicate };
    },
    async reconcile(event) {
      const duplicate = seen.has(event.eventId);
      seen.add(event.eventId);
      if (!duplicate) reconciliations += 1;
      return { outcome: "PROCESSED", duplicate };
    },
    async reconcileFailure(event) {
      const duplicate = seen.has(event.eventId);
      seen.add(event.eventId);
      if (!duplicate) reconciliations += 1;
      return { outcome: "PROCESSED", duplicate };
    },
  };

  const [first, second] = await Promise.all([
    processVerifiedStripeWebhookEvent(stripeEvent(), repository),
    processVerifiedStripeWebhookEvent(stripeEvent(), repository),
  ]);
  assert.deepEqual([first.duplicate, second.duplicate].sort(), [false, true]);
  assert.equal(reconciliations, 1);
});
