import { createHash } from "node:crypto";

import type { buildRevenueExchange } from "./revenue-exchange";

export const REVENUE_DOCUMENT_PACKAGE_MAX_DOCUMENTS = 200;
export const REVENUE_DOCUMENT_PACKAGE_MAX_BYTES = 32 * 1024 * 1024;

export type RevenueExchange = ReturnType<typeof buildRevenueExchange>;
export type RevenuePackageDocumentInput = Readonly<{
  number: string;
  kind: "INVOICE" | "CREDIT_NOTE";
  sourceDocumentNumber: string | null;
  snapshotHashSha256: string;
  bytes: Uint8Array;
}>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pdf = (bytes: Uint8Array) => bytes.byteLength >= 8
  && Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-"
  && Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 1024))).includes(Buffer.from("%%EOF"));

function safeNumber(value: string) {
  return /^(?:AV-)?LNX-[A-Za-z0-9_-]{1,72}$/.test(value) && !/[\u0000-\u001f\u007f]/.test(value);
}

/** A self-contained authenticated hand-off. Gestion verifies the bytes again. */
export function buildRevenueDocumentPackage(
  exchange: RevenueExchange,
  inputDocuments: readonly RevenuePackageDocumentInput[],
  reviewReasons: Readonly<Record<string, string>> = {},
) {
  if (exchange.format !== "lnx-site-receipts" || exchange.version !== 1 || exchange.mode !== "LIVE") throw new Error("Échange de recettes incompatible avec le paquet documentaire.");
  if (inputDocuments.length > REVENUE_DOCUMENT_PACKAGE_MAX_DOCUMENTS) throw new Error("Trop de justificatifs pour un seul paquet.");
  const rowsByNumber = new Map<string, typeof exchange.rows>();
  for (const row of exchange.rows) {
    const values = rowsByNumber.get(row.documentNumber) ?? [];
    values.push(row); rowsByNumber.set(row.documentNumber, values);
  }
  const seenNumbers = new Set<string>();
  let totalBytes = 0;
  const documents = inputDocuments.map(document => {
    if (!safeNumber(document.number) || seenNumbers.has(document.number) || !rowsByNumber.has(document.number)) throw new Error("Justificatif documentaire incohérent.");
    if (!/^[a-f0-9]{64}$/.test(document.snapshotHashSha256) || !pdf(document.bytes)) throw new Error("Justificatif PDF invalide.");
    if (document.kind === "CREDIT_NOTE") {
      if (!document.number.startsWith("AV-") || !document.sourceDocumentNumber || !safeNumber(document.sourceDocumentNumber)) throw new Error("Lien facture/avoir invalide.");
    } else if (document.number.startsWith("AV-") || document.sourceDocumentNumber !== null) throw new Error("Nature de justificatif invalide.");
    const matchingRows = rowsByNumber.get(document.number)!;
    if (matchingRows.some(row => row.kind !== (document.kind === "INVOICE" ? "RECEIPT" : "REFUND"))) throw new Error("Nature du mouvement et du justificatif incohérente.");
    totalBytes += document.bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > REVENUE_DOCUMENT_PACKAGE_MAX_BYTES) throw new Error("Paquet documentaire trop volumineux.");
    seenNumbers.add(document.number);
    const contentHashSha256 = sha256(document.bytes);
    return { id: `document:${contentHashSha256}`, number: document.number, kind: document.kind,
      sourceDocumentNumber: document.sourceDocumentNumber, mimeType: "application/pdf" as const,
      sizeBytes: document.bytes.byteLength, contentHashSha256, snapshotHashSha256: document.snapshotHashSha256,
      contentBase64: Buffer.from(document.bytes).toString("base64") };
  }).sort((a, b) => a.number.localeCompare(b.number));
  const documentByNumber = new Map(documents.map(document => [document.number, document]));
  const links = exchange.rows.map(row => {
    const document = documentByNumber.get(row.documentNumber), reason = reviewReasons[row.externalId];
    if (reason && (reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason))) throw new Error("Motif de revue invalide.");
    return { externalId: row.externalId, documentId: document?.id ?? null,
      archivalStatus: document ? "VERIFIED" as const : "REVIEW_REQUIRED" as const,
      reviewReason: document ? null : reason ?? "Justificatif absent ou non vérifiable automatiquement." };
  });
  return { format: "lnx-site-receipts-package" as const, version: 1 as const, generatedAt: exchange.generatedAt,
    origin: exchange.origin, mode: "LIVE" as const, receipts: exchange, documents, links,
    documentaryPolicy: { archiveVerifiedDocuments: true, createAccountingEntries: false, inferFiscalTreatment: false, ambiguousRowsRequireReview: true } };
}
