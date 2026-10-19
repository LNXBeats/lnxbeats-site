import test from "node:test";
import assert from "node:assert/strict";
import { revenuePeriod, revenueSummary, revenueCsv, type RevenueEntry } from "@/lib/admin/revenue-policy";
const entry = (overrides: Partial<RevenueEntry> = {}): RevenueEntry => ({ id: "p1", paymentKey: "LIVE:PAYPAL:c1", category: "DIGITAL", mode: "LIVE", kind: "RECEIPT", at: "2026-10-18T21:45:00Z", amountCents: 129, currency: "EUR", order: "order", title: "Titre QA", customer: "Client synthétique", provider: "PAYPAL", reference: "c1", invoice: "QA-invoice", documentHref: null, orderHref: "/admin", ...overrides });
test("recettes : encaissement distinct de facture, centimes et modes isolés", () => {
  const r = revenueSummary([entry(), entry({ id: "qa", mode: "TEST", amountCents: 990 })], revenuePeriod("2026-01-01", "2026-12-31"), "LIVE");
  assert.equal(r.receivedCents, 129); assert.equal(r.rows.length, 1); assert.equal(r.categories[0].receivedCents, 129);
});
test("un remboursement est daté de sa confirmation, pas de l’achat précédent", () => {
  const r = revenueSummary([entry({ at: "2025-12-01T10:00:00Z" }), entry({ id: "r1", kind: "REFUND", amountCents: 129 })], revenuePeriod("2026-01-01", "2026-12-31"), "LIVE");
  assert.equal(r.receivedCents, 0); assert.equal(r.refundedCents, 129); assert.equal(r.balanceCents, -129);
});
test("trois activités sans compter un webhook comme recette", () => {
  const r = revenueSummary([entry(), entry({ id: "p2", category: "COMMANDER", amountCents: 2000 }), entry({ id: "p3", category: "SHOP", amountCents: 990 })], revenuePeriod("2026-01-01", "2026-12-31"), "LIVE");
  assert.equal(r.receivedCents, 3119); assert.deepEqual(r.categories.map(c => c.receivedCents), [129, 2000, 990]);
});
test("dates Paris : changement d’heure mars (23h) et octobre (25h)", () => {
  const spring = revenuePeriod("2026-03-29", "2026-03-29"), fall = revenuePeriod("2026-10-25", "2026-10-25");
  assert.equal(spring.start.toISOString(), "2026-03-28T23:00:00.000Z"); assert.equal(spring.end.getTime() - spring.start.getTime(), 23 * 3600000);
  assert.equal(fall.start.toISOString(), "2026-10-24T22:00:00.000Z"); assert.equal(fall.end.getTime() - fall.start.getTime(), 25 * 3600000);
});
test("bornes de période et dates impossibles rejetées", () => {
  for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-12-01", "2026-01-01"], ["2024-01-01", "2026-01-01"], ["<script>", "2026-01-01"]]) assert.throws(() => revenuePeriod(from, to));
});
test("date locale de fin inclusive et pas de dérive du jour UTC", () => {
  const p = revenuePeriod("2026-10-19", "2026-10-19");
  const r = revenueSummary([entry({ at: "2026-10-18T22:00:00.000Z" }), entry({ id: "next", at: "2026-10-19T22:00:00.000Z" })], p, "LIVE");
  assert.equal(r.rows.length, 1);
});
test("montant invalide, devise inconnue, date absente et doublons fail-closed", () => {
  const p = revenuePeriod("2026-01-01", "2026-12-31");
  for (const change of [{ amountCents: 1.5 }, { amountCents: -1 }, { currency: "USD" }, { at: "invalid" }]) assert.throws(() => revenueSummary([entry(change)], p, "LIVE"));
  assert.throws(() => revenueSummary([entry(), entry()], p, "LIVE"));
});
test("CSV UTF-8 : accents, champs cités et protection formules", () => {
  const csv = revenueCsv([entry({ title: '=HYPERLINK("evil")', customer: " +SUM(1;2)" })]);
  assert.ok(csv.startsWith("\uFEFF")); assert.ok(csv.includes("' =") === false); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes("' +SUM")); assert.ok(csv.includes('"1,29"')); assert.ok(csv.includes("Date Europe/Paris"));
});
