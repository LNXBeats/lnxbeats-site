import test, { after } from "node:test";
import assert from "node:assert/strict";
const previous = (globalThis as { prisma?: unknown }).prisma;
let payments: unknown[] = [], digital: unknown[] = [], commands: string[] = [], orphanCount = 0;
const db = { async $executeRawUnsafe(query: string) { commands.push(query); }, providerEvent: { async count() { return orphanCount; } }, payment: { async findMany() { return payments; } }, digitalOrder: { async findMany() { return digital; } }, async $transaction<T>(fn: (tx: unknown) => Promise<T>, options: unknown) { assert.deepEqual(options, { isolationLevel: "RepeatableRead", timeout: 30000 }); return fn(db); } };
Object.assign(globalThis, { prisma: db });
const { loadRevenue } = await import("@/lib/admin/revenue");
after(() => { if (previous === undefined) delete (globalThis as { prisma?: unknown }).prisma; else Object.assign(globalThis, { prisma: previous }); });
const payment = () => ({ id: "p1", orderId: "o1", shopOrderId: null, paidAt: new Date("2026-10-18T21:00:00Z"), amountCents: 2000, currency: "EUR", provider: "PAYPAL", providerPaymentId: "capture-1", refundedAmountCents: 0, order: { orderNumber: "QA-1", title: "Essai personnel LIVE" }, shopOrder: null, invoice: { invoiceNumber: "QA-INV1", customerNameSearch: "Client fictif" }, refundAttempts: [] });
const digitalOrder = () => ({ id: "d1", totalCents: 129, currency: "EUR", status: "PAID", lines: [{ title: "Titre synthétique" }], attempts: [{ id: "a1", provider: "STRIPE", paymentReference: "pi-qa" }], documents: [{ id: "doc1", number: "QA-INV2", kind: "INVOICE", status: "READY", snapshot: { totalCents: 129, mode: "LIVE", paidAt: "2026-10-18T21:30:00Z", customerSnapshot: { name: "Acheteur fictif" } } }], refunds: [], disputes: [] });
test("registre cohérent en lecture seule : propres ventes LIVE, même personnelles", async () => {
  commands = []; payments = [payment()]; digital = [digitalOrder()]; const r = await loadRevenue();
  assert.deepEqual(commands, ["SET TRANSACTION READ ONLY"]); assert.equal(r.receivedCents, 2129); assert.equal(r.issues.length, 0); assert.equal(r.allTimeBalanceCents, 2129); assert.equal(r.rows.length, 2);
});
test("deux captures pour une commande ne deviennent pas une recette approuvée", async () => {
  const d = digitalOrder(); d.attempts.push({ ...d.attempts[0], id: "second", paymentReference: "pi-second" }); payments = []; digital = [d]; const r = await loadRevenue(); assert.equal(r.receivedCents, 0); assert.equal(r.issues.length, 1);
});
test("digital sans preuve documentaire du paiement exclu et signalé", async () => {
  const d = digitalOrder(); d.documents = []; payments = []; digital = [d]; const r = await loadRevenue(); assert.equal(r.receivedCents, 0); assert.equal(r.issues.length, 1);
});
test("référence PSP partagée entre domaines : aucun total silencieusement doublé", async () => {
  const d = digitalOrder(); d.attempts[0].provider = "PAYPAL"; d.attempts[0].paymentReference = "capture-1"; payments = [payment()]; digital = [d]; await assert.rejects(() => loadRevenue(), /dupliquée/);
});
test("facture absente : encaissement conservé, export final doit être bloqué", async () => {
  payments = [{ ...payment(), invoice: null }]; digital = []; const r = await loadRevenue(); assert.equal(r.receivedCents, 2000); assert.match(r.issues[0], /facture absente/);
});
test("remboursements cumulés non documentés : anomalie visible et aucune déduction inventée", async () => {
  payments = [{ ...payment(), refundedAmountCents: 2000 }]; digital = []; const r = await loadRevenue(); assert.equal(r.refundedCents, 0); assert.equal(r.issues.length, 1);
});
test("remboursement confirmé daté, avoir conservé et total avant commissions", async () => {
  payments = [{ ...payment(), paidAt: new Date("2025-10-18T21:00:00Z"), refundedAmountCents: 200, refundAttempts: [{ id: "r1", amountCents: 200, currency: "EUR", confirmedAt: new Date("2026-10-18T21:00:00Z"), providerRefundId: "refund-qa", creditNotes: [{ creditNoteNumber: "QA-CREDIT" }] }] }]; digital = [];
  const r = await loadRevenue(); assert.equal(r.receivedCents, 0); assert.equal(r.refundedCents, 200); assert.equal(r.balanceCents, -200); assert.equal(r.allTimeBalanceCents, 1800); assert.equal(r.rows[0].invoice, "QA-CREDIT"); assert.equal(r.rows[0].documentHref, "/admin/facturation/avoirs/QA-CREDIT");
});
test("un reçu PSP orphelin est signalé, sans encaissement inventé ni double compte", async () => {
  orphanCount = 1; payments = [payment()]; digital = []; const r = await loadRevenue(); assert.equal(r.receivedCents, 2000); assert.equal(r.unmatchedReceipts, 1); orphanCount = 0;
});
