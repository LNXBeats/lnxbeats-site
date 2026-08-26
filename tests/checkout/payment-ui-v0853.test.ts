import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("premium payment presentation uses a pinned official PayPal asset without changing provider actions", () => {
  const choices = readFileSync("components/payment-checkout-actions.tsx", "utf8");
  const css = readFileSync("app/v0854-audio-payment.css", "utf8");
  const asset = readFileSync("public/brands/paypal-white.svg", "utf8");
  const digest = createHash("sha256").update(asset).digest("hex");

  assert.match(choices, /src="\/brands\/paypal-white\.svg"/);
  assert.match(choices, /provider === "stripe"[\s\S]*?<CardPaymentIcon \/>[\s\S]*?: \([\s\S]*?paypal-white\.svg/);
  assert.match(choices, /provider === "stripe" \? <strong id=\{headingId\}>\{presentation\.title\}<\/strong> : null/);
  assert.match(choices, /<span id=\{provider === "paypal" \? headingId : undefined\}>\{presentation\.providerLabel\}<\/span>/);
  assert.doesNotMatch(choices, /<strong id=\{headingId\}>\{presentation\.title\}<\/strong>\s*<span>/);
  assert.doesNotMatch(choices, /paypalobjects\.com|paypal\.com\/.*\.svg|<script/);
  assert.equal(digest, "c2654a3c25ef2a429934e80d8b66ecf5c9dfe998250d9f046ecfe8e11f7fb4f5");
  assert.match(asset, /^<svg\b/);
  assert.doesNotMatch(asset, /<script|<foreignObject|(?:href|src)=["'](?:https?:|data:)/i);
  assert.match(css, /@media \(min-width: 760px\) \{[\s\S]*?\.payment-methods__actions \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.payment-methods__choice:only-child \{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?width: min\(100%, 36rem\);[\s\S]*?justify-self: center;/);
  assert.match(css, /\.payment-methods__choice \.checkout-action \.form-button \{[\s\S]*?min-height: 56px;/);
});
