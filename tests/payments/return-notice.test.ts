import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync("components/payment-return-notice.tsx", "utf8");

test("the Stripe return is display-only and polls the server at a bounded interval", () => {
  assert.match(componentSource, /POLL_INTERVAL_MS = 1_500/);
  assert.match(componentSource, /MAX_POLLS = 12/);
  assert.match(componentSource, /router\.refresh\(\)/);
  assert.doesNotMatch(componentSource, /fetch\(|SUCCEEDED|PAYMENT_CONFIRMED/);
});

test("success and cancellation query parameters never become payment evidence", () => {
  const confirmationPageSource = readFileSync("app/commande/[orderNumber]/confirmation/page.tsx", "utf8");
  assert.match(confirmationPageSource, /paiement.*annule/);
  assert.match(confirmationPageSource, /PaymentReturnNotice/);
  assert.doesNotMatch(confirmationPageSource, /session_id.*(?:find|update|create)/s);
  assert.match(componentSource, /ne constitue jamais une preuve de paiement/);
  assert.match(componentSource, /commande reste impayée/);
});
