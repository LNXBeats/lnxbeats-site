import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isSupportEnabled, isSupportTestEnvironment, supportLimits, validateSupportAmount } from "@/lib/support/config";
import { assertSupportAttemptAllowed, nextSupportStatus, supportEvidenceMatches, supportRetryAllowed, validSupportId } from "@/lib/support/service";
import { stripeSupportEvidence, supportCheckoutParameters, validateSupportCheckoutUrl, type SupportEvidence } from "@/lib/support/providers";
import { boundedSupportText } from "@/lib/support/http";
import { provisionSupportRuntimePrivileges } from "@/lib/support/runtime-privileges";
import type Stripe from "stripe";

const id = "170a3b22-c762-4f48-8739-f94068165ceb";
const environment = { SUPPORT_ENABLED: "true", SUPPORT_TEST_MODE: "true", SITE_URL: "https://isolated-preview.example.test", PAYMENT_DEPLOYMENT_ENV: "staging" };

test("support defaults OFF and live/production contexts cannot enable it", () => {
  assert.equal(isSupportEnabled({}), false);
  assert.equal(isSupportEnabled(environment), true);
  for (const overrides of [{ SUPPORT_TEST_MODE: "false" }, { SUPPORT_ENABLED: "false" }, { PAYMENT_DEPLOYMENT_ENV: "production" }, { RAILWAY_ENVIRONMENT_NAME: "production" }, { SITE_URL: "https://www.lnxbeats.fr" }, { SITE_URL: "http://untrusted.example.test" }]) {
    assert.equal(isSupportEnabled({ ...environment, ...overrides }), false);
  }
  assert.equal(isSupportTestEnvironment({ ...environment, SUPPORT_ENABLED: "false" }), true, "reconciliation survives checkout kill switch");
});

test("server amount bounds cover presets/custom and reject floats/strings/NaN/overflow", () => {
  assert.deepEqual(supportLimits({}), { minCents: 100, maxCents: 50000, currency: "EUR" });
  for (const amount of [100, 300, 500, 1000, 2000, 1234, 50000]) assert.equal(validateSupportAmount(amount), amount);
  for (const amount of [0, -1, 99, 50001, 1.5, NaN, Infinity, "500", null]) assert.throws(() => validateSupportAmount(amount));
  for (const config of [{ SUPPORT_MIN_CENTS: "0" }, { SUPPORT_MAX_CENTS: "50001" }, { SUPPORT_MIN_CENTS: "1000", SUPPORT_MAX_CENTS: "500" }]) assert.throws(() => supportLimits(config));
});

test("support IDs reject malformed and punctuation before database access", () => {
  assert.equal(validSupportId(id), true);
  assert.equal(validSupportId(id.toUpperCase()), true);
  for (const value of [null, "a".repeat(36), "x", `${id}'`, "00000000-0000-0000-0000-000000000000"]) assert.equal(validSupportId(value), false);
});

test("server Checkout parameters isolate support, forbid invoice/tax/benefits and use immutable amount", () => {
  const params = supportCheckoutParameters({ id, provider: "STRIPE", amountCents: 1234, providerReference: null, paymentReference: null }, "https://isolated-preview.example.test");
  assert.equal(params.metadata?.purpose, "SUPPORT_LNX_BEATS");
  assert.equal(params.line_items?.[0]?.price_data?.unit_amount, 1234);
  assert.equal(params.invoice_creation?.enabled, false);
  assert.equal(params.automatic_tax?.enabled, false);
  assert.equal(params.allow_promotion_codes, false);
  assert.equal(params.payment_method_types, undefined);
  assert.match(String(params.integration_identifier), /^lnx-support-[a-z]{8}$/);
  assert.equal(JSON.stringify(params).includes("orderId"), false);
});

test("redirects accept only exact TLS hosted-checkout provider hosts", () => {
  assert.equal(validateSupportCheckoutUrl("https://checkout.stripe.com/c/test", "STRIPE"), "https://checkout.stripe.com/c/test");
  assert.equal(validateSupportCheckoutUrl("https://www.sandbox.paypal.com/checkoutnow?token=TEST", "PAYPAL").startsWith("https:"), true);
  for (const value of ["javascript:alert(1)", "https://checkout.stripe.com.evil.test", "http://checkout.stripe.com", "https://user:pass@checkout.stripe.com", "https://www.paypal.com/checkoutnow"]) assert.throws(() => validateSupportCheckoutUrl(value, "STRIPE"));
});

function stripeEvent(paymentStatus: string, type = "checkout.session.completed") {
  return { id: "evt_test", type, livemode: false, data: { object: { id: "cs_test", livemode: false,
    metadata: { purpose: "SUPPORT_LNX_BEATS", contributionId: id }, client_reference_id: id,
    amount_total: 500, currency: "eur", payment_status: paymentStatus, payment_intent: "pi_test" } } } as unknown as Stripe.Event;
}
test("verified Stripe evidence only marks paid, covers async success/failure and ignores other business domains", () => {
  assert.equal(stripeSupportEvidence(stripeEvent("paid"))?.status, "SUCCEEDED");
  assert.equal(stripeSupportEvidence(stripeEvent("unpaid"))?.status, "PENDING");
  assert.equal(stripeSupportEvidence(stripeEvent("paid", "checkout.session.async_payment_succeeded"))?.status, "SUCCEEDED");
  assert.equal(stripeSupportEvidence(stripeEvent("unpaid", "checkout.session.async_payment_failed"))?.status, "FAILED");
  const live = stripeEvent("paid"); live.livemode = true;
  assert.equal(stripeSupportEvidence(live), null);
  const other = stripeEvent("paid"); (other.data.object as Stripe.Checkout.Session).metadata = { purpose: "SHOP_ORDER" };
  assert.equal(stripeSupportEvidence(other), null);
});

test("provider evidence binds contribution/reference/provider/amount/currency", () => {
  const value = { id, amountCents: 500, currency: "EUR", provider: "STRIPE", providerReference: "cs_test" };
  const evidence: SupportEvidence = { contributionId: id, amountCents: 500, currency: "EUR", provider: "STRIPE", providerReference: "cs_test", paymentReference: "pi_test", status: "SUCCEEDED" };
  assert.equal(supportEvidenceMatches(value, evidence), true);
  for (const changes of [{ contributionId: "wrong" }, { amountCents: 100 }, { currency: "USD" }, { provider: "PAYPAL" as const }, { providerReference: "another" }]) assert.equal(supportEvidenceMatches(value, { ...evidence, ...changes }), false);
});

test("event ordering never downgrades a paid/refunded/review contribution", () => {
  for (const terminal of ["SUCCEEDED", "REFUNDED", "REFUND_PENDING", "REQUIRES_REVIEW"]) {
    assert.equal(nextSupportStatus(terminal, "FAILED"), terminal);
    assert.equal(nextSupportStatus(terminal, "PENDING"), terminal);
  }
  assert.equal(nextSupportStatus("FAILED", "SUCCEEDED"), "SUCCEEDED");
  assert.equal(nextSupportStatus("FAILED", "PENDING"), "FAILED");
});

test("ambiguous retries stop before provider idempotency retention expires", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  assert.equal(supportRetryAllowed(new Date(now.getTime() - 29 * 60000), now), true);
  assert.equal(supportRetryAllowed(new Date(now.getTime() - 30 * 60000), now), false);
  assert.equal(supportRetryAllowed(new Date(now.getTime() - 24 * 3600000), now), false);
});

test("historical capture/refund attempts never authorize a now-blocked ledger state", () => {
  for (const status of ["REQUIRES_REVIEW", "FAILED", "REFUNDED", "CREATED"]) {
    for (const operation of ["CAPTURE", "REFUND"] as const) {
      for (const attemptStatus of ["REQUESTED", "SUCCEEDED"]) {
        assert.throws(() => assertSupportAttemptAllowed({ status, provider: "PAYPAL" }, operation, { status: attemptStatus }));
      }
    }
  }
  assert.doesNotThrow(() => assertSupportAttemptAllowed({ status: "PENDING", provider: "PAYPAL" }, "CAPTURE", { status: "REQUESTED" }));
  assert.throws(() => assertSupportAttemptAllowed({ status: "PENDING", provider: "STRIPE" }, "CAPTURE", { status: "REQUESTED" }));
  assert.throws(() => assertSupportAttemptAllowed({ status: "REFUND_PENDING", provider: "PAYPAL" }, "REFUND", null));
  for (const status of ["REQUESTED", "SUCCEEDED"]) assert.doesNotThrow(() => assertSupportAttemptAllowed({ status: "REFUND_PENDING", provider: "PAYPAL" }, "REFUND", { status }));
  assert.doesNotThrow(() => assertSupportAttemptAllowed({ status: "SUCCEEDED", provider: "PAYPAL" }, "REFUND", null));
});

test("bounded webhook/request reader rejects declared and chunked oversize", async () => {
  await assert.rejects(boundedSupportText(new Request("https://example.test", { method: "POST", body: "small", headers: { "content-length": "999" } }), 10));
  await assert.rejects(boundedSupportText(new Request("https://example.test", { method: "POST", body: "x".repeat(11) }), 10));
  assert.equal(await boundedSupportText(new Request("https://example.test", { method: "POST", body: "{}" }), 10), "{}");
});

test("support runtime grants exact ledger tables, append-only events, no delete or DDL", async () => {
  const queries: string[] = [];
  const fake = { async query(sql: string) { queries.push(sql); return { rows: sql.includes("FROM pg_roles") ? [{ safe: true }] : sql.includes("FROM pg_class") ? ["support_contributions", "support_contribution_attempts", "support_contribution_events"].map((name) => ({ name, owned: true })) : [] }; } };
  await provisionSupportRuntimePrivileges(fake as never);
  const grants = queries.filter((sql) => sql.startsWith("GRANT"));
  assert.equal(grants.length, 3);
  assert.equal(grants.some((sql) => /DELETE|TRUNCATE|OWNERSHIP|TRIGGER|REFERENCES/.test(sql)), false);
  assert.match(grants[2], /^GRANT SELECT, INSERT ON TABLE/);
});

test("support schema/migration are additive and have no order, financial or Rights changes", () => {
  const sql = readFileSync("prisma/migrations/20261004010000_support_contributions/migration.sql", "utf8");
  assert.equal(/\b(DROP|DELETE|TRUNCATE|UPDATE)\s+(?:TABLE|FROM|"orders"|"payments")/i.test(sql), false);
  assert.equal(/publication_license_contract_v4|REFERENCES "orders"|REFERENCES "shop_orders"/i.test(sql), false);
  assert.equal((sql.match(/CREATE TABLE /g) ?? []).length, 3);
  assert.match(sql, /CHECK \("mode" = 'TEST'\)/);
});
