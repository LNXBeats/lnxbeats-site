import assert from "node:assert/strict";
import test from "node:test";

import {
  checkoutLineItemsFromOrderSnapshot,
  nextPaymentStatusFromCheckoutEvent,
  normalizePaymentMethod,
  PaymentDomainError,
  validateOrderPaymentSnapshot,
} from "@/lib/payments/domain";
import { paymentMethodPresentation, paymentStatusPresentation } from "@/lib/payments/presentation";
import type { OrderPaymentSnapshot } from "@/lib/payments/types";

function snapshot(
  coverIncluded: boolean,
  priorityProcessing: boolean,
  pricingVersion: "2026-08-v1" | "2026-08-v2" = "2026-08-v2",
): OrderPaymentSnapshot {
  const basePriceCents = pricingVersion === "2026-08-v1" ? 5_000 : 2_000;
  const coverPriceCents = coverIncluded ? 1_000 : 0;
  const priorityPriceCents = priorityProcessing ? 3_000 : 0;
  return {
    coverIncluded,
    priorityProcessing,
    basePriceCents,
    coverPriceCents,
    priorityPriceCents,
    totalCents: basePriceCents + coverPriceCents + priorityPriceCents,
    currency: "EUR",
    pricingVersion,
  };
}

test("validates the four current server pricing snapshots", () => {
  const scenarios = [
    [false, false, 2_000],
    [true, false, 3_000],
    [false, true, 5_000],
    [true, true, 6_000],
  ] as const;

  for (const [coverIncluded, priorityProcessing, amountCents] of scenarios) {
    assert.deepEqual(validateOrderPaymentSnapshot(snapshot(coverIncluded, priorityProcessing)), {
      ok: true,
      amountCents,
      currency: "EUR",
      pricingVersion: "2026-08-v2",
    });
  }
});

test("accepts historical v1 snapshots without recalculating them", () => {
  const legacy = snapshot(false, false, "2026-08-v1");
  assert.deepEqual(validateOrderPaymentSnapshot(legacy), {
    ok: true,
    amountCents: 5_000,
    currency: "EUR",
    pricingVersion: "2026-08-v1",
  });
  assert.deepEqual(
    validateOrderPaymentSnapshot({ ...legacy, basePriceCents: 2_000, totalCents: 2_000 }),
    { ok: false, code: "INVALID_BASE_PRICE" },
  );
  const current = snapshot(false, false);
  assert.deepEqual(
    validateOrderPaymentSnapshot({ ...current, basePriceCents: 5_000, totalCents: 5_000 }),
    { ok: false, code: "INVALID_BASE_PRICE" },
  );
});

test("rejects altered currency, version, components and totals", () => {
  const valid = snapshot(true, true);
  const invalid = [
    [{ ...valid, currency: "USD" }, "INVALID_CURRENCY"],
    [{ ...valid, pricingVersion: "legacy" }, "INVALID_PRICING_VERSION"],
    [{ ...valid, totalCents: Number.NaN }, "INVALID_AMOUNT"],
    [{ ...valid, basePriceCents: 1 }, "INVALID_BASE_PRICE"],
    [{ ...valid, coverPriceCents: 0 }, "INVALID_COVER_PRICE"],
    [{ ...valid, priorityPriceCents: 0 }, "INVALID_PRIORITY_PRICE"],
    [{ ...valid, totalCents: 5_999 }, "INVALID_TOTAL"],
  ] as const;

  for (const [altered, code] of invalid) {
    assert.deepEqual(validateOrderPaymentSnapshot(altered), { ok: false, code });
    assert.throws(
      () => checkoutLineItemsFromOrderSnapshot(altered),
      (error) => error instanceof PaymentDomainError && error.code === code,
    );
  }
});

test("builds fixed-quantity Checkout lines exclusively from the stored snapshot", () => {
  const forgedClientFields = {
    amount: 1,
    amountCents: 1,
    currency: "EUR",
    quantity: 12,
    userId: "attacker",
    successUrl: "https://attacker.example.invalid",
  };
  const trustedSnapshot = { ...snapshot(true, true), ...forgedClientFields, currency: "EUR" };
  const lineItems = checkoutLineItemsFromOrderSnapshot(trustedSnapshot);

  assert.deepEqual(lineItems.map((item) => ({
    name: item.price_data.product_data.name,
    amount: item.price_data.unit_amount,
    quantity: item.quantity,
    currency: item.price_data.currency,
  })), [
    { name: "Création musicale personnalisée LNX Beats", amount: 2_000, quantity: 1, currency: "eur" },
    { name: "Cover personnalisée", amount: 1_000, quantity: 1, currency: "eur" },
    { name: "Traitement prioritaire", amount: 3_000, quantity: 1, currency: "eur" },
  ]);
  assert.equal(lineItems.reduce((sum, item) => sum + item.price_data.unit_amount, 0), 6_000);
  assert.equal(JSON.stringify(lineItems).includes("attacker"), false);
  assert.equal(JSON.stringify(lineItems).includes("example.invalid"), false);
});

test("builds a historical v1 Checkout line from the persisted snapshot", () => {
  const lineItems = checkoutLineItemsFromOrderSnapshot(snapshot(false, false, "2026-08-v1"));
  assert.equal(lineItems.length, 1);
  assert.equal(lineItems[0]?.price_data.unit_amount, 5_000);
});

test("normalizes only known payment methods", () => {
  assert.equal(normalizePaymentMethod("card"), "CARD");
  assert.equal(normalizePaymentMethod(" PayPal "), "PAYPAL");
  assert.equal(normalizePaymentMethod("WERO"), "WERO");
  assert.equal(normalizePaymentMethod("link"), "OTHER");
  assert.equal(normalizePaymentMethod(null), "OTHER");
});

test("exposes reusable human payment labels without raw Stripe event names", () => {
  assert.equal(paymentStatusPresentation.SUCCEEDED, "Paiement confirmé");
  assert.equal(paymentStatusPresentation.REQUIRES_REVIEW, "Paiement à vérifier");
  assert.equal(paymentMethodPresentation.PAYPAL, "PayPal");
  assert.doesNotMatch(JSON.stringify(paymentStatusPresentation), /checkout\.session|payment_intent/);
});

test("maps Checkout lifecycle events without ever regressing a success", () => {
  assert.equal(nextPaymentStatusFromCheckoutEvent("CREATED", {
    type: "checkout.session.completed",
    paymentStatus: "unpaid",
  }), "PENDING");
  assert.equal(nextPaymentStatusFromCheckoutEvent("CREATED", {
    type: "checkout.session.completed",
    paymentStatus: "paid",
  }), "SUCCEEDED");
  assert.equal(nextPaymentStatusFromCheckoutEvent("PENDING", {
    type: "checkout.session.async_payment_succeeded",
  }), "SUCCEEDED");
  assert.equal(nextPaymentStatusFromCheckoutEvent("PENDING", {
    type: "checkout.session.async_payment_failed",
  }), "FAILED");
  assert.equal(nextPaymentStatusFromCheckoutEvent("PENDING", {
    type: "checkout.session.expired",
  }), "EXPIRED");

  for (const event of [
    { type: "checkout.session.completed", paymentStatus: "unpaid" },
    { type: "checkout.session.async_payment_failed" },
    { type: "checkout.session.expired" },
  ] as const) {
    assert.equal(nextPaymentStatusFromCheckoutEvent("SUCCEEDED", event), "SUCCEEDED");
  }
  assert.equal(nextPaymentStatusFromCheckoutEvent("FAILED", {
    type: "checkout.session.completed",
    paymentStatus: "unpaid",
  }), "FAILED");
  assert.equal(nextPaymentStatusFromCheckoutEvent("FAILED", {
    type: "checkout.session.async_payment_succeeded",
  }), "SUCCEEDED");
  assert.equal(nextPaymentStatusFromCheckoutEvent("REFUNDED", {
    type: "checkout.session.async_payment_succeeded",
  }), "REFUNDED");
});
