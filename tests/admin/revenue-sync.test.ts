import test from "node:test";
import assert from "node:assert/strict";

import { isGestionRevenueSyncAuthorized, GESTION_REVENUE_SYNC_CONFIRMATION } from "@/lib/admin/revenue-sync-auth";
import { decodeRevenueSyncCursor, encodeRevenueSyncCursor, sliceRevenueExchange } from "@/lib/admin/revenue-sync-cursor";
import { buildRevenueExchange } from "@/lib/admin/revenue-exchange";
import type { RevenueEntry } from "@/lib/admin/revenue-policy";

const token = "a".repeat(64);
const environment = { GESTION_REVENUE_SYNC_ENABLED: "true", GESTION_REVENUE_SYNC_CONFIRM: GESTION_REVENUE_SYNC_CONFIRMATION, GESTION_REVENUE_SYNC_TOKEN: token };

test("intégration Gestion fail-closed et jeton dédié constant-time", () => {
  const request = (candidate?: string) => new Request("https://www.lnxbeats.fr/api/internal/integrations/gestion/receipts?from=2026-01-01", { headers: candidate ? { Authorization: `Bearer ${candidate}` } : {} });
  assert.equal(isGestionRevenueSyncAuthorized(request(token), environment), true);
  assert.equal(isGestionRevenueSyncAuthorized(request(), environment), false);
  assert.equal(isGestionRevenueSyncAuthorized(request("b".repeat(64)), environment), false);
  assert.equal(isGestionRevenueSyncAuthorized(request(token), { ...environment, GESTION_REVENUE_SYNC_ENABLED: "false" }), false);
  assert.equal(isGestionRevenueSyncAuthorized(request(token), { ...environment, GESTION_REVENUE_SYNC_CONFIRM: "wrong" }), false);
  assert.equal(isGestionRevenueSyncAuthorized(request(token), { ...environment, GESTION_REVENUE_SYNC_TOKEN: "short" }), false);
});

test("curseur opaque et déterministe avec recouvrement idempotent pour les rapprochements tardifs", () => {
  const rows: RevenueEntry[] = ["p1", "p2"].map((id, index) => ({ id: `payment:${id}`, paymentKey: `LIVE:STRIPE:${id}`, mode: "LIVE", category: "COMMANDER", kind: "RECEIPT", at: `2026-10-1${8 + index}T21:00:00Z`, amountCents: 5000, currency: "EUR", order: `LNX-${id}`, title: "Création", customer: "exclu", provider: "STRIPE", reference: id, invoice: `LNX-2026101${8 + index}-0001`, documentHref: `/admin/facturation/LNX-2026101${8 + index}-0001`, orderHref: `/admin/commandes/LNX-${id}` }));
  const exchange = buildRevenueExchange({ mode: "LIVE", generatedAt: "2026-10-27T10:00:00Z", period: { from: "2026-01-01", to: "2026-12-31" }, rows, issues: [], unmatchedReceipts: 0 });
  const first = exchange.rows[0], encoded = encodeRevenueSyncCursor({ occurredAt: first.occurredAt, externalId: first.externalId });
  assert.deepEqual(decodeRevenueSyncCursor(encoded), { occurredAt: first.occurredAt, externalId: first.externalId });
  const sliced = sliceRevenueExchange(exchange, decodeRevenueSyncCursor(encoded));
  assert.deepEqual(sliced.exchange.rows.map(row => row.externalId), exchange.rows.map(row => row.externalId));
  assert.equal(sliced.exchange.totals.receivedCents, 10000); assert.ok(sliced.nextCursor);
  assert.throws(() => decodeRevenueSyncCursor("not_json"));
});
