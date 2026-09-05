export type HistoricalInvoiceRow = Readonly<{
  orderNumber: string;
  orderStatus: string;
  orderTotalCents: number;
  orderCurrency: string;
  basePriceCents: number;
  coverIncluded: boolean;
  coverPriceCents: number;
  priorityProcessing: boolean;
  priorityPriceCents: number;
  titlePresent: boolean;
  customerNamePresent: boolean;
  customerEmailValid: boolean;
  termsVersionPresent: boolean;
  termsHashPresent: boolean;
  paymentPresent: boolean;
  provider: string | null;
  paymentMode: string | null;
  paymentStatus: string | null;
  paymentAmountCents: number | null;
  paymentCurrency: string | null;
  paidAt: string | Date | null;
  providerPaymentProofPresent: boolean;
  processedProviderEventCount: number;
  invoiceCount: number;
}>;

export type HistoricalInvoicePlan = Readonly<{
  orderNumber: string;
  readyForBackfill: boolean;
  missingData: string[];
  customerSnapshotComplete: boolean;
  orderSnapshotComplete: boolean;
  paymentProofComplete: boolean;
  descriptionComplete: boolean;
  amountCurrencyVerified: boolean;
  billingDataSufficient: boolean;
  proposedDocumentContent: Readonly<{
    documentType: "MUSIC";
    operationCategory: "SERVICES";
    lines: Array<Readonly<{ description: string; quantity: number; unitPriceCents: number; lineTotalCents: number }>>;
    totalCents: number;
    currency: string;
    provider: string | null;
    issuanceDatePolicy: "CURRENT_ISSUANCE_WITH_HISTORICAL_PAID_AT_REFERENCE";
    historicalPaymentDateReference: string | Date | null;
    customerIdentity: "PRESENT_NOT_DISPLAYED";
    termsSnapshot: "PRESENT" | "ABSENT";
  }>;
  numberAllocated: false;
  datePolicyRequired: false;
  applyImplemented: false;
}>;

export const HISTORICAL_INVOICE_ORDER_ALLOWLIST: readonly string[];
export const APPROVED_HISTORICAL_INVOICE_DATE_POLICY: "CURRENT_ISSUANCE_WITH_HISTORICAL_PAID_AT_REFERENCE";
export function assertHistoricalInvoiceDryRunArguments(argumentsProvided: readonly string[]): void;
export function assertHistoricalInvoiceWhitelist(orderNumbers: readonly string[]): string[];
export function assessHistoricalInvoiceOrder(row: HistoricalInvoiceRow): HistoricalInvoicePlan;
export function readHistoricalInvoiceBackfillPlan(
  client: { query(sql: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }> },
  requestedOrderNumbers?: readonly string[],
): Promise<Readonly<{
  mode: "DRY_RUN_READ_ONLY";
  approvedDatePolicy: "CURRENT_ISSUANCE_WITH_HISTORICAL_PAID_AT_REFERENCE";
  allowlist: string[];
  missingOrders: string[];
  sequence: unknown;
  plans: HistoricalInvoicePlan[];
  productionWrites: 0;
  numbersAllocated: 0;
  allOrdersValidatedBeforeNumberAllocation: boolean;
  datePolicyRequired: false;
  applyImplemented: false;
}>>;
