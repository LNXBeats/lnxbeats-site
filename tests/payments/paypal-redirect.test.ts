import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedPaypalApprovalRedirect } from "@/lib/payments/paypal-redirect";

const applicationOrigin = "https://www.lnxbeats.fr";

test("allows only the exact PayPal Live and Sandbox approval origins", () => {
  assert.equal(isAllowedPaypalApprovalRedirect(
    "https://www.paypal.com/checkoutnow?token=example",
    applicationOrigin,
  ), true);
  assert.equal(isAllowedPaypalApprovalRedirect(
    "https://www.sandbox.paypal.com/checkoutnow?token=example",
    applicationOrigin,
  ), true);

  for (const value of [
    "http://www.paypal.com/checkoutnow?token=example",
    "https://evil.example/",
    "https://paypal.com.evil.example/",
    "https://www.paypal.com.evil.example/",
    "https://www.paypal.com:444/checkoutnow?token=example",
    "https://user:password@www.paypal.com/checkoutnow?token=example",
    "javascript:alert(1)",
    "data:text/html,PayPal",
  ]) {
    assert.equal(isAllowedPaypalApprovalRedirect(value, applicationOrigin), false, value);
  }
});

test("keeps the existing exact HTTPS same-origin fallback fail-closed", () => {
  assert.equal(isAllowedPaypalApprovalRedirect(
    "https://www.lnxbeats.fr/compte/commandes/LNX-2026-000001?paiement=paypal-retour",
    applicationOrigin,
  ), true);
  assert.equal(isAllowedPaypalApprovalRedirect(
    "https://www.lnxbeats.fr.evil.example/compte",
    applicationOrigin,
  ), false);
  assert.equal(isAllowedPaypalApprovalRedirect(
    "http://www.lnxbeats.fr/compte",
    applicationOrigin,
  ), false);
  assert.equal(isAllowedPaypalApprovalRedirect(
    "https://user:password@www.lnxbeats.fr/compte",
    applicationOrigin,
  ), false);
});
