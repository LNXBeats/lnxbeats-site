/** No tax receipt, no fabricated fees. CSV cells cannot become spreadsheet formulas. */
export function supportCsvCell(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(raw) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export const supportAccountingHeader = ["contribution", "date", "brut_centimes", "devise", "prestataire", "mode", "etat", "checkout", "paiement", "remboursement", "tentative", "operation", "etat_tentative", "derniere_verification", "frais_centimes", "net_centimes"];
export type AccountingEntry = { id: string; createdAt: Date; amountCents: number; currency: string; provider: string; mode: string; status: string;
  providerReference: string | null; paymentReference: string | null; refundReference: string | null;
  attempts: Array<{ id: string; operation: string; status: string; lastCheckedAt: Date | null }> };
export function supportAccountingRows(entry: AccountingEntry) {
  // The amount appears once per contribution, never once per attempt: summing
  // the gross column must not multiply a receipt by its recovery attempts.
  return (entry.attempts.length ? entry.attempts : [null]).map((attempt, index) => [entry.id, entry.createdAt.toISOString(), index === 0 ? entry.amountCents : "", entry.currency,
    entry.provider, entry.mode, entry.status, entry.providerReference, entry.paymentReference, entry.refundReference,
    attempt?.id, attempt?.operation, attempt?.status, attempt?.lastCheckedAt?.toISOString(), "", ""]);
}
