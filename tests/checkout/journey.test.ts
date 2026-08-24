import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  clientOrderAction,
  clientPaymentPresentation,
  clientPaymentState,
  orderCanStillBeEdited,
} from "@/lib/orders/checkout";

type OrderState = Parameters<typeof clientPaymentState>[0];

function order(status: OrderState["status"], paymentStatus?: OrderState["payments"][number]["status"]): OrderState {
  return {
    status,
    payments: paymentStatus ? [{
      id: "payment-fixture",
      provider: "STRIPE",
      status: paymentStatus,
      amountCents: 5_000,
      currency: "EUR",
      paymentMethod: null,
      checkoutExpiresAt: null,
      paidAt: null,
      failedAt: null,
      expiredAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }] : [],
  };
}

test("maps draft, pending, success, failure, expiry and cancellation to human client states", () => {
  assert.equal(clientPaymentState(order("DRAFT")), "draft");
  assert.equal(clientPaymentState(order("AWAITING_PAYMENT")), "ready");
  assert.equal(clientPaymentState(order("AWAITING_PAYMENT", "PENDING")), "confirming");
  assert.equal(clientPaymentState(order("AWAITING_PAYMENT", "FAILED")), "failed");
  assert.equal(clientPaymentState(order("AWAITING_PAYMENT", "EXPIRED")), "expired");
  assert.equal(clientPaymentState(order("PAYMENT_CONFIRMED", "SUCCEEDED")), "confirmed");
  assert.equal(clientPaymentState(order("CANCELLED", "CANCELED")), "cancelled");
  assert.equal(clientOrderAction(order("AWAITING_PAYMENT", "FAILED")), "Réessayer le paiement");
  assert.equal(clientPaymentPresentation(order("PAYMENT_CONFIRMED", "SUCCEEDED")), "Paiement confirmé");
});

test("permits editing only before a payment or after every attempt is terminal", () => {
  assert.equal(orderCanStillBeEdited(order("DRAFT")), true);
  assert.equal(orderCanStillBeEdited(order("AWAITING_PAYMENT")), true);
  assert.equal(orderCanStillBeEdited(order("AWAITING_PAYMENT", "EXPIRED")), true);
  assert.equal(orderCanStillBeEdited(order("AWAITING_PAYMENT", "PENDING")), false);
  assert.equal(orderCanStillBeEdited(order("PAYMENT_CONFIRMED", "SUCCEEDED")), false);
});

test("Commander keeps a six-step brief in memory across authentication without sensitive browser storage", () => {
  const form = readFileSync("components/music-order-form.tsx", "utf8");
  const provider = readFileSync("components/order-journey-provider.tsx", "utf8");
  assert.match(form, /Projet.*Histoire.*Options.*Références.*Compte.*Récapitulatif & paiement/s);
  assert.match(form, /useOrderJourneyMemory/);
  assert.match(form, /journey\.preserve\(\{[\s\S]*form,[\s\S]*step: 4,[\s\S]*pendingFiles,[\s\S]*photoRightsConfirmed,[\s\S]*\}\)/);
  assert.doesNotMatch(provider, /pendingAudioFiles|audioRightsConfirmed/);
  assert.doesNotMatch(form, /100 Mo maximum par fichier|references\/audio|fichier audio client/i);
  assert.match(form, /brouillon=\$\{encodeURIComponent\(persistedOrderNumber\)\}&etape=\$\{stepQueryValues\[bounded\]\}/);
  assert.doesNotMatch(`${form}\n${provider}`, /(?:localStorage|sessionStorage)\s*(?:\[|\.)\s*(?:getItem|setItem|removeItem)|indexedDB\s*\.\s*open/i);
  assert.doesNotMatch(form, /label[^>]*>[^<]*(mots ou expressions|éléments à éviter|prononciation)/i);
  assert.match(form, /Détails importants/);
});

test("recap and confirmation use server Orders while the client sends no amount", () => {
  const form = readFileSync("components/music-order-form.tsx", "utf8");
  const checkoutAction = readFileSync("components/stripe-checkout-action.tsx", "utf8");
  const providerActions = readFileSync("components/payment-checkout-actions.tsx", "utf8");
  const paypalAction = readFileSync("components/paypal-checkout-action.tsx", "utf8");
  const confirmation = readFileSync("app/commande/[orderNumber]/confirmation/page.tsx", "utf8");
  assert.match(form, /Enregistrer et passer au paiement/);
  assert.match(form, /PaymentCheckoutActions/);
  assert.match(providerActions, /Carte bancaire — Stripe/);
  assert.match(providerActions, /PayPal/);
  assert.doesNotMatch(checkoutAction, /body:\s*JSON\.stringify\([^)]*(?:amount|currency)/s);
  assert.doesNotMatch(paypalAction, /body:\s*JSON\.stringify\([^)]*(?:amount|currency)/s);
  assert.match(confirmation, /getOrderForActor\(actor, orderNumber\)/);
  assert.match(confirmation, /clientPaymentState\(order\)/);
  assert.match(confirmation, /returnState === "cancel" && paymentState === "confirming"/);
  assert.doesNotMatch(confirmation, /session_id.*(?:update|create|confirm)/s);
});

test("public checkout wording stays provider-neutral and never exposes QA environments", () => {
  const commander = readFileSync("app/commander/page.tsx", "utf8");
  const form = readFileSync("components/music-order-form.tsx", "utf8");
  const stripe = readFileSync("components/stripe-checkout-action.tsx", "utf8");
  const paypal = readFileSync("components/paypal-checkout-action.tsx", "utf8");
  const account = readFileSync("app/compte/commandes/[orderNumber]/page.tsx", "utf8");
  assert.match(commander, /Le paiement sera proposé après validation du récapitulatif lorsqu’un moyen de paiement est disponible/);
  assert.match(commander, /Paiement fermé dans cet environnement/);
  assert.doesNotMatch(commander, /paiement sandbox/i);
  assert.doesNotMatch(form, /provider sandbox/i);
  assert.doesNotMatch(stripe, /Stripe Test|environnement Test/i);
  assert.doesNotMatch(paypal, /PayPal Sandbox/i);
  assert.doesNotMatch(account, /environnements sandbox/i);
});

test("Commander and Boutique retain their editorial identity with denser responsive spacing", () => {
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.editorial-break \{[\s\S]*?linear-gradient\(180deg, #ddd2c0 0, var\(--paper\) 12%, var\(--paper\) 88%, #ddd2c0 100%\)/);
  assert.match(css, /\.editorial-break \.editorial-copy p \{ color: #575147; \}/);
  assert.match(css, /\.shop-card \{[\s\S]*?min-height: 480px;/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.shop-card \{ min-height: 400px; \}/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.shop-card \{ min-height: 360px; padding: 1\.5rem; \}/);
  assert.doesNotMatch(css, /\.shop-card \{ min-height: 560px; overflow: hidden;/);
});

test("Compte and Admin separate unpaid checkout from paid work", () => {
  const account = readFileSync("app/compte/page.tsx", "utf8");
  const adminService = readFileSync("lib/admin/service.ts", "utf8");
  const adminPage = readFileSync("app/admin/commandes/page.tsx", "utf8");
  assert.match(account, /Paiement et confirmation/);
  assert.match(account, /clientPaymentPresentation/);
  assert.match(account, /Options :/);
  assert.match(adminService, /pendingStatuses.*DRAFT.*AWAITING_PAYMENT/);
  assert.match(adminService, /PAYMENT_CONFIRMED/);
  assert.match(adminPage, /Paiements à vérifier/);
});

test("the Safari browser fixture cleanup targets only its loopback auth buckets", () => {
  const fixture = readFileSync("scripts/checkout-browser-fixture.ts", "utf8");
  assert.match(fixture, /127\.0\.0\.1\|\/sign-in\/email/);
  assert.match(fixture, /127\.0\.0\.1\|\/sign-out/);
  assert.match(fixture, /0000:0000:0000:0000:0000:0000:0000:0000\|\/sign-in\/email/);
  assert.match(fixture, /0000:0000:0000:0000:0000:0000:0000:0000\|\/sign-out/);
  assert.doesNotMatch(fixture, /rateLimit\.deleteMany\(\{\s*\}\)/);
});
