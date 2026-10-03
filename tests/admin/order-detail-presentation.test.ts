import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getOrderDetailAttention } from "@/lib/admin/order-detail-presentation";
import type { OrderVisibilityGuardSnapshot } from "@/lib/admin/order-visibility";

const settled = (): OrderVisibilityGuardSnapshot => ({
  status: "IN_PROGRESS", payments: [{ status: "SUCCEEDED", incidents: [], events: [], refundAttempts: [] }],
  rightsRequests: [], withdrawalRequests: [], notifications: [{ status: "SENT" }],
});

test("settled information can be disclosed progressively, without changing order data", () => {
  const order = settled();
  const before = JSON.stringify(order);
  assert.deepEqual(getOrderDetailAttention(order), { finance: false, withdrawal: false, rights: false, notifications: false });
  assert.equal(JSON.stringify(order), before);
});

test("a refused or canceled paid order keeps the refund decision visible", () => {
  for (const status of ["REFUSED", "CANCELLED", "REFUNDED"] as const) {
    assert.equal(getOrderDetailAttention({ ...settled(), status }).finance, true);
  }
});

test("payment reconciliation and every pending refund remain prominent even on an active order", () => {
  for (const status of ["CREATED", "PENDING", "REQUIRES_REVIEW", "REFUND_PENDING"]) {
    assert.equal(getOrderDetailAttention({ ...settled(), payments: [{ status, incidents: [], events: [], refundAttempts: [] }] }).finance, true);
  }
  for (const status of ["PENDING", "PROCESSING", "REQUIRES_REVIEW"]) {
    assert.equal(getOrderDetailAttention({ ...settled(), payments: [{ ...settled().payments[0], refundAttempts: [{ status }] }] }).finance, true);
  }
  for (const field of ["incidents", "events"] as const) {
    assert.equal(getOrderDetailAttention({ ...settled(), payments: [{ ...settled().payments[0], [field]: [{}] }] }).finance, true);
  }
});

test("withdrawals and contractual decisions cannot be hidden by progressive disclosure", () => {
  assert.equal(getOrderDetailAttention({ ...settled(), withdrawalRequests: [{ status: "OPEN", refundStatus: "REFUND_REQUIRED" }] }).withdrawal, true);
  assert.equal(getOrderDetailAttention({ ...settled(), rightsRequests: [{ status: "REQUESTED" }] }).rights, true);
  assert.equal(getOrderDetailAttention({ ...settled(), rightsRequests: [{ status: "UNKNOWN_FUTURE" }] }).rights, true);
});

test("failed, queued and unknown notifications keep their panel open", () => {
  for (const status of ["PENDING", "PROCESSING", "FAILED", "FAILED_FINAL", "BOUNCED", "UNKNOWN_FUTURE"]) {
    assert.equal(getOrderDetailAttention({ ...settled(), notifications: [{ status }] }).notifications, true);
  }
});

test("actions and private delivery precede the brief and financial diagnostics in DOM order", async () => {
  const page = await readFile(new URL("../../app/admin/commandes/[orderNumber]/page.tsx", import.meta.url), "utf8");
  assert.ok(page.indexOf("<AdminOrderActions") < page.indexOf('aria-labelledby="admin-brief-title"'));
  assert.ok(page.indexOf("<AdminOrderDeliveryPanel") < page.indexOf('aria-labelledby="admin-brief-title"'));
  assert.match(page, /open=\{attention.finance \|\| canRunStripeTest\}/);
  assert.match(page, /open=\{attention.rights\}/);
  assert.match(page, /open=\{attention.notifications\}/);
  assert.match(page, /await requireAdmin\(\)/);
  assert.match(page, /orderAcceptsDeliveryUpload\(order.status, hasSuccessfulPayment\)/);
  assert.match(page, /evaluateOrderCurrentViewVisibility\(order\)/);
  assert.match(page, /\?download=1/);
  for (const field of ["wordsToInclude", "avoid", "pronunciationNotes", "notes"]) {
    assert.ok(page.includes(`{order.${field}}`), `saved brief field ${field} remains visible`);
  }
  assert.equal((page.match(/<AdminOrderActions/g) ?? []).length, 1);
  assert.equal((page.match(/<AdminOrderDeliveryPanel/g) ?? []).length, 1);
});
