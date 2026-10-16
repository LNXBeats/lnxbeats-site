import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import Stripe from "stripe";
import { createDigitalStripeGateway, createDigitalPaypalGateway, verifiedDigitalStripeEvent, digitalStripeClient, digitalPaypalClient, assertDigitalRefundOperation } from "@/lib/digital/providers";
import type { DigitalMode } from "@/lib/digital/runtime-policy";
import type { DigitalRefundRequest } from "@/lib/digital/finance-policy";

// Every response below is a local double. All TCP/HTTP/HTTPS transports are
// trapped and PayPal fetch is replaced. No TEST/LIVE provider recipe is run.
const orderId = "c7a03dd8-e103-40fa-ac04-9c9aa421e758", attemptId = "458649b7-645c-46e0-afc5-dc0347d71fd3";
const refundId = "2640bdce-96ae-48a5-b1f3-5cd42f6b3a49", stripeMerchant = "acct_localFinanceQa", paypalMerchant = "MERCHANTQA";
const baseEnvironment = { DCN_ENABLED: "true", NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production", RAILWAY_ENVIRONMENT: "production",
  MEDIA_DEPLOYMENT_ENV: "production", PAYMENT_DEPLOYMENT_ENV: "production", DCN_STORAGE_MODE: "OBJECT",
  PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved", PAYMENTS_ENABLED: "true", DCN_NEW_PAYMENTS_ENABLED: "false", DCN_LOCAL_REVIEW_AUTHORIZED: "false",
  DCN_RECOVERY_EXCERPTS_REVIEW_ONLY: "false", DCN_EXTERNAL_TEST_AUTHORIZED: "false", LIVE_REFUNDS_ENABLED: "true",
  LIVE_REFUNDS_PRODUCTION_CONFIRM: "enable-production-live-refunds", AUTH_URL: "https://www.lnxbeats.fr",
  DCN_STRIPE_ACCOUNT_ID: stripeMerchant, DCN_STRIPE_WEBHOOK_SECRET: "whsec_LOCAL_DUMMY_ONLY",
  DCN_PAYPAL_CLIENT_ID: "paypal-client-fixture", DCN_PAYPAL_CLIENT_SECRET: "paypal-secret-fixture",
  DCN_PAYPAL_WEBHOOK_ID: "paypal-webhook-fixture", DCN_PAYPAL_MERCHANT_ID: paypalMerchant };
let mode: DigitalMode = "LIVE", provider = "STRIPE", orderMode = "LIVE", sqlReads = 0;
const metadata = () => ({ paymentSource: "DIGITAL_MUSIC", mode, digitalOrderId: orderId, digitalAttemptId: attemptId });
const fakeDb = { digitalOrder: { async findUniqueOrThrow() { sqlReads++; return { id: orderId, mode: orderMode, totalCents: 990,
  attempts: [{ id: attemptId, provider, status: "PAID", paymentReference: provider === "STRIPE" ? "pi_localFinanceQa" : "CAPTUREQA",
    providerReference: provider === "STRIPE" ? "cs_localFinanceQa" : "ORDERQA" }] }; } } };
Object.assign(globalThis, { prisma: fakeDb });
const { digitalFinanceGateway } = await import("@/lib/digital/finance-providers");
function setup(t: TestContext, selectedProvider = "STRIPE", selectedMode: DigitalMode = "LIVE") {
  const values: Record<string, string> = { ...baseEnvironment, DCN_MODE: selectedMode,
    DCN_STRIPE_SECRET_KEY: selectedMode === "LIVE" ? "sk_live_LOCAL_DUMMY_ONLY" : "sk_test_LOCAL_DUMMY_ONLY",
    DCN_PAYPAL_ENVIRONMENT: selectedMode === "LIVE" ? "live" : "sandbox" };
  if (selectedMode === "TEST") Object.assign(values, { NODE_ENV: "test", RAILWAY_ENVIRONMENT_NAME: "local-finance-qa", RAILWAY_ENVIRONMENT: "local",
    MEDIA_DEPLOYMENT_ENV: "local", PAYMENT_DEPLOYMENT_ENV: "development", DCN_STORAGE_MODE: "LOCAL", DCN_EXTERNAL_TEST_AUTHORIZED: "true" });
  const old = new Map(Object.keys(values).map(k => [k, process.env[k]])); Object.assign(process.env, values);
  mode = selectedMode; provider = selectedProvider; orderMode = selectedMode; sqlReads = 0;
  t.after(() => { for (const [k, v] of old) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const tcp = t.mock.method(net.Socket.prototype, "connect", () => { throw Error("Unexpected TCP connection"); });
  const plain = t.mock.method(http, "request", () => { throw Error("Unexpected HTTP request"); });
  const tls = t.mock.method(https, "request", () => { throw Error("Unexpected HTTPS request"); });
  return () => { assert.equal(tcp.mock.calls.length, 0); assert.equal(plain.mock.calls.length, 0); assert.equal(tls.mock.calls.length, 0); };
}
function request(selectedProvider = "STRIPE"): DigitalRefundRequest { return { id: refundId, orderId, provider: selectedProvider,
  paymentReference: selectedProvider === "STRIPE" ? "pi_localFinanceQa" : "CAPTUREQA", providerReference: null,
  idempotencyKey: "local-live-finance-fixture", amountCents: 200 }; }
const stripeRefund = () => ({ id: "re_localFinanceQa", object: "refund", payment_intent: "pi_localFinanceQa", charge: "ch_localFinanceQa",
  livemode: mode === "LIVE", amount: 200, currency: "eur", status: "succeeded", metadata: { ...metadata(), digitalRefundId: refundId } });
type AsyncMethod = (...args: unknown[]) => Promise<unknown>;
const resources = Stripe.resources as unknown as {
  Accounts: { prototype: { retrieve: AsyncMethod } }; PaymentIntents: { prototype: { retrieve: AsyncMethod } };
  Refunds: { prototype: { create: AsyncMethod; retrieve: AsyncMethod; list: AsyncMethod } };
};
function stripeDoubles(t: TestContext, afterVerification?: () => void) {
  const account = t.mock.method(resources.Accounts.prototype, "retrieve", async () => ({ id: stripeMerchant, charges_enabled: true }));
  t.mock.method(resources.PaymentIntents.prototype, "retrieve", async () => { afterVerification?.(); return { id: "pi_localFinanceQa",
    livemode: mode === "LIVE", currency: "eur", amount_received: 990, metadata: metadata() }; });
  const create = t.mock.method(resources.Refunds.prototype, "create", async () => stripeRefund());
  t.mock.method(resources.Refunds.prototype, "retrieve", async () => stripeRefund());
  t.mock.method(resources.Refunds.prototype, "list", async () => ({ data: [stripeRefund()], has_more: false }));
  return { account, create };
}
function paypalDoubles(t: TestContext, approved = false, afterVerification?: () => void) {
  const calls: Array<{ url: string; method: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input), method = init.method ?? "GET"; calls.push({ url, method });
    const origin = mode === "LIVE" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    assert.ok(url.startsWith(`${origin}/`)); let body: unknown;
    if (url.endsWith("/v1/oauth2/token")) body = { access_token: "access-token-fixture", token_type: "Bearer", expires_in: 3600 };
    else if (url.endsWith("/v2/checkout/orders/ORDERQA")) {
      afterVerification?.(); body = { id: "ORDERQA", status: approved ? "APPROVED" : "COMPLETED", purchase_units: [{ reference_id: orderId,
        custom_id: attemptId, payee: { merchant_id: paypalMerchant }, amount: { value: "9.90", currency_code: "EUR" },
        payments: { captures: approved ? [] : [{ id: "CAPTUREQA", amount: { value: "9.90", currency_code: "EUR" } }], refunds: [{ id: "REFUNDQA" }] } }] };
    } else if (url.endsWith("/v2/payments/captures/CAPTUREQA/refund") || url.endsWith("/v2/payments/refunds/REFUNDQA")) {
      body = { id: "REFUNDQA", status: "COMPLETED", amount: { value: "2.00", currency_code: "EUR" }, update_time: "2026-10-16T12:00:00Z",
        links: [{ rel: "up", method: "GET", href: `${origin}/v2/payments/captures/CAPTUREQA` }] };
    } else throw Error("Unexpected fake PayPal operation");
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}
for (const selectedMode of ["TEST", "LIVE"] as const) {
  test(`Stripe ${selectedMode} scoped refund uses the existing authorization and exact idempotent request`, async t => {
    const noNetwork = setup(t, "STRIPE", selectedMode), { create } = stripeDoubles(t);
    const evidence = await digitalFinanceGateway("STRIPE", selectedMode).refund(request());
    assert.equal(evidence.mode, selectedMode); assert.equal(evidence.reference, "re_localFinanceQa"); assert.equal(evidence.amountCents, 200);
    assert.equal(create.mock.calls.length, 1);
    assert.deepEqual(create.mock.calls[0].arguments, [{ payment_intent: "pi_localFinanceQa", amount: 200,
      metadata: { ...metadata(), digitalRefundId: refundId } }, { idempotencyKey: "local-live-finance-fixture" }]); noNetwork();
  });
  test(`PayPal ${selectedMode} scoped refund remains possible with the existing authorization`, async t => {
    const noNetwork = setup(t, "PAYPAL", selectedMode), calls = paypalDoubles(t);
    const evidence = await digitalFinanceGateway("PAYPAL", selectedMode).refund(request("PAYPAL"));
    assert.equal(evidence.mode, selectedMode); assert.equal(evidence.reference, "REFUNDQA"); assert.equal(evidence.amountCents, 200);
    assert.equal(calls.filter(c => c.url.endsWith("/refund") && c.method === "POST").length, 1); noNetwork();
  });
}
for (const selectedProvider of ["STRIPE", "PAYPAL"]) {
  test(`${selectedProvider} LIVE refund without existing operational authorization refuses before DB/OAuth`, async t => {
    const noNetwork = setup(t, selectedProvider); process.env.LIVE_REFUNDS_ENABLED = "false";
    const outbound = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected fetch"); });
    await assert.rejects(digitalFinanceGateway(selectedProvider, "LIVE").refund(request(selectedProvider)), { code: "LIVE_REFUNDS_NOT_ARMED" });
    assert.equal(sqlReads, 0); assert.equal(outbound.mock.calls.length, 0); noNetwork();
  });
  test(`${selectedProvider} LIVE refund preserves the existing global payment stop without cutting reads`, async t => {
    const noNetwork = setup(t, selectedProvider); process.env.PAYMENTS_ENABLED = "false";
    const outbound = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected fetch"); });
    await assert.rejects(digitalFinanceGateway(selectedProvider, "LIVE").refund(request(selectedProvider)), { code: "LIVE_REFUNDS_NOT_ARMED" });
    assert.equal(sqlReads, 0); assert.equal(outbound.mock.calls.length, 0); noNetwork();
  });
}
test("a configuration composed from the other provider mode cannot arm a TEST refund", t => {
  const noNetwork = setup(t, "STRIPE", "TEST"), stripe = digitalStripeClient(), paypal = digitalPaypalClient();
  assert.throws(() => assertDigitalRefundOperation("TEST", { ...stripe.configuration, mode: "live" }));
  assert.throws(() => assertDigitalRefundOperation("TEST", { ...paypal.configuration, environment: "live" }));
  assert.equal(sqlReads, 0); noNetwork();
});
test("Stripe rechecks existing LIVE refund authorization immediately before mutation", async t => {
  const noNetwork = setup(t), { create } = stripeDoubles(t, () => { process.env.LIVE_REFUNDS_ENABLED = "false"; });
  await assert.rejects(digitalFinanceGateway("STRIPE", "LIVE").refund(request()), { code: "LIVE_REFUNDS_NOT_ARMED" });
  assert.equal(create.mock.calls.length, 0); noNetwork();
});
test("PayPal rechecks existing LIVE refund authorization immediately before mutation", async t => {
  const noNetwork = setup(t, "PAYPAL"), calls = paypalDoubles(t, false, () => { process.env.LIVE_REFUNDS_ENABLED = "false"; });
  await assert.rejects(digitalFinanceGateway("PAYPAL", "LIVE").refund(request("PAYPAL")), { code: "LIVE_REFUNDS_NOT_ARMED" });
  assert.equal(calls.filter(c => c.url.endsWith("/refund")).length, 0); noNetwork();
});
test("LIVE Stripe read/recover stays possible with new sales and refund mutation disabled", async t => {
  const noNetwork = setup(t); process.env.LIVE_REFUNDS_ENABLED = "false"; process.env.PAYMENTS_ENABLED = "false"; const { create } = stripeDoubles(t);
  const gateway = digitalFinanceGateway("STRIPE", "LIVE");
  assert.equal((await gateway.readRefund(orderId, "re_localFinanceQa")).mode, "LIVE");
  assert.equal((await gateway.recoverRefund({ ...request(), providerReference: "re_localFinanceQa" }))?.mode, "LIVE");
  await assert.rejects(gateway.readRefund(orderId, "ch_localFinanceQa"), { code: "REFUND_EVIDENCE_INVALID" });
  assert.equal(create.mock.calls.length, 0); noNetwork();
});
test("LIVE PayPal read/recover stays possible with new sales and refund mutation disabled", async t => {
  const noNetwork = setup(t, "PAYPAL"); process.env.LIVE_REFUNDS_ENABLED = "false"; process.env.PAYMENTS_ENABLED = "false"; const calls = paypalDoubles(t);
  const gateway = digitalFinanceGateway("PAYPAL", "LIVE");
  assert.equal((await gateway.readRefund(orderId, "REFUNDQA")).mode, "LIVE");
  assert.equal((await gateway.recoverRefund({ ...request("PAYPAL"), providerReference: "REFUNDQA" }))?.mode, "LIVE");
  assert.equal(calls.filter(c => c.url.endsWith("/refund")).length, 0); noNetwork();
});
test("the immutable order mode is checked before any Stripe account or refund request", async t => {
  const noNetwork = setup(t), { account, create } = stripeDoubles(t); orderMode = "TEST";
  await assert.rejects(digitalFinanceGateway("STRIPE", "LIVE").refund(request()), { code: "PAYMENT_REQUIRES_REVIEW" });
  assert.equal(account.mock.calls.length, 0); assert.equal(create.mock.calls.length, 0); noNetwork();
});
test("closing new sales blocks Stripe create and PayPal capture but not authenticated reads", async t => {
  const noNetwork = setup(t), { account } = stripeDoubles(t);
  const order = { id: orderId, mode: "LIVE" as const, totalCents: 990, userEmail: "qa@example.invalid", lines: [{ title: "Synthetic album", priceCents: 990 }] };
  const attempt = { id: attemptId, provider: "STRIPE", providerReference: null, idempotencyKey: "local-create-fixture" };
  await assert.rejects(createDigitalStripeGateway("LIVE").create(order, attempt), { code: "NEW_DIGITAL_PAYMENTS_CLOSED" });
  assert.equal(account.mock.calls.length, 0);
  const calls = paypalDoubles(t, true);
  await assert.rejects(createDigitalPaypalGateway("LIVE").capture!(order, { ...attempt, provider: "PAYPAL", providerReference: "ORDERQA" }), { code: "NEW_DIGITAL_PAYMENTS_CLOSED" });
  assert.equal(calls.filter(c => /\/(?:capture|refund)$/.test(c.url)).length, 0); noNetwork();
});
test("a locally signed LIVE event remains verifiable with new sales closed, TEST/Connect events are refused", async t => {
  const noNetwork = setup(t), { account } = stripeDoubles(t);
  const signer = new Stripe("sk_live_LOCAL_DUMMY_ONLY"), secret = "whsec_LOCAL_DUMMY_ONLY";
  const body = (extra: Record<string, unknown>) => JSON.stringify({ id: "evt_localLiveQa", object: "event", type: "checkout.session.completed", data: { object: {} }, ...extra });
  const payload = body({ livemode: true });
  const result = await verifiedDigitalStripeEvent(payload, signer.webhooks.generateTestHeaderString({ payload, secret }));
  assert.equal(result.mode, "LIVE"); assert.equal(result.merchantId, stripeMerchant); assert.equal(account.mock.calls.length, 1);
  for (const extra of [{ livemode: false }, { livemode: true, account: "acct_otherQa" }]) {
    const invalid = body(extra); await assert.rejects(verifiedDigitalStripeEvent(invalid, signer.webhooks.generateTestHeaderString({ payload: invalid, secret })), { code: "INVALID_WEBHOOK" });
  }
  assert.equal(account.mock.calls.length, 1); noNetwork();
});
