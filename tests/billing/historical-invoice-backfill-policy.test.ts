import assert from "node:assert/strict";
import test from "node:test";

import {
  HISTORICAL_INVOICE_ORDER_ALLOWLIST,
  assertHistoricalInvoiceDryRunArguments,
  assertHistoricalInvoiceWhitelist,
  assessHistoricalInvoiceOrder,
  readHistoricalInvoiceBackfillPlan,
} from "../../scripts/historical-invoice-backfill-dry-run.mjs";

const complete = {
  orderNumber: "LNX-2026-000003", orderStatus: "REFUSED",
  orderTotalCents: 5000, orderCurrency: "EUR", basePriceCents: 5000,
  coverIncluded: false, coverPriceCents: 0, priorityProcessing: false, priorityPriceCents: 0,
  titlePresent: true, customerNamePresent: true, customerEmailValid: true,
  termsVersionPresent: true, termsHashPresent: true,
  paymentPresent: true, provider: "STRIPE", paymentMode: "LIVE", paymentStatus: "SUCCEEDED",
  paymentAmountCents: 5000, paymentCurrency: "EUR", paidAt: new Date("2026-08-25T21:03:57Z"),
  paymentRefundedAmountCents: 0, providerPaymentProofPresent: true, succeededPaymentCount: 1,
  processedProviderEventCount: 1, refundAttemptCount: 0, openIncidentCount: 0,
  invoiceCount: 0, creditNoteCount: 0,
};

test("historical invoice dry-run rejects apply and enforces its exact three-order whitelist", () => {
  assert.doesNotThrow(() => assertHistoricalInvoiceDryRunArguments(["--dry-run"]));
  assert.throws(() => assertHistoricalInvoiceDryRunArguments(["--apply"]));
  assert.deepEqual(assertHistoricalInvoiceWhitelist(HISTORICAL_INVOICE_ORDER_ALLOWLIST), HISTORICAL_INVOICE_ORDER_ALLOWLIST);
  assert.throws(() => assertHistoricalInvoiceWhitelist(["LNX-2026-999999"]));
  assert.throws(() => assertHistoricalInvoiceWhitelist(["LNX-2026-000003"]));
});

test("complete historical payment produces a non-allocating plan with the approved date policy", () => {
  const plan = assessHistoricalInvoiceOrder(complete);
  assert.equal(plan.readyForBackfill, true);
  assert.deepEqual(plan.missingData, []);
  assert.equal(plan.numberAllocated, false);
  assert.equal(plan.datePolicyRequired, false);
  assert.equal(plan.applyImplemented, true);
  assert.equal(plan.proposedDocumentContent.issuanceDatePolicy, "CURRENT_ISSUANCE_WITH_HISTORICAL_PAID_AT_REFERENCE");
  assert.deepEqual(plan.proposedDocumentContent.historicalPaymentDateReference, complete.paidAt);
  assert.equal(plan.proposedDocumentContent.totalCents, 5000);
});

test("generic service description is deterministic when the old title is absent", () => {
  const plan = assessHistoricalInvoiceOrder({ ...complete, orderNumber: "LNX-2026-000011", titlePresent: false, orderTotalCents: 2000, paymentAmountCents: 2000, basePriceCents: 2000 });
  assert.equal(plan.descriptionComplete, true);
  assert.equal(plan.proposedDocumentContent.lines[0]?.description, "Création musicale personnalisée");
});

test("mismatch, non-live payment and existing invoice fail closed", () => {
  const plan = assessHistoricalInvoiceOrder({ ...complete, paymentMode: "TEST", paymentAmountCents: 4000, invoiceCount: 1 });
  assert.equal(plan.readyForBackfill, false);
  assert.ok(plan.missingData.includes("PAYMENT_NOT_LIVE"));
  assert.ok(plan.missingData.includes("AMOUNT_OR_CURRENCY_MISMATCH"));
  assert.ok(plan.missingData.includes("INVOICE_ALREADY_EXISTS"));
});

test("winner, provider, refund, incident and document guards fail closed", () => {
  const plan = assessHistoricalInvoiceOrder({
    ...complete,
    provider: "PAYPAL",
    succeededPaymentCount: 2,
    refundAttemptCount: 1,
    paymentRefundedAmountCents: 100,
    openIncidentCount: 1,
    creditNoteCount: 1,
  });
  assert.equal(plan.readyForBackfill, false);
  for (const code of ["PAYMENT_WINNER_NOT_UNIQUE", "PROVIDER_MISMATCH", "REFUND_STATE_PRESENT", "PAYMENT_INCIDENT_OPEN", "CREDIT_NOTE_ALREADY_EXISTS"]) {
    assert.ok(plan.missingData.includes(code));
  }
});

test("dry-run performs SELECTs inside a read-only transaction without consuming sequence", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql.trim());
      if (sql.includes("FROM invoice_sequence")) return { rows: [{ lastValue: "1", isCalled: false, maxInvoiceSequence: "0", invoiceCount: 0 }] };
      if (sql.trim().startsWith("SELECT o.")) return {
        rows: HISTORICAL_INVOICE_ORDER_ALLOWLIST.map((orderNumber) => ({
          ...complete,
          orderNumber,
          provider: orderNumber === "LNX-2026-000007" ? "PAYPAL" : "STRIPE",
          orderTotalCents: orderNumber === "LNX-2026-000003" ? 5000 : 2000,
          paymentAmountCents: orderNumber === "LNX-2026-000003" ? 5000 : 2000,
          basePriceCents: orderNumber === "LNX-2026-000003" ? 5000 : 2000,
        })),
      };
      return { rows: [] };
    },
  };
  const report = await readHistoricalInvoiceBackfillPlan(client);
  assert.equal(report.productionWrites, 0);
  assert.equal(report.numbersAllocated, 0);
  assert.equal(report.approvedDatePolicy, "CURRENT_ISSUANCE_WITH_HISTORICAL_PAID_AT_REFERENCE");
  assert.equal(report.allOrdersValidatedBeforeNumberAllocation, true);
  assert.equal(report.datePolicyRequired, false);
  assert.equal(report.applyImplemented, true);
  assert.equal(report.plans.length, 3);
  assert.match(queries[0]!, /^BEGIN TRANSACTION READ ONLY$/);
  assert.match(queries.at(-1)!, /^ROLLBACK$/);
  assert.doesNotMatch(queries.join("\n"), /\b(INSERT|UPDATE|DELETE|nextval|setval)\b/i);
});
