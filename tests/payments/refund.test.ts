import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { OrderActor } from "@/lib/orders/domain";
import {
  assertRefundSourceInvoice,
  createRefundProviderGateway,
  parseRefundAmountToCents,
  paymentStatusAfterRefund,
  reconcileRefundAttemptForAdmin,
  refundableAmount,
  RefundServiceError,
  requestRefundForOrder,
  type RefundDependencies,
  type ReservedRefund,
} from "@/lib/payments/refund";
import {
  PaypalClientError,
  createTestPaypalGateway,
  paypalRefundEvidence,
  type PaypalGateway,
  type PaypalRefundGateway,
} from "@/lib/payments/paypal-client";
import {
  captureIdFromRefundResource,
  isPaypalFinancialEvent,
  isStripeFinancialEvent,
  normalizePaypalIncidentEvent,
  normalizePaypalRefundEvent,
  normalizeStripeIncidentEvent,
  normalizeStripeRefundEvent,
  paypalFinancialProviderPaymentId,
  stripeFinancialProviderPaymentId,
} from "@/lib/payments/provider-financial-events";
import {
  createTestStripeRefundGateway,
  type StripeRefundGateway,
} from "@/lib/payments/stripe-client";

const admin = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "admin@example.invalid",
  name: "Admin QA",
  role: "ADMIN",
  status: "ACTIVE",
  emailVerified: true,
} as const satisfies OrderActor;

const reserved = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  paymentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  provider: "PAYPAL",
  providerPaymentId: "PAYPAL-CAPTURE-01",
  amountCents: 1_500,
  currency: "EUR",
  providerIdempotencyKey: "refund:paypal:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  providerRefundId: null,
  status: "PROCESSING",
  mode: "TEST",
  reused: false,
} as const satisfies ReservedRefund;

function dependencies(overrides: Partial<RefundDependencies> = {}) {
  let evidenceSeen: unknown;
  let failureSeen: unknown;
  const repository = {
    async reserve() { return reserved; },
    async claim() { return true; },
    async applyEvidence(_attemptId: string, evidence: unknown) {
      evidenceSeen = evidence;
      return { status: "SUCCEEDED" as const, confirmed: true };
    },
    async markProviderFailure(_attemptId: string, failure: unknown) { failureSeen = failure; },
    async get() { return reserved; },
    async recordReconciliation() {},
  } as RefundDependencies["repository"];
  const value: RefundDependencies = {
    repository,
    gateway: () => ({
      async request(input) {
        return {
          provider: "PAYPAL", providerRefundId: "REFUND-01", providerPaymentId: input.providerPaymentId,
          status: "SUCCEEDED", amountCents: input.amountCents, currency: "EUR", occurredAt: new Date("2026-08-22T12:00:00Z"),
        };
      },
      async retrieve() { throw new Error("not expected"); },
    }),
    assertRuntime: async () => ({ mode: "TEST", liveRefundsEnabled: false }),
    ...overrides,
  };
  return { value, evidence: () => evidenceSeen, failure: () => failureSeen };
}

test("refund amounts use exact integer cents and reject floats or non-positive input", () => {
  assert.equal(parseRefundAmountToCents("10"), 1_000);
  assert.equal(parseRefundAmountToCents("10,5"), 1_050);
  assert.equal(parseRefundAmountToCents("10.05"), 1_005);
  for (const value of ["0", "-1", "1.999", "NaN", "1e2", 10]) {
    assert.throws(() => parseRefundAmountToCents(value), RefundServiceError);
  }
});

test("a missing source invoice is an explicit fail-closed business error", () => {
  assert.doesNotThrow(() => assertRefundSourceInvoice({ id: "invoice-fixture" }));
  assert.throws(
    () => assertRefundSourceInvoice(null),
    (error: unknown) => error instanceof RefundServiceError
      && error.code === "REFUND_SOURCE_INVOICE_REQUIRED"
      && error.status === 409,
  );
});

test("remaining amount and Payment refund status are deterministic", () => {
  assert.equal(refundableAmount({ paidCents: 9_000, confirmedRefundedCents: 2_000, reservedRefundCents: 1_000 }), 6_000);
  assert.equal(paymentStatusAfterRefund({ amountCents: 9_000, confirmedRefundedCents: 0, hasUnresolvedRefund: false }), "SUCCEEDED");
  assert.equal(paymentStatusAfterRefund({ amountCents: 9_000, confirmedRefundedCents: 2_000, hasUnresolvedRefund: false }), "PARTIALLY_REFUNDED");
  assert.equal(paymentStatusAfterRefund({ amountCents: 9_000, confirmedRefundedCents: 9_000, hasUnresolvedRefund: false }), "REFUNDED");
  assert.equal(paymentStatusAfterRefund({ amountCents: 9_000, confirmedRefundedCents: 2_000, hasUnresolvedRefund: true }), "REFUND_PENDING");
  assert.throws(() => refundableAmount({ paidCents: 9_000, confirmedRefundedCents: 8_000, reservedRefundCents: 2_000 }), RefundServiceError);
});

test("PayPal refund evidence requires EUR, a refund id and the capture up-link", () => {
  const evidence = paypalRefundEvidence({
    id: "PAYPAL-REFUND-01",
    status: "COMPLETED",
    amount: { currency_code: "EUR", value: "15.00" },
    update_time: "2026-08-22T12:00:00Z",
    links: [{ rel: "up", method: "GET", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/PAYPAL-CAPTURE-01" }],
  });
  assert.equal(evidence.amountCents, 1_500);
  assert.equal(evidence.status, "SUCCEEDED");
  assert.equal(evidence.captureId, "PAYPAL-CAPTURE-01");
  assert.throws(() => paypalRefundEvidence({
    id: "PAYPAL-REFUND-01", status: "COMPLETED", amount: { currency_code: "USD", value: "15.00" },
    update_time: "2026-08-22T12:00:00Z", links: [],
  }), PaypalClientError);
});

test("the PayPal adapter passes exact cents and the persistent provider idempotency key", async () => {
  let request: unknown;
  const paypal = {
    async createOrder() { throw new Error("not expected"); },
    async retrieveOrder() { throw new Error("not expected"); },
    async captureOrder() { throw new Error("not expected"); },
    async verifyWebhook() { return true; },
    async refundCapture(captureId: string, amountCents: number, idempotencyKey: string) {
      request = { captureId, amountCents, idempotencyKey };
      return {
        providerRefundId: "PAYPAL-REFUND-01", captureId, status: "SUCCEEDED" as const,
        amountCents, currency: "EUR" as const, occurredAt: new Date("2026-08-22T12:00:00Z"),
      };
    },
    async retrieveRefund() { throw new Error("not expected"); },
  } satisfies PaypalGateway & PaypalRefundGateway;
  const gateway = createRefundProviderGateway("PAYPAL", { paypal });
  await gateway.request({
    paymentId: reserved.paymentId, attemptId: reserved.id, providerPaymentId: reserved.providerPaymentId,
    amountCents: reserved.amountCents, idempotencyKey: reserved.providerIdempotencyKey,
  });
  assert.deepEqual(request, {
    captureId: reserved.providerPaymentId,
    amountCents: 1_500,
    idempotencyKey: reserved.providerIdempotencyKey,
  });
});

test("PayPal Sandbox refund API uses exact EUR and the persistent Request ID", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const gateway = createTestPaypalGateway({
    provider: "paypal", enabled: true, configured: true, environment: "sandbox",
    clientId: "paypal-client-fixture", clientSecret: "paypal-secret-fixture", webhookId: "paypal-webhook-fixture",
  }, async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const body = String(input).endsWith("/v1/oauth2/token")
      ? { access_token: "access-token-fixture", token_type: "Bearer" }
      : {
          id: "PAYPAL-REFUND-01", status: "PENDING", amount: { currency_code: "EUR", value: "15.00" },
          update_time: "2026-08-22T12:00:00Z",
          links: [{ rel: "up", method: "GET", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/PAYPAL-CAPTURE-01" }],
        };
    return new Response(JSON.stringify(body), { status: String(input).endsWith("/v1/oauth2/token") ? 200 : 202 });
  });
  const evidence = await gateway.refundCapture("PAYPAL-CAPTURE-01", 1_500, "refund:paypal:persistent-01");
  assert.equal(evidence.status, "PENDING");
  assert.equal(calls[1]?.url, "https://api-m.sandbox.paypal.com/v2/payments/captures/PAYPAL-CAPTURE-01/refund");
  assert.equal(new Headers(calls[1]?.init.headers).get("PayPal-Request-Id"), "refund:paypal:persistent-01");
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), { amount: { currency_code: "EUR", value: "15.00" } });
});

test("the PayPal Live adapter refuses a refund before OAuth when the Live gate is closed", async () => {
  let fetchCalls = 0;
  const gateway = createTestPaypalGateway({
    provider: "paypal",
    enabled: true,
    configured: true,
    environment: "live",
    clientId: "paypal-live-client-fixture",
    clientSecret: "paypal-live-secret-fixture",
    webhookId: "paypal-live-webhook-fixture",
  }, async () => {
    fetchCalls += 1;
    throw new Error("network must remain unreachable");
  });

  await assert.rejects(
    gateway.refundCapture("PAYPAL-LIVE-CAPTURE-01", 1_500, "refund:paypal:live-gated"),
    (error: unknown) => error instanceof PaypalClientError && error.code === "UNAVAILABLE",
  );
  assert.equal(fetchCalls, 0);
});

test("the PayPal Live adapter uses the Live endpoint only when its composed gate is armed", async () => {
  const calls: string[] = [];
  const gateway = createTestPaypalGateway({
    provider: "paypal",
    enabled: true,
    configured: true,
    environment: "live",
    clientId: "paypal-live-client-fixture",
    clientSecret: "paypal-live-secret-fixture",
    webhookId: "paypal-live-webhook-fixture",
  }, async (input) => {
    calls.push(String(input));
    return String(input).endsWith("/v1/oauth2/token")
      ? new Response(JSON.stringify({ access_token: "access-token-fixture", token_type: "Bearer" }), { status: 200 })
      : new Response(JSON.stringify({
          id: "PAYPAL-LIVE-REFUND-01",
          status: "COMPLETED",
          amount: { currency_code: "EUR", value: "15.00" },
          update_time: "2026-09-01T12:00:00Z",
          links: [{ rel: "up", method: "GET", href: "https://api-m.paypal.com/v2/payments/captures/PAYPAL-LIVE-CAPTURE-01" }],
        }), { status: 201 });
  }, true);

  const evidence = await gateway.refundCapture(
    "PAYPAL-LIVE-CAPTURE-01",
    1_500,
    "refund:paypal:live-armed-fixture",
  );
  assert.equal(evidence.status, "SUCCEEDED");
  assert.deepEqual(calls, [
    "https://api-m.paypal.com/v1/oauth2/token",
    "https://api-m.paypal.com/v2/payments/captures/PAYPAL-LIVE-CAPTURE-01/refund",
  ]);
});

test("PayPal refund HTTP failures are classified without provider payload leakage", async () => {
  const expected = new Map<number, PaypalClientError["code"]>([
    [400, "INVALID_REQUEST"], [401, "AUTHENTICATION"], [403, "AUTHENTICATION"], [409, "CONFLICT"],
    [422, "NOT_APPROVED"], [429, "RATE_LIMITED"], [500, "UNAVAILABLE"],
  ]);
  for (const [status, code] of expected) {
    const gateway = createTestPaypalGateway({
      provider: "paypal", enabled: true, configured: true, environment: "sandbox",
      clientId: "paypal-client-fixture", clientSecret: "paypal-secret-fixture", webhookId: "paypal-webhook-fixture",
    }, async (input) => String(input).endsWith("/v1/oauth2/token")
      ? new Response(JSON.stringify({ access_token: "access-token-fixture", token_type: "Bearer" }), { status: 200 })
      : new Response(JSON.stringify({ details: [{ issue: "provider-private-detail" }] }), { status }));
    await assert.rejects(
      gateway.refundCapture("PAYPAL-CAPTURE-01", 1_500, `refund:paypal:http-${status}`),
      (error: unknown) => error instanceof PaypalClientError
        && error.code === code
        && !error.message.includes("provider-private-detail"),
    );
  }
});

test("the Stripe adapter passes exact cents, metadata and the persistent idempotency key", async () => {
  let request: unknown;
  const stripe = {
    async refundPaymentIntent(paymentIntentId, amountCents, idempotencyKey, metadata) {
      request = { paymentIntentId, amountCents, idempotencyKey, metadata };
      return {
        providerRefundId: "re_test_01", paymentIntentId, status: "SUCCEEDED" as const,
        amountCents, currency: "EUR" as const, occurredAt: new Date("2026-08-22T12:00:00Z"),
      };
    },
    async retrieveRefund() { throw new Error("not expected"); },
  } satisfies StripeRefundGateway;
  const gateway = createRefundProviderGateway("STRIPE", { stripe });
  await gateway.request({
    paymentId: reserved.paymentId, attemptId: reserved.id, providerPaymentId: "pi_test_01",
    amountCents: 1_500, idempotencyKey: "refund:stripe:persistent-01",
  });
  assert.deepEqual(request, {
    paymentIntentId: "pi_test_01", amountCents: 1_500, idempotencyKey: "refund:stripe:persistent-01",
    metadata: { paymentId: reserved.paymentId, refundAttemptId: reserved.id },
  });
});

test("the Stripe Live adapter blocks before mutation unless its composed gate is armed", async () => {
  let requests = 0;
  const client = {
    refunds: {
      async create(params: { payment_intent?: string; amount?: number }, options: { idempotencyKey?: string }) {
        requests += 1;
        return {
          id: "re_live_fixture_01",
          object: "refund" as const,
          amount: params.amount ?? 0,
          balance_transaction: null,
          charge: null,
          created: 1_788_264_000,
          currency: "eur" as const,
          customer: null,
          customer_account: null,
          destination_details: null,
          metadata: {},
          payment_intent: params.payment_intent ?? null,
          payment_method: null,
          pending_reason: null,
          reason: null,
          receipt_number: null,
          source_transfer_reversal: null,
          status: "succeeded" as const,
          transfer_reversal: null,
          next_action: null,
          failure_balance_transaction: null,
          failure_reason: null,
          instructions_email: null,
          description: null,
          requestId: options.idempotencyKey,
        };
      },
      async retrieve() { throw new Error("not expected"); },
    },
  } as unknown as Parameters<typeof createTestStripeRefundGateway>[0];
  const closed = createTestStripeRefundGateway(client, "live", false);
  await assert.rejects(
    closed.refundPaymentIntent("pi_live_fixture_01", 1_500, "refund:stripe:closed", {
      paymentId: reserved.paymentId,
      refundAttemptId: reserved.id,
    }),
  );
  assert.equal(requests, 0);

  const armed = createTestStripeRefundGateway(client, "live", true);
  const evidence = await armed.refundPaymentIntent("pi_live_fixture_01", 1_500, "refund:stripe:armed", {
    paymentId: reserved.paymentId,
    refundAttemptId: reserved.id,
  });
  assert.equal(evidence.status, "SUCCEEDED");
  assert.equal(requests, 1);
});

test("only documented PayPal and Stripe financial webhook names are routed", () => {
  for (const name of [
    "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED", "PAYMENT.REFUND.PENDING", "PAYMENT.REFUND.FAILED",
    "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED",
  ]) assert.equal(isPaypalFinancialEvent(name), true);
  assert.equal(isPaypalFinancialEvent("PAYMENT.REFUND.COMPLETED"), false);
  for (const name of ["refund.created", "refund.updated", "refund.failed", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]) {
    assert.equal(isStripeFinancialEvent(name), true);
  }
  assert.equal(isStripeFinancialEvent("refund.succeeded"), false);
});

test("financial webhook normalizers reject wrong currency and amount while preserving signed live mode", () => {
  const stripe = {
    id: "evt_refund_01", type: "refund.updated", livemode: false, created: 1_787_398_400,
    data: { object: { id: "re_test_01", object: "refund", payment_intent: "pi_test_01", amount: 1_500, currency: "eur", status: "succeeded" } },
  } as const;
  assert.equal(normalizeStripeRefundEvent(stripe)?.status, "SUCCEEDED");
  assert.equal(normalizeStripeRefundEvent({ ...stripe, livemode: true })?.eventId, stripe.id);
  assert.equal(normalizeStripeRefundEvent({ ...stripe, data: { object: { ...stripe.data.object, currency: "usd" } } }), null);
  assert.equal(normalizeStripeRefundEvent({ ...stripe, data: { object: { ...stripe.data.object, amount: 1.5 } } }), null);
  assert.equal(stripeFinancialProviderPaymentId({
    ...stripe,
    data: { object: { ...stripe.data.object, currency: "usd", amount: "invalid" } },
  }), "pi_test_01");
  const paypal = {
    id: "WH-REFUND-01", event_type: "PAYMENT.REFUND.PENDING", create_time: "2026-08-22T12:00:00Z",
    resource: {
      id: "PAYPAL-REFUND-01", status: "PENDING", amount: { currency_code: "EUR", value: "15.00" },
      update_time: "2026-08-22T12:00:00Z",
      links: [{ rel: "up", method: "GET", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/PAYPAL-CAPTURE-01" }],
    },
  } as const;
  assert.equal(normalizePaypalRefundEvent(paypal)?.amountCents, 1_500);
  assert.equal(normalizePaypalRefundEvent({ ...paypal, resource: { ...paypal.resource, amount: { currency_code: "USD", value: "15.00" } } }), null);
  const malformedPaypal = {
    ...paypal,
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: { ...paypal.resource, amount: { currency_code: "USD", value: "invalid" } },
  };
  assert.equal(paypalFinancialProviderPaymentId(malformedPaypal), "PAYPAL-CAPTURE-01");
  assert.equal(captureIdFromRefundResource({
    links: [{
      rel: "up",
      method: "GET",
      href: "https://attacker.invalid/v2/payments/captures/PAYPAL-CAPTURE-01",
    }],
  }), null);
  assert.equal(captureIdFromRefundResource({
    links: [{
      rel: "up",
      method: "POST",
      href: "https://api-m.sandbox.paypal.com/v2/payments/captures/PAYPAL-CAPTURE-01",
    }],
  }), null);
});

test("PayPal reversals and disputes remain separate stable incidents", () => {
  const reversed = normalizePaypalIncidentEvent({
    id: "WH-REVERSAL-01", event_type: "PAYMENT.CAPTURE.REVERSED", create_time: "2026-08-22T12:00:00Z",
    resource: { id: "PAYPAL-CAPTURE-01", amount: { currency_code: "EUR", value: "15.00" } },
  });
  assert.equal(reversed?.incidentType, "REVERSAL");
  assert.equal(reversed?.providerIncidentId, "reversal:PAYPAL-CAPTURE-01");
  const dispute = normalizePaypalIncidentEvent({
    id: "WH-DISPUTE-01", event_type: "CUSTOMER.DISPUTE.RESOLVED", create_time: "2026-08-22T12:00:00Z",
    resource: {
      dispute_id: "PP-D-01", status: "RESOLVED", dispute_life_cycle_stage: "CHARGEBACK",
      disputed_transactions: [{ seller_transaction_id: "PAYPAL-CAPTURE-01" }],
      dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" },
    },
  });
  assert.equal(dispute?.incidentType, "CHARGEBACK");
  assert.equal(dispute?.status, "RESOLVED");
  assert.equal(dispute?.outcome, "SELLER_FAVOUR");
  assert.equal(paypalFinancialProviderPaymentId({
    id: "WH-DISPUTE-MALFORMED",
    event_type: "CUSTOMER.DISPUTE.UPDATED",
    create_time: "invalid-date",
    resource: {
      dispute_id: "PP-D-02",
      disputed_transactions: [{ seller_transaction_id: "PAYPAL-CAPTURE-02" }],
    },
  }), "PAYPAL-CAPTURE-02");
});

test("Stripe dispute normalization preserves Payment mapping without changing business state", () => {
  const incident = normalizeStripeIncidentEvent({
    id: "evt_dispute_01", type: "charge.dispute.closed", livemode: false, created: 1_787_398_400,
    data: { object: { id: "dp_test_01", object: "dispute", payment_intent: "pi_test_01", amount: 1_500, currency: "eur", status: "won" } },
  });
  assert.equal(incident?.providerPaymentId, "pi_test_01");
  assert.equal(incident?.status, "RESOLVED");
  assert.equal(incident?.outcome, "SELLER_FAVOUR");
});

test("an Admin refund uses the reserved attempt once and reconciles provider evidence", async () => {
  const fixture = dependencies();
  const result = await requestRefundForOrder(admin, {
    orderNumber: "LNX-2026-000001", kind: "PARTIAL", amountCents: 1_500,
    requestToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  }, fixture.value);
  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(fixture.evidence(), {
    provider: "PAYPAL", providerRefundId: "REFUND-01", providerPaymentId: "PAYPAL-CAPTURE-01",
    status: "SUCCEEDED", amountCents: 1_500, currency: "EUR", occurredAt: new Date("2026-08-22T12:00:00Z"),
  });
});

test("the Live gate refuses a new refund before repository or provider activity", async () => {
  const base = dependencies();
  let repositoryCalls = 0;
  let gatewayCalls = 0;
  const fixture = dependencies({
    repository: {
      ...base.value.repository,
      async reserve() {
        repositoryCalls += 1;
        return { ...reserved, mode: "LIVE" as const };
      },
    },
    gateway: (provider) => {
      gatewayCalls += 1;
      return base.value.gateway(provider);
    },
    assertRuntime: async () => ({ mode: "LIVE", liveRefundsEnabled: false }),
  });

  await assert.rejects(
    requestRefundForOrder(admin, {
      orderNumber: "LNX-2026-000001",
      kind: "FULL",
      requestToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }, fixture.value),
    (error: unknown) => error instanceof RefundServiceError
      && error.code === "LIVE_REFUNDS_DISABLED"
      && error.status === 403,
  );
  assert.equal(repositoryCalls, 0);
  assert.equal(gatewayCalls, 0);
});

test("Stripe and PayPal are never reached when the repository rejects a missing source invoice", async () => {
  for (const provider of ["STRIPE", "PAYPAL"] as const) {
    const base = dependencies();
    let providerCalls = 0;
    const fixture = dependencies({
      repository: {
        ...base.value.repository,
        async reserve() {
          throw new RefundServiceError(409, "REFUND_SOURCE_INVOICE_REQUIRED");
        },
      },
      gateway: () => ({
        async request() {
          providerCalls += 1;
          throw new Error(`${provider} must remain unreachable`);
        },
        async retrieve() {
          providerCalls += 1;
          throw new Error(`${provider} must remain unreachable`);
        },
      }),
    });
    await assert.rejects(
      requestRefundForOrder(admin, {
        orderNumber: "LNX-2026-000001",
        kind: "FULL",
        requestToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      }, fixture.value),
      (error: unknown) => error instanceof RefundServiceError
        && error.code === "REFUND_SOURCE_INVOICE_REQUIRED",
    );
    assert.equal(providerCalls, 0, `${provider} received an unexpected call`);
  }
});

test("the invoice guard is inside the repository and precedes RefundAttempt creation", async () => {
  const source = await readFile(new URL("../../lib/payments/refund.ts", import.meta.url), "utf8");
  const repository = source.slice(source.indexOf("export function createRefundDatabaseRepository"), source.indexOf("export function createRefundProviderGateway"));
  const guard = repository.indexOf("assertRefundSourceInvoice(payment.invoice)");
  const attempt = repository.indexOf("transaction.refundAttempt.create");
  assert.ok(guard > 0);
  assert.ok(attempt > guard);
  assert.match(repository, /invoice: \{ select: \{ id: true \} \}/);
});

test("an explicit Live opt-in preserves the existing refund path", async () => {
  const base = dependencies();
  let repositoryCalls = 0;
  let providerCalls = 0;
  const fixture = dependencies({
    repository: {
      ...base.value.repository,
      async reserve() {
        repositoryCalls += 1;
        return { ...reserved, mode: "LIVE" as const };
      },
    },
    gateway: () => ({
      async request(input) {
        providerCalls += 1;
        return {
          provider: "PAYPAL",
          providerRefundId: "REFUND-LIVE-01",
          providerPaymentId: input.providerPaymentId,
          status: "SUCCEEDED",
          amountCents: input.amountCents,
          currency: "EUR",
          occurredAt: new Date("2026-08-22T12:00:00Z"),
        };
      },
      async retrieve() { throw new Error("not expected"); },
    }),
    assertRuntime: async () => ({ mode: "LIVE", liveRefundsEnabled: true, liveRefundsArmed: true }),
  });

  const result = await requestRefundForOrder(admin, {
    orderNumber: "LNX-2026-000001",
    kind: "FULL",
    requestToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    liveConfirmation: "CONFIRM_LIVE_FINANCIAL_REFUND",
  }, fixture.value);
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(repositoryCalls, 1);
  assert.equal(providerCalls, 1);
});

test("the Live gate refuses Admin reconciliation before lookup, claim or provider activity", async () => {
  const base = dependencies();
  let repositoryCalls = 0;
  let gatewayCalls = 0;
  const fixture = dependencies({
    repository: {
      ...base.value.repository,
      async get() {
        repositoryCalls += 1;
        return { ...reserved, mode: "LIVE" as const };
      },
      async claim() {
        repositoryCalls += 1;
        return true;
      },
    },
    gateway: (provider) => {
      gatewayCalls += 1;
      return base.value.gateway(provider);
    },
    assertRuntime: async () => ({ mode: "LIVE", liveRefundsEnabled: false }),
  });

  await assert.rejects(
    reconcileRefundAttemptForAdmin(
      admin,
      reserved.id,
      fixture.value,
      "CONFIRM_LIVE_REFUND_RECONCILIATION",
    ),
    (error: unknown) => error instanceof RefundServiceError
      && error.code === "LIVE_REFUNDS_DISABLED",
  );
  assert.equal(repositoryCalls, 0);
  assert.equal(gatewayCalls, 0);
});

test("MEMBER and malformed requests are refused before any provider call", async () => {
  const fixture = dependencies();
  const member = { ...admin, role: "MEMBER" as const };
  await assert.rejects(
    requestRefundForOrder(member, {
      orderNumber: "LNX-2026-000001", kind: "FULL", requestToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }, fixture.value),
    (error: unknown) => error instanceof RefundServiceError && error.status === 403,
  );
});

test("provider timeout enters reconciliation and never creates a second logical attempt", async () => {
  const fixture = dependencies({
    gateway: () => ({
      async request() { throw new PaypalClientError("UNAVAILABLE"); },
      async retrieve() { throw new Error("not expected"); },
    }),
  });
  await assert.rejects(
    requestRefundForOrder(admin, {
      orderNumber: "LNX-2026-000001", kind: "FULL", requestToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }, fixture.value),
    (error: unknown) => error instanceof RefundServiceError && error.code === "REFUND_PROVIDER_UNAVAILABLE",
  );
  assert.deepEqual(fixture.failure(), { code: "REFUND_PROVIDER_UNAVAILABLE", review: true });
});

test("a reused ambiguous attempt without provider id never issues a blind provider retry", async () => {
  const base = dependencies();
  let providerCalls = 0;
  let claimCalls = 0;
  const fixture = dependencies({
    repository: {
      ...base.value.repository,
      async reserve() {
        return { ...reserved, reused: true, status: "REQUIRES_REVIEW" as const };
      },
      async claim() {
        claimCalls += 1;
        return true;
      },
    },
    gateway: () => ({
      async request() { providerCalls += 1; throw new Error("must not run"); },
      async retrieve() { providerCalls += 1; throw new Error("must not run"); },
    }),
  });

  const result = await requestRefundForOrder(admin, {
    orderNumber: "LNX-2026-000001",
    kind: "FULL",
    requestToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  }, fixture.value);
  assert.deepEqual(result, { attemptId: reserved.id, status: "REQUIRES_REVIEW" });
  assert.equal(claimCalls, 0);
  assert.equal(providerCalls, 0);
});

test("Admin reconciliation without a provider refund id records review without mutation", async () => {
  const base = dependencies();
  let providerCalls = 0;
  let reconciliation: string | undefined;
  const fixture = dependencies({
    repository: {
      ...base.value.repository,
      async recordReconciliation(_attemptId, _actor, status) { reconciliation = status; },
    },
    gateway: () => ({
      async request() { providerCalls += 1; throw new Error("must not run"); },
      async retrieve() { providerCalls += 1; throw new Error("must not run"); },
    }),
  });

  const result = await reconcileRefundAttemptForAdmin(admin, reserved.id, fixture.value);
  assert.deepEqual(result, { status: "REQUIRES_REVIEW", confirmed: false });
  assert.equal(reconciliation, "REQUIRES_REVIEW");
  assert.equal(providerCalls, 0);
});

test("a database failure after provider success enters review on the same attempt", async () => {
  const base = dependencies();
  let providerCalls = 0;
  const fixture = dependencies({
    repository: {
      ...base.value.repository,
      async applyEvidence() { throw new Error("database unavailable after provider response"); },
    },
    gateway: () => ({
      async request(input) {
        providerCalls += 1;
        return {
          provider: "PAYPAL", providerRefundId: "REFUND-DB-FAIL", providerPaymentId: input.providerPaymentId,
          status: "SUCCEEDED", amountCents: input.amountCents, currency: "EUR", occurredAt: new Date("2026-08-22T12:00:00Z"),
        };
      },
      async retrieve() { throw new Error("not expected"); },
    }),
  });
  await assert.rejects(requestRefundForOrder(admin, {
    orderNumber: "LNX-2026-000001", kind: "FULL", requestToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  }, fixture.value), RefundServiceError);
  assert.equal(providerCalls, 1);
  assert.deepEqual(base.failure(), { code: "REFUND_PROVIDER_UNAVAILABLE", review: true });
});

test("Admin refund mutations reuse origin, session and closed confirmation guards", async () => {
  const actions = await readFile(new URL("../../app/admin/actions.ts", import.meta.url), "utf8");
  for (const action of ["requestPaymentRefundAction", "reconcilePaymentRefundAction"]) {
    const body = actions.match(new RegExp(`export async function ${action}\\([^]*?\\n\\}`, "m"))?.[0] ?? "";
    assert.match(body, /await authorizeAdminAction\(\)/);
    assert.doesNotMatch(body, /formData\.get\("provider"\)/);
    assert.doesNotMatch(body, /formData\.get\("currency"\)/);
  }
  assert.match(actions, /await requestRefundForOrder\(/);
  assert.match(actions, /await reconcileRefundAttemptForAdmin\(/);
  assert.match(actions, /LIVE_REFUND_CONFIRMATION/);
  assert.match(actions, /LIVE_REFUND_RECONCILIATION_CONFIRMATION/);
  assert.match(actions, /REFUND_SOURCE_INVOICE_REQUIRED[\s\S]*remboursement-facture-requise/);
  const page = await readFile(new URL("../../app/admin/commandes/[orderNumber]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Facture source[\s\S]*Absente — remboursement interdit/);
  assert.match(page, /remboursement-facture-requise/);
});

test("the Admin UI hides Live refund mutations behind the server configuration while preserving TEST", async () => {
  const page = await readFile(
    new URL("../../app/admin/commandes/[orderNumber]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /evaluateLiveRefundProductionPolicy\(process\.env, paymentsConfiguration\)/);
  assert.match(page, /liveRefundsEnabled = evaluateLiveRefundProductionPolicy\(process\.env, paymentsConfiguration\)\.armed/);
  assert.match(page, /payment\.mode === "LIVE" && !liveRefundsEnabled/);
  assert.match(page, /Remboursements Live désactivés/);
  assert.match(page, /payment\.mode === "TEST" && \["SUCCEEDED", "PARTIALLY_REFUNDED"\]/);
  assert.match(page, /payment\.mode === "LIVE" && \["SUCCEEDED", "PARTIALLY_REFUNDED"\][^\n]+\? liveRefundsEnabled \?/);
});

test("provider adapters enforce the Live mutation gate while inbound financial webhooks stay open", async () => {
  const [stripe, paypal, inbound] = await Promise.all([
    readFile(new URL("../../lib/payments/stripe-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/payments/paypal-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/payments/provider-financial-events.ts", import.meta.url), "utf8"),
  ]);
  assert.match(stripe, /mode === "live" && !liveRefundsArmed/);
  assert.match(stripe, /stripe\.refunds\.create/);
  assert.match(paypal, /configuration\.environment === "live" && !liveRefundsEnabled/);
  assert.match(paypal, /\/v2\/payments\/captures\/\$\{encodeURIComponent\(captureId\)\}\/refund/);
  assert.doesNotMatch(inbound, /LIVE_REFUNDS_ENABLED|liveRefundsEnabled/);
});

test("Shop financial events arm review behind the same fulfillment lock without automatic refund", async () => {
  const [financialEvents, fulfillment] = await Promise.all([
    readFile(new URL("../../lib/payments/provider-financial-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/fulfillment-service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(financialEvents, /SHOP_PROVIDER_FINANCIAL_EVENT_REVIEW/);
  assert.match(financialEvents, /shop-payments:order:\$\{input\.shopOrderId\}/);
  assert.match(financialEvents, /FROM "shop_orders"[\s\S]*FOR UPDATE/);
  assert.match(financialEvents, /paymentReviewAt: order\.paymentReviewAt \?\? input\.occurredAt/);
  assert.match(financialEvents, /outcome: "REQUIRES_REVIEW"[\s\S]*paymentId: input\.paymentId/);
  assert.match(financialEvents, /category: "PROVIDER_FINANCIAL_EVENT"/);
  assert.match(fulfillment, /shop-payments:order:\$\{shopOrderId\}/);
  assert.match(fulfillment, /paymentReviewAt: null/);
  const reviewHelper = financialEvents.match(/async function recordShopFinancialReview[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(reviewHelper, /refundAttempt\.create|enqueueOrderNotification/);
});
