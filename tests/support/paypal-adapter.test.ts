import assert from "node:assert/strict";
import test from "node:test";
import { captureProviderSupport, createProviderCheckout, inspectBoundPaypalOrder, refundProviderSupport, verifySupportPaypalWebhook } from "@/lib/support/providers";

test("PayPal support reuses sandbox transport, immutable EUR amount and stable request keys (mock transport)", async () => {
  const originalEnv = { ...process.env }; const originalFetch = globalThis.fetch;
  Object.assign(process.env, { SUPPORT_ENABLED: "true", SUPPORT_TEST_MODE: "true", SITE_URL: "https://preview.example.test",
    PAYMENT_DEPLOYMENT_ENV: "staging", PAYPAL_ENVIRONMENT: "sandbox", PAYPAL_CLIENT_ID: "synthetic_client",
    PAYPAL_CLIENT_SECRET: "synthetic_secret", SUPPORT_PAYPAL_WEBHOOK_ID: "synthetic_webhook" });
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  const id = "170a3b22-c762-4f48-8739-f94068165ceb";
  const value = { id, amountCents: 500, provider: "PAYPAL", providerReference: "ORDER_TEST", paymentReference: null };
  const calls: { url: string; body: string; key: string | null }[] = [];
  let corruptCapture = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input); const body = String(init?.body ?? "");
    assert.ok(url.startsWith("https://api-m.sandbox.paypal.com/"));
    calls.push({ url, body, key: new Headers(init?.headers).get("PayPal-Request-Id") });
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "synthetic_access", token_type: "Bearer" });
    if (url.endsWith("/v2/checkout/orders")) return Response.json({ id: "ORDER_TEST", status: "CREATED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER_TEST" }] });
    if (url.endsWith("/capture")) return Response.json({ id: "ORDER_TEST", status: "COMPLETED", purchase_units: [{ custom_id: id,
      payments: { captures: [{ id: "CAPTURE_TEST", status: "COMPLETED", final_capture: !corruptCapture, amount: { value: "5.00", currency_code: "EUR" }, update_time: "2026-10-03T20:00:00Z" }] } }] });
    if (url.endsWith("/verify-webhook-signature")) return Response.json({ verification_status: "SUCCESS" });
    throw new Error("Unexpected mocked provider endpoint");
  };
  try {
    const result = await createProviderCheckout(value, "https://preview.example.test", "support-checkout-test");
    assert.equal(result.id, "ORDER_TEST");
    const request = calls.find((call) => call.url.endsWith("/v2/checkout/orders"))!;
    assert.equal(request.key, "support-checkout-test");
    const payload = JSON.parse(request.body);
    assert.equal(payload.purchase_units[0].amount.value, "5.00");
    assert.equal(payload.purchase_units[0].custom_id, id);
    assert.equal(payload.purchase_units[0].reference_id, id);
    assert.equal(payload.purchase_units[0].items[0].category, "DONATION");
    assert.equal(payload.purchase_units[0].items[0].quantity, "1");
    assert.deepEqual(payload.purchase_units[0].items[0].unit_amount, { currency_code: "EUR", value: "5.00" });
    assert.deepEqual(payload.purchase_units[0].amount.breakdown.item_total, { currency_code: "EUR", value: "5.00" });
    assert.match(payload.purchase_units[0].invoice_id, /^SUPPORT_LNX_BEATS:/);
    assert.equal(payload.payment_source.paypal.experience_context.shipping_preference, "NO_SHIPPING");
    assert.equal((await captureProviderSupport(value, "support-capture-test")).status, "SUCCEEDED");
    corruptCapture = true;
    await assert.rejects(captureProviderSupport(value, "support-capture-test"));
    const raw = '{"id":"EVENT_TEST", "resource": {"value":1}}';
    assert.equal(await verifySupportPaypalWebhook(raw, { transmissionId: "TEST", transmissionTime: "2026-10-03T20:00:00Z", certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/TEST", authAlgo: "SHA256withRSA", transmissionSignature: "TEST" }), true);
    assert.ok(calls.at(-1)!.body.endsWith(`"webhook_event":${raw}}`), "exact raw event bytes survive postback envelope");
    process.env.PAYPAL_ENVIRONMENT = "live";
    await assert.rejects(createProviderCheckout(value, "https://preview.example.test", "never-live"));
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});

test("LIVE PayPal transport binds merchant/mode before capture; closed checkout preserves settlement (all network mocked)", async () => {
  const originalEnv = { ...process.env }; const originalFetch = globalThis.fetch;
  Object.assign(process.env, { SUPPORT_ENABLED: "true", SUPPORT_TEST_MODE: "false", SITE_URL: "https://www.lnxbeats.fr",
    PAYMENT_DEPLOYMENT_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production", PAYPAL_ENVIRONMENT: "live",
    PAYPAL_CLIENT_ID: "synthetic_client", PAYPAL_CLIENT_SECRET: "synthetic_secret", SUPPORT_PAYPAL_WEBHOOK_ID: "synthetic_webhook",
    SUPPORT_PAYPAL_ENABLED: "true", SUPPORT_PAYPAL_LIVE_APPROVED: "true", SUPPORT_PAYPAL_MERCHANT_ID: "MERCHANTFIXTURE" });
  delete process.env.SUPPORT_LIVE_REFUNDS_ENABLED;
  const value = { id: "fixture-contribution", amountCents: 500, provider: "PAYPAL", mode: "LIVE", providerReference: "ORDER_FIXTURE", paymentReference: null };
  let merchant = "MERCHANTFIXTURE"; let capturePosts = 0; let refundPosts = 0; let checkoutPosts = 0;
  const capture = { id: "CAPTURE_FIXTURE", status: "COMPLETED", final_capture: true, update_time: "2026-10-04T12:00:00Z", amount: { value: "5.00", currency_code: "EUR" } };
  globalThis.fetch = async (input, init) => {
    const url = String(input); assert.ok(url.startsWith("https://api-m.paypal.com/"));
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "synthetic_access", token_type: "Bearer" });
    if (url.endsWith("/v2/checkout/orders")) {
      checkoutPosts++;
      const unit = JSON.parse(String(init?.body)).purchase_units[0];
      assert.equal(unit.payee.merchant_id, "MERCHANTFIXTURE");
      assert.equal(unit.items[0].category, "DONATION");
      return Response.json({ id: value.providerReference, status: "CREATED", links: [{ rel: "approve", href: "https://www.paypal.com/checkoutnow" }] });
    }
    if (url.endsWith("/capture")) capturePosts++;
    else if (url.endsWith("/refund")) { refundPosts++; throw new Error("Refund must remain unarmed"); }
    else assert.equal(init?.method ?? "GET", "GET");
    return Response.json({ id: value.providerReference, status: "COMPLETED", purchase_units: [{ custom_id: value.id, reference_id: value.id,
      amount: { value: "5.00", currency_code: "EUR" }, payee: { merchant_id: merchant }, payments: { captures: [capture] } }] });
  };
  try {
    await createProviderCheckout(value, "https://www.lnxbeats.fr", "fixture-key");
    process.env.SUPPORT_ENABLED = "false";
    await assert.rejects(createProviderCheckout(value, "https://www.lnxbeats.fr", "fixture-key"));
    assert.equal(checkoutPosts, 1);
    merchant = "WRONGMERCHANT";
    await assert.rejects(captureProviderSupport(value, "fixture-capture"));
    assert.equal(capturePosts, 0, "wrong merchant rejected before financial POST");
    merchant = "MERCHANTFIXTURE";
    assert.equal((await captureProviderSupport(value, "fixture-capture")).mode, "LIVE");
    assert.equal(capturePosts, 1, "existing payment settles despite closed new contributions");
    await assert.rejects(captureProviderSupport({ ...value, mode: "TEST" }, "fixture-capture"));
    assert.equal(capturePosts, 1);
    await assert.rejects(inspectBoundPaypalOrder({ ...value, paymentReference: "WRONG_CAPTURE" }));
    await inspectBoundPaypalOrder({ ...value, paymentReference: capture.id });
    await assert.rejects(refundProviderSupport({ ...value, paymentReference: capture.id }, "fixture-refund"));
    assert.equal(refundPosts, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
