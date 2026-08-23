import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PaypalGateway } from "@/lib/payments/paypal-client";
import {
  handlePaypalWebhookPost,
  PAYPAL_WEBHOOK_MAX_BYTES,
  type PaypalWebhookRouteDependencies,
} from "@/lib/payments/paypal-webhook-route-handler";
import {
  normalizePaypalWebhookEvent,
  processVerifiedPaypalWebhookEvent,
  type VerifiedPaypalWebhookEvent,
} from "@/lib/payments/paypal-webhook";
import type { PaypalCaptureRepository } from "@/lib/payments/paypal-service";

const paymentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function completedEvent(overrides: Partial<VerifiedPaypalWebhookEvent> = {}): VerifiedPaypalWebhookEvent {
  return {
    id: "WH-PAYPAL-COMPLETED-01",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    create_time: "2026-08-21T10:00:00.000Z",
    resource: {
      id: "PAYPAL-CAPTURE-01",
      status: "COMPLETED",
      amount: { currency_code: "EUR", value: "90.00" },
      supplementary_data: { related_ids: { order_id: "PAYPAL-ORDER-01" } },
    },
    ...overrides,
  };
}

function routeRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://staging.example.test/api/payments/paypal/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "paypal-transmission-id": "transmission-fixture",
      "paypal-transmission-time": "2026-08-21T10:00:00.000Z",
      "paypal-cert-url": "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-01",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-transmission-sig": "signature-fixture",
      ...headers,
    },
    body,
  });
}

function gateway(verified: boolean): PaypalGateway {
  return {
    async createOrder() { throw new Error("not used"); },
    async retrieveOrder() { throw new Error("not used"); },
    async captureOrder() { throw new Error("not used"); },
    async verifyWebhook() { return verified; },
  };
}

test("normalizes an official PayPal capture without requiring custom_id", () => {
  assert.deepEqual(normalizePaypalWebhookEvent(completedEvent()), {
    eventId: "WH-PAYPAL-COMPLETED-01",
    type: "PAYMENT.CAPTURE.COMPLETED",
    occurredAt: new Date("2026-08-21T10:00:00.000Z"),
    providerOrderId: "PAYPAL-ORDER-01",
    captureId: "PAYPAL-CAPTURE-01",
    amountCents: 9_000,
    currency: "EUR",
    status: "COMPLETED",
  });
  assert.equal(normalizePaypalWebhookEvent(completedEvent({
    resource: {
      id: "PAYPAL-CAPTURE-01",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "90.00" },
      supplementary_data: { related_ids: { order_id: "PAYPAL-ORDER-01" } },
    },
  })), null);
  assert.equal(normalizePaypalWebhookEvent(completedEvent({
    resource: {
      id: "PAYPAL-CAPTURE-01",
      status: "COMPLETED",
      custom_id: paymentId,
      amount: { currency_code: "EUR", value: "90.00" },
      supplementary_data: { related_ids: { order_id: "PAYPAL-ORDER-01" } },
    },
  }))?.paymentId, paymentId);
  assert.equal(normalizePaypalWebhookEvent(completedEvent({
    event_type: "PAYMENT.CAPTURE.DECLINED",
    resource: {
      id: "PAYPAL-CAPTURE-02",
      status: "DECLINED",
      amount: { currency_code: "EUR", value: "90.00" },
      supplementary_data: { related_ids: { order_id: "PAYPAL-ORDER-01" } },
    },
  }))?.status, "DECLINED");
});

test("verifies PayPal headers and signature before processing the bounded raw event", async () => {
  let processed = 0;
  let verifiedBody = "";
  const verificationGateway: PaypalGateway = {
    ...gateway(true),
    async verifyWebhook(_headers, webhookEventBody) {
      verifiedBody = webhookEventBody;
      return true;
    },
  };
  const dependencies: PaypalWebhookRouteDependencies = {
    assertRuntime: async () => {},
    gateway: () => verificationGateway,
    async processEvent() {
      processed += 1;
      return { outcome: "PROCESSED", duplicate: false, orderConfirmed: true };
    },
  };
  const rawEvent = JSON.stringify(completedEvent(), null, 2);
  const response = await handlePaypalWebhookPost(
    routeRequest(rawEvent),
    dependencies,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, outcome: "processed", duplicate: false });
  assert.equal(processed, 1);
  assert.equal(verifiedBody, rawEvent);
});

test("fails closed for invalid signatures, production certificate hosts and oversized bodies", async () => {
  const dependencies: PaypalWebhookRouteDependencies = {
    assertRuntime: async () => {},
    gateway: () => gateway(false),
    async processEvent() { throw new Error("must not process"); },
  };
  assert.equal((await handlePaypalWebhookPost(
    routeRequest(JSON.stringify(completedEvent())), dependencies,
  )).status, 400);
  assert.equal((await handlePaypalWebhookPost(
    routeRequest(JSON.stringify(completedEvent()), {
      "paypal-cert-url": "https://api-m.paypal.com/v1/notifications/certs/CERT-01",
    }), dependencies,
  )).status, 400);
  assert.equal((await handlePaypalWebhookPost(
    routeRequest(JSON.stringify(completedEvent()), {
      "content-length": String(PAYPAL_WEBHOOK_MAX_BYTES + 1),
    }), dependencies,
  )).status, 413);
});

test("accepts only the PayPal certificate host for the configured provider environment", async () => {
  const dependencies: PaypalWebhookRouteDependencies = {
    assertRuntime: async () => ({
      enabled: true,
      deploymentEnvironment: "production",
      stripe: { provider: "stripe", enabled: false, configured: false, mode: "disabled", apiVersion: "2026-07-29.dahlia" },
      paypal: {
        provider: "paypal", enabled: true, configured: true, environment: "live",
        clientId: "paypal-client-fixture", clientSecret: "paypal-secret-fixture", webhookId: "paypal-webhook-fixture",
      },
    }),
    gateway: () => gateway(true),
    async processEvent() { return { outcome: "PROCESSED", duplicate: false, orderConfirmed: false }; },
  };
  const response = await handlePaypalWebhookPost(routeRequest(
    JSON.stringify(completedEvent()),
    { "paypal-cert-url": "https://api-m.paypal.com/v1/notifications/certs/CERT-01" },
  ), dependencies);
  assert.equal(response.status, 200);
});

test("the default route returns the runtime configuration used to bind the certificate host", async () => {
  const source = await readFile(new URL("../../lib/payments/paypal-webhook-route-handler.ts", import.meta.url), "utf8");
  assert.match(source, /assertRuntime:\s*assertPaymentsRuntimeEnvironment/);
  assert.match(source, /runtimeConfiguration\?\.paypal\.enabled/);
});

test("delegates replay idempotence and quarantines malformed supported events", async () => {
  const seen = new Set<string>();
  let reconcileCalls = 0;
  const repository: PaypalCaptureRepository = {
    async reserveCapture() { throw new Error("not used"); },
    async reconcile(event) {
      reconcileCalls += 1;
      const duplicate = seen.has(event.eventId);
      seen.add(event.eventId);
      return { outcome: "PROCESSED", duplicate, orderConfirmed: !duplicate };
    },
    async recordUnmatched(_eventId, _type, _objectId, outcome = "REQUIRES_REVIEW") {
      return { outcome, duplicate: false, orderConfirmed: false };
    },
  };
  const first = await processVerifiedPaypalWebhookEvent(completedEvent(), repository);
  const replay = await processVerifiedPaypalWebhookEvent(completedEvent(), repository);
  assert.deepEqual([first.duplicate, replay.duplicate], [false, true]);
  assert.equal(reconcileCalls, 2);
  const malformed = await processVerifiedPaypalWebhookEvent(completedEvent({ resource: {} }), repository);
  assert.equal(malformed.outcome, "REQUIRES_REVIEW");
  const unknown = await processVerifiedPaypalWebhookEvent(completedEvent({ event_type: "CATALOG.PRODUCT.CREATED" }), repository);
  assert.equal(unknown.outcome, "IGNORED");
});
