import assert from "node:assert/strict";
import test from "node:test";

import {
  getAdminOrderTransition,
  getAllowedOrderTransitions,
  getOrderDeletionEligibility,
  getOrderTransitionTimestamps,
  normalizeAdminNote,
} from "@/lib/admin/order-machine";

test("the admin state machine only exposes contextual transitions", () => {
  assert.deepEqual(getAllowedOrderTransitions("DRAFT"), []);
  assert.deepEqual(getAllowedOrderTransitions("DELIVERED"), []);
  assert.equal(getAdminOrderTransition("REVIEWING", "ACCEPTED")?.label, "Accepter la création");
  assert.equal(getAdminOrderTransition("REVIEWING", "DELIVERED"), null);
  assert.equal(getAdminOrderTransition("AWAITING_PAYMENT", "PAYMENT_CONFIRMED"), null);
  assert.equal(getAdminOrderTransition("AWAITING_PAYMENT", "RECEIVED"), null);
  assert.equal(getAdminOrderTransition("PAYMENT_CONFIRMED", "RECEIVED")?.label, "Confirmer la réception");
});

test("the fulfillment transition matrix is closed and cannot skip payment or production", () => {
  const expected = {
    DRAFT: [], AWAITING_PAYMENT: ["CANCELLED"], PAYMENT_CONFIRMED: ["RECEIVED"],
    RECEIVED: ["REVIEWING", "REFUSED"], SUBMITTED: ["REVIEWING", "REFUSED"],
    REVIEWING: ["ACCEPTED", "REFUSED"], ACCEPTED: ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["FIRST_VERSION_READY", "CANCELLED"],
    FIRST_VERSION_READY: ["REVISION_REQUESTED", "FINALIZING"],
    REVISION_REQUESTED: ["IN_PROGRESS"], FINALIZING: ["DELIVERED"],
    DELIVERED: [], REFUSED: [], CANCELLED: [], REFUND_PENDING: [], REFUNDED: [],
  } as const;
  for (const [status, targets] of Object.entries(expected)) {
    assert.deepEqual(getAllowedOrderTransitions(status as keyof typeof expected).map(({ to }) => to), targets);
  }
  assert.equal(getAdminOrderTransition("AWAITING_PAYMENT", "IN_PROGRESS"), null);
  assert.equal(getAdminOrderTransition("AWAITING_PAYMENT", "DELIVERED"), null);
  assert.equal(getAdminOrderTransition("DELIVERED", "DRAFT"), null);
});

test("payment and refund statuses cannot be forged by the admin cockpit", () => {
  const sourceStatuses = ["AWAITING_PAYMENT", "RECEIVED", "REVIEWING", "ACCEPTED", "IN_PROGRESS", "FINALIZING"] as const;
  for (const status of sourceStatuses) {
    assert.equal(getAdminOrderTransition(status, "PAYMENT_CONFIRMED"), null);
    assert.equal(getAdminOrderTransition(status, "REFUNDED"), null);
  }
});

test("business timestamps are derived from the target status", () => {
  const now = new Date("2026-08-11T12:00:00.000Z");
  assert.deepEqual(getOrderTransitionTimestamps("IN_PROGRESS", now), { serviceStartedAt: now });
  assert.deepEqual(getOrderTransitionTimestamps("DELIVERED", now), {
    deliveredAt: now,
    downloadExpiresAt: new Date("2027-02-11T12:00:00.000Z"),
  });
  assert.deepEqual(getOrderTransitionTimestamps("CANCELLED", now), { cancelledAt: now });
  assert.deepEqual(getOrderTransitionTimestamps("REVIEWING", now), {});
});

test("internal notes are trimmed and bounded", () => {
  assert.equal(normalizeAdminNote("  Note interne  "), "Note interne");
  assert.equal(normalizeAdminNote(""), null);
  assert.equal(normalizeAdminNote("x".repeat(1_001)), null);
  assert.equal(normalizeAdminNote({ note: "forged" }), null);
});

const deletionFixture = (overrides: Partial<Parameters<typeof getOrderDeletionEligibility>[0]> = {}) => ({
  status: "CANCELLED" as const,
  serviceStartedAt: null,
  deliveredAt: null,
  events: [{ toStatus: "AWAITING_PAYMENT" as const }, { toStatus: "CANCELLED" as const }],
  assets: [{ role: "REFERENCE" as const }],
  commercialLicenses: [],
  rightsRequests: [],
  payments: [],
  ...overrides,
});

test("only unpaid drafts or cancelled orders without legal retention signals are deletable", () => {
  assert.equal(getOrderDeletionEligibility(deletionFixture()).eligible, true);
  assert.equal(getOrderDeletionEligibility(deletionFixture({ status: "DRAFT" })).eligible, true);
  assert.equal(getOrderDeletionEligibility(deletionFixture({ status: "IN_PROGRESS" })).eligible, false);
  assert.equal(getOrderDeletionEligibility(deletionFixture({ serviceStartedAt: new Date() })).eligible, false);
  assert.equal(getOrderDeletionEligibility(deletionFixture({ deliveredAt: new Date() })).eligible, false);
  assert.equal(getOrderDeletionEligibility(deletionFixture({ commercialLicenses: [{}] })).eligible, false);
  assert.equal(getOrderDeletionEligibility(deletionFixture({ rightsRequests: [{}] })).eligible, false);
  assert.equal(getOrderDeletionEligibility(deletionFixture({ payments: [{}] })).eligible, false);
  assert.equal(getOrderDeletionEligibility(deletionFixture({ assets: [{ role: "DELIVERY" }] })).eligible, false);
  assert.equal(getOrderDeletionEligibility(deletionFixture({ events: [{ toStatus: "PAYMENT_CONFIRMED" }] })).eligible, false);
});
