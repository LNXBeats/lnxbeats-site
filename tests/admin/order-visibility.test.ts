import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  evaluateOrderCurrentViewVisibility,
  normalizeOrderCurrentViewHiddenNote,
  parseOrderCurrentViewHiddenReason,
  type OrderVisibilityGuardSnapshot,
} from "@/lib/admin/order-visibility";
import { commanderOrderMatchesFilter } from "@/lib/admin/operations";

function snapshot(overrides: Partial<OrderVisibilityGuardSnapshot> = {}): OrderVisibilityGuardSnapshot {
  return {
    status: "REFUSED",
    payments: [],
    rightsRequests: [],
    withdrawalRequests: [],
    notifications: [],
    ...overrides,
  };
}

test("resolved rejected and test orders are hideable without title inference", () => {
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot()).allowed, true);
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ status: "CANCELLED" })).allowed, true);
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ status: "DELIVERED" })).allowed, true);
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ status: "IN_PROGRESS" })).code, "ORDER_NOT_TERMINAL");
});

test("financial, withdrawal, rights and notification obligations fail closed", () => {
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ payments: [{ status: "SUCCEEDED", incidents: [], events: [], refundAttempts: [] }] })).code, "REFUND_DECISION");
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ payments: [{ status: "REQUIRES_REVIEW", incidents: [], events: [], refundAttempts: [] }] })).code, "PAYMENT_REVIEW");
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ payments: [{ status: "PENDING", incidents: [], events: [], refundAttempts: [] }] })).code, "PAYMENT_REVIEW");
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ payments: [{ status: "REFUNDED", incidents: [{}], events: [], refundAttempts: [] }] })).code, "FINANCIAL_INCIDENT");
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ payments: [{ status: "REFUNDED", incidents: [], events: [], refundAttempts: [{ status: "PENDING" }] }] })).code, "REFUND_REVIEW");
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ withdrawalRequests: [{ status: "RECEIVED", refundStatus: "NOT_EVALUATED" }] })).code, "WITHDRAWAL_OPEN");
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ rightsRequests: [{ status: "CLIENT_ACCEPTED" }] })).code, "RIGHTS_REVIEW");
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ rightsRequests: [{ status: "REQUIRES_REVIEW" }] })).code, "RIGHTS_REVIEW");
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({ notifications: [{ status: "FAILED_FINAL" }] })).code, "NOTIFICATION_BLOCKING");
});

test("settled relations do not create a false operational blocker", () => {
  assert.equal(evaluateOrderCurrentViewVisibility(snapshot({
    status: "REFUNDED",
    payments: [{ status: "REFUNDED", incidents: [], events: [], refundAttempts: [{ status: "SUCCEEDED" }] }],
    withdrawalRequests: [{ status: "REJECTED", refundStatus: "NOT_REQUIRED" }],
    rightsRequests: [{ status: "REJECTED" }],
    notifications: [{ status: "DELIVERED" }, { status: "CANCELED" }],
  })).allowed, true);
});

test("hidden orders leave current filters, remain in hidden, and actionable hidden orders resurface", () => {
  assert.equal(commanderOrderMatchesFilter({ status: "REFUSED", hidden: true }, "all"), false);
  assert.equal(commanderOrderMatchesFilter({ status: "REFUSED", hidden: true }, "completed"), false);
  assert.equal(commanderOrderMatchesFilter({ status: "REFUSED", hidden: true }, "hidden"), true);
  assert.equal(commanderOrderMatchesFilter({ status: "REFUSED", hidden: true, hasRefundDue: true }, "attention"), true);
});

test("reason and note parsing is typed, bounded and control-safe", () => {
  assert.equal(parseOrderCurrentViewHiddenReason("TEST"), "TEST");
  assert.equal(parseOrderCurrentViewHiddenReason("DUPLICATE"), "DUPLICATE");
  assert.equal(parseOrderCurrentViewHiddenReason("OTHER"), "OTHER");
  assert.throws(() => parseOrderCurrentViewHiddenReason("TITLE_LOOKS_TEST"));
  assert.equal(normalizeOrderCurrentViewHiddenNote("  exemple\n court  "), "exemple court");
  assert.throws(() => normalizeOrderCurrentViewHiddenNote("x".repeat(241)));
});

test("migration is additive, defaults to visible and creates an immutable visibility audit", async () => {
  const sql = await readFile("prisma/migrations/20260925120000_order_current_view_visibility/migration.sql", "utf8");
  assert.match(sql, /ADD COLUMN "hiddenFromCurrentViewsAt"/);
  assert.match(sql, /CREATE TABLE "order_current_view_visibility_events"/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /(?:^|\n)\s*(?:UPDATE\s+|DELETE\s+FROM|DROP\s+(?:TABLE|COLUMN)|TRUNCATE\s+)/i);
  assert.doesNotMatch(sql, /DEFAULT\s+TRUE|hiddenFromCurrentViewsAt[^;]+DEFAULT/i);
});

test("visibility migration applies on an existing order schema without rewriting rows", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE "users" ("id" UUID PRIMARY KEY);
      CREATE TABLE "orders" (
        "id" UUID PRIMARY KEY,
        "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO "users" ("id") VALUES ('10000000-0000-4000-8000-000000000001');
      INSERT INTO "orders" ("id") VALUES ('20000000-0000-4000-8000-000000000002');
    `);
    const sql = await readFile("prisma/migrations/20260925120000_order_current_view_visibility/migration.sql", "utf8");
    await database.exec(sql);
    const rows = await database.query<{ hiddenFromCurrentViewsAt: Date | null }>(`SELECT "hiddenFromCurrentViewsAt" FROM "orders"`);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.hiddenFromCurrentViewsAt, null);
    const auditTable = await database.query<{ name: string }>(`SELECT to_regclass('order_current_view_visibility_events')::text AS name`);
    assert.equal(auditTable.rows[0]?.name, "order_current_view_visibility_events");
  } finally {
    await database.close();
  }
});

test("server mutations are Admin-only, same-origin, per-order locked and idempotent", async () => {
  const [actions, service] = await Promise.all([
    readFile("app/admin/actions.ts", "utf8"),
    readFile("lib/admin/service.ts", "utf8"),
  ]);
  for (const action of ["hideOrderFromCurrentViewsAction", "restoreOrderToCurrentViewsAction", "hideSelectedOrdersFromCurrentViewsAction"]) {
    assert.match(actions, new RegExp(`export async function ${action}`));
  }
  assert.match(actions, /authorizeAdminAction\(\)/);
  assert.match(actions, /isSameOriginMutation/);
  assert.match(service, /withOrderLock\(orderNumber/);
  assert.match(service, /if \(order\.hiddenFromCurrentViewsAt\)[\s\S]*ALREADY_HIDDEN/);
  assert.match(service, /adminRecordArchive\.findUnique[\s\S]*ORDER_ALREADY_ARCHIVED/);
  assert.match(service, /if \(!order\.hiddenFromCurrentViewsAt\)[\s\S]*ALREADY_VISIBLE/);
  assert.match(service, /for \(const orderNumber of uniqueOrderNumbers\)[\s\S]*hideAdminOrderFromCurrentViews/);
  assert.match(service, /orderCurrentViewVisibilityEvent\.create/);
  assert.doesNotMatch(service, /title.*(?:test|essai)|(?:test|essai).*title/i);
});

test("Admin pages expose hide, restore, hidden filter, explicit search inclusion and separate audit", async () => {
  const [list, detail, search, searchService] = await Promise.all([
    readFile("app/admin/commandes/page.tsx", "utf8"),
    readFile("app/admin/commandes/[orderNumber]/page.tsx", "utf8"),
    readFile("app/admin/recherche/page.tsx", "utf8"),
    readFile("lib/admin/search.ts", "utf8"),
  ]);
  assert.match(list, /hidden: "Masquées"/);
  assert.match(list, /Masquer la sélection/);
  assert.match(detail, /Restaurer dans les vues courantes/);
  assert.match(detail, /Journal de visibilité/);
  assert.match(search, /Inclure les commandes masquées/);
  assert.match(searchService, /includeHiddenOrders/);
  assert.match(searchService, /hiddenFromCurrentViewsAt: null/);
});
