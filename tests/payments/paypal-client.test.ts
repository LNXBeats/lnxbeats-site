import assert from "node:assert/strict";
import test from "node:test";

import {
  createTestPaypalGateway,
  paypalAmountFromCents,
  paypalCaptureEvidence,
  paypalCentsFromAmount,
  paypalCreateOrderBody,
  paypalOrderSession,
} from "@/lib/payments/paypal-client";

const request = {
  orderId: "11111111-1111-4111-8111-111111111111",
  orderNumber: "LNX-2026-000001",
  paymentId: "22222222-2222-4222-8222-222222222222",
  amountCents: 9_000,
  currency: "EUR",
  description: "Création musicale personnalisée LNX Beats",
  returnUrl: "https://staging.example.test/compte/commandes/LNX-2026-000001?paiement=paypal-retour",
  cancelUrl: "https://staging.example.test/compte/commandes/LNX-2026-000001?paiement=paypal-annule",
} as const;

const configuration = {
  provider: "paypal",
  enabled: true,
  configured: true,
  environment: "sandbox",
  clientId: "paypal-client-fixture",
  clientSecret: "paypal-secret-fixture",
  webhookId: "paypal-webhook-fixture",
} as const;

test("builds the PayPal order exclusively from the server snapshot", () => {
  const body = paypalCreateOrderBody(request);
  assert.equal(body.intent, "CAPTURE");
  assert.equal(body.purchase_units[0].amount.value, "90.00");
  assert.equal(body.purchase_units[0].amount.currency_code, "EUR");
  assert.equal(body.purchase_units[0].reference_id, request.orderId);
  assert.equal(body.purchase_units[0].custom_id, request.paymentId);
  assert.equal(body.payment_source.paypal.experience_context.shipping_preference, "NO_SHIPPING");
  assert.equal(body.payment_source.paypal.experience_context.return_url, request.returnUrl);
  assert.equal("amountCents" in body, false);
});

test("converts fixed EUR amounts without floating-point trust", () => {
  assert.equal(paypalAmountFromCents(5_000), "50.00");
  assert.equal(paypalAmountFromCents(9_099), "90.99");
  assert.equal(paypalCentsFromAmount("1500.00"), 150_000);
  for (const value of ["1", "1.0", "01.00", "-1.00", "1.001", 1]) {
    assert.throws(() => paypalCentsFromAmount(value));
  }
});

test("accepts only sandbox approval links and complete capture evidence", () => {
  assert.deepEqual(paypalOrderSession({
    id: "PAYPAL-ORDER-01",
    status: "PAYER_ACTION_REQUIRED",
    links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-01" }],
  }), {
    id: "PAYPAL-ORDER-01",
    status: "PAYER_ACTION_REQUIRED",
    approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-01",
  });
  assert.throws(() => paypalOrderSession({
    id: "PAYPAL-ORDER-01",
    status: "CREATED",
    links: [{ rel: "approve", href: "https://www.paypal.com/checkoutnow" }],
  }));

  assert.deepEqual(paypalCaptureEvidence({
    id: "PAYPAL-ORDER-01",
    status: "COMPLETED",
    purchase_units: [{
      custom_id: request.paymentId,
      payments: { captures: [{
        id: "PAYPAL-CAPTURE-01",
        status: "COMPLETED",
        final_capture: true,
        amount: { currency_code: "EUR", value: "90.00" },
        update_time: "2026-08-21T10:00:00.000Z",
      }] },
    }],
  }), {
    providerOrderId: "PAYPAL-ORDER-01",
    captureId: "PAYPAL-CAPTURE-01",
    status: "COMPLETED",
    paymentId: request.paymentId,
    amountCents: 9_000,
    currency: "EUR",
    occurredAt: new Date("2026-08-21T10:00:00.000Z"),
  });
});

test("uses PayPal Sandbox Orders v2 and the persisted provider idempotency key", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const gateway = createTestPaypalGateway(configuration, async (input, init = {}) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access-token-fixture", token_type: "Bearer" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      id: "PAYPAL-ORDER-01",
      status: "CREATED",
      links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-01" }],
    }), { status: 201, headers: { "content-type": "application/json" } });
  });

  const result = await gateway.createOrder(request, "paypal-order:payment-fixture");
  assert.equal(result.id, "PAYPAL-ORDER-01");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, "https://api-m.sandbox.paypal.com/v2/checkout/orders");
  const headers = new Headers(calls[1]?.init.headers);
  assert.equal(headers.get("PayPal-Request-Id"), "paypal-order:payment-fixture");
  const body = JSON.parse(String(calls[1]?.init.body)) as { purchase_units: Array<{ amount: { value: string } }> };
  assert.equal(body.purchase_units[0]?.amount.value, "90.00");
});

test("posts the exact raw event inside PayPal's official signature envelope", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const gateway = createTestPaypalGateway(configuration, async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const body = String(input).endsWith("/v1/oauth2/token")
      ? { access_token: "access-token-fixture", token_type: "Bearer" }
      : { verification_status: "SUCCESS" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const rawEvent = "{\n  \"id\": \"WH-RAW-01\", \"event_type\": \"PAYMENT.CAPTURE.COMPLETED\"\n}";
  const verified = await gateway.verifyWebhook({
    transmissionId: "transmission-fixture",
    transmissionTime: "2026-08-21T10:00:00.000Z",
    certUrl: "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-01",
    authAlgo: "SHA256withRSA",
    transmissionSignature: "signature-fixture",
  }, rawEvent);
  assert.equal(verified, true);
  assert.equal(calls[1]?.url, "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
  assert.ok(String(calls[1]?.init.body).endsWith(`\"webhook_event\":${rawEvent}}`));
});

test("derives the immutable PayPal Live API and approval hosts only from server configuration", async () => {
  const liveConfiguration = { ...configuration, environment: "live" as const };
  const calls: string[] = [];
  const gateway = createTestPaypalGateway(liveConfiguration, async (input) => {
    calls.push(String(input));
    if (String(input).endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access-token-fixture", token_type: "Bearer" }), { status: 200 });
    }
    return new Response(JSON.stringify({
      id: "PAYPAL-LIVE-ORDER-01",
      status: "CREATED",
      links: [{ rel: "approve", href: "https://www.paypal.com/checkoutnow?token=PAYPAL-LIVE-ORDER-01" }],
    }), { status: 201 });
  });
  const result = await gateway.createOrder(request, "paypal-live-order:fixture");
  assert.equal(result.approvalUrl, "https://www.paypal.com/checkoutnow?token=PAYPAL-LIVE-ORDER-01");
  assert.equal(calls[0], "https://api-m.paypal.com/v1/oauth2/token");
  assert.equal(calls[1], "https://api-m.paypal.com/v2/checkout/orders");
  assert.throws(() => paypalOrderSession({
    id: "PAYPAL-LIVE-ORDER-01",
    status: "CREATED",
    links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow" }],
  }, "live"));
});
