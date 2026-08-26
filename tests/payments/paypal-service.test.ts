import assert from "node:assert/strict";
import test from "node:test";

import type { OrderActor } from "@/lib/orders/domain";
import type { PaypalGateway } from "@/lib/payments/paypal-client";
import {
  capturePaypalOrderForOrder,
  createPaypalOrderForOrder,
  type PaypalCaptureRepository,
} from "@/lib/payments/paypal-service";
import { PaymentServiceError, type PaymentCheckoutRepository } from "@/lib/payments/service";

const actor = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "member@example.test",
  name: "Member QA",
  role: "MEMBER",
  status: "ACTIVE",
  emailVerified: true,
} as const satisfies OrderActor;
const paymentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const orderId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const orderNumber = "LNX-2026-000001";

function checkoutRepository(providerCheckoutId?: string): PaymentCheckoutRepository {
  return {
    async enforceRateLimit() {},
    async reserveAttempt() {
      return {
        paymentId,
        orderId,
        orderNumber,
        customerEmail: actor.email,
        snapshot: {
          basePriceCents: 2_000,
          coverIncluded: false,
          coverPriceCents: 0,
          priorityProcessing: false,
          priorityPriceCents: 0,
          totalCents: 2_000,
          currency: "EUR",
          pricingVersion: "2026-08-v2",
        },
        idempotencyKey: `paypal-order:${paymentId}`,
        ...(providerCheckoutId ? { providerCheckoutId } : {}),
      };
    },
    async recordSession() {},
  };
}

function gateway(overrides: Partial<PaypalGateway> = {}): PaypalGateway {
  return {
    async createOrder() {
      return {
        id: "PAYPAL-ORDER-01",
        status: "CREATED",
        approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-01",
      };
    },
    async retrieveOrder() {
      return { id: "PAYPAL-ORDER-01", status: "APPROVED" };
    },
    async captureOrder() {
      return {
        providerOrderId: "PAYPAL-ORDER-01",
        captureId: "PAYPAL-CAPTURE-01",
        status: "COMPLETED",
        paymentId,
        amountCents: 9_000,
        currency: "EUR",
        occurredAt: new Date("2026-08-21T10:00:00.000Z"),
      };
    },
    async verifyWebhook() { return true; },
    ...overrides,
  };
}

test("creates a PayPal order after the server-priced reservation and reuses its idempotency key", async () => {
  let createInput: Parameters<PaypalGateway["createOrder"]> | undefined;
  const result = await createPaypalOrderForOrder(actor, orderNumber, {
    repository: checkoutRepository(),
    gateway: gateway({
      async createOrder(request, idempotencyKey) {
        createInput = [request, idempotencyKey];
        return {
          id: "PAYPAL-ORDER-01",
          status: "CREATED",
          approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-01",
        };
      },
    }),
    baseUrl: "https://staging.example.test",
  });
  assert.equal(result.approvalUrl, "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-01");
  assert.equal(createInput?.[0].amountCents, 2_000);
  assert.equal(createInput?.[0].currency, "EUR");
  assert.equal(createInput?.[1], `paypal-order:${paymentId}`);
});

test("reuses the persisted PayPal order instead of creating a second logical transaction", async () => {
  let createCalls = 0;
  let retrieveCalls = 0;
  let recordedSession: { id: string; url: string } | undefined;
  const repository = checkoutRepository("PAYPAL-LIVE-ORDER-01");
  repository.recordSession = async (_paymentId, session) => {
    recordedSession = session;
  };

  const result = await createPaypalOrderForOrder(actor, orderNumber, {
    repository,
    gateway: gateway({
      async createOrder() {
        createCalls += 1;
        throw new Error("must not create a second PayPal order");
      },
      async retrieveOrder(providerOrderId) {
        retrieveCalls += 1;
        assert.equal(providerOrderId, "PAYPAL-LIVE-ORDER-01");
        return {
          id: providerOrderId,
          status: "PAYER_ACTION_REQUIRED",
          approvalUrl: "https://www.paypal.com/checkoutnow?token=PAYPAL-LIVE-ORDER-01",
        };
      },
    }),
    baseUrl: "https://www.lnxbeats.fr",
  });

  assert.equal(createCalls, 0);
  assert.equal(retrieveCalls, 1);
  assert.equal(result.approvalUrl, "https://www.paypal.com/checkoutnow?token=PAYPAL-LIVE-ORDER-01");
  assert.deepEqual(recordedSession, {
    id: "PAYPAL-LIVE-ORDER-01",
    url: "https://www.paypal.com/checkoutnow?token=PAYPAL-LIVE-ORDER-01",
  });
});

test("rejects a capture whose amount, currency or Payment identity differs from the DB snapshot", async () => {
  const repository: PaypalCaptureRepository = {
    async reserveCapture() {
      return {
        paymentId,
        orderId,
        orderNumber,
        providerOrderId: "PAYPAL-ORDER-01",
        captureIdempotencyKey: `paypal-capture:${paymentId}`,
        amountCents: 9_000,
        currency: "EUR",
        pricingVersion: "2026-08-v1",
      };
    },
    async reconcile() { throw new Error("must not reconcile mismatched evidence"); },
    async recordUnmatched() { throw new Error("must not record from the capture route"); },
  };
  await assert.rejects(
    capturePaypalOrderForOrder(actor, orderNumber, "PAYPAL-ORDER-01", {
      repository,
      gateway: gateway({
        async captureOrder() {
          return {
            providerOrderId: "PAYPAL-ORDER-01",
            captureId: "PAYPAL-CAPTURE-01",
            status: "COMPLETED",
            paymentId,
            amountCents: 100,
            currency: "EUR",
            occurredAt: new Date(),
          };
        },
      }),
    }),
    (error) => error instanceof PaymentServiceError && error.code === "PAYMENT_SNAPSHOT_CONFLICT",
  );
});

test("critical double-provider path refuses PayPal before capture after Stripe has paid", async () => {
  let captureCalls = 0;
  const repository: PaypalCaptureRepository = {
    async reserveCapture() {
      throw new PaymentServiceError(409, "PAYMENT_ALREADY_COMPLETED");
    },
    async reconcile() { throw new Error("must not reconcile a second provider"); },
    async recordUnmatched() { throw new Error("must not record a browser capture"); },
  };
  await assert.rejects(
    capturePaypalOrderForOrder(actor, orderNumber, "PAYPAL-ORDER-01", {
      repository,
      gateway: gateway({
        async captureOrder() {
          captureCalls += 1;
          throw new Error("PayPal must not be called");
        },
      }),
    }),
    (error) => error instanceof PaymentServiceError && error.code === "PAYMENT_ALREADY_COMPLETED",
  );
  assert.equal(captureCalls, 0);
});
