import assert from "node:assert/strict";
import test from "node:test";

import { planShopPaymentReconciliation, type ShopPaymentReconciliationSnapshot } from "@/lib/shop/payment-domain";

const successEvent = {
  eventId: "evt_shop_1",
  type: "checkout.session.completed",
  provider: "STRIPE",
  livemode: false,
  paymentId: "11111111-1111-4111-8111-111111111111",
  providerCheckoutId: "cs_test_shop",
  providerPaymentId: "pi_test_shop",
  amountCents: 3_000,
  currency: "EUR",
  status: "SUCCEEDED",
  occurredAt: new Date("2026-08-27T20:00:00.000Z"),
  paymentMethod: "CARD",
} as const;

const snapshot = {
  payment: {
    id: successEvent.paymentId,
    orderId: null,
    shopOrderId: "22222222-2222-4222-8222-222222222222",
    provider: "STRIPE",
    mode: "TEST",
    status: "PENDING",
    amountCents: 3_000,
    currency: "EUR",
    pricingVersion: "shop-order-v1",
    providerCheckoutId: successEvent.providerCheckoutId,
    providerPaymentId: null,
    paidAt: null,
  },
  shopOrder: {
    id: "22222222-2222-4222-8222-222222222222",
    totalCents: 3_000,
    currency: "EUR",
    status: "OPEN",
    paymentStatus: "AWAITING_PAYMENT",
    paymentReviewAt: null,
    paymentReviewCode: null,
  },
  event: successEvent,
  providerIdentifiersBelongToAnotherPayment: false,
  shopOrderSnapshotValid: true,
  reservationValid: true,
} as const satisfies ShopPaymentReconciliationSnapshot;

test("a matching success with an active reservation reaches the atomic stock gate", () => {
  assert.deepEqual(planShopPaymentReconciliation(snapshot), { action: "CHECK_STOCK" });
});

test("a concurrent provider winner converts a later authentic capture to review", () => {
  assert.deepEqual(planShopPaymentReconciliation({
    ...snapshot,
    otherWinningPaymentId: "33333333-3333-4333-8333-333333333333",
  }), {
    action: "REVIEW_OTHER_WINNER",
    reviewCode: "SHOP_PAYMENT_ALREADY_CAPTURED",
    captured: true,
    winningPaymentId: "33333333-3333-4333-8333-333333333333",
  });
});

test("an authentic capture after reservation expiry is preserved for operator review", () => {
  assert.deepEqual(planShopPaymentReconciliation({
    ...snapshot,
    shopOrder: { ...snapshot.shopOrder, status: "EXPIRED" },
    reservationValid: false,
  }), {
    action: "REVIEW_EXPIRED",
    reviewCode: "SHOP_RESERVATION_EXPIRED_AFTER_CAPTURE",
    captured: true,
  });
});

test("a pre-existing Shop payment review prevents a later capture from confirming stock", () => {
  assert.deepEqual(planShopPaymentReconciliation({
    ...snapshot,
    shopOrder: {
      ...snapshot.shopOrder,
      paymentReviewAt: new Date("2026-08-27T19:59:00.000Z"),
      paymentReviewCode: "SHOP_PAYMENT_EVIDENCE_MISMATCH",
    },
  }), {
    action: "REVIEW_OPEN",
    reviewCode: "SHOP_PAYMENT_EVIDENCE_MISMATCH",
    captured: true,
  });
});

test("amount, source, mode and provider identifier conflicts fail closed", () => {
  assert.deepEqual(planShopPaymentReconciliation({
    ...snapshot,
    event: { ...successEvent, amountCents: 2_999 },
  }), {
    action: "REVIEW_EVIDENCE",
    reviewCode: "SHOP_PAYMENT_EVIDENCE_MISMATCH",
    captured: true,
  });
  assert.equal(planShopPaymentReconciliation({
    ...snapshot,
    event: { ...successEvent, currency: "USD" },
  }).action, "REVIEW_EVIDENCE");
  assert.equal(planShopPaymentReconciliation({
    ...snapshot,
    event: { ...successEvent, evidenceConsistent: false },
  }).action, "REVIEW_EVIDENCE");
  assert.equal(planShopPaymentReconciliation({
    ...snapshot,
    payment: { ...snapshot.payment, orderId: "44444444-4444-4444-8444-444444444444" },
  }).action, "REVIEW_EVIDENCE");
  assert.equal(planShopPaymentReconciliation({
    ...snapshot,
    shopOrder: { ...snapshot.shopOrder, totalCents: 3_001 },
  }).action, "REVIEW_EVIDENCE");
  assert.equal(planShopPaymentReconciliation({
    ...snapshot,
    shopOrderSnapshotValid: false,
  }).action, "REVIEW_EVIDENCE");
  assert.equal(planShopPaymentReconciliation({
    ...snapshot,
    event: { ...successEvent, providerSourcePaymentId: "44444444-4444-4444-8444-444444444444" },
  }).action, "REVIEW_EVIDENCE");
  assert.equal(planShopPaymentReconciliation({
    ...snapshot,
    event: { ...successEvent, providerSourceShopOrderId: "55555555-5555-4555-8555-555555555555" },
  }).action, "REVIEW_EVIDENCE");
  assert.equal(planShopPaymentReconciliation({
    ...snapshot,
    event: { ...successEvent, status: "FAILED", amountCents: 2_999, paymentMethod: undefined },
  }).action, "REVIEW_EVIDENCE");
  assert.equal(planShopPaymentReconciliation({
    ...snapshot,
    providerIdentifiersBelongToAnotherPayment: true,
  }).action, "REVIEW_EVIDENCE");
  assert.equal(planShopPaymentReconciliation({
    ...snapshot,
    providerIdentifiersBelongToAnotherPayment: true,
    otherWinningPaymentId: "33333333-3333-4333-8333-333333333333",
  }).action, "REVIEW_EVIDENCE");
});

test("a replay of the winning success is a no-op and a terminal failure cannot regress it", () => {
  const alreadyPaid = {
    ...snapshot,
    payment: { ...snapshot.payment, status: "SUCCEEDED" as const },
    shopOrder: { ...snapshot.shopOrder, paymentStatus: "PAID" as const },
  };
  assert.deepEqual(planShopPaymentReconciliation(alreadyPaid), {
    action: "REPLAY_SUCCESS",
    requiresReview: false,
  });
  assert.deepEqual(planShopPaymentReconciliation({
    ...alreadyPaid,
    event: { ...successEvent, status: "FAILED" as const },
  }), { action: "IGNORE_TERMINAL_FAILURE" });
});

test("pending and failed attempts never confirm the ShopOrder", () => {
  assert.deepEqual(planShopPaymentReconciliation({
    ...snapshot,
    event: { ...successEvent, status: "PENDING" as const, providerPaymentId: undefined, paymentMethod: undefined },
  }), { action: "RECORD_PENDING" });
  assert.deepEqual(planShopPaymentReconciliation({
    ...snapshot,
    event: { ...successEvent, status: "FAILED" as const, providerPaymentId: undefined, paymentMethod: undefined },
  }), { action: "RECORD_FAILURE" });

  assert.deepEqual(planShopPaymentReconciliation({
    ...snapshot,
    payment: {
      ...snapshot.payment,
      status: "REQUIRES_REVIEW",
      paidAt: successEvent.occurredAt,
    },
    event: {
      ...successEvent,
      status: "FAILED" as const,
      providerPaymentId: undefined,
      paymentMethod: undefined,
    },
  }), { action: "IGNORE_TERMINAL_FAILURE" });
});
