import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { issueInvoiceForPayment } from "@/lib/billing/service";
import { prisma } from "@/lib/prisma";

export const HISTORICAL_INVOICE_ORDER_ALLOWLIST = Object.freeze([
  "LNX-2026-000003",
  "LNX-2026-000007",
  "LNX-2026-000011",
] as const);

export const HISTORICAL_INVOICE_BACKFILL_CONFIRMATION =
  "APPLY_OPTION_C_LNX_2026_000003_000007_000011";

const PRODUCTION_PROJECT_ID = "116aee1d-3daf-471c-adb0-fdbb34bd5da0";
const PRODUCTION_ENVIRONMENT_ID = "75201c67-bb4f-4912-9bda-d6fa81bbb707";
const PRODUCTION_WEB_SERVICE_ID = "57e307d9-12dc-42a1-bcb5-a2a7bb90fcbe";
const EXPECTED_PRODUCTION_SHA = "ac88a130ec567dad09f6ec8391396f0247d30dbc";

const EXPECTATIONS = Object.freeze({
  "LNX-2026-000003": Object.freeze({ provider: "STRIPE", amountCents: 5000, currency: "EUR" }),
  "LNX-2026-000007": Object.freeze({ provider: "PAYPAL", amountCents: 2000, currency: "EUR" }),
  "LNX-2026-000011": Object.freeze({ provider: "STRIPE", amountCents: 2000, currency: "EUR" }),
});

type Transaction = Prisma.TransactionClient;
type SequenceState = Readonly<{
  lastValue: string;
  isCalled: boolean;
  maxInvoiceSequence: string;
  invoiceCount: number;
}>;

type CandidatePayment = Readonly<{
  orderId: string;
  orderNumber: string;
  paymentId: string;
  paidAt: Date;
  provider: "STRIPE" | "PAYPAL";
  amountCents: number;
  currency: string;
  status: string;
  refundedAmountCents: number;
  orderStatus: string;
  orderTotalCents: number;
  orderCurrency: string;
  basePriceCents: number;
  coverIncluded: boolean;
  coverPriceCents: number;
  priorityProcessing: boolean;
  priorityPriceCents: number;
  customerNamePresent: boolean;
  customerEmailValid: boolean;
  termsVersionPresent: boolean;
  termsHashPresent: boolean;
  providerPaymentProofPresent: boolean;
  succeededPaymentCount: number;
  processedProviderEventCount: number;
  refundAttemptCount: number;
  openIncidentCount: number;
  invoiceCount: number;
  creditNoteCount: number;
}>;

export function assertHistoricalInvoiceBackfillArguments(argumentsProvided: readonly string[]) {
  if (
    argumentsProvided.length !== 2
    || argumentsProvided[0] !== "--apply"
    || argumentsProvided[1] !== `--confirm=${HISTORICAL_INVOICE_BACKFILL_CONFIRMATION}`
  ) {
    throw new Error("Historical invoice backfill confirmation is invalid.");
  }
}

export function assertHistoricalInvoiceBackfillProductionEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (environment.NODE_ENV !== "production") throw new Error("Historical invoice backfill requires NODE_ENV=production.");
  if (environment.RAILWAY_ENVIRONMENT_NAME !== "production") throw new Error("Historical invoice backfill requires the production Railway environment.");
  if (environment.RAILWAY_PROJECT_ID !== PRODUCTION_PROJECT_ID) throw new Error("Historical invoice backfill project is invalid.");
  if (environment.RAILWAY_ENVIRONMENT_ID !== PRODUCTION_ENVIRONMENT_ID) throw new Error("Historical invoice backfill environment is invalid.");
  if (environment.RAILWAY_SERVICE_ID !== PRODUCTION_WEB_SERVICE_ID) throw new Error("Historical invoice backfill must run from the Production Web service.");
  if (environment.RAILWAY_GIT_COMMIT_SHA !== EXPECTED_PRODUCTION_SHA) {
    throw new Error("Historical invoice backfill refuses an unexpected Production source SHA.");
  }
  if (environment.LIVE_REFUNDS_ENABLED === "true" || environment.LIVE_REFUNDS_PRODUCTION_CONFIRM) {
    throw new Error("Historical invoice backfill requires Live Refunds to remain disarmed.");
  }
  for (const flag of ["SHOP_ENABLED", "SHOP_PAYMENTS_ENABLED", "SHOP_SHIPPING_ENABLED"] as const) {
    if (environment[flag] === "true") throw new Error(`Historical invoice backfill requires ${flag}=false.`);
  }
  if (environment.CLIENT_EMAIL_NOTIFICATIONS_ENABLED !== "true") {
    throw new Error("Historical invoice backfill requires the validated client notification channel.");
  }
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("Historical invoice backfill database is unavailable.");
  const parsed = new URL(databaseUrl);
  const hostname = parsed.hostname.toLowerCase();
  const pathname = decodeURIComponent(parsed.pathname).toLowerCase();
  if (["127.0.0.1", "localhost", "::1"].includes(hostname) || /(?:test|staging|qa)/.test(`${hostname}${pathname}`)) {
    throw new Error("Historical invoice backfill refuses a non-Production database.");
  }
}

async function sequenceState(transaction: Transaction): Promise<SequenceState> {
  const rows = await transaction.$queryRaw<Array<{
    lastValue: bigint;
    isCalled: boolean;
    maxInvoiceSequence: bigint;
    invoiceCount: bigint;
  }>>`
    SELECT last_value::bigint AS "lastValue", is_called AS "isCalled",
      (SELECT coalesce(max("sequenceNumber"), 0)::bigint FROM invoices) AS "maxInvoiceSequence",
      (SELECT count(*)::bigint FROM invoices) AS "invoiceCount"
    FROM invoice_sequence
  `;
  const row = rows[0];
  if (!row) throw new Error("Historical invoice sequence state is unavailable.");
  return {
    lastValue: row.lastValue.toString(),
    isCalled: row.isCalled,
    maxInvoiceSequence: row.maxInvoiceSequence.toString(),
    invoiceCount: Number(row.invoiceCount),
  };
}

async function candidatePayments(transaction: Transaction): Promise<CandidatePayment[]> {
  return transaction.$queryRaw<CandidatePayment[]>`
    SELECT o.id AS "orderId", o."orderNumber" AS "orderNumber", o.status::text AS "orderStatus",
      o."totalCents" AS "orderTotalCents", o.currency AS "orderCurrency",
      o."basePriceCents", o."coverIncluded", o."coverPriceCents",
      o."priorityProcessing", o."priorityPriceCents",
      (o."customerName" IS NOT NULL AND length(trim(o."customerName")) > 0) AS "customerNamePresent",
      (o."customerEmail" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') AS "customerEmailValid",
      (o."personalUseTermsVersion" IS NOT NULL) AS "termsVersionPresent",
      (o."personalUseTermsHashSha256" IS NOT NULL) AS "termsHashPresent",
      p.id AS "paymentId",
      p."paidAt", p.provider::text AS provider, p."amountCents", p.currency,
      p.status::text AS status, p."refundedAmountCents",
      (p."providerPaymentId" IS NOT NULL) AS "providerPaymentProofPresent",
      (SELECT count(*)::int FROM payments p1 WHERE p1."orderId" = o.id AND p1.status = 'SUCCEEDED') AS "succeededPaymentCount",
      (SELECT count(*)::int FROM provider_events pe WHERE pe."paymentId" = p.id AND pe.outcome = 'PROCESSED') AS "processedProviderEventCount",
      (SELECT count(*)::int FROM refund_attempts ra WHERE ra."paymentId" = p.id) AS "refundAttemptCount",
      (SELECT count(*)::int FROM payment_incidents pi WHERE pi."paymentId" = p.id AND pi.status IN ('OPEN', 'UNDER_REVIEW')) AS "openIncidentCount",
      (SELECT count(*)::int FROM invoices i WHERE i."orderId" = o.id) AS "invoiceCount",
      (SELECT count(*)::int FROM credit_notes cn JOIN invoices i ON i.id = cn."invoiceId" WHERE i."orderId" = o.id) AS "creditNoteCount"
    FROM orders o
    JOIN payments p ON p."orderId" = o.id AND p.status = 'SUCCEEDED'
    WHERE o."orderNumber" IN ('LNX-2026-000003', 'LNX-2026-000007', 'LNX-2026-000011')
    ORDER BY p."paidAt", o."orderNumber"
  `;
}

function assertAllThreeReady(candidates: readonly CandidatePayment[]) {
  if (
    candidates.length !== HISTORICAL_INVOICE_ORDER_ALLOWLIST.length
    || new Set(candidates.map((entry) => entry.orderNumber)).size !== HISTORICAL_INVOICE_ORDER_ALLOWLIST.length
    || HISTORICAL_INVOICE_ORDER_ALLOWLIST.some((orderNumber) => !candidates.some((entry) => entry.orderNumber === orderNumber))
  ) throw new Error("Historical invoice winner set is invalid.");

  for (const candidate of candidates) {
    const expectation = EXPECTATIONS[candidate.orderNumber as keyof typeof EXPECTATIONS];
    const lineTotal = candidate.basePriceCents
      + (candidate.coverIncluded ? candidate.coverPriceCents : 0)
      + (candidate.priorityProcessing ? candidate.priorityPriceCents : 0);
    if (
      !expectation
      || candidate.status !== "SUCCEEDED"
      || !candidate.paidAt
      || candidate.provider !== expectation.provider
      || candidate.amountCents !== expectation.amountCents
      || candidate.currency !== expectation.currency
      || candidate.orderTotalCents !== expectation.amountCents
      || candidate.orderCurrency !== expectation.currency
      || candidate.amountCents !== candidate.orderTotalCents
      || candidate.currency !== candidate.orderCurrency
      || candidate.succeededPaymentCount !== 1
      || !candidate.providerPaymentProofPresent
      || candidate.processedProviderEventCount < 1
      || candidate.refundAttemptCount !== 0
      || candidate.refundedAmountCents !== 0
      || candidate.openIncidentCount !== 0
      || candidate.invoiceCount !== 0
      || candidate.creditNoteCount !== 0
      || !candidate.customerNamePresent
      || !candidate.customerEmailValid
      || candidate.termsVersionPresent !== candidate.termsHashPresent
      || ["DRAFT", "AWAITING_PAYMENT"].includes(candidate.orderStatus)
      || lineTotal !== candidate.orderTotalCents
    ) throw new Error(`Historical invoice validation failed for ${candidate.orderNumber}.`);
  }
}

export async function applyHistoricalInvoiceBackfill(
  client: PrismaClient,
  options: Readonly<{ issuedAt?: Date }> = {},
) {
  const issuedAt = options.issuedAt ?? new Date();
  if (Number.isNaN(issuedAt.getTime())) throw new Error("Historical invoice issuance date is invalid.");
  return client.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('billing:historical-invoice-backfill:v1', 0))`;

    const initialCandidates = await candidatePayments(transaction);
    if (
      initialCandidates.length !== HISTORICAL_INVOICE_ORDER_ALLOWLIST.length
      || new Set(initialCandidates.map((entry) => entry.orderNumber)).size !== HISTORICAL_INVOICE_ORDER_ALLOWLIST.length
    ) {
      throw new Error("Historical invoice winner set is invalid.");
    }
    for (const candidate of [...initialCandidates].sort((a, b) => a.paymentId.localeCompare(b.paymentId))) {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:invoice:payment:${candidate.paymentId}`}, 0))`;
    }

    const lockedCandidates = await candidatePayments(transaction);
    assertAllThreeReady(lockedCandidates);
    const before = await sequenceState(transaction);
    const orderIds = lockedCandidates.map((entry) => entry.orderId);
    const paymentIds = lockedCandidates.map((entry) => entry.paymentId);
    const notificationCountBefore = await transaction.orderNotification.count({ where: { orderId: { in: orderIds } } });
    const paymentStateBefore = await transaction.payment.findMany({
      where: { id: { in: paymentIds } },
      orderBy: { id: "asc" },
      select: { id: true, status: true, amountCents: true, currency: true, refundedAmountCents: true },
    });

    const created = [];
    for (const candidate of lockedCandidates) {
      const result = await issueInvoiceForPayment(transaction, candidate.paymentId, { issuedAt });
      if (!result.created) throw new Error("Historical invoice appeared after global validation.");
      created.push({
        orderNumber: candidate.orderNumber,
        invoiceId: result.invoice.id,
        invoiceNumber: result.invoice.invoiceNumber,
        sequenceNumber: result.invoice.sequenceNumber.toString(),
        issuedAt: result.invoice.issuedAt.toISOString(),
        paidAt: result.invoice.paidAt.toISOString(),
        amountCents: result.invoice.totalCents,
        currency: result.invoice.currency,
        description: candidate.orderNumber === "LNX-2026-000011" ? "Création musicale personnalisée" : "HISTORICAL_TITLE_PRESERVED",
        customerSnapshot: "PRESENT_NOT_DISPLAYED",
      });
    }

    if (created.length !== 3) throw new Error("Historical invoice creation count is invalid.");
    const invoiceIds = created.map((entry) => entry.invoiceId);
    const [invoiceCount, auditCount, creditNoteCount, refundAttemptCount, notificationCountAfter, paymentStateAfter, after] = await Promise.all([
      transaction.invoice.count({ where: { id: { in: invoiceIds } } }),
      transaction.billingAuditEvent.count({ where: { invoiceId: { in: invoiceIds }, action: "INVOICE_ISSUED" } }),
      transaction.creditNote.count({ where: { invoiceId: { in: invoiceIds } } }),
      transaction.refundAttempt.count({ where: { paymentId: { in: paymentIds } } }),
      transaction.orderNotification.count({ where: { orderId: { in: orderIds } } }),
      transaction.payment.findMany({
        where: { id: { in: paymentIds } },
        orderBy: { id: "asc" },
        select: { id: true, status: true, amountCents: true, currency: true, refundedAmountCents: true },
      }),
      sequenceState(transaction),
    ]);
    if (invoiceCount !== 3 || auditCount !== 3 || creditNoteCount !== 0 || refundAttemptCount !== 0) {
      throw new Error("Historical invoice post-write invariant failed.");
    }
    if (notificationCountAfter !== notificationCountBefore) throw new Error("Historical invoice backfill created an unexpected notification.");
    if (JSON.stringify(paymentStateAfter) !== JSON.stringify(paymentStateBefore)) throw new Error("Historical invoice backfill changed a Payment state.");

    return {
      event: "historical.invoice.backfill.completed",
      policy: "CURRENT_ISSUANCE_WITH_HISTORICAL_PAID_AT_REFERENCE",
      validationCompletedBeforeFirstNextval: true,
      deterministicOrder: lockedCandidates.map((entry) => entry.orderNumber),
      sequenceBefore: before,
      sequenceAfter: after,
      invoicesCreated: created,
      auditEventsCreated: auditCount,
      creditNotesCreated: creditNoteCount,
      refundAttemptsCreated: refundAttemptCount,
      notificationsCreated: notificationCountAfter - notificationCountBefore,
      paymentStatesChanged: false,
      providerCalls: 0,
      emailsSent: 0,
    } as const;
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 });
}

async function main() {
  assertHistoricalInvoiceBackfillArguments(process.argv.slice(2));
  assertHistoricalInvoiceBackfillProductionEnvironment(process.env);
  const result = await applyHistoricalInvoiceBackfill(prisma);
  console.info(JSON.stringify(result));
}

const executedDirectly = process.argv[1] === "-"
  || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (executedDirectly) {
  main()
    .catch(() => {
      console.error("Historical invoice backfill failed safely; inspect operator diagnostics before any retry.");
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
