import test from "node:test";
import assert from "node:assert/strict";
import { buildRevenueExchange } from "@/lib/admin/revenue-exchange";
import type { RevenueEntry } from "@/lib/admin/revenue-policy";

const row = (overrides: Partial<RevenueEntry> = {}): RevenueEntry => ({ id: "payment:p1", paymentKey: "LIVE:PAYPAL:cap-1", mode: "LIVE", category: "COMMANDER", kind: "RECEIPT", at: "2026-10-18T21:00:00Z", amountCents: 2000, currency: "EUR", order: "LNX-QA-1", title: "Création synthétique", customer: "Nom privé à exclure", provider: "PAYPAL", reference: "cap-1", invoice: "LNX-QA-INV1", documentHref: "/admin/facturation/LNX-QA-INV1", orderHref: "/admin/commandes/LNX-QA-1", ...overrides });
const source = (rows = [row()]) => ({ mode: "LIVE", generatedAt: "2026-10-27T10:00:00Z", period: { from: "2026-01-01", to: "2026-12-31" }, rows, issues: [] as string[], unmatchedReceipts: 0 });

test("échange Gestion versionné : références stables, origin fixe et aucune identité client", () => {
  const result = buildRevenueExchange(source());
  assert.equal(result.format, "lnx-site-receipts"); assert.equal(result.version, 1);
  assert.equal(result.origin, "https://www.lnxbeats.fr"); assert.equal(result.mode, "LIVE");
  assert.deepEqual(result.period, { from: "2026-01-01", to: "2026-12-31", timeZone: "Europe/Paris" });
  assert.equal(result.generatedAt, "2026-10-27T10:00:00.000Z");
  assert.equal(result.rows[0].externalId, "lnxbeats.fr:LIVE:payment:p1");
  assert.equal(result.rows[0].paymentKey, "lnxbeats.fr:LIVE:LIVE:PAYPAL:cap-1");
  assert.equal(result.rows[0].providerReference, "cap-1"); assert.equal(result.rows[0].orderReference, "LNX-QA-1");
  assert.equal(result.rows[0].occurredAtSource, "PAYMENT_PAID_AT");
  assert.equal(result.rows[0].documentUrl, "https://www.lnxbeats.fr/admin/facturation/LNX-QA-INV1");
  assert.equal(JSON.stringify(result).includes("Nom privé à exclure"), false);
  assert.equal("customer" in result.rows[0], false); assert.equal("email" in result.rows[0], false);
});

test("couverture partielle explicite, frais/net/fiscalité inconnus et totaux des seules lignes", () => {
  const result = buildRevenueExchange({ ...source(), issues: ["Facture à rapprocher."], unmatchedReceipts: 2 });
  assert.equal(result.status, "PARTIAL"); assert.equal(result.coverage.exhaustive, false);
  assert.deepEqual(result.coverage.excludedSiteFlows, ["SUPPORT", "RIGHTS"]);
  assert.deepEqual(result.coverage.excludedExternalSources, ["DISTROKID", "SACEM"]);
  assert.equal(result.coverage.totalScope, "EXPORTED_ROWS_ONLY"); assert.equal(result.issues.length, 2);
  assert.equal(result.rows[0].feeCents, null); assert.equal(result.rows[0].netCents, null); assert.equal(result.rows[0].fiscalTreatment, null);
  assert.deepEqual(result.totals, { currency: "EUR", receivedCents: 2000, refundedCents: 0, balanceCents: 2000 });
  assert.equal(buildRevenueExchange(source()).status, "PARTIAL");
});

test("remboursement séparé, référence propre, date de confirmation et paiement parent conservés", () => {
  const refund = row({ id: "refund:r1", kind: "REFUND", at: "2026-10-19T09:00:00+02:00", amountCents: 500, reference: "refund-1", invoice: "AV-1", documentHref: "/admin/facturation/avoirs/AV-1" });
  const result = buildRevenueExchange(source([refund, row()]));
  assert.equal(result.rows[1].occurredAt, "2026-10-19T07:00:00.000Z");
  assert.equal(result.rows[1].occurredAtSource, "CONFIRMED_REFUND_AT");
  assert.equal(result.rows[1].paymentKey, result.rows[0].paymentKey); assert.equal(result.rows[1].providerReference, "refund-1");
  assert.deepEqual(result.totals, { currency: "EUR", receivedCents: 2000, refundedCents: 500, balanceCents: 1500 });
});

test("TEST, mauvaises références, montants/devises et dates invalides refusés", () => {
  assert.throws(() => buildRevenueExchange({ ...source(), mode: "TEST" }));
  assert.throws(() => buildRevenueExchange({ ...source(), generatedAt: "invalid" }));
  assert.throws(() => buildRevenueExchange({ ...source(), unmatchedReceipts: -1 }));
  for (const overrides of [{ mode: "TEST" as const }, { paymentKey: "TEST:PAYPAL:cap-1" }, { paymentKey: "LIVE:STRIPE:cap-1" }, { reference: "other" }, { reference: "" }, { amountCents: 1.1 }, { amountCents: 0 }, { currency: "USD" }, { provider: "OTHER" }, { at: "invalid" }, { at: "2026-02-30T00:00:00Z" }, { at: "2025-01-01T00:00:00Z" }]) {
    assert.throws(() => buildRevenueExchange(source([row(overrides)])));
  }
});

test("doublons source et prestataire refusés, totaux protégés des dépassements", () => {
  assert.throws(() => buildRevenueExchange(source([row(), row()])));
  assert.throws(() => buildRevenueExchange(source([row(), row({ id: "different" })])));
  assert.throws(() => buildRevenueExchange(source([row(), row({ id: "different", reference: "other" })])));
  assert.throws(() => buildRevenueExchange(source([row({ amountCents: Number.MAX_SAFE_INTEGER }), row({ id: "different", reference: "other", paymentKey: "LIVE:PAYPAL:other" })])));
});

test("documents limités aux routes existantes, jamais URL externe ou fichier privé", () => {
  const digital = buildRevenueExchange(source([row({ documentHref: "/api/digital/documents/doc_1" })]));
  assert.equal(digital.rows[0].documentUrl, "https://www.lnxbeats.fr/api/digital/documents/doc_1");
  assert.equal(buildRevenueExchange(source([row({ documentHref: null })])).rows[0].documentUrl, null);
  for (const documentHref of ["https://attacker.example/invoice", "//attacker.example/file", "/admin/facturation/../secret", "/admin/facturation/%2e%2e", "/admin/facturation/a%2fb", "/api/digital/documents/doc?token=secret", "/api/digital/download/master", "/admin/facturation/doc#secret"]) {
    assert.throws(() => buildRevenueExchange(source([row({ documentHref })])));
  }
});

test("bornes Europe/Paris préservées sans inventer une date de création ou de virement", () => {
  const input = { ...source([row({ at: "2026-10-24T22:00:00Z" })]), period: { from: "2026-10-25", to: "2026-10-25" } };
  assert.equal(buildRevenueExchange(input).rows.length, 1);
  assert.throws(() => buildRevenueExchange({ ...input, rows: [row({ at: "2026-10-25T23:00:00Z" })] }));
});

test("trois activités conservées, montants recalculés sans total fourni par le registre", () => {
  const result = buildRevenueExchange(source([
    row(),
    row({ id: "digital:a1", category: "DIGITAL", provider: "STRIPE", reference: "pi-1", paymentKey: "LIVE:STRIPE:pi-1", amountCents: 990 }),
    row({ id: "payment:shop1", category: "SHOP", reference: "cap-shop", paymentKey: "LIVE:PAYPAL:cap-shop", amountCents: 129 }),
  ]));
  assert.deepEqual(new Set(result.rows.map(value => value.category)), new Set(["DIGITAL", "COMMANDER", "SHOP"]));
  assert.equal(result.totals.receivedCents, 3119);
  assert.equal(result.rows.find(value => value.category === "DIGITAL")?.occurredAtSource, "INVOICE_PAID_AT");
  assert.match(result.coverage.dateNote, /ne constitue pas un horodatage indépendant/);
});
