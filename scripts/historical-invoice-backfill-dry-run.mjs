import pg from "pg";

export const HISTORICAL_INVOICE_ORDER_ALLOWLIST = Object.freeze([
  "LNX-2026-000003",
  "LNX-2026-000007",
  "LNX-2026-000011",
]);

export const HISTORICAL_INVOICE_EXPECTATIONS = Object.freeze({
  "LNX-2026-000003": Object.freeze({ provider: "STRIPE", amountCents: 5000, currency: "EUR" }),
  "LNX-2026-000007": Object.freeze({ provider: "PAYPAL", amountCents: 2000, currency: "EUR" }),
  "LNX-2026-000011": Object.freeze({ provider: "STRIPE", amountCents: 2000, currency: "EUR" }),
});

export const APPROVED_HISTORICAL_INVOICE_DATE_POLICY = "CURRENT_ISSUANCE_WITH_HISTORICAL_PAID_AT_REFERENCE";

export function assertHistoricalInvoiceDryRunArguments(argumentsProvided) {
  if (argumentsProvided.length !== 1 || argumentsProvided[0] !== "--dry-run") {
    throw new Error("Only the explicit --dry-run mode is supported.");
  }
}

export function assertHistoricalInvoiceWhitelist(orderNumbers) {
  const unique = [...new Set(orderNumbers)];
  if (
    unique.length !== HISTORICAL_INVOICE_ORDER_ALLOWLIST.length
    || unique.some((value) => !HISTORICAL_INVOICE_ORDER_ALLOWLIST.includes(value))
  ) {
    throw new Error("Historical invoice order is not allowlisted.");
  }
  return [...HISTORICAL_INVOICE_ORDER_ALLOWLIST];
}

function proposedLines(row) {
  return [
    {
      description: row.titlePresent ? "Création musicale personnalisée (titre historique présent)" : "Création musicale personnalisée",
      quantity: 1,
      unitPriceCents: row.basePriceCents,
      lineTotalCents: row.basePriceCents,
    },
    ...(row.coverIncluded && row.coverPriceCents > 0
      ? [{ description: "Illustration personnalisée", quantity: 1, unitPriceCents: row.coverPriceCents, lineTotalCents: row.coverPriceCents }]
      : []),
    ...(row.priorityProcessing && row.priorityPriceCents > 0
      ? [{ description: "Traitement prioritaire", quantity: 1, unitPriceCents: row.priorityPriceCents, lineTotalCents: row.priorityPriceCents }]
      : []),
  ];
}

export function assessHistoricalInvoiceOrder(row) {
  const lines = proposedLines(row);
  const missingData = [];
  const expectation = HISTORICAL_INVOICE_EXPECTATIONS[row.orderNumber];
  if (!expectation) missingData.push("ORDER_NOT_ALLOWLISTED");
  if (row.invoiceCount !== 0) missingData.push("INVOICE_ALREADY_EXISTS");
  if (row.creditNoteCount !== 0) missingData.push("CREDIT_NOTE_ALREADY_EXISTS");
  if (!row.paymentPresent) missingData.push("PAYMENT_MISSING");
  if (row.succeededPaymentCount !== 1) missingData.push("PAYMENT_WINNER_NOT_UNIQUE");
  if (row.paymentMode !== "LIVE") missingData.push("PAYMENT_NOT_LIVE");
  if (row.paymentStatus !== "SUCCEEDED" || !row.paidAt) missingData.push("PAYMENT_NOT_SUCCEEDED");
  if (expectation && row.provider !== expectation.provider) missingData.push("PROVIDER_MISMATCH");
  if (!row.providerPaymentProofPresent || row.processedProviderEventCount < 1) missingData.push("PAYMENT_PROOF_INCOMPLETE");
  if (row.paymentAmountCents !== row.orderTotalCents || row.paymentCurrency !== row.orderCurrency) missingData.push("AMOUNT_OR_CURRENCY_MISMATCH");
  if (expectation && (row.orderTotalCents !== expectation.amountCents || row.orderCurrency !== expectation.currency)) missingData.push("EXPECTED_FINANCIALS_MISMATCH");
  if (row.orderCurrency !== "EUR") missingData.push("CURRENCY_NOT_EUR");
  if (row.refundAttemptCount !== 0 || row.paymentRefundedAmountCents !== 0) missingData.push("REFUND_STATE_PRESENT");
  if (row.openIncidentCount !== 0) missingData.push("PAYMENT_INCIDENT_OPEN");
  if (!row.customerNamePresent || !row.customerEmailValid) missingData.push("CUSTOMER_SNAPSHOT_INCOMPLETE");
  if (row.termsVersionPresent !== row.termsHashPresent) missingData.push("TERMS_SNAPSHOT_INCONSISTENT");
  if (["DRAFT", "AWAITING_PAYMENT"].includes(row.orderStatus)) missingData.push("ORDER_NOT_INVOICEABLE");
  if (lines.reduce((sum, line) => sum + line.lineTotalCents, 0) !== row.orderTotalCents) missingData.push("LINE_TOTAL_MISMATCH");
  return {
    orderNumber: row.orderNumber,
    readyForBackfill: missingData.length === 0,
    missingData,
    customerSnapshotComplete: row.customerNamePresent && row.customerEmailValid,
    orderSnapshotComplete: !["DRAFT", "AWAITING_PAYMENT"].includes(row.orderStatus) && lines.length > 0,
    paymentProofComplete: row.paymentPresent && row.paymentMode === "LIVE" && row.paymentStatus === "SUCCEEDED"
      && row.succeededPaymentCount === 1 && Boolean(row.paidAt)
      && row.providerPaymentProofPresent && row.processedProviderEventCount > 0,
    descriptionComplete: lines.length > 0,
    amountCurrencyVerified: row.paymentAmountCents === row.orderTotalCents
      && row.paymentCurrency === row.orderCurrency && row.orderCurrency === "EUR",
    billingDataSufficient: missingData.length === 0,
    proposedDocumentContent: {
      documentType: "MUSIC",
      operationCategory: "SERVICES",
      lines,
      totalCents: row.orderTotalCents,
      currency: row.orderCurrency,
      provider: row.provider,
      issuanceDatePolicy: APPROVED_HISTORICAL_INVOICE_DATE_POLICY,
      historicalPaymentDateReference: row.paidAt,
      customerIdentity: "PRESENT_NOT_DISPLAYED",
      termsSnapshot: row.termsVersionPresent && row.termsHashPresent ? "PRESENT" : "ABSENT",
    },
    numberAllocated: false,
    datePolicyRequired: false,
    applyImplemented: true,
  };
}

export async function readHistoricalInvoiceBackfillPlan(
  client,
  requestedOrderNumbers = HISTORICAL_INVOICE_ORDER_ALLOWLIST,
  options = { manageReadOnlyTransaction: true },
) {
  const orderNumbers = assertHistoricalInvoiceWhitelist(requestedOrderNumbers);
  if (options.manageReadOnlyTransaction) await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    const result = await client.query(`
      SELECT o."orderNumber" AS "orderNumber", o.status::text AS "orderStatus",
        o."totalCents" AS "orderTotalCents", o.currency AS "orderCurrency",
        o."basePriceCents", o."coverIncluded", o."coverPriceCents",
        o."priorityProcessing", o."priorityPriceCents",
        (o.title IS NOT NULL AND length(trim(o.title)) > 0) AS "titlePresent",
        (o."customerName" IS NOT NULL AND length(trim(o."customerName")) > 0) AS "customerNamePresent",
        (o."customerEmail" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') AS "customerEmailValid",
        (o."personalUseTermsVersion" IS NOT NULL) AS "termsVersionPresent",
        (o."personalUseTermsHashSha256" IS NOT NULL) AS "termsHashPresent",
        p.id IS NOT NULL AS "paymentPresent", p.provider::text AS provider,
        p.mode::text AS "paymentMode", p.status::text AS "paymentStatus",
        p."amountCents" AS "paymentAmountCents", p.currency AS "paymentCurrency", p."paidAt",
        p."refundedAmountCents" AS "paymentRefundedAmountCents",
        (p."providerPaymentId" IS NOT NULL) AS "providerPaymentProofPresent",
        (SELECT count(*)::int FROM payments p1 WHERE p1."orderId" = o.id AND p1.status = 'SUCCEEDED') AS "succeededPaymentCount",
        (SELECT count(*)::int FROM provider_events pe WHERE pe."paymentId" = p.id AND pe.outcome = 'PROCESSED') AS "processedProviderEventCount",
        (SELECT count(*)::int FROM refund_attempts ra WHERE ra."paymentId" = p.id) AS "refundAttemptCount",
        (SELECT count(*)::int FROM payment_incidents pi WHERE pi."paymentId" = p.id AND pi.status IN ('OPEN', 'UNDER_REVIEW')) AS "openIncidentCount",
        (SELECT count(*)::int FROM invoices i WHERE i."orderId" = o.id) AS "invoiceCount",
        (SELECT count(*)::int FROM credit_notes cn JOIN invoices i ON i.id = cn."invoiceId" WHERE i."orderId" = o.id) AS "creditNoteCount"
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT * FROM payments p0 WHERE p0."orderId" = o.id
        ORDER BY (p0.status = 'SUCCEEDED') DESC, p0."paidAt" DESC NULLS LAST, p0."createdAt" DESC LIMIT 1
      ) p ON true
      WHERE o."orderNumber" = ANY($1::text[])
      ORDER BY p."paidAt" NULLS LAST, o."orderNumber"
    `, [orderNumbers]);
    const sequence = await client.query(`
      SELECT last_value::text AS "lastValue", is_called AS "isCalled",
        (SELECT coalesce(max("sequenceNumber"), 0)::text FROM invoices) AS "maxInvoiceSequence",
        (SELECT count(*)::int FROM invoices) AS "invoiceCount"
      FROM invoice_sequence
    `);
    const returned = new Set(result.rows.map((row) => row.orderNumber));
    const missingOrders = orderNumbers.filter((orderNumber) => !returned.has(orderNumber));
    const plans = result.rows.map(assessHistoricalInvoiceOrder);
    return {
      mode: "DRY_RUN_READ_ONLY",
      approvedDatePolicy: APPROVED_HISTORICAL_INVOICE_DATE_POLICY,
      allowlist: orderNumbers,
      missingOrders,
      sequence: sequence.rows[0],
      plans,
      productionWrites: 0,
      numbersAllocated: 0,
      allOrdersValidatedBeforeNumberAllocation: missingOrders.length === 0
        && result.rows.length === orderNumbers.length
        && plans.every((plan) => plan.readyForBackfill),
      datePolicyRequired: false,
      applyImplemented: true,
    };
  } finally {
    if (options.manageReadOnlyTransaction) await client.query("ROLLBACK");
  }
}

async function main() {
  assertHistoricalInvoiceDryRunArguments(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: "lnx-historical-invoice-backfill-dry-run",
    options: "-c default_transaction_read_only=on",
  });
  await client.connect();
  try {
    console.info(JSON.stringify(await readHistoricalInvoiceBackfillPlan(client)));
  } finally {
    await client.end();
  }
}

const executedDirectly = process.argv[1] === "-" || import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (executedDirectly) {
  main().catch(() => {
    console.error("Historical invoice backfill dry-run failed safely; no number was allocated and no database write was attempted.");
    process.exitCode = 1;
  });
}
