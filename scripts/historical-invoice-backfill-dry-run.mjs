import pg from "pg";

export const HISTORICAL_INVOICE_ORDER_ALLOWLIST = Object.freeze([
  "LNX-2026-000003",
  "LNX-2026-000007",
  "LNX-2026-000011",
]);

export const APPROVED_HISTORICAL_INVOICE_DATE_POLICY = "CURRENT_ISSUANCE_WITH_HISTORICAL_PAID_AT_REFERENCE";

export function assertHistoricalInvoiceDryRunArguments(argumentsProvided) {
  if (argumentsProvided.length !== 1 || argumentsProvided[0] !== "--dry-run") {
    throw new Error("Only the explicit --dry-run mode is supported.");
  }
}

export function assertHistoricalInvoiceWhitelist(orderNumbers) {
  const unique = [...new Set(orderNumbers)];
  if (!unique.length || unique.some((value) => !HISTORICAL_INVOICE_ORDER_ALLOWLIST.includes(value))) {
    throw new Error("Historical invoice order is not allowlisted.");
  }
  return unique;
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
  if (row.invoiceCount !== 0) missingData.push("INVOICE_ALREADY_EXISTS");
  if (!row.paymentPresent) missingData.push("PAYMENT_MISSING");
  if (row.paymentMode !== "LIVE") missingData.push("PAYMENT_NOT_LIVE");
  if (row.paymentStatus !== "SUCCEEDED" || !row.paidAt) missingData.push("PAYMENT_NOT_SUCCEEDED");
  if (!row.providerPaymentProofPresent || row.processedProviderEventCount < 1) missingData.push("PAYMENT_PROOF_INCOMPLETE");
  if (row.paymentAmountCents !== row.orderTotalCents || row.paymentCurrency !== row.orderCurrency) missingData.push("AMOUNT_OR_CURRENCY_MISMATCH");
  if (row.orderCurrency !== "EUR") missingData.push("CURRENCY_NOT_EUR");
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
      && Boolean(row.paidAt) && row.providerPaymentProofPresent && row.processedProviderEventCount > 0,
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
    applyImplemented: false,
  };
}

export async function readHistoricalInvoiceBackfillPlan(client, requestedOrderNumbers = HISTORICAL_INVOICE_ORDER_ALLOWLIST) {
  const orderNumbers = assertHistoricalInvoiceWhitelist(requestedOrderNumbers);
  await client.query("BEGIN TRANSACTION READ ONLY");
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
        (p."providerPaymentId" IS NOT NULL) AS "providerPaymentProofPresent",
        (SELECT count(*)::int FROM provider_events pe WHERE pe."paymentId" = p.id AND pe.outcome = 'PROCESSED') AS "processedProviderEventCount",
        (SELECT count(*)::int FROM invoices i WHERE i."orderId" = o.id) AS "invoiceCount"
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT * FROM payments p0 WHERE p0."orderId" = o.id
        ORDER BY (p0.status = 'SUCCEEDED') DESC, p0."paidAt" DESC NULLS LAST, p0."createdAt" DESC LIMIT 1
      ) p ON true
      WHERE o."orderNumber" = ANY($1::text[])
      ORDER BY o."orderNumber"
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
      applyImplemented: false,
    };
  } finally {
    await client.query("ROLLBACK");
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
