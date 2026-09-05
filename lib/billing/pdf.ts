import "server-only";

import PDFDocument from "pdfkit";

import { billingAddressLines } from "@/lib/billing/address-presentation";
import { formatBillingMoney } from "@/lib/billing/domain";
import { creditNoteReasonLabel, type BillingDocumentRenderMode } from "@/lib/billing/presentation";

type Address = { line1: string; line2?: string | null; postalCode: string; city: string; countryCode: string };
type Seller = { legalName: string; legalForm: string; tradeName: string; serviceName: string; address: Address; siren: string; siret: string; ape: string; email: string; phone: string };
type Customer = { type: string; name: string; email: string; companyName?: string | null; billingAddress?: Address | null; businessIdentifier?: string | null; vatId?: string | null };
type LineItem = { description: string; quantity: number; unitPriceCents: number; lineTotalCents: number };

export type InvoicePdfRecord = Readonly<{
  invoiceNumber: string;
  issuedAt: Date;
  orderNumberSnapshot: string;
  sellerSnapshot: unknown;
  customerSnapshot: unknown;
  lineItemsSnapshot: unknown;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
  vatLegalNotice: string;
  paymentMethodLabel: string;
  paidAt: Date;
  termsVersion: string | null;
  snapshotHashSha256: string;
}>;

export type CreditNotePdfRecord = Readonly<{
  creditNoteNumber: string;
  issuedAt: Date;
  amountCents: number;
  cumulativeCreditedCents: number;
  remainingBalanceCents: number;
  currency: string;
  reasonCode: string;
  reasonText: string | null;
  snapshotHashSha256: string;
  invoice: InvoicePdfRecord;
}>;

const PAGE = { width: 595.28, height: 841.89 } as const;
const margin = 48;
const gold = "#b88a3b";
const dark = "#151515";
const gray = "#5d5d5d";
const qaWatermark = "DOCUMENT QA — SANS VALEUR COMPTABLE";

export const billingPdfLayout = Object.freeze({
  pageWidth: PAGE.width,
  pageHeight: PAGE.height,
  safePrintMargin: margin,
  titleY: 68,
  metadataY: 101,
  metadataHeight: 11,
  qaBannerY: 126,
  qaBannerHeight: 34,
  qaBodyY: 180,
  standardBodyY: 128,
  continuationBodyY: 68,
  footerY: 779,
  footerHeight: 10,
});

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function text(record: Record<string, unknown>, key: string, maximum = 500) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new TypeError(`${key} is invalid.`);
  return value;
}

function parseAddress(value: unknown): Address {
  const record = object(value, "Address");
  return { line1: text(record, "line1"), line2: typeof record.line2 === "string" ? record.line2 : null, postalCode: text(record, "postalCode", 32), city: text(record, "city", 120), countryCode: text(record, "countryCode", 2) };
}

function parseSeller(value: unknown): Seller {
  const record = object(value, "Seller snapshot");
  return {
    legalName: text(record, "legalName"), legalForm: text(record, "legalForm"), tradeName: text(record, "tradeName"),
    serviceName: text(record, "serviceName"), address: parseAddress(record.address), siren: text(record, "siren", 16),
    siret: text(record, "siret", 20), ape: text(record, "ape", 12), email: text(record, "email", 320), phone: text(record, "phone", 32),
  };
}

function parseCustomer(value: unknown): Customer {
  const record = object(value, "Customer snapshot");
  return {
    type: text(record, "type", 32), name: text(record, "name"), email: text(record, "email", 320),
    companyName: typeof record.companyName === "string" ? record.companyName : null,
    billingAddress: record.billingAddress ? parseAddress(record.billingAddress) : null,
    businessIdentifier: typeof record.businessIdentifier === "string" ? record.businessIdentifier : null,
    vatId: typeof record.vatId === "string" ? record.vatId : null,
  };
}

function parseLines(value: unknown): LineItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new TypeError("Invoice lines are invalid.");
  return value.map((entry) => {
    const record = object(entry, "Invoice line");
    const quantity = record.quantity;
    const unitPriceCents = record.unitPriceCents;
    const lineTotalCents = record.lineTotalCents;
    if (!Number.isInteger(quantity) || !Number.isInteger(unitPriceCents) || !Number.isInteger(lineTotalCents)) throw new TypeError("Invoice line amounts are invalid.");
    return { description: text(record, "description"), quantity: quantity as number, unitPriceCents: unitPriceCents as number, lineTotalCents: lineTotalCents as number };
  });
}

function frenchDate(value: Date) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long" }).format(value);
}

async function render(title: string, number: string, issuedAt: Date, hash: string, mode: BillingDocumentRenderMode, body: (document: PDFKit.PDFDocument) => void) {
  const document = new PDFDocument({
    size: "A4",
    bufferPages: true,
    margins: { top: margin, right: margin, bottom: 96, left: margin },
    compress: true,
    info: { Title: `${title} ${number}`, Author: "LNX Beats", Creator: "LNX STUDIO V1.1.0", CreationDate: issuedAt, ModDate: issuedAt },
  });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completion = new Promise<Buffer>((resolve, reject) => { document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); });

  function drawPageChrome() {
    document.save();
    document.rect(0, 0, PAGE.width, 10).fill(gold);
    document.fillColor(dark).font("Helvetica-Bold").fontSize(12).text("LNX STUDIO", margin, 34, { lineBreak: false });
    document.fillColor(gray).font("Helvetica").fontSize(9).text(number, PAGE.width - margin - 220, 36, { width: 220, align: "right", lineBreak: false });
    document.restore();
  }

  document.on("pageAdded", () => {
    drawPageChrome();
    document.x = margin;
    document.y = billingPdfLayout.continuationBodyY;
  });

  drawPageChrome();
  document.fillColor(dark).font("Helvetica-Bold").fontSize(24).text(title, margin, billingPdfLayout.titleY, { lineBreak: false });
  document.fillColor(gray).font("Helvetica").fontSize(9).text(
    `Émis le ${frenchDate(issuedAt)} · Empreinte ${hash.slice(0, 16).toUpperCase()}`,
    margin,
    billingPdfLayout.metadataY,
    { width: PAGE.width - margin * 2, lineBreak: false },
  );
  if (mode === "TEST") {
    document.roundedRect(margin, billingPdfLayout.qaBannerY, PAGE.width - margin * 2, billingPdfLayout.qaBannerHeight, 6).fill("#fff1d6");
    document.fillColor("#704708").font("Helvetica-Bold").fontSize(10).text(
      qaWatermark,
      margin + 12,
      billingPdfLayout.qaBannerY + 12,
      { width: PAGE.width - margin * 2 - 24, align: "center", lineBreak: false },
    );
    document.x = margin;
    document.y = billingPdfLayout.qaBodyY;
  } else {
    document.x = margin;
    document.y = billingPdfLayout.standardBodyY;
  }
  body(document);

  const range = document.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    document.switchToPage(index);
    document.page.margins.bottom = 0;
    document.save();
    document.fillColor(gray).font("Helvetica").fontSize(7.5).text(
      `Document généré à partir d’un snapshot immuable. Conservation comptable : 10 ans. · Page ${index + 1} / ${range.count}`,
      margin,
      billingPdfLayout.footerY,
      { width: PAGE.width - margin * 2, align: "center", lineBreak: false },
    );
    document.restore();
  }
  document.end();
  return { bytes: await completion, filename: `${number}.pdf`, pageCount: range.count };
}

function party(document: PDFKit.PDFDocument, title: string, lines: readonly string[], x: number) {
  document.fillColor(gold).font("Helvetica-Bold").fontSize(8).text(title.toUpperCase(), x, document.y, { width: 230 });
  const y = document.y + 5;
  document.fillColor(dark).font("Helvetica").fontSize(8.5).text(lines.join("\n"), x, y, { width: 230, lineGap: 2 });
}

export async function generateInvoicePdf(record: InvoicePdfRecord, mode: BillingDocumentRenderMode = "TEST") {
  const seller = parseSeller(record.sellerSnapshot);
  const customer = parseCustomer(record.customerSnapshot);
  const lines = parseLines(record.lineItemsSnapshot);
  return render("FACTURE", record.invoiceNumber, record.issuedAt, record.snapshotHashSha256, mode, (document) => {
    const partyY = document.y;
    party(document, "Émetteur", [seller.legalName, `${seller.legalForm} · ${seller.tradeName}`, seller.address.line1, `${seller.address.postalCode} ${seller.address.city}`, `SIREN ${seller.siren} · SIRET ${seller.siret}`, `APE ${seller.ape}`, seller.email], margin);
    document.y = partyY;
    const customerLines = [customer.companyName || customer.name, ...(customer.companyName ? [customer.name] : []), ...(customer.billingAddress ? billingAddressLines(customer.billingAddress) : []), customer.email, ...(customer.businessIdentifier ? [`SIREN/SIRET ${customer.businessIdentifier}`] : []), ...(customer.vatId ? [`TVA ${customer.vatId}`] : [])].filter(Boolean);
    party(document, "Client", customerLines, 318);
    document.y = Math.max(document.y, partyY + 105);
    document.moveDown(.8);
    document.fillColor(dark).font("Helvetica-Bold").fontSize(10).text(`Commande ${record.orderNumberSnapshot}`);
    document.moveDown(.6);
    for (const line of lines) {
      const y = document.y;
      const description = `${line.description} × ${line.quantity}`;
      document.fillColor(dark).font("Helvetica").fontSize(9);
      const descriptionHeight = document.heightOfString(description, { width: 310 });
      const amount = formatBillingMoney(line.lineTotalCents);
      const amountHeight = document.heightOfString(amount, { width: 100 });
      document.text(description, margin, y, { width: 310 });
      document.text(amount, 400, y, { width: 100, align: "right" });
      document.y = y + Math.max(descriptionHeight, amountHeight);
      document.moveDown(.55).strokeColor("#dedede").moveTo(margin, document.y).lineTo(PAGE.width - margin, document.y).stroke();
      document.moveDown(.55);
    }
    document.fillColor(dark).font("Helvetica").fontSize(9).text(`Sous-total : ${formatBillingMoney(record.subtotalCents)}`, { align: "right" });
    if (record.shippingCents) document.text(`Livraison : ${formatBillingMoney(record.shippingCents)}`, { align: "right" });
    document.font("Helvetica-Bold").fontSize(14).text(`TOTAL : ${formatBillingMoney(record.totalCents)}`, { align: "right" });
    document.moveDown(1);
    document.fillColor(dark).font("Helvetica-Bold").fontSize(9).text(record.vatLegalNotice);
    document.font("Helvetica").text(`Paiement reçu le ${frenchDate(record.paidAt)} — ${record.paymentMethodLabel}.`);
    if (record.termsVersion) document.text(`Conditions contractuelles : version ${record.termsVersion}.`);
  });
}

export async function generateCreditNotePdf(record: CreditNotePdfRecord, mode: BillingDocumentRenderMode = "TEST") {
  return render("AVOIR", record.creditNoteNumber, record.issuedAt, record.snapshotHashSha256, mode, (document) => {
    document.fillColor(dark).font("Helvetica-Bold").fontSize(11).text(`Facture d’origine : ${record.invoice.invoiceNumber}`);
    document.font("Helvetica").fontSize(9.5).text(`Commande : ${record.invoice.orderNumberSnapshot}`);
    document.text(`Motif : ${creditNoteReasonLabel(record.reasonCode)}${record.reasonText ? ` — ${record.reasonText}` : ""}`);
    document.moveDown(1.5);
    document.font("Helvetica-Bold").fontSize(18).text(`Montant de l’avoir : ${formatBillingMoney(record.amountCents)}`, { align: "right" });
    document.font("Helvetica").fontSize(9.5).text(`Total cumulé des avoirs : ${formatBillingMoney(record.cumulativeCreditedCents)}`, { align: "right" });
    document.text(`Solde documentaire restant : ${formatBillingMoney(record.remainingBalanceCents)}`, { align: "right" });
    document.moveDown(1);
    document.font("Helvetica").fontSize(9).text(record.invoice.vatLegalNotice);
    document.text("Cet avoir corrige la facture d’origine sans la modifier ni la supprimer.");
  });
}
