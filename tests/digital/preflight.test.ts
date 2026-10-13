import test from "node:test";
import assert from "node:assert/strict";
import { digitalTestPreflight } from "@/lib/digital/test-preflight";
test("DCN external preflight is read-only, fail-closed and never inherits global LIVE keys", () => {
  const p = digitalTestPreflight({ STRIPE_SECRET_KEY: "sk_live_not_for_dcn", PAYPAL_CLIENT_SECRET: "not_for_dcn" });
  assert.equal(p.stripeTestConfigured, false); assert.equal(p.paypalSandboxConfigured, false);
  assert.equal(p.providerCallsPerformed, 0); assert.equal(p.financialActionsPerformed, 0); assert.equal(p.humanAuthorizationStillRequired, true);
  assert.ok(!JSON.stringify(p).includes("sk_live"));
});
test("DCN external preflight refuses LIVE/Production, authenticated origins and Production webhook target", () => {
  for (const AUTH_URL of ["https://u:p@preview.example.invalid", "https://preview.example.invalid/path", "https://www.lnxbeats.fr"]) {
    assert.equal(digitalTestPreflight({ DCN_ENABLED: "true", DCN_MODE: "TEST", AUTH_URL }).httpsWebhook, false);
  }
  assert.equal(digitalTestPreflight({ DCN_ENABLED: "true", DCN_MODE: "LIVE" }).testOnly, false);
  assert.equal(digitalTestPreflight({ DCN_ENABLED: "true", DCN_MODE: "TEST", MEDIA_DEPLOYMENT_ENV: "production" }).testOnly, false);
});
