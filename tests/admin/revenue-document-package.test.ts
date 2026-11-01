import test from "node:test";
import assert from "node:assert/strict";

import { buildRevenueDocumentPackage } from "@/lib/admin/revenue-document-package";
import { buildRevenueExchange } from "@/lib/admin/revenue-exchange";
import type { RevenueEntry } from "@/lib/admin/revenue-policy";

const movement = (overrides: Partial<RevenueEntry> = {}): RevenueEntry => ({ id: "payment:p1", paymentKey: "LIVE:STRIPE:pi_1", mode: "LIVE", category: "COMMANDER", kind: "RECEIPT", at: "2026-10-18T21:00:00Z", amountCents: 5000, currency: "EUR", order: "LNX-2026-1", title: "Création", customer: "exclu", provider: "STRIPE", reference: "pi_1", invoice: "LNX-20261018-0001", documentHref: "/admin/facturation/LNX-20261018-0001", orderHref: "/admin/commandes/LNX-2026-1", ...overrides });
const exchange = (rows = [movement()]) => buildRevenueExchange({ mode: "LIVE", generatedAt: "2026-10-27T10:00:00Z", period: { from: "2026-01-01", to: "2026-12-31" }, rows, issues: [], unmatchedReceipts: 0 });
const bytes = Buffer.from("%PDF-1.4\nfixture\n%%EOF\n");

test("paquet documentaire conserve les octets exacts, les deux empreintes et ne comptabilise rien", () => {
  const result = buildRevenueDocumentPackage(exchange(), [{ number: "LNX-20261018-0001", kind: "INVOICE", sourceDocumentNumber: null, snapshotHashSha256: "a".repeat(64), bytes }]);
  assert.equal(result.format, "lnx-site-receipts-package"); assert.equal(result.version, 1);
  assert.deepEqual(result.documentaryPolicy, { archiveVerifiedDocuments: true, createAccountingEntries: false, inferFiscalTreatment: false, ambiguousRowsRequireReview: true });
  assert.deepEqual(Buffer.from(result.documents[0].contentBase64, "base64"), bytes);
  assert.equal(result.documents[0].contentHashSha256.length, 64); assert.equal(result.documents[0].snapshotHashSha256, "a".repeat(64));
  assert.equal(result.links[0].archivalStatus, "VERIFIED"); assert.equal(result.links[0].documentId, result.documents[0].id);
});

test("avoir relié à sa facture source et ligne incertaine laissée en revue", () => {
  const refund = movement({ id: "refund:r1", kind: "REFUND", at: "2026-10-19T08:00:00Z", amountCents: 900, reference: "re_1", invoice: "AV-LNX-20261019-0001", documentHref: "/admin/facturation/avoirs/AV-LNX-20261019-0001" });
  const input = exchange([movement(), refund]);
  const result = buildRevenueDocumentPackage(input, [{ number: refund.invoice, kind: "CREDIT_NOTE", sourceDocumentNumber: "LNX-20261018-0001", snapshotHashSha256: "b".repeat(64), bytes }], { [input.rows[0].externalId]: "PDF absent du registre." });
  assert.equal(result.documents[0].sourceDocumentNumber, "LNX-20261018-0001");
  assert.equal(result.links.find(link => link.externalId === input.rows[0].externalId)?.archivalStatus, "REVIEW_REQUIRED");
  assert.equal(result.links.find(link => link.externalId === input.rows[1].externalId)?.archivalStatus, "VERIFIED");
});

test("PDF altéré, doublon documentaire et fausse relation facture/avoir refusés", () => {
  const base = exchange();
  assert.throws(() => buildRevenueDocumentPackage(base, [{ number: base.rows[0].documentNumber, kind: "INVOICE", sourceDocumentNumber: null, snapshotHashSha256: "a".repeat(64), bytes: Buffer.from("not pdf") }]));
  const document = { number: base.rows[0].documentNumber, kind: "INVOICE" as const, sourceDocumentNumber: null, snapshotHashSha256: "a".repeat(64), bytes };
  assert.throws(() => buildRevenueDocumentPackage(base, [document, document]));
  assert.throws(() => buildRevenueDocumentPackage(base, [{ ...document, sourceDocumentNumber: "LNX-20261018-0000" }]));
});
