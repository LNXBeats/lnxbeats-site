import assert from "node:assert/strict";
import test from "node:test";

import {
  getAdminOrderTransition,
  getAllowedOrderTransitions,
  getOrderTransitionTimestamps,
  normalizeAdminNote,
} from "@/lib/admin/order-machine";

test("the admin state machine only exposes contextual transitions", () => {
  assert.deepEqual(getAllowedOrderTransitions("DRAFT"), []);
  assert.deepEqual(getAllowedOrderTransitions("DELIVERED"), []);
  assert.equal(getAdminOrderTransition("REVIEWING", "ACCEPTED")?.label, "Accepter la création");
  assert.equal(getAdminOrderTransition("REVIEWING", "DELIVERED"), null);
  assert.equal(getAdminOrderTransition("AWAITING_PAYMENT", "PAYMENT_CONFIRMED"), null);
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
  assert.deepEqual(getOrderTransitionTimestamps("DELIVERED", now), { deliveredAt: now });
  assert.deepEqual(getOrderTransitionTimestamps("CANCELLED", now), { cancelledAt: now });
  assert.deepEqual(getOrderTransitionTimestamps("REVIEWING", now), {});
});

test("internal notes are trimmed and bounded", () => {
  assert.equal(normalizeAdminNote("  Note interne  "), "Note interne");
  assert.equal(normalizeAdminNote(""), null);
  assert.equal(normalizeAdminNote("x".repeat(1_001)), null);
  assert.equal(normalizeAdminNote({ note: "forged" }), null);
});
