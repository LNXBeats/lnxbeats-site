import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync("components/payment-return-notice.tsx", "utf8");
const pageSource = readFileSync("app/compte/commandes/[orderNumber]/page.tsx", "utf8");

test("the Stripe return is display-only and polls the server at a bounded interval", () => {
  assert.match(componentSource, /POLL_INTERVAL_MS = 3_000/);
  assert.match(componentSource, /MAX_POLLS = 6/);
  assert.match(componentSource, /router\.refresh\(\)/);
  assert.doesNotMatch(componentSource, /fetch\(|SUCCEEDED|PAYMENT_CONFIRMED/);
});

test("success and cancellation query parameters never become payment evidence", () => {
  assert.match(pageSource, /paymentReturn === "retour"/);
  assert.match(pageSource, /paymentReturn === "annule"/);
  assert.match(pageSource, /PaymentReturnNotice/);
  assert.doesNotMatch(pageSource, /session_id.*(?:find|update|create)/s);
  assert.match(componentSource, /ne constitue jamais une preuve de paiement/);
  assert.match(componentSource, /commande reste impayée/);
});
