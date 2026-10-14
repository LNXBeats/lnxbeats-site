import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createBudgetedPaypalQaFetch, PAYPAL_QA_FETCH_ATTESTATION } from "./paypal-dcn-qa-fetch.mjs";
import { readPaypalQaBudget, createPaypalQaBudgetAuthority } from "./paypal-dcn-qa-budget.mjs";
import { withOfflineBudget, OFFLINE_BINDING, OFFLINE_SCOPE, OFFLINE_TIME, offlineOauthResponse, offlineOauthInput, offlineBearer } from "./paypal-dcn-qa-test-fixture.mjs";
const origin = "https://api-m.sandbox.paypal.com";
test("each OAuth and REST/signature is fsync reserved before injected transport; no credentials enter ledger", async () => {
  await withOfflineBudget(async ({ file, budget }) => {
    let calls = 0;
    const fetch = createBudgetedPaypalQaFetch({ budget, binding: OFFLINE_BINDING, transport: async (url, init) => {
      const state = await readPaypalQaBudget(file);
      assert.equal(state.used.REST_TOTAL, ++calls);
      assert.equal(init.redirect, "manual");
      return url.endsWith("/token") ? offlineOauthResponse() : Response.json({ verification_status: "SUCCESS" });
    } });
    await fetch(...offlineOauthInput());
    await fetch(`${origin}/v2/checkout/orders/OFFLINEORDER`, { headers: offlineBearer });
    await fetch(...offlineOauthInput());
    await fetch(`${origin}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: offlineBearer,
      body: JSON.stringify({ webhook_id: OFFLINE_BINDING.webhookId, webhook_event: { id: "OFFLINEEVENT" } }) });
    const state = await readPaypalQaBudget(file);
    assert.equal(state.used.OAUTH, 2); assert.equal(state.used.GET, 1); assert.equal(state.used.SIGNATURE, 1);
    const text = await readFile(file, "utf8");
    for (const secret of [OFFLINE_BINDING.clientId, OFFLINE_BINDING.clientSecret, "synthetic-token", "Basic ", "Bearer ", "webhook_event"]) assert.ok(!text.includes(secret));
    assert.equal(fetch[PAYPAL_QA_FETCH_ATTESTATION].durableReservationBeforeTransport, true);
  });
});
test("failed/ambiguous transport remains spent after restart; deadline/caps not renewed", async () => {
  await withOfflineBudget(async ({ file, budget, now, setTime }) => {
    const fetch = createBudgetedPaypalQaFetch({ budget, binding: OFFLINE_BINDING, transport: async () => { throw new Error("OFFLINE_TIMEOUT"); } });
    await assert.rejects(fetch(...offlineOauthInput()), /OFFLINE_TIMEOUT/);
    const restarted = await createPaypalQaBudgetAuthority(file, OFFLINE_SCOPE, now);
    assert.equal(restarted.initialUsed.OAUTH, 1);
    assert.equal(restarted.deadline, OFFLINE_TIME + 7200000);
    setTime(restarted.deadline);
    await assert.rejects(fetch(...offlineOauthInput()), /AUTHORIZATION_EXPIRED/);
    assert.equal((await readPaypalQaBudget(file)).used.OAUTH, 1);
  });
});
test("LIVE, wrong app Basic, query pagination, retries, follow and unknown token fail before transport", async () => {
  await withOfflineBudget(async ({ file, budget }) => {
    let calls = 0;
    const fetch = createBudgetedPaypalQaFetch({ budget, binding: OFFLINE_BINDING, transport: async () => { calls++; return offlineOauthResponse(); } });
    const [url, oauth] = offlineOauthInput();
    await assert.rejects(fetch(url.replace("sandbox.", ""), oauth), /SANDBOX_ONLY/);
    await assert.rejects(fetch(`${url}?page=2`, oauth), /NO_QUERY/);
    await assert.rejects(fetch(url, { ...oauth, redirect: "follow" }), /REDIRECT_NOT_AUTHORIZED/);
    await assert.rejects(fetch(url, { ...oauth, retry: false }), /RETRY_OR_PAGINATION/);
    await assert.rejects(fetch(url, { ...oauth, headers: { ...oauth.headers, authorization: "Basic wrong-application" } }), /EXACT_OAUTH_APPLICATION/);
    await assert.rejects(fetch(`${origin}/v2/checkout/orders/OFFLINEORDER`, { headers: offlineBearer }), /TOKEN_NOT_ISSUED/);
    await assert.rejects(fetch(new Request(url), oauth), /EXPLICIT_URL_REQUIRED/);
    assert.equal(calls, 0); assert.equal((await readPaypalQaBudget(file)).used.REST_TOTAL, 0);
  });
});
test("OAuth wrong app_id or scopes do not authorize subsequent REST", async () => {
  for (const changes of [{ app_id: "APP-ANOTHERQA123" }, { scope: "https://uri.paypal.com/irrelevant" }]) {
    await withOfflineBudget(async ({ file, budget }) => {
      const fetch = createBudgetedPaypalQaFetch({ budget, binding: { ...OFFLINE_BINDING, expectedOAuthAppId: "APP-OFFLINEQA123" }, transport: async () => offlineOauthResponse(changes) });
      await assert.rejects(fetch(...offlineOauthInput()), /OAUTH_APP_OR_SCOPES_MISMATCH/);
      await assert.rejects(fetch(`${origin}/v2/checkout/orders/OFFLINEORDER`, { headers: offlineBearer }), /TOKEN_NOT_ISSUED/);
      assert.equal((await readPaypalQaBudget(file)).used.REST_TOTAL, 1);
    });
  }
});
test("redirect response is not followed and consumes only its original reservation", async () => {
  await withOfflineBudget(async ({ file, budget }) => {
    let calls = 0;
    const fetch = createBudgetedPaypalQaFetch({ budget, binding: OFFLINE_BINDING, transport: async () => {
      calls++; return new Response(null, { status: 302, headers: { location: "https://api-m.paypal.com/v1/oauth2/token" } });
    } });
    await assert.rejects(fetch(...offlineOauthInput()), /REDIRECT_RESPONSE_REFUSED/);
    assert.equal(calls, 1); assert.equal((await readPaypalQaBudget(file)).used.OAUTH, 1);
  });
});
test("merchant, signature webhook and cleanup webhook are exact-bound before spending budget", async () => {
  await withOfflineBudget(async ({ file, budget }) => {
    const fetch = createBudgetedPaypalQaFetch({ budget, binding: OFFLINE_BINDING, transport: async url => url.endsWith("/token") ? offlineOauthResponse() : Response.json({ ok: true }) });
    await fetch(...offlineOauthInput());
    await assert.rejects(fetch(`${origin}/v2/checkout/orders`, { method: "POST", headers: offlineBearer,
      body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ payee: { merchant_id: "OTHER00000001" } }] }) }), /EXACT_MERCHANT_REQUIRED/);
    await assert.rejects(fetch(`${origin}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: offlineBearer,
      body: JSON.stringify({ webhook_id: "PRODUCTIONORSTAGING" }) }), /EXACT_WEBHOOK_REQUIRED/);
    await assert.rejects(fetch(`${origin}/v1/notifications/webhooks/PRODUCTIONORSTAGING`, { method: "DELETE", headers: offlineBearer }), /EXACT_WEBHOOK_DELETE_REQUIRED/);
    assert.equal((await readPaypalQaBudget(file)).used.REST_TOTAL, 1);
    fetch.beginWebhookCleanup();
    await fetch(...offlineOauthInput());
    await fetch(`${origin}/v1/notifications/webhooks/${OFFLINE_BINDING.webhookId}`, { method: "DELETE", headers: offlineBearer });
    assert.equal((await readPaypalQaBudget(file)).used.DELETE_WEBHOOK, 1);
  });
});
test("webhook creation URL and exact six-event minimum; created ID used for signature and delete", async () => {
  await withOfflineBudget(async ({ file, budget }) => {
    const fetch = createBudgetedPaypalQaFetch({ budget, binding: { ...OFFLINE_BINDING, webhookId: null }, transport: async url => {
      if (url.endsWith("/token")) return offlineOauthResponse();
      if (url.endsWith("/webhooks")) return Response.json({ id: "NEWQAONLYWEBHOOK" }, { status: 201 });
      return Response.json({ ok: true });
    } });
    await fetch(...offlineOauthInput());
    const body = { url: `https://${OFFLINE_SCOPE.approvedHost}/api/digital/webhooks/paypal`,
      event_types: OFFLINE_BINDING.webhookEvents.map(name => ({ name })) };
    await assert.rejects(fetch(`${origin}/v1/notifications/webhooks`, { method: "POST", headers: offlineBearer,
      body: JSON.stringify({ ...body, url: "https://www.lnxbeats.fr/api/digital/webhooks/paypal" }) }), /EXACT_WEBHOOK_URL/);
    await assert.rejects(fetch(`${origin}/v1/notifications/webhooks`, { method: "POST", headers: offlineBearer,
      body: JSON.stringify({ ...body, event_types: [{ name: "*" }] }) }), /EXACT_WEBHOOK_URL/);
    await assert.rejects(fetch(`${origin}/v1/notifications/webhooks`, { method: "POST", headers: offlineBearer,
      body: JSON.stringify({ ...body, event_types: body.event_types.filter(event => event.name !== "PAYMENT.REFUND.FAILED") }) }), /EXACT_WEBHOOK_URL/);
    assert.throws(() => createBudgetedPaypalQaFetch({ budget, binding: { ...OFFLINE_BINDING,
      webhookEvents: [...OFFLINE_BINDING.webhookEvents, "PAYMENT.REFUND.COMPLETED"] } }), /INVALID_WEBHOOK_EVENTS/);
    await fetch(`${origin}/v1/notifications/webhooks`, { method: "POST", headers: offlineBearer, body: JSON.stringify(body) });
    await fetch(`${origin}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: offlineBearer,
      body: JSON.stringify({ webhook_id: "NEWQAONLYWEBHOOK" }) });
    fetch.beginWebhookCleanup();
    await fetch(...offlineOauthInput());
    await fetch(`${origin}/v1/notifications/webhooks/NEWQAONLYWEBHOOK`, { method: "DELETE", headers: offlineBearer });
    assert.equal((await readPaypalQaBudget(file)).used.REST_TOTAL, 5);
  });
});
test("concurrent OAuth reservations are atomic, no overspend even with failing transports", async () => {
  await withOfflineBudget(async ({ file, budget }) => {
    let calls = 0;
    const fetch = createBudgetedPaypalQaFetch({ budget, binding: OFFLINE_BINDING, transport: async () => { calls++; throw new Error("OFFLINE_TIMEOUT"); } });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => fetch(...offlineOauthInput())));
    assert.equal(results.filter(result => result.status === "rejected").length, 8);
    assert.equal(calls, 2); assert.equal((await readPaypalQaBudget(file)).used.REST_TOTAL, 2);
  }, { REST_TOTAL: 2, OAUTH: 2, DELETE_WEBHOOK: 0 });
});

test("REST Client ID binding is exact without inventing pre-OAuth app_id; generic app_id is corroboration only", async () => {
  await withOfflineBudget(async ({ budget }) => {
    assert.throws(() => createBudgetedPaypalQaFetch({ budget, binding: { ...OFFLINE_BINDING,
      expectedClientId: "another-synthetic-client-not-a-credential" }, transport: async () => offlineOauthResponse() }), /EXACT_PRIVATE_BINDING/);
    const fetch = createBudgetedPaypalQaFetch({ budget, binding: OFFLINE_BINDING,
      transport: async () => offlineOauthResponse({ app_id: "APP-GENERICSANDBOX123" }) });
    await fetch(...offlineOauthInput());
    assert.equal((await budget.snapshot()).used.OAUTH, 1);
  });
});
test("cleanup phase rejects new finance and preserves its one OAuth plus exact DELETE", async () => {
  await withOfflineBudget(async ({ budget }) => {
    const fetch = createBudgetedPaypalQaFetch({ budget, binding: OFFLINE_BINDING,
      transport: async url => url.endsWith("/token") ? offlineOauthResponse() : Response.json({ ok: true }) });
    await fetch(...offlineOauthInput());
    await assert.rejects(fetch(`${origin}/v1/notifications/webhooks/${OFFLINE_BINDING.webhookId}`, { method: "DELETE", headers: offlineBearer }), /EXPLICIT_TARGETED_CLEANUP/);
    fetch.beginWebhookCleanup(); await fetch(...offlineOauthInput());
    await assert.rejects(fetch(`${origin}/v2/checkout/orders/OFFLINEORDER/capture`, { method: "POST", headers: offlineBearer, body: "{}" }), /TARGETED_CLEANUP_ONLY/);
    await fetch(`${origin}/v1/notifications/webhooks/${OFFLINE_BINDING.webhookId}`, { method: "DELETE", headers: offlineBearer });
    assert.equal((await budget.snapshot()).used.REST_TOTAL, 3);
  }, { REST_TOTAL: 3, OAUTH: 2 });
});
