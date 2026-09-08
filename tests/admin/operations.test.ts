import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  adminOrderFilters,
  adminShopOrderFilters,
  classifyCommanderOperation,
  classifyNotificationOperation,
  classifyRightsOperation,
  classifyShopOrderOperation,
  classifyShopReturnOperation,
  classifyUncorrelatedFinancialEventOperation,
  commanderOrderMatchesFilter,
  shopOrderMatchesFilter,
  sortAdminActionItems,
  type AdminOrderFilter,
} from "@/lib/admin/operations";
import {
  adminNotificationAttentionWhere,
  adminPaymentReviewEventWhere,
  adminUncorrelatedPaymentReviewEventWhere,
} from "@/lib/admin/operation-queries";
import type { KnownOrderStatus } from "@/lib/orders/status";

const commanderStatuses: readonly KnownOrderStatus[] = [
  "DRAFT", "AWAITING_PAYMENT", "PAYMENT_CONFIRMED", "RECEIVED", "SUBMITTED", "REVIEWING",
  "ACCEPTED", "IN_PROGRESS", "FIRST_VERSION_READY", "REVISION_REQUESTED", "FINALIZING",
  "DELIVERED", "REFUSED", "CANCELLED", "REFUND_PENDING", "REFUNDED",
];

test("Commander filters cover every state and resurface archived records only when actionable", () => {
  assert.deepEqual(adminOrderFilters, ["attention", "active", "pending", "completed", "archives", "all"]);
  for (const status of commanderStatuses) {
    const snapshot = { status } as const;
    const visibleFilters: AdminOrderFilter[] = [...adminOrderFilters]
      .filter((candidate: AdminOrderFilter) => commanderOrderMatchesFilter(snapshot, candidate));
    assert.ok(visibleFilters.includes("all"), status);
    assert.ok(visibleFilters.some((filter) => filter !== "all"), status);
    assert.equal(commanderOrderMatchesFilter({ status, archived: true }, "all"), false, status);
    assert.equal(commanderOrderMatchesFilter({ status, archived: true }, "archives"), true, status);
  }
});

test("Commander action classification prioritizes durable financial state", () => {
  assert.equal(classifyCommanderOperation({ status: "DELIVERED" }), null);
  assert.equal(classifyCommanderOperation({ status: "REVIEWING" })?.reasonCode, "ORDER_REVIEWING");
  assert.equal(classifyCommanderOperation({ status: "REVIEWING", hasRightsReview: true })?.reasonCode, "RIGHTS_REVIEW");
  assert.equal(classifyCommanderOperation({ status: "REFUSED", hasRefundDue: true })?.reasonCode, "REFUND_DECISION");
  assert.equal(classifyCommanderOperation({ status: "REFUSED", hasRefundDue: true, hasRefundPending: true })?.reasonCode, "REFUND_RECONCILIATION");
  assert.equal(classifyCommanderOperation({ status: "REVIEWING", hasPaymentReview: true })?.reasonCode, "PAYMENT_REVIEW");
  assert.equal(classifyCommanderOperation({ status: "REVIEWING", hasPaymentReview: true, hasUnresolvedFinancialIncident: true })?.reasonCode, "FINANCIAL_INCIDENT");
  assert.equal(classifyCommanderOperation({ status: "REVIEWING", archived: true })?.reasonCode, "ORDER_REVIEWING");
  assert.equal(classifyCommanderOperation({ status: "REFUSED", archived: true, hasRefundDue: true })?.reasonCode, "REFUND_DECISION");
  assert.equal(commanderOrderMatchesFilter({ status: "REFUSED", archived: true, hasRefundDue: true }, "attention"), true);
  assert.equal(classifyCommanderOperation({ status: "REFUNDED", hasRefundContradiction: true })?.reasonCode, "REFUND_STATE_CONTRADICTION");
  assert.equal(commanderOrderMatchesFilter({ status: "REFUNDED", archived: true, hasRefundContradiction: true }, "attention"), true);
});

const baseShopOrder = {
  status: "OPEN",
  paymentStatus: "PAID",
  fulfillmentStatus: "PENDING",
  paymentReviewAt: null,
} as const;

test("Shop filters separate customer payment waiting, fulfillment and history", () => {
  assert.deepEqual(adminShopOrderFilters, ["attention", "active", "pending", "completed", "archives", "all"]);
  assert.equal(shopOrderMatchesFilter(baseShopOrder, "active"), true);
  assert.equal(shopOrderMatchesFilter(baseShopOrder, "attention"), true);
  assert.equal(shopOrderMatchesFilter({ ...baseShopOrder, paymentStatus: "AWAITING_PAYMENT" }, "pending"), true);
  assert.equal(shopOrderMatchesFilter({ ...baseShopOrder, fulfillmentStatus: "SHIPPED" }, "completed"), true);
  assert.equal(shopOrderMatchesFilter({ ...baseShopOrder, status: "EXPIRED", paymentStatus: "CANCELLED" }, "completed"), true);
  assert.equal(shopOrderMatchesFilter({ ...baseShopOrder, archived: true }, "all"), false);
  assert.equal(shopOrderMatchesFilter({ ...baseShopOrder, archived: true }, "archives"), true);
});

test("Shop action classification orders financial review before customer and fulfillment work", () => {
  assert.equal(classifyShopOrderOperation(baseShopOrder)?.reasonCode, "SHOP_PREPARATION");
  assert.equal(classifyShopOrderOperation({ ...baseShopOrder, hasCustomerRequest: true })?.reasonCode, "SHOP_CUSTOMER_REQUEST");
  assert.equal(classifyShopOrderOperation({ ...baseShopOrder, hasRefundReview: true, hasCustomerRequest: true })?.reasonCode, "SHOP_REFUND_REVIEW");
  assert.equal(classifyShopOrderOperation({ ...baseShopOrder, paymentReviewAt: new Date() })?.reasonCode, "SHOP_PAYMENT_REVIEW");
  assert.equal(classifyShopOrderOperation({ ...baseShopOrder, status: "CANCELLED", paymentStatus: "CANCELLED", fulfillmentStatus: "CANCELLED" }), null);
  assert.equal(classifyShopOrderOperation({ ...baseShopOrder, archived: true })?.reasonCode, "SHOP_PREPARATION");
  assert.equal(classifyShopOrderOperation({ ...baseShopOrder, archived: true, hasRefundReview: true })?.reasonCode, "SHOP_REFUND_REVIEW");
  assert.equal(shopOrderMatchesFilter({ ...baseShopOrder, archived: true, hasRefundReview: true }, "attention"), true);
});

test("Notification classification distinguishes worker flow from human attention", () => {
  const now = new Date("2026-09-08T10:00:00.000Z");
  const pending = { status: "PENDING", attempts: 0, suppressionActive: false, leaseExpiresAt: null } as const;
  assert.equal(classifyNotificationOperation(pending, now), null);
  assert.equal(classifyNotificationOperation({ ...pending, status: "PROCESSING" }, now)?.reasonCode, "NOTIFICATION_EXPIRED_LEASE");
  assert.equal(classifyNotificationOperation({ ...pending, status: "PROCESSING", leaseExpiresAt: new Date("2026-09-08T10:01:00.000Z") }, now), null);
  assert.equal(classifyNotificationOperation({ ...pending, status: "PROCESSING", leaseExpiresAt: new Date("2026-09-08T09:59:00.000Z") }, now)?.reasonCode, "NOTIFICATION_EXPIRED_LEASE");
  assert.equal(classifyNotificationOperation({ ...pending, status: "FAILED_RETRYABLE", attempts: 4 }, now)?.reasonCode, "NOTIFICATION_RETRY");
  assert.equal(classifyNotificationOperation({ ...pending, status: "FAILED_RETRYABLE", attempts: 5 }, now), null);
  assert.equal(classifyNotificationOperation({ ...pending, status: "FAILED_RETRYABLE", attempts: 1, suppressionActive: true }, now), null);
  assert.equal(classifyNotificationOperation({ ...pending, status: "BOUNCED" }, now)?.reasonCode, "NOTIFICATION_DELIVERY_REVIEW");
});

test("Admin review queries preserve uncorrelated financial receipts and interrupted notification leases", async () => {
  const now = new Date("2026-09-08T10:00:00.000Z");
  assert.deepEqual(adminPaymentReviewEventWhere, {
    outcome: "REQUIRES_REVIEW",
    OR: [
      { paymentId: null, refundAttemptId: null, incidentId: null },
      { payment: { is: { status: "REQUIRES_REVIEW" } } },
      { incident: { is: { requiresOperatorReview: true, status: { not: "RESOLVED" } } } },
    ],
  });
  assert.deepEqual(adminNotificationAttentionWhere(now), {
    OR: [
      { status: "FAILED_RETRYABLE", attempts: { lt: 5 } },
      { status: { in: ["FAILED_FINAL", "BOUNCED", "COMPLAINED", "SUPPRESSED"] } },
      {
        status: "PROCESSING",
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
    ],
  });
  assert.deepEqual(adminUncorrelatedPaymentReviewEventWhere, {
    outcome: "REQUIRES_REVIEW",
    paymentId: null,
    refundAttemptId: null,
    incidentId: null,
  });
  assert.equal(classifyUncorrelatedFinancialEventOperation({
    outcome: "REQUIRES_REVIEW",
    paymentId: null,
    refundAttemptId: null,
    incidentId: null,
  })?.reasonCode, "UNCORRELATED_FINANCIAL_EVENT");
  assert.equal(classifyUncorrelatedFinancialEventOperation({
    outcome: "REQUIRES_REVIEW",
    paymentId: "linked-payment",
    refundAttemptId: null,
    incidentId: null,
  }), null);
  const [adminService, cockpit, notificationAdmin, shopService] = await Promise.all([
    readFile(new URL("../../lib/admin/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/admin/cockpit.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/notifications/admin.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/order-service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(adminService, /where: adminPaymentReviewEventWhere/);
  assert.match(cockpit, /adminNotificationAttentionWhere\(now\)/);
  assert.match(cockpit, /adminUncorrelatedPaymentReviewEventWhere/);
  assert.match(cockpit, /events\."paymentId" IS NULL/);
  assert.match(cockpit, /orders\."status" = 'REFUNDED'[\s\S]*payments\."status" IN \('SUCCEEDED', 'PARTIALLY_REFUNDED'\)/);
  assert.match(notificationAdmin, /filter === "attention" \? adminNotificationAttentionWhere\(new Date\(\)\)/);
  assert.match(adminService, /\$\{filter\}::text = 'attention'\s+OR NOT EXISTS \([\s\S]*'MUSIC_ORDER'/);
  assert.match(shopService, /\$\{filter\}::text = 'attention'\s+OR NOT EXISTS \([\s\S]*'SHOP_ORDER'/);
});

test("Rights and SAV classifiers expose only a current next operation", () => {
  assert.equal(classifyRightsOperation("DRAFT"), null);
  assert.equal(classifyRightsOperation("CLIENT_ACCEPTED")?.reasonCode, "RIGHTS_CLIENT_ACCEPTED");
  assert.equal(classifyRightsOperation("ACTIVE"), null);

  const sav = { status: "REQUESTED", refundStatus: "NOT_REQUESTED", hasRefundAttempt: false, hasRestockRemaining: false };
  assert.equal(classifyShopReturnOperation(sav)?.reasonCode, "SAV_REVIEW");
  assert.equal(classifyShopReturnOperation({ ...sav, status: "REFUNDED", refundStatus: "SUCCEEDED", hasRefundAttempt: true, hasRestockRemaining: true })?.reasonCode, "SAV_RESTOCK");
  assert.equal(classifyShopReturnOperation({ ...sav, status: "REFUND_PENDING", refundStatus: "PENDING", hasRefundAttempt: true, refundAttemptStatus: "PENDING" })?.reasonCode, "SAV_REFUND_RECONCILIATION");
  assert.equal(classifyShopReturnOperation({ ...sav, status: "REFUND_PENDING", refundStatus: "PENDING", hasRefundAttempt: true, refundAttemptStatus: "PROCESSING" })?.reasonCode, "SAV_REFUND_RECONCILIATION");
  assert.equal(classifyShopReturnOperation({ ...sav, status: "CLOSED", refundStatus: "SUCCEEDED", hasRefundAttempt: true }), null);
});

test("Cockpit actions sort by priority, oldest first, then stable key", () => {
  const items = [
    { key: "b", domain: "COMMANDER", reasonCode: "B", priority: "HIGH", occurredAt: new Date("2026-09-08T11:00:00Z"), reference: "B", label: "B", href: "/b" },
    { key: "c", domain: "SHOP_ORDER", reasonCode: "C", priority: "CRITICAL", occurredAt: new Date("2026-09-08T12:00:00Z"), reference: "C", label: "C", href: "/c" },
    { key: "a", domain: "RIGHTS", reasonCode: "A", priority: "HIGH", occurredAt: new Date("2026-09-08T10:00:00Z"), reference: "A", label: "A", href: "/a" },
  ] as const;
  assert.deepEqual(sortAdminActionItems(items).map((item) => item.key), ["c", "a", "b"]);
});

test("Cockpit queries are bounded and the overview exposes links without mutation controls", async () => {
  const [cockpit, page, layout] = await Promise.all([
    readFile(new URL("../../lib/admin/cockpit.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(cockpit, /ACTION_CANDIDATE_LIMIT/);
  assert.ok((cockpit.match(/LIMIT \$\{ACTION_CANDIDATE_LIMIT\}/g) ?? []).length >= 5);
  assert.doesNotMatch(cockpit, /admin_record_archives/);
  assert.doesNotMatch(cockpit, /recipient: true|customerName: true|customerEmail: true|displayName: true/);
  assert.match(page, /À traiter maintenant/);
  assert.match(page, /cockpit\.actions\.map/);
  assert.match(page, /data-priority=\{action\.priority\.toLowerCase\(\)\}/);
  assert.doesNotMatch(page, /<form|<button|action=/);
  assert.match(layout, /actionRequiredCounts=\{actionSummary\.actionRequiredCounts\}/);
  assert.match(layout, /criticalActionRequiredCounts=\{actionSummary\.criticalActionRequiredCounts\}/);
  assert.match(cockpit, /const commanderCriticalTotal = commanderCritical \+ financialEvents/);
  assert.match(cockpit, /status: "PROCESSING",[\s\S]*leaseExpiresAt: null/);
  assert.match(cockpit, /refundStatus: "REQUIRES_REVIEW"/);
  assert.match(cockpit, /shopReturnRequestId[\s\S]{0,240}(?:in: \["PROCESSING", "PENDING", "REQUIRES_REVIEW"\]|IN \('PROCESSING', 'PENDING', 'REQUIRES_REVIEW'\))/);
});
