import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  billingSnapshotHash,
  creditNoteNumber,
  CURRENT_VAT_LEGAL_NOTICE,
  CURRENT_VAT_REGIME,
  invoiceNumber,
  parisDayRange,
  paymentMethodLabel,
  validateBillingCustomerIdentity,
  type BillingCustomerIdentity,
} from "@/lib/billing/domain";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;

export class BillingServiceError extends Error {
  constructor(public readonly code: string, public readonly status = 409) {
    super(code);
    this.name = "BillingServiceError";
  }
}

const sellerSnapshot = Object.freeze({
  legalName: "Ludovic Mickaël Mathon",
  legalForm: "Entrepreneur individuel",
  tradeName: "LNX Beats",
  serviceName: "LNX STUDIO",
  address: { line1: "35 Impasse des Orties", postalCode: "07370", city: "Ozon", countryCode: "FR" },
  siren: "106870850",
  siret: "10687085000018",
  ape: "9003B",
  email: "lnx.beats.pro@gmail.com",
  phone: "06 71 66 70 32",
});

async function lock(transaction: Transaction, value: string) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${value}, 0))`;
}

async function nextSequence(transaction: Transaction, sequence: "invoice_sequence" | "credit_note_sequence") {
  const rows = sequence === "invoice_sequence"
    ? await transaction.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('invoice_sequence')::bigint AS value`
    : await transaction.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('credit_note_sequence')::bigint AS value`;
  const value = rows[0]?.value;
  if (typeof value !== "bigint" || value < 1n) throw new BillingServiceError("BILLING_SEQUENCE_FAILURE", 500);
  return value;
}

function individualIdentity(input: { name: string | null; email: string }): BillingCustomerIdentity {
  return validateBillingCustomerIdentity({
    type: "INDIVIDUAL",
    name: input.name?.trim() || "Client LNX Beats",
    email: input.email,
    billingAddress: null,
  });
}

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

export async function issueInvoiceForPayment(
  transaction: Transaction,
  paymentId: string,
  options: Readonly<{ issuedAt?: Date; customer?: BillingCustomerIdentity }> = {},
) {
  await lock(transaction, `billing:invoice:payment:${paymentId}`);
  const existing = await transaction.invoice.findUnique({ where: { paymentId } });
  if (existing) return { invoice: existing, created: false } as const;

  const payment = await transaction.payment.findUnique({ where: { id: paymentId } });
  const musicOrder = payment?.orderId ? await transaction.order.findUnique({
    where: { id: payment.orderId },
    select: {
      id: true,
      orderNumber: true, status: true, customerName: true, customerEmail: true,
      title: true, basePriceCents: true, coverIncluded: true, coverPriceCents: true,
      priorityProcessing: true, priorityPriceCents: true, totalCents: true, currency: true,
      personalUseTermsVersion: true, personalUseTermsHashSha256: true,
    },
  }) : null;
  const shopOrderRow = payment?.shopOrderId ? await transaction.shopOrder.findUnique({
    where: { id: payment.shopOrderId },
    select: {
      id: true, userId: true, orderNumber: true, status: true, paymentStatus: true, paymentReviewAt: true,
      subtotalCents: true, shippingCents: true, totalCents: true, currency: true,
      termsVersion: true, termsHashSha256: true,
      shippingFirstName: true, shippingLastName: true, shippingAddressLine1: true,
      shippingAddressLine2: true, shippingPostalCode: true, shippingCity: true, shippingCountryCode: true,
    },
  }) : null;
  const shopUser = shopOrderRow ? await transaction.user.findUnique({
    where: { id: shopOrderRow.userId },
    select: { email: true, displayName: true, firstName: true, lastName: true },
  }) : null;
  const shopItems = shopOrderRow ? await transaction.shopOrderItem.findMany({
    where: { shopOrderId: shopOrderRow.id },
    orderBy: { position: "asc" },
    select: { productTitle: true, unitPriceCents: true, quantity: true, lineTotalCents: true },
  }) : [];
  const shopOrder = shopOrderRow && shopUser
    ? { ...shopOrderRow, user: shopUser, items: shopItems }
    : null;
  if (!payment || payment.status !== "SUCCEEDED" || !payment.paidAt) throw new BillingServiceError("PAYMENT_NOT_INVOICEABLE");
  if ((payment.orderId ? 1 : 0) + (payment.shopOrderId ? 1 : 0) !== 1) throw new BillingServiceError("INVOICE_PARENT_INVALID");
  if (payment.currency !== "EUR" || payment.amountCents <= 0) throw new BillingServiceError("INVOICE_FINANCIAL_SNAPSHOT_INVALID");

  const issuedAt = options.issuedAt ?? new Date();
  let documentType: "MUSIC" | "SHOP";
  let operationCategory: "SERVICES" | "GOODS";
  let orderNumberSnapshot: string;
  let customer: BillingCustomerIdentity;
  let lineItems: Array<{ description: string; quantity: number; unitPriceCents: number; lineTotalCents: number }>;
  let subtotalCents: number;
  let shippingCents: number;
  let termsVersion: string | null;
  let termsHashSha256: string | null;

  if (musicOrder && payment.orderId) {
    if (musicOrder.status === "DRAFT" || musicOrder.status === "AWAITING_PAYMENT") throw new BillingServiceError("ORDER_NOT_INVOICEABLE");
    if (musicOrder.totalCents !== payment.amountCents || musicOrder.currency !== payment.currency) throw new BillingServiceError("INVOICE_FINANCIAL_SNAPSHOT_INVALID");
    documentType = "MUSIC";
    operationCategory = "SERVICES";
    orderNumberSnapshot = musicOrder.orderNumber;
    customer = options.customer ? validateBillingCustomerIdentity(options.customer) : individualIdentity({ name: musicOrder.customerName, email: musicOrder.customerEmail });
    lineItems = [
      { description: musicOrder.title?.trim() || "Création musicale personnalisée", quantity: 1, unitPriceCents: musicOrder.basePriceCents, lineTotalCents: musicOrder.basePriceCents },
      ...(musicOrder.coverIncluded && musicOrder.coverPriceCents > 0 ? [{ description: "Illustration personnalisée", quantity: 1, unitPriceCents: musicOrder.coverPriceCents, lineTotalCents: musicOrder.coverPriceCents }] : []),
      ...(musicOrder.priorityProcessing && musicOrder.priorityPriceCents > 0 ? [{ description: "Traitement prioritaire", quantity: 1, unitPriceCents: musicOrder.priorityPriceCents, lineTotalCents: musicOrder.priorityPriceCents }] : []),
    ];
    subtotalCents = musicOrder.totalCents;
    shippingCents = 0;
    termsVersion = musicOrder.personalUseTermsVersion;
    termsHashSha256 = musicOrder.personalUseTermsHashSha256;
  } else if (shopOrder && payment.shopOrderId) {
    if (shopOrder.paymentStatus !== "PAID" || shopOrder.paymentReviewAt || shopOrder.status !== "OPEN") throw new BillingServiceError("SHOP_ORDER_NOT_INVOICEABLE");
    if (shopOrder.totalCents !== payment.amountCents || shopOrder.currency !== payment.currency) throw new BillingServiceError("INVOICE_FINANCIAL_SNAPSHOT_INVALID");
    documentType = "SHOP";
    operationCategory = "GOODS";
    orderNumberSnapshot = shopOrder.orderNumber;
    if (!shopOrder.shippingAddressLine1 || !shopOrder.shippingPostalCode || !shopOrder.shippingCity || shopOrder.shippingCountryCode !== "FR") {
      throw new BillingServiceError("INVOICE_BILLING_ADDRESS_INVALID");
    }
    const userName = [shopOrder.user.firstName, shopOrder.user.lastName].filter(Boolean).join(" ") || shopOrder.user.displayName;
    customer = options.customer ? validateBillingCustomerIdentity(options.customer) : validateBillingCustomerIdentity({
      type: "INDIVIDUAL",
      name: userName || "Client LNX Beats",
      email: shopOrder.user.email,
      billingAddress: {
        line1: shopOrder.shippingAddressLine1,
        line2: shopOrder.shippingAddressLine2,
        postalCode: shopOrder.shippingPostalCode,
        city: shopOrder.shippingCity,
        countryCode: shopOrder.shippingCountryCode as "FR",
      },
    });
    lineItems = shopOrder.items.map((item) => ({
      description: item.productTitle,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents,
    }));
    subtotalCents = shopOrder.subtotalCents;
    shippingCents = shopOrder.shippingCents;
    termsVersion = shopOrder.termsVersion;
    termsHashSha256 = shopOrder.termsHashSha256;
  } else {
    throw new BillingServiceError("INVOICE_PARENT_INVALID");
  }

  if (subtotalCents + shippingCents !== payment.amountCents || lineItems.reduce((sum, item) => sum + item.lineTotalCents, 0) !== subtotalCents) {
    throw new BillingServiceError("INVOICE_FINANCIAL_SNAPSHOT_INVALID");
  }
  if ((termsVersion === null) !== (termsHashSha256 === null)) throw new BillingServiceError("INVOICE_TERMS_SNAPSHOT_INVALID");

  const sequenceNumber = await nextSequence(transaction, "invoice_sequence");
  const number = invoiceNumber(issuedAt, sequenceNumber);
  const snapshot = {
    invoiceNumber: number,
    sequenceNumber: sequenceNumber.toString(),
    issuedAt: issuedAt.toISOString(),
    documentType,
    operationCategory,
    orderNumber: orderNumberSnapshot,
    seller: sellerSnapshot,
    customer,
    lineItems,
    currency: "EUR",
    subtotalCents,
    shippingCents,
    totalCents: payment.amountCents,
    vatRegime: CURRENT_VAT_REGIME,
    vatAmountCents: 0,
    vatLegalNotice: CURRENT_VAT_LEGAL_NOTICE,
    payment: { id: payment.id, provider: payment.provider, label: paymentMethodLabel(payment.provider, payment.paymentMethod), paidAt: payment.paidAt.toISOString() },
    terms: termsVersion && termsHashSha256 ? { version: termsVersion, hashSha256: termsHashSha256 } : null,
  };
  const invoice = await transaction.invoice.create({
    data: {
      invoiceNumber: number,
      sequenceNumber,
      issuedAt,
      documentType,
      operationCategory,
      orderId: payment.orderId,
      shopOrderId: payment.shopOrderId,
      paymentId: payment.id,
      orderNumberSnapshot,
      customerType: customer.type,
      customerNameSearch: customer.companyName ?? customer.name,
      customerEmailSearch: customer.email,
      sellerSnapshot: json(sellerSnapshot),
      customerSnapshot: json(customer),
      lineItemsSnapshot: json(lineItems),
      currency: "EUR",
      subtotalCents,
      shippingCents,
      totalCents: payment.amountCents,
      vatRegime: CURRENT_VAT_REGIME,
      vatAmountCents: 0,
      vatLegalNotice: CURRENT_VAT_LEGAL_NOTICE,
      paymentMethodLabel: paymentMethodLabel(payment.provider, payment.paymentMethod),
      paidAt: payment.paidAt,
      termsVersion,
      termsHashSha256,
      snapshotHashSha256: billingSnapshotHash(snapshot),
    },
  });
  await transaction.billingAuditEvent.create({ data: { invoiceId: invoice.id, action: "INVOICE_ISSUED" } });
  return { invoice, created: true } as const;
}

export async function issueCreditNoteForRefund(
  transaction: Transaction,
  input: Readonly<{
    refundAttemptId: string;
    withdrawalRequestId?: string | null;
    shopReturnRequestId?: string | null;
    reasonCode?: "WITHDRAWAL" | "NON_CONFORMITY" | "SELLER_ERROR" | "DAMAGED_PRODUCT" | "OTHER_REVIEWED";
    reasonText?: string | null;
    issuedAt?: Date;
  }>,
) {
  await lock(transaction, `billing:credit-note:refund:${input.refundAttemptId}`);
  const existing = await transaction.creditNote.findUnique({ where: { refundAttemptId: input.refundAttemptId } });
  if (existing) return { creditNote: existing, created: false } as const;
  const attempt = await transaction.refundAttempt.findUnique({
    where: { id: input.refundAttemptId },
    select: {
      id: true, status: true, amountCents: true, currency: true, confirmedAt: true,
      payment: { select: { invoice: { select: { id: true, invoiceNumber: true, totalCents: true, currency: true, orderId: true, shopOrderId: true } } } },
    },
  });
  if (!attempt || attempt.status !== "SUCCEEDED" || !attempt.confirmedAt) throw new BillingServiceError("REFUND_NOT_CREDIT_NOTE_ELIGIBLE");
  const invoice = attempt.payment.invoice;
  if (!invoice) throw new BillingServiceError("INVOICE_NOT_FOUND", 404);
  await lock(transaction, `billing:credit-note:invoice:${invoice.id}`);
  if (attempt.currency !== "EUR" || attempt.currency !== invoice.currency) throw new BillingServiceError("CREDIT_NOTE_CURRENCY_INVALID");
  if (input.withdrawalRequestId) {
    const withdrawal = await transaction.consumerWithdrawalRequest.findUnique({
      where: { id: input.withdrawalRequestId },
      select: { id: true, orderId: true, shopOrderId: true, status: true, refundStatus: true },
    });
    const sameParent = withdrawal && withdrawal.orderId === invoice.orderId && withdrawal.shopOrderId === invoice.shopOrderId;
    if (!withdrawal || !sameParent || withdrawal.status !== "ACCEPTED" || !["REFUND_REQUIRED", "COMPLETED"].includes(withdrawal.refundStatus)) {
      throw new BillingServiceError("CREDIT_NOTE_WITHDRAWAL_INVALID");
    }
  }
  if (input.shopReturnRequestId) {
    const shopReturn = await transaction.shopReturnRequest.findUnique({
      where: { id: input.shopReturnRequestId },
      select: { shopOrderId: true, refundAttempt: { select: { id: true } } },
    });
    if (
      !shopReturn
      || shopReturn.shopOrderId !== invoice.shopOrderId
      || shopReturn.refundAttempt?.id !== attempt.id
    ) throw new BillingServiceError("CREDIT_NOTE_SHOP_RETURN_INVALID");
  }
  const aggregate = await transaction.creditNote.aggregate({ where: { invoiceId: invoice.id }, _sum: { amountCents: true } });
  const alreadyCredited = aggregate._sum.amountCents ?? 0;
  if (attempt.amountCents <= 0 || alreadyCredited + attempt.amountCents > invoice.totalCents) throw new BillingServiceError("CREDIT_NOTE_AMOUNT_EXCEEDED");
  const cumulativeCreditedCents = alreadyCredited + attempt.amountCents;
  const remainingBalanceCents = invoice.totalCents - cumulativeCreditedCents;
  const reasonText = input.reasonText?.trim() || null;
  if (reasonText && (reasonText.length > 500 || /[\u0000-\u001f\u007f]/.test(reasonText))) throw new BillingServiceError("CREDIT_NOTE_REASON_INVALID", 400);
  const issuedAt = input.issuedAt ?? attempt.confirmedAt;
  const sequenceNumber = await nextSequence(transaction, "credit_note_sequence");
  const number = creditNoteNumber(issuedAt, sequenceNumber);
  const reasonCode = input.reasonCode ?? "OTHER_REVIEWED";
  const snapshot = {
    creditNoteNumber: number,
    sequenceNumber: sequenceNumber.toString(),
    issuedAt: issuedAt.toISOString(),
    sourceInvoice: invoice.invoiceNumber,
    refundAttemptId: attempt.id,
    withdrawalRequestId: input.withdrawalRequestId ?? null,
    shopReturnRequestId: input.shopReturnRequestId ?? null,
    amountCents: attempt.amountCents,
    cumulativeCreditedCents,
    remainingBalanceCents,
    currency: "EUR",
    reasonCode,
    reasonText,
  };
  const creditNote = await transaction.creditNote.create({
    data: {
      creditNoteNumber: number,
      sequenceNumber,
      invoiceId: invoice.id,
      refundAttemptId: attempt.id,
      withdrawalRequestId: input.withdrawalRequestId ?? null,
      shopReturnRequestId: input.shopReturnRequestId ?? null,
      idempotencyKey: `refund-attempt:${attempt.id}:credit-note`,
      issuedAt,
      amountCents: attempt.amountCents,
      cumulativeCreditedCents,
      remainingBalanceCents,
      currency: "EUR",
      reasonCode,
      reasonText,
      snapshotHashSha256: billingSnapshotHash(snapshot),
    },
  });
  await transaction.billingAuditEvent.create({ data: { invoiceId: invoice.id, creditNoteId: creditNote.id, action: "CREDIT_NOTE_ISSUED" } });
  return { creditNote, created: true } as const;
}

export async function issueCreditNoteForRefundIfInvoiceExists(transaction: Transaction, refundAttemptId: string) {
  const linked = await transaction.refundAttempt.findUnique({
    where: { id: refundAttemptId },
    select: { payment: { select: { invoice: { select: { id: true } } } } },
  });
  if (!linked?.payment.invoice) return null;
  return issueCreditNoteForRefund(transaction, { refundAttemptId });
}

export async function listMemberInvoices(userId: string, client: PrismaClient = prisma) {
  assertDatabaseConfigured();
  return client.invoice.findMany({
    where: { OR: [{ order: { userId } }, { shopOrder: { userId } }] },
    orderBy: [{ issuedAt: "desc" }, { sequenceNumber: "desc" }],
    include: { creditNotes: { orderBy: { issuedAt: "asc" } } },
  });
}

export async function getInvoiceForMember(invoiceNumberValue: string, userId: string, client: PrismaClient = prisma) {
  assertDatabaseConfigured();
  return client.invoice.findFirst({
    where: { invoiceNumber: invoiceNumberValue, OR: [{ order: { userId } }, { shopOrder: { userId } }] },
    include: { creditNotes: { orderBy: { issuedAt: "asc" } } },
  });
}

export async function getCreditNoteForMember(number: string, userId: string, client: PrismaClient = prisma) {
  assertDatabaseConfigured();
  return client.creditNote.findFirst({
    where: { creditNoteNumber: number, invoice: { OR: [{ order: { userId } }, { shopOrder: { userId } }] } },
    include: { invoice: true },
  });
}

export async function listAdminInvoices(search: string | undefined, client: PrismaClient = prisma) {
  assertDatabaseConfigured();
  const value = search?.trim().slice(0, 120);
  const dateMatch = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const dateParts = dateMatch
    ? value?.includes("-")
      ? { year: Number(dateMatch[1]), month: Number(dateMatch[2]), day: Number(dateMatch[3]) }
      : { year: Number(dateMatch[3]), month: Number(dateMatch[2]), day: Number(dateMatch[1]) }
    : null;
  let dateRange: ReturnType<typeof parisDayRange> | null = null;
  if (dateParts) {
    try { dateRange = parisDayRange(dateParts.year, dateParts.month, dateParts.day); } catch { dateRange = null; }
  }
  return client.invoice.findMany({
    where: value ? { OR: [
      { invoiceNumber: { contains: value, mode: "insensitive" } },
      { orderNumberSnapshot: { contains: value, mode: "insensitive" } },
      { customerNameSearch: { contains: value, mode: "insensitive" } },
      { customerEmailSearch: { contains: value, mode: "insensitive" } },
      { creditNotes: { some: { creditNoteNumber: { contains: value, mode: "insensitive" } } } },
      ...(dateRange ? [{ issuedAt: { gte: dateRange.start, lt: dateRange.end } }] : []),
      ...(dateRange ? [{ creditNotes: { some: { issuedAt: { gte: dateRange.start, lt: dateRange.end } } } }] : []),
    ] } : undefined,
    orderBy: [{ issuedAt: "desc" }, { sequenceNumber: "desc" }],
    take: 200,
    include: { creditNotes: { orderBy: { issuedAt: "asc" } } },
  });
}

export async function getInvoiceForAdmin(invoiceNumberValue: string, client: PrismaClient = prisma) {
  assertDatabaseConfigured();
  return client.invoice.findUnique({
    where: { invoiceNumber: invoiceNumberValue },
    include: { creditNotes: { orderBy: { issuedAt: "asc" } }, auditEvents: { orderBy: { createdAt: "asc" } } },
  });
}

export async function getCreditNoteForAdmin(number: string, client: PrismaClient = prisma) {
  assertDatabaseConfigured();
  return client.creditNote.findUnique({ where: { creditNoteNumber: number }, include: { invoice: true } });
}
