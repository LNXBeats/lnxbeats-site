import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { supportMode, isSupportEnabled, isSupportProviderEnabled } from "@/lib/support/config";
import { supportProviderPresentation } from "@/app/soutenir/provider-presentation";
import { supportEvidenceMatches } from "@/lib/support/service";
import { stripeSupportEvidence, validateSupportCheckoutUrl } from "@/lib/support/providers";
import type Stripe from "stripe";
import { supportMutation } from "@/lib/support/http";

const live = { SUPPORT_ENABLED: "true", SUPPORT_TEST_MODE: "false", PAYMENT_DEPLOYMENT_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production", SITE_URL: "https://www.lnxbeats.fr" };
test("existing LIVE HTTP mutations reach same-origin guard after closure, without an obsolete TEST-only gate", async () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { ...live, SUPPORT_ENABLED: "false" });
    const request = new Request("https://www.lnxbeats.fr/api/support/fixture/capture", { method: "POST", headers: { Origin: "https://foreign.example.test" } });
    assert.equal(await supportMutation(request, true), false, "cross-origin remains refused before DB/provider calls");
    await assert.rejects(supportMutation(request, false), "new contributions remain closed");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
test("LIVE context requires explicit mode plus exact Production deployment and origin", () => {
  assert.equal(supportMode(live), "LIVE");
  for (const change of [{ SUPPORT_TEST_MODE: undefined }, { SUPPORT_TEST_MODE: "true" }, { PAYMENT_DEPLOYMENT_ENV: "staging" }, { RAILWAY_ENVIRONMENT_NAME: "preview" }, { SITE_URL: "https://preview.example.test" }, { SITE_URL: "http://www.lnxbeats.fr" }, { SITE_URL: "https://user:pass@www.lnxbeats.fr" }]) assert.equal(supportMode({ ...live, ...change }), null);
  assert.equal(isSupportEnabled(live), false, "context alone cannot open collection");
});
test("each LIVE provider requires its own activation and externally proven approval", () => {
  const env = { ...live, SUPPORT_STRIPE_ENABLED: "true", SUPPORT_STRIPE_LIVE_APPROVED: "true" };
  assert.equal(isSupportProviderEnabled("STRIPE", env), true);
  assert.equal(isSupportProviderEnabled("PAYPAL", env), false);
  assert.equal(isSupportProviderEnabled("STRIPE", { ...env, SUPPORT_STRIPE_LIVE_APPROVED: "false" }), false);
  assert.equal(isSupportProviderEnabled("STRIPE", { ...env, SUPPORT_ENABLED: "false" }), false);
  assert.equal(supportMode({ ...env, SUPPORT_ENABLED: "false" }), "LIVE", "settlement context survives closure");
});
test("presentation cannot expose a LIVE provider without its merchant binding or with TEST keys", () => {
  const env = { ...live, SUPPORT_STRIPE_ENABLED: "true", SUPPORT_STRIPE_LIVE_APPROVED: "true", STRIPE_MODE: "live", STRIPE_SECRET_KEY: "rk_live_synthetic_fixture_only", SUPPORT_STRIPE_WEBHOOK_SECRET: "whsec_fixture" };
  assert.equal(supportProviderPresentation(env).stripeConfigured, false);
  assert.equal(supportProviderPresentation({ ...env, SUPPORT_STRIPE_ACCOUNT_ID: "acct_fixture" }).stripeConfigured, true);
  assert.equal(supportProviderPresentation({ ...env, SUPPORT_STRIPE_ACCOUNT_ID: "acct_fixture", STRIPE_SECRET_KEY: "rk_test_synthetic_fixture_only" }).stripeConfigured, false);
});
test("provider evidence cannot settle across TEST and LIVE", () => {
  const value = { id: "fixture", amountCents: 500, currency: "EUR", provider: "STRIPE", providerReference: "session", mode: "LIVE" };
  const evidence = { contributionId: "fixture", amountCents: 500, currency: "EUR", provider: "STRIPE" as const, providerReference: "session", paymentReference: "payment", status: "SUCCEEDED" as const };
  assert.equal(supportEvidenceMatches(value, evidence), false);
  assert.equal(supportEvidenceMatches(value, { ...evidence, mode: "LIVE" }), true);
});
test("Stripe live evidence needs both event and session mode; Connect event never accepted", () => {
  const event = { type: "checkout.session.completed", livemode: true, data: { object: { id: "session", livemode: true, metadata: { purpose: "SUPPORT_LNX_BEATS", contributionId: "fixture" }, client_reference_id: "fixture", amount_total: 500, currency: "eur", payment_status: "paid", payment_intent: "payment" } } } as unknown as Stripe.Event;
  assert.equal(stripeSupportEvidence(event), null);
  assert.equal(stripeSupportEvidence(event, "LIVE")?.mode, "LIVE");
  assert.equal(stripeSupportEvidence({ ...event, account: "acct_other" }, "LIVE"), null);
  assert.equal(stripeSupportEvidence({ ...event, livemode: false }, "LIVE"), null);
});
test("PayPal redirects are mode-specific rather than a global union of hosts", () => {
  assert.throws(() => validateSupportCheckoutUrl("https://www.paypal.com/checkoutnow", "PAYPAL", "TEST"));
  assert.throws(() => validateSupportCheckoutUrl("https://www.sandbox.paypal.com/checkoutnow", "PAYPAL", "LIVE"));
  assert.equal(validateSupportCheckoutUrl("https://www.paypal.com/checkoutnow", "PAYPAL", "LIVE"), "https://www.paypal.com/checkoutnow");
});
test("new mode migration changes only the support CHECK and never rewrites historical data", () => {
  const sql = readFileSync("prisma/migrations/20261004180000_support_explicit_payment_modes/migration.sql", "utf8");
  assert.match(sql, /CHECK \("mode" IN \('TEST', 'LIVE'\)\)/);
  assert.equal(/\b(?:DELETE|TRUNCATE|UPDATE|DROP TABLE|DROP COLUMN)\b/.test(sql), false);
  assert.equal((sql.match(/ALTER TABLE/g) ?? []).length, 1);
});
