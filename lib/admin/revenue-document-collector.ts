import "server-only";

import { createHash } from "node:crypto";

import { generateCreditNotePdf, generateInvoicePdf } from "@/lib/billing/pdf";
import { billingDocumentRenderMode } from "@/lib/billing/presentation";
import { prisma } from "@/lib/prisma";
import type { RevenueExchange, RevenuePackageDocumentInput } from "./revenue-document-package";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function collectRegisteredDocument(row: RevenueExchange["rows"][number]): Promise<RevenuePackageDocumentInput | null> {
  if (row.kind === "RECEIPT") {
    const invoice = await prisma.invoice.findUnique({ where: { invoiceNumber: row.documentNumber },
      include: { payment: { select: { mode: true, provider: true, providerPaymentId: true } } } });
    if (!invoice || invoice.currency !== "EUR" || invoice.totalCents !== row.amountCents
      || invoice.payment.provider !== row.provider || invoice.payment.providerPaymentId !== row.providerReference) return null;
    const rendered = await generateInvoicePdf(invoice, billingDocumentRenderMode(invoice.payment.mode));
    return { number: invoice.invoiceNumber, kind: "INVOICE", sourceDocumentNumber: null,
      snapshotHashSha256: invoice.snapshotHashSha256, bytes: rendered.bytes };
  }
  const credit = await prisma.creditNote.findUnique({ where: { creditNoteNumber: row.documentNumber }, include: {
    refundAttempt: { select: { providerRefundId: true } },
    invoice: { include: { payment: { select: { mode: true, provider: true } } } },
  } });
  if (!credit || !credit.refundAttempt || credit.currency !== "EUR" || credit.amountCents !== row.amountCents
    || credit.invoice.payment.provider !== row.provider || credit.refundAttempt.providerRefundId !== row.providerReference) return null;
  const rendered = await generateCreditNotePdf(credit, billingDocumentRenderMode(credit.invoice.payment.mode));
  return { number: credit.creditNoteNumber, kind: "CREDIT_NOTE", sourceDocumentNumber: credit.invoice.invoiceNumber,
    snapshotHashSha256: credit.snapshotHashSha256, bytes: rendered.bytes };
}

async function collectDigitalDocument(row: RevenueExchange["rows"][number]): Promise<RevenuePackageDocumentInput | null> {
  const id = row.documentUrl?.match(/^https:\/\/www\.lnxbeats\.fr\/api\/digital\/documents\/([A-Za-z0-9_-]+)$/)?.[1];
  if (!id) return null;
  const document = await prisma.digitalDocument.findUnique({ where: { id }, include: { order: {
    select: { mode: true, currency: true, totalCents: true,
      attempts: { where: { status: "PAID" }, select: { provider: true, paymentReference: true } },
      refunds: { where: { status: "SUCCEEDED" }, select: { amountCents: true, providerReference: true } },
    },
  } } });
  if (!document || document.status !== "READY" || !document.pdf || !document.pdfHash || document.number !== row.documentNumber
    || document.order.mode !== "LIVE" || document.order.currency !== "EUR") return null;
  const bytes = Buffer.from(document.pdf);
  if (sha256(bytes) !== document.pdfHash) return null;
  if (row.kind === "RECEIPT") {
    const attempt = document.order.attempts.find(value => value.provider === row.provider && value.paymentReference === row.providerReference);
    if (document.kind !== "INVOICE" || !attempt || document.order.totalCents !== row.amountCents) return null;
    return { number: document.number, kind: "INVOICE", sourceDocumentNumber: null, snapshotHashSha256: document.snapshotHash, bytes };
  }
  const refund = document.order.refunds.find(value => value.providerReference === row.providerReference && value.amountCents === row.amountCents);
  const snapshot = record(document.snapshot);
  const source = typeof snapshot.sourceInvoice === "string" ? snapshot.sourceInvoice
    : typeof record(snapshot.invoice).invoiceNumber === "string" ? record(snapshot.invoice).invoiceNumber as string : null;
  if (document.kind !== "CREDIT_NOTE" || !refund || !source) return null;
  return { number: document.number, kind: "CREDIT_NOTE", sourceDocumentNumber: source, snapshotHashSha256: document.snapshotHash, bytes };
}

/** Resolve only documents whose amount, provider reference and immutable hash all agree. */
export async function collectRevenuePackageDocuments(exchange: RevenueExchange) {
  const documents = new Map<string, RevenuePackageDocumentInput>();
  const reviewReasons: Record<string, string> = {};
  for (const row of exchange.rows) {
    if (!row.documentUrl) { reviewReasons[row.externalId] = "Aucun justificatif PDF disponible dans le registre du site."; continue; }
    if (documents.has(row.documentNumber)) continue;
    if (documents.size >= 200) { reviewReasons[row.externalId] = "Limite documentaire atteinte ; exporter une période plus courte."; continue; }
    try {
      const document = row.category === "DIGITAL" ? await collectDigitalDocument(row) : await collectRegisteredDocument(row);
      if (document) documents.set(document.number, document);
      else reviewReasons[row.externalId] = "Le justificatif ne concorde pas avec le mouvement et doit être rapproché manuellement.";
    } catch {
      reviewReasons[row.externalId] = "Le justificatif n’a pas pu être vérifié ; aucune archive automatique créée.";
    }
  }
  return { documents: [...documents.values()], reviewReasons };
}
