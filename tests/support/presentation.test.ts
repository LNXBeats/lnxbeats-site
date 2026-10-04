import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { supportProviderPresentation } from "@/app/soutenir/provider-presentation";

const preview = { SUPPORT_ENABLED: "true", SUPPORT_TEST_MODE: "true", PAYMENT_DEPLOYMENT_ENV: "preview", SITE_URL: "https://preview.example.test" };
const configured = { ...preview, STRIPE_MODE: "test", STRIPE_SECRET_KEY: ["sk", "test", "synthetic_fixture_only"].join("_"), SUPPORT_STRIPE_WEBHOOK_SECRET: "synthetic-webhook", PAYPAL_ENVIRONMENT: "sandbox", PAYPAL_CLIENT_ID: "synthetic-client", PAYPAL_CLIENT_SECRET: "synthetic-secret", SUPPORT_PAYPAL_WEBHOOK_ID: "synthetic-webhook" };

test("support presentation exposes booleans only and defaults unavailable without provider configuration", () => {
  assert.deepEqual(supportProviderPresentation({}), { stripeConfigured: false, paypalConfigured: false });
  assert.deepEqual(supportProviderPresentation(preview), { stripeConfigured: false, paypalConfigured: false });
  assert.deepEqual(supportProviderPresentation(configured), { stripeConfigured: true, paypalConfigured: true });
  assert.equal(JSON.stringify(supportProviderPresentation(configured)).includes("synthetic"), false);
});

test("support presentation never offers live, incomplete or disabled test providers", () => {
  for (const overrides of [{ SUPPORT_ENABLED: "false" }, { SUPPORT_TEST_MODE: "false" }, { PAYMENT_DEPLOYMENT_ENV: "production" }, { SITE_URL: "https://www.lnxbeats.fr" }]) {
    assert.deepEqual(supportProviderPresentation({ ...configured, ...overrides }), { stripeConfigured: false, paypalConfigured: false });
  }
  for (const overrides of [{ STRIPE_MODE: "live" }, { STRIPE_SECRET_KEY: ["sk", "live", "synthetic_fixture_only"].join("_") }, { SUPPORT_STRIPE_WEBHOOK_SECRET: "" }]) {
    assert.equal(supportProviderPresentation({ ...configured, ...overrides }).stripeConfigured, false);
  }
  for (const overrides of [{ PAYPAL_ENVIRONMENT: "live" }, { PAYPAL_CLIENT_ID: "" }, { PAYPAL_CLIENT_SECRET: "" }, { SUPPORT_PAYPAL_WEBHOOK_ID: "" }]) {
    assert.equal(supportProviderPresentation({ ...configured, ...overrides }).paypalConfigured, false);
  }
});

test("support form only presents configured providers and disables unavailable amount inputs", () => {
  const form = readFileSync(new URL("../../components/support-form.tsx", import.meta.url), "utf8");
  assert.match(form, /stripeConfigured \? <button/);
  assert.match(form, /paypalConfigured \? <button/);
  assert.match(form, /disabled=\{pending \|\| !providerConfigured\}/);
  assert.match(form, /Aucun versement n’est possible/);
  assert.doesNotMatch(form, /process\.env|STRIPE_SECRET_KEY|PAYPAL_CLIENT_SECRET/);
});
