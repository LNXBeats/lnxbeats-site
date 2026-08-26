import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatEuro } from "@/lib/orders/domain";
import {
  checkoutPaymentChoicePresentation,
  checkoutPaymentCtaLabel,
  enabledCheckoutPaymentProviders,
} from "@/lib/payments/presentation";

test("checkout exposes only the enabled providers in a stable order", () => {
  assert.deepEqual(enabledCheckoutPaymentProviders({ stripe: false, paypal: false }), []);
  assert.deepEqual(enabledCheckoutPaymentProviders({ stripe: true, paypal: false }), ["stripe"]);
  assert.deepEqual(enabledCheckoutPaymentProviders({ stripe: false, paypal: true }), ["paypal"]);
  assert.deepEqual(enabledCheckoutPaymentProviders({ stripe: true, paypal: true }), ["stripe", "paypal"]);
});

test("payment labels remain professional, qualified and dynamically priced", () => {
  assert.equal(checkoutPaymentChoicePresentation.stripe.title, "Carte bancaire & Apple Pay");
  assert.match(checkoutPaymentChoicePresentation.stripe.details, /Apple Pay.*selon.*disponibilité/i);
  assert.equal(checkoutPaymentChoicePresentation.paypal.title, "PayPal");
  assert.match(checkoutPaymentChoicePresentation.paypal.details, /selon les options proposées par PayPal/i);

  for (const amountCents of [2_000, 3_000, 5_000, 6_000, 2_599]) {
    assert.equal(checkoutPaymentCtaLabel("stripe", amountCents), `Payer ${formatEuro(amountCents)} en toute sécurité`);
    assert.equal(checkoutPaymentCtaLabel("paypal", amountCents), `Payer ${formatEuro(amountCents)} avec PayPal`);
  }
});

test("shared checkout UI keeps provider actions isolated without adding wallet logic", () => {
  const choices = readFileSync("components/payment-checkout-actions.tsx", "utf8");
  const stripe = readFileSync("components/stripe-checkout-action.tsx", "utf8");
  const paypal = readFileSync("components/paypal-checkout-action.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");

  assert.match(choices, /enabledCheckoutPaymentProviders\(providers\)/);
  assert.match(choices, /data-payment-provider=\{provider\}/);
  assert.match(choices, /provider === "stripe"[\s\S]*?<StripeCheckoutAction[\s\S]*?: <PaypalCheckoutAction/);
  assert.doesNotMatch(choices, /Carte bancaire — Stripe/);
  assert.match(stripe, /checkoutPaymentCtaLabel\("stripe", amountCents\)/);
  assert.match(paypal, /checkoutPaymentCtaLabel\("paypal", amountCents\)/);
  assert.doesNotMatch(`${choices}\n${stripe}\n${paypal}`, /ApplePaySession|PaymentRequest|Elements|loadStripe/);
  assert.match(css, /\.payment-methods__actions \{[^}]*repeat\(auto-fit, minmax\(min\(100%, 19rem\), 1fr\)\)/);
  assert.match(css, /\.payment-methods__choice \{[\s\S]*?height: 100%;/);
  assert.match(css, /\.payment-methods__choice \.checkout-action \.form-button \{[\s\S]*?width: 100%;/);
});
