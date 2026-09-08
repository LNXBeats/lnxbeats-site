import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classifyMusicOrderCleanup,
  classifyRightsRequestCleanup,
  classifyShopOrderCleanup,
  parseAdminCleanupTargets,
} from "@/lib/admin/cleanup";

function music(overrides: Partial<Parameters<typeof classifyMusicOrderCleanup>[0]> = {}) {
  return {
    status: "CANCELLED",
    customerEmail: "fixture@example.invalid",
    serviceStartedAt: null,
    deliveredAt: null,
    events: [{ toStatus: "CANCELLED" }],
    assets: [{ role: "REFERENCE" as const }],
    commercialLicenses: [], rightsRequests: [], payments: [], invoices: [], notifications: [], withdrawalRequests: [],
    ...overrides,
  };
}

test("hard deletion requires an explicit non-deliverable fixture identity and no retention relation", () => {
  assert.equal(classifyMusicOrderCleanup(music({ assets: [] })).classification, "DELETE_SAFE");
  assert.equal(classifyMusicOrderCleanup(music()).classification, "ARCHIVE_REQUIRED");
  assert.equal(classifyMusicOrderCleanup(music({ customerEmail: "client@example.com" })).classification, "ARCHIVE_REQUIRED");
  assert.equal(classifyMusicOrderCleanup(music({ payments: [{}] })).classification, "ARCHIVE_REQUIRED");
  assert.equal(classifyMusicOrderCleanup(music({ invoices: [{}] })).classification, "ARCHIVE_REQUIRED");
  assert.equal(classifyMusicOrderCleanup(music({ notifications: [{}] })).classification, "ARCHIVE_REQUIRED");
  assert.equal(classifyMusicOrderCleanup(music({ withdrawalRequests: [{ status: "CANCELLED" }] })).classification, "ARCHIVE_REQUIRED");
  assert.equal(classifyMusicOrderCleanup(music({ withdrawalRequests: [{ status: "RECEIVED" }] })).classification, "KEEP_ACTION_REQUIRED");
});

test("an active music order remains actionable even when its label looks like QA", () => {
  assert.equal(classifyMusicOrderCleanup(music({ status: "IN_PROGRESS" })).classification, "KEEP_ACTION_REQUIRED");
});

test("terminal labels cannot hide an unresolved financial or operational action", () => {
  assert.equal(classifyMusicOrderCleanup(music({
    payments: [{ status: "SUCCEEDED", amountCents: 5_000, refundedAmountCents: 0 }],
  })).classification, "KEEP_ACTION_REQUIRED");
  assert.equal(classifyMusicOrderCleanup(music({
    payments: [{ status: "REFUNDED", amountCents: 5_000, refundedAmountCents: 5_000 }],
  })).classification, "ARCHIVE_REQUIRED");
  assert.equal(classifyMusicOrderCleanup(music({
    payments: [{ status: "REFUND_PENDING", refundAttempts: [{ status: "PENDING" }] }],
  })).classification, "KEEP_ACTION_REQUIRED");
  assert.equal(classifyMusicOrderCleanup(music({
    notifications: [{ status: "FAILED_FINAL" }],
  })).classification, "KEEP_ACTION_REQUIRED");
  assert.equal(classifyMusicOrderCleanup(music({
    rightsRequests: [{ status: "UNDER_REVIEW" }],
  })).classification, "KEEP_ACTION_REQUIRED");
});

test("Shop and Rights records are archive-only or retained, never hard-deleted", () => {
  assert.equal(classifyShopOrderCleanup({
    status: "CANCELLED", paymentStatus: "CANCELLED", fulfillmentStatus: "CANCELLED",
    paymentReviewAt: null, openCustomerRequests: 0, openFinancialReviews: 0, openOperationalActions: 0, financialPayments: [],
  }).classification, "ARCHIVE_REQUIRED");
  assert.equal(classifyShopOrderCleanup({
    status: "OPEN", paymentStatus: "PAID", fulfillmentStatus: "PENDING",
    paymentReviewAt: null, openCustomerRequests: 0, openFinancialReviews: 0, openOperationalActions: 0, financialPayments: [],
  }).classification, "KEEP_ACTION_REQUIRED");
  assert.equal(classifyRightsRequestCleanup("REJECTED").classification, "ARCHIVE_REQUIRED");
  assert.equal(classifyRightsRequestCleanup("UNDER_REVIEW").classification, "KEEP_ACTION_REQUIRED");
  assert.equal(classifyRightsRequestCleanup("ACTIVE").classification, "KEEP_ACTION_REQUIRED");
});

test("Shop archive classification fails closed on terminal/financial contradictions", () => {
  const terminal = {
    status: "CANCELLED",
    paymentStatus: "CANCELLED",
    fulfillmentStatus: "CANCELLED",
    paymentReviewAt: null,
    openCustomerRequests: 0,
    openFinancialReviews: 0,
    openOperationalActions: 0,
  } as const;
  assert.equal(classifyShopOrderCleanup({
    ...terminal,
    paymentStatus: "PAID",
    financialPayments: [{ status: "SUCCEEDED", amountCents: 1_249, refundedAmountCents: 0 }],
  }).classification, "KEEP_ACTION_REQUIRED");
  assert.equal(classifyShopOrderCleanup({
    ...terminal,
    openOperationalActions: 1,
    financialPayments: [{ status: "REFUNDED", amountCents: 1_249, refundedAmountCents: 1_249 }],
  }).classification, "KEEP_ACTION_REQUIRED");
  assert.equal(classifyShopOrderCleanup({
    ...terminal,
    financialPayments: [{ status: "REFUND_PENDING", amountCents: 1_249, refundedAmountCents: 0 }],
  }).classification, "KEEP_ACTION_REQUIRED");
  assert.equal(classifyShopOrderCleanup({
    ...terminal,
    financialPayments: [{ status: "REFUNDED", amountCents: 1_249, refundedAmountCents: 1_249 }],
  }).classification, "ARCHIVE_REQUIRED");
  assert.equal(classifyShopOrderCleanup({
    ...terminal,
    openFinancialReviews: 1,
    financialPayments: [{ status: "REFUNDED", amountCents: 1_249, refundedAmountCents: 1_249 }],
  }).classification, "KEEP_ACTION_REQUIRED");
});

test("cleanup targets are typed, deduplicated and carry the preview classification", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  assert.deepEqual(parseAdminCleanupTargets([
    `MUSIC_ORDER:${id}:DELETE_SAFE`, `MUSIC_ORDER:${id}:DELETE_SAFE`,
  ]), [{ type: "MUSIC_ORDER", id, expected: "DELETE_SAFE" }]);
  assert.throws(() => parseAdminCleanupTargets([`SHOP_ORDER:${id}:DELETE_SAFE:extra`]));
  assert.throws(() => parseAdminCleanupTargets([`UNKNOWN:${id}:DELETE_SAFE`]));
});

test("the archive migration is additive and never rewrites business or financial rows", async () => {
  const sql = await readFile("prisma/migrations/20260908120000_admin_operations_archives/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "admin_record_archives"/);
  assert.match(sql, /CREATE TABLE "admin_cleanup_audit_events"/);
  assert.match(sql, /UNIQUE INDEX "admin_record_archives_recordType_recordId_key"/);
  assert.doesNotMatch(sql, /\b(?:UPDATE\s+[^;]+\s+SET|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE\s+[^;]+\s+DROP)\b/i);
  assert.doesNotMatch(sql, /payments|invoices|credit_notes|refund_attempts|shop_orders" SET/i);
});

test("cleanup keeps in-flight Shop operations and refuses hard deletion when any file remains", async () => {
  const source = await readFile("lib/admin/cleanup.ts", "utf8");
  const classifier = await readFile("lib/admin/cleanup-classification.ts", "utf8");
  assert.match(source, /status:\s*\{ in:\s*\["REQUESTED", "APPROVED"\]/);
  assert.match(source, /status:\s*\{ in:\s*\["REQUESTED", "PENDING", "REQUIRES_REVIEW"\]/);
  assert.match(source, /requiresOperatorReview:\s*true, status:\s*\{ not:\s*"RESOLVED"/);
  assert.match(source, /withdrawalRequests:[\s\S]*REFUND_REQUIRED/);
  assert.match(source, /returnRequests:[\s\S]*notIn:\s*\["REJECTED", "CLOSED", "CANCELLED"\]/);
  assert.match(source, /reservation:\s*\{ is:\s*\{ status:\s*"ACTIVE"/);
  assert.match(classifier, /const hasStoredAsset = snapshot\.assets\.length > 0/);
  assert.doesNotMatch(source, /deletePrivateOrderFile|transaction\.asset\.deleteMany/);
});

test("music-order deletion has one server-revalidated entry point", async () => {
  const [actions, service, detail, component] = await Promise.all([
    readFile("app/admin/actions.ts", "utf8"),
    readFile("lib/admin/service.ts", "utf8"),
    readFile("app/admin/commandes/[orderNumber]/page.tsx", "utf8"),
    readFile("components/admin-order-actions.tsx", "utf8"),
  ]);
  assert.doesNotMatch(actions, /deleteOrderAction|deleteEligibleAdminOrder/);
  assert.doesNotMatch(service, /deleteEligibleAdminOrder/);
  assert.doesNotMatch(component, /Supprimer définitivement|deleteOrderAction/);
  assert.match(detail, /href="\/admin\/nettoyage"/);
});

test("changing the cleanup selection invalidates the exact-plan confirmation", async () => {
  const component = await readFile("components/admin-cleanup-form.tsx", "utf8");
  assert.match(component, /const \[confirmed, setConfirmed\] = useState\(false\)/);
  assert.match(component, /onChange=\{\(event\) => \{\s*setConfirmed\(false\);\s*setSelected/s);
  assert.match(component, /checked=\{confirmed\}/);
  assert.match(component, /disabled=\{!confirmed\}/);
});
