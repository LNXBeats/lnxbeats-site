import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import { PAYMENT_PRODUCTION_CONFIRMATION } from "@/lib/payments/config";
import { digitalRuntimeMode, digitalProviderRequestsAllowed, digitalNewSalesAllowed, type DigitalMode } from "@/lib/digital/runtime-policy";
import { requireDigitalEnvironment, assertPaymentEvidence, checkoutProviderUrl, type DigitalPaymentEvidence } from "@/lib/digital/domain";
import { stripeDigitalEvidence, digitalStripeParameters } from "@/lib/digital/providers";
import { digitalPaypalOrderEvidence } from "@/lib/digital/paypal-evidence";
import { readStripeChargeRefunds, stripeRefundEvidence } from "@/lib/digital/stripe-refunds";

// Pure policies and in-memory authenticated-response doubles. No PSP, profile,
// credential, database, payment, real signature or external recipe is used.
const live = { DCN_ENABLED: "true", DCN_MODE: "LIVE", NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production",
  RAILWAY_ENVIRONMENT: "production", MEDIA_DEPLOYMENT_ENV: "production", PAYMENT_DEPLOYMENT_ENV: "production", DCN_STORAGE_MODE: "OBJECT",
  PAYMENT_PRODUCTION_CONFIRM: PAYMENT_PRODUCTION_CONFIRMATION, DCN_NEW_PAYMENTS_ENABLED: "false", PAYMENTS_ENABLED: "true" };
const testEnv = { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_EXTERNAL_TEST_AUTHORIZED: "true", DCN_NEW_PAYMENTS_ENABLED: "false" };
const orderId = "c7a03dd8-e103-40fa-ac04-9c9aa421e758", attemptId = "458649b7-645c-46e0-afc5-dc0347d71fd3";
const refundId = "2640bdce-96ae-48a5-b1f3-5cd42f6b3a49", merchant = "acct_localBoundaryQa";
const metadata = (mode: DigitalMode) => ({ paymentSource: "DIGITAL_MUSIC", mode, digitalOrderId: orderId, digitalAttemptId: attemptId });
function session(mode: DigitalMode) { return { id: "cs_localBoundaryQa", livemode: mode === "LIVE", client_reference_id: orderId, amount_total: 990,
  currency: "eur", payment_intent: "pi_localBoundaryQa", status: "complete", payment_status: "paid", metadata: metadata(mode) } as unknown as Stripe.Checkout.Session; }
const expected = (mode: DigitalMode) => ({ orderId, mode, attemptId, paymentReference: "pi_localBoundaryQa", merchantId: merchant, amountCents: 990 });
function refund(mode: DigitalMode) { return { id: "re_localBoundaryQa", object: "refund", payment_intent: "pi_localBoundaryQa", charge: "ch_localBoundaryQa",
  livemode: mode === "LIVE", currency: "eur", amount: 200, status: "succeeded",
  metadata: { ...metadata(mode), digitalRefundId: refundId } }; }
function charge(mode: DigitalMode) { return { id: "ch_localBoundaryQa", object: "charge", livemode: mode === "LIVE", payment_intent: "pi_localBoundaryQa",
  amount: 990, amount_captured: 990, amount_refunded: 200, currency: "eur", paid: true, captured: true, on_behalf_of: null, transfer_data: null }; }

test("runtime requires a coherent explicit mode and retains TEST production isolation", () => {
  assert.equal(digitalRuntimeMode(testEnv), "TEST"); assert.equal(digitalRuntimeMode(live), "LIVE");
  assert.equal(requireDigitalEnvironment(live), "LIVE");
  for (const patch of [{ DCN_MODE: undefined }, { DCN_MODE: "live" }, { DCN_MODE: "UNKNOWN" }, { DCN_ENABLED: "false" },
    { NODE_ENV: "development" }, { RAILWAY_ENVIRONMENT_NAME: "staging" }, { RAILWAY_ENVIRONMENT: "staging" },
    { MEDIA_DEPLOYMENT_ENV: "staging" }, { PAYMENT_DEPLOYMENT_ENV: "staging" }, { DCN_STORAGE_MODE: "LOCAL" },
    { PAYMENT_PRODUCTION_CONFIRM: undefined }, { DCN_EXTERNAL_TEST_AUTHORIZED: "true" }, { DCN_LOCAL_REVIEW_AUTHORIZED: "true" },
    { DCN_RECOVERY_EXCERPTS_REVIEW_ONLY: "true" }, { DCN_R4_FIXTURE: "true" }, { DCN_LOCAL_QA_FIXTURE: "true" }]) {
    assert.equal(digitalRuntimeMode({ ...live, ...patch }), null);
  }
  assert.equal(digitalRuntimeMode({ ...testEnv, PAYMENT_DEPLOYMENT_ENV: "production" }), null);
});
test("closing new sales leaves authorized provider reads and runtime available in both modes", () => {
  for (const [mode, env] of [["TEST", testEnv], ["LIVE", live]] as const) {
    assert.equal(digitalRuntimeMode(env), mode); assert.equal(digitalNewSalesAllowed(mode, env), false);
    assert.equal(digitalProviderRequestsAllowed(mode, env), true);
    assert.equal(digitalNewSalesAllowed(mode, { ...env, DCN_NEW_PAYMENTS_ENABLED: "true" }), true);
  }
  assert.equal(digitalProviderRequestsAllowed("TEST", { ...testEnv, DCN_EXTERNAL_TEST_AUTHORIZED: "false" }), false);
  assert.equal(digitalProviderRequestsAllowed("TEST", live), false); assert.equal(digitalProviderRequestsAllowed("LIVE", testEnv), false);
  const stopped = { ...live, DCN_NEW_PAYMENTS_ENABLED: "true", PAYMENTS_ENABLED: "false" };
  assert.equal(digitalNewSalesAllowed("LIVE", stopped), false); assert.equal(digitalProviderRequestsAllowed("LIVE", stopped), true);
});
test("PayPal return URLs and provider names are allowlisted per immutable mode", () => {
  assert.doesNotThrow(() => checkoutProviderUrl("https://www.paypal.com/checkoutnow?token=public-order-id", "PAYPAL", "LIVE"));
  assert.doesNotThrow(() => checkoutProviderUrl("https://www.sandbox.paypal.com/checkoutnow", "PAYPAL", "TEST"));
  for (const [url, mode] of [["https://www.sandbox.paypal.com/checkoutnow", "LIVE"], ["https://www.paypal.com/checkoutnow", "TEST"],
    ["https://www.paypal.com.attacker.invalid/", "LIVE"], ["http://www.paypal.com/", "LIVE"], ["https://person@www.paypal.com/", "LIVE"]] as const) {
    assert.throws(() => checkoutProviderUrl(url, "PAYPAL", mode));
  }
  assert.throws(() => checkoutProviderUrl("https://www.sandbox.paypal.com/", "OTHER", "TEST"));
});
test("payment proof mode must equal the immutable order mode, including LIVE", () => {
  const proof: DigitalPaymentEvidence = { eventId: "evt_localBoundaryQa", orderId, provider: "STRIPE", mode: "LIVE", providerReference: "cs_localBoundaryQa",
    paymentReference: "pi_localBoundaryQa", merchantId: merchant, amountCents: 990, currency: "EUR", status: "PAID", authenticated: true };
  const attempt = { provider: "STRIPE", providerReference: "cs_localBoundaryQa" };
  assert.doesNotThrow(() => assertPaymentEvidence(proof, { id: orderId, mode: "LIVE", totalCents: 990 }, attempt, merchant));
  assert.throws(() => assertPaymentEvidence(proof, { id: orderId, mode: "TEST", totalCents: 990 }, attempt, merchant));
  assert.throws(() => assertPaymentEvidence({ ...proof, mode: "TEST" }, { id: orderId, mode: "LIVE", totalCents: 990 }, attempt, merchant));
});
test("Stripe evidence requires exact livemode plus DCN metadata mode and keeps paid gating", () => {
  assert.equal(stripeDigitalEvidence(session("LIVE"), "evt_local", merchant, undefined, "LIVE").mode, "LIVE");
  assert.equal(stripeDigitalEvidence(session("TEST"), "evt_local", merchant).mode, "TEST");
  assert.throws(() => stripeDigitalEvidence(session("LIVE"), "evt_local", merchant));
  assert.throws(() => stripeDigitalEvidence(session("TEST"), "evt_local", merchant, undefined, "LIVE"));
  assert.throws(() => stripeDigitalEvidence({ ...session("LIVE"), metadata: metadata("TEST") }, "evt_local", merchant, undefined, "LIVE"));
  assert.equal(stripeDigitalEvidence({ ...session("LIVE"), payment_status: "unpaid" }, "evt_local", merchant, undefined, "LIVE").status, "PENDING");
});
test("Checkout metadata pins the supplied server mode, with legacy omission TEST only", () => {
  const old = process.env.AUTH_URL; process.env.AUTH_URL = "https://www.lnxbeats.fr";
  try {
    const order = { id: orderId, totalCents: 990, userEmail: "qa@example.invalid", lines: [{ title: "Synthetic album", priceCents: 990 }] };
    assert.equal(digitalStripeParameters(order, attemptId).metadata.mode, "TEST");
    assert.equal(digitalStripeParameters({ ...order, mode: "LIVE" }, attemptId).metadata.mode, "LIVE");
    process.env.AUTH_URL = "http://127.0.0.1:3140";
    assert.throws(() => digitalStripeParameters({ ...order, mode: "LIVE" }, attemptId), { code: "INVALID_BASE" });
  } finally { if (old === undefined) delete process.env.AUTH_URL; else process.env.AUTH_URL = old; }
});
test("PayPal authenticated response parser requires an explicit matching LIVE order context", () => {
  const body = { id: "ORDERQA", status: "COMPLETED", purchase_units: [{ reference_id: orderId, custom_id: attemptId,
    payee: { merchant_id: "MERCHANTQA" }, amount: { value: "9.90", currency_code: "EUR" }, payments: { captures: [{ id: "CAPTUREQA", status: "COMPLETED",
      amount: { value: "9.90", currency_code: "EUR" }, final_capture: true, update_time: "2026-10-16T12:00:00Z" }] } }] };
  const attempt = { id: attemptId, providerReference: "ORDERQA" };
  assert.equal(digitalPaypalOrderEvidence(body, { id: orderId, totalCents: 990, mode: "LIVE" }, attempt, "MERCHANTQA", "LIVE").status, "PAID");
  assert.throws(() => digitalPaypalOrderEvidence(body, { id: orderId, totalCents: 990 }, attempt, "MERCHANTQA", "LIVE"));
  assert.throws(() => digitalPaypalOrderEvidence(body, { id: orderId, totalCents: 990, mode: "LIVE" }, attempt, "OTHER", "LIVE"));
});
test("refund evidence keeps re_ identity and rejects cross-mode metadata in either direction", () => {
  for (const mode of ["TEST", "LIVE"] as const) {
    assert.equal(stripeRefundEvidence(refund(mode), expected(mode)).mode, mode);
    assert.throws(() => stripeRefundEvidence({ ...refund(mode), id: "ch_localBoundaryQa" }, expected(mode)));
    const other = mode === "LIVE" ? "TEST" : "LIVE";
    assert.throws(() => stripeRefundEvidence(refund(other), expected(mode)));
    assert.throws(() => stripeRefundEvidence({ ...refund(mode), metadata: { ...metadata(other), digitalRefundId: refundId } }, expected(mode)));
  }
});
test("fresh charge refund resolution supports LIVE without weakening the bounded re_ path", async () => {
  for (const mode of ["TEST", "LIVE"] as const) {
    let reads = 0;
    const client = { accounts: { async retrieve() { reads++; return { id: merchant }; } },
      paymentIntents: { async retrieve() { reads++; return { id: "pi_localBoundaryQa", livemode: mode === "LIVE", status: "succeeded", currency: "eur",
        amount_received: 990, on_behalf_of: null, transfer_data: null, metadata: metadata(mode), latest_charge: charge(mode) }; } },
      refunds: { async list() { reads++; return { data: [refund(mode)], has_more: false }; } } };
    const proofs = await readStripeChargeRefunds(client, expected(mode), "ch_localBoundaryQa");
    assert.equal(reads, 3); assert.equal(proofs.length, 1); assert.equal(proofs[0].mode, mode); assert.equal(proofs[0].reference, "re_localBoundaryQa");
    await assert.rejects(readStripeChargeRefunds(client, expected(mode === "LIVE" ? "TEST" : "LIVE"), "ch_localBoundaryQa"));
  }
});
