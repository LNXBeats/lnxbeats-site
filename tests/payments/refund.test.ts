import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { OrderActor } from "@/lib/orders/domain";
import {
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
  isPaypalFinancialEvent,
  isStripeFinancialEvent,
  normalizePaypalIncidentEvent,
  normalizePaypalRefundEvent,
  normalizeStripeIncidentEvent,
  normalizeStripeRefundEvent,
} from "@/lib/payments/provider-financial-events";
import type { StripeRefundGateway } from "@/lib/payments/stripe-client";

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
    assertRuntime: async () => ({ mode: "LIVE", liveRefundsEnabled: true }),
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
});

test("the Admin UI hides Live refund mutations behind the server configuration while preserving TEST", async () => {
  const page = await readFile(
    new URL("../../app/admin/commandes/[orderNumber]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /const paymentsConfiguration = parsePaymentsConfiguration\(\)/);
  assert.match(page, /paymentsConfiguration\.enabled/);
  assert.match(page, /paymentsConfiguration\.deploymentEnvironment === "production"/);
  assert.match(page, /paymentsConfiguration\.liveRefundsEnabled === true/);
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
  assert.match(stripe, /configuration\.mode === "live" && !liveRefundsEnabled/);
  assert.match(stripe, /stripe\.refunds\.create/);
  assert.match(paypal, /configuration\.environment === "live" && !liveRefundsEnabled/);
  assert.match(paypal, /\/v2\/payments\/captures\/\$\{encodeURIComponent\(captureId\)\}\/refund/);
  assert.doesNotMatch(inbound, /LIVE_REFUNDS_ENABLED|liveRefundsEnabled/);
});
