import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { verifySupportStripeWebhook } from "@/lib/support/providers";
import { POST as sessionPost } from "@/app/api/support/session/route";
import { POST as checkoutPost } from "@/app/api/support/checkout/route";
import { POST as capturePost } from "@/app/api/support/[id]/capture/route";
import { NextRequest } from "next/server";

test("Stripe webhook signature verified using raw bytes; altered/live payload refused even after checkout flag OFF", () => {
  const snapshot = { ...process.env };
  Object.assign(process.env, { SUPPORT_ENABLED: "false", SUPPORT_TEST_MODE: "true", SITE_URL: "https://preview.example.test",
    PAYMENT_DEPLOYMENT_ENV: "staging", STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_test_synthetic_fixture_only",
    SUPPORT_STRIPE_WEBHOOK_SECRET: "whsec_synthetic_fixture_only" });
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  try {
    const stripe = new Stripe("sk_test_synthetic_fixture_only");
    const payload = JSON.stringify({ id: "evt_synthetic", type: "checkout.session.completed", livemode: false, data: { object: {} } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.SUPPORT_STRIPE_WEBHOOK_SECRET! });
    assert.equal(verifySupportStripeWebhook(payload, signature).id, "evt_synthetic");
    assert.throws(() => verifySupportStripeWebhook(`${payload} `, signature));
    assert.throws(() => verifySupportStripeWebhook(payload, "invalid"));
    const live = payload.replace('"livemode":false', '"livemode":true');
    const liveSignature = stripe.webhooks.generateTestHeaderString({ payload: live, secret: process.env.SUPPORT_STRIPE_WEBHOOK_SECRET! });
    assert.throws(() => verifySupportStripeWebhook(live, liveSignature));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in snapshot)) delete process.env[key];
    Object.assign(process.env, snapshot);
  }
});

test("public mutation routes reject cross-origin before database or provider calls", async () => {
  const snapshot = { ...process.env };
  Object.assign(process.env, { SUPPORT_ENABLED: "true", SUPPORT_TEST_MODE: "true", SITE_URL: "https://preview.example.test", PAYMENT_DEPLOYMENT_ENV: "staging" });
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  try {
    for (const handler of [sessionPost, checkoutPost]) {
      const response = await handler(new NextRequest("https://preview.example.test/api/support/test", { method: "POST", headers: { origin: "https://attacker.example.test" }, body: "{}" }));
      assert.equal(response.status, 403);
    }
    const response = await capturePost(new NextRequest("https://preview.example.test/api/support/test", { method: "POST", headers: { origin: "https://attacker.example.test" } }), { params: Promise.resolve({ id: "synthetic" }) });
    assert.equal(response.status, 403);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in snapshot)) delete process.env[key];
    Object.assign(process.env, snapshot);
  }
});
