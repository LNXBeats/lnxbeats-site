import { REVENUE_CATEGORIES, revenuePeriod, type RevenueEntry } from "./revenue-policy";

export const REVENUE_EXCHANGE_ORIGIN = "https://www.lnxbeats.fr";
const NAMESPACE = "lnxbeats.fr:LIVE:";
type RevenueExchangeSource = {
  mode: string;
  generatedAt: string;
  period: { from: string; to: string };
  rows: RevenueEntry[];
  issues: string[];
  unmatchedReceipts: number;
};

function timestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Date d’encaissement ou de génération invalide.");
  }
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) throw new Error("Date de calendrier invalide.");
  return new Date(value).toISOString();
}

/** Only existing authenticated document routes; never a PSP URL or an asset URL. */
function documentUrl(path: string | null) {
  if (path === null) return null;
  if (!/^\/admin\/facturation\/(?:avoirs\/)?[^/?#]+$/.test(path) && !/^\/api\/digital\/documents\/[a-zA-Z0-9_-]+$/.test(path)) {
    throw new Error("Lien de justificatif non autorisé.");
  }
  const tail = path.slice(path.lastIndexOf("/") + 1);
  const decoded = decodeURIComponent(tail);
  if (!decoded || decoded === "." || decoded === ".." || /[\\/\u0000-\u001f\u007f]/.test(decoded)) throw new Error("Lien de justificatif invalide.");
  const url = new URL(path, REVENUE_EXCHANGE_ORIGIN);
  if (url.origin !== REVENUE_EXCHANGE_ORIGIN || url.pathname !== path || url.search || url.hash) throw new Error("Lien de justificatif invalide.");
  return url.href;
}

/** A versioned interchange snapshot, not a tax return or a complete site ledger.
 * Uses confirmed movements already selected by loadRevenue. No provider calls,
 * fees inferred from payouts, customer identity, or accounting classification. */
export function buildRevenueExchange(source: RevenueExchangeSource) {
  if (source.mode !== "LIVE") throw new Error("Seules les recettes LIVE sont exportables vers Gestion.");
  const period = revenuePeriod(source.period.from, source.period.to);
  const generatedAt = timestamp(source.generatedAt);
  if (!Number.isSafeInteger(source.unmatchedReceipts) || source.unmatchedReceipts < 0) throw new Error("Nombre de reçus non rapprochés invalide.");
  const ids = new Set<string>(), receipts = new Set<string>(), providerMovements = new Set<string>();
  const rows = source.rows.map(row => {
    if (row.mode !== "LIVE" || !REVENUE_CATEGORIES.includes(row.category) || !["RECEIPT", "REFUND"].includes(row.kind)
      || !["STRIPE", "PAYPAL"].includes(row.provider) || row.currency !== "EUR"
      || !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0) throw new Error("Mouvement incompatible avec l’échange Gestion.");
    for (const value of [row.id, row.paymentKey, row.reference, row.order]) {
      if (!value || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Référence de mouvement invalide.");
    }
    const paymentPrefix = `LIVE:${row.provider}:`;
    if (!row.paymentKey.startsWith(paymentPrefix) || !row.paymentKey.slice(paymentPrefix.length)
      || (row.kind === "RECEIPT" && row.paymentKey !== paymentPrefix + row.reference)) throw new Error("Référence de paiement incohérente.");
    const occurredAt = timestamp(row.at), at = new Date(occurredAt);
    if (at < period.start || at >= period.end) throw new Error("Mouvement hors de la période exportée.");
    const providerMovement = `${row.kind}:${row.provider}:${row.reference}`;
    if (ids.has(row.id) || providerMovements.has(providerMovement) || (row.kind === "RECEIPT" && receipts.has(row.paymentKey))) throw new Error("Mouvement dupliqué dans l’échange Gestion.");
    ids.add(row.id); providerMovements.add(providerMovement);
    if (row.kind === "RECEIPT") receipts.add(row.paymentKey);
    return {
      externalId: NAMESPACE + row.id,
      paymentKey: NAMESPACE + row.paymentKey,
      kind: row.kind,
      category: row.category,
      occurredAt,
      occurredAtSource: row.kind === "REFUND" ? "CONFIRMED_REFUND_AT" as const
        : row.category === "DIGITAL" ? "INVOICE_PAID_AT" as const : "PAYMENT_PAID_AT" as const,
      amountCents: row.amountCents,
      currency: "EUR" as const,
      provider: row.provider as "STRIPE" | "PAYPAL",
      providerReference: row.reference,
      orderReference: row.order,
      description: row.title,
      documentNumber: row.invoice,
      documentUrl: documentUrl(row.documentHref),
      feeCents: null,
      netCents: null,
      fiscalTreatment: null,
    };
  }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.externalId.localeCompare(b.externalId));
  let receivedCents = 0, refundedCents = 0;
  for (const row of rows) {
    if (row.kind === "RECEIPT") receivedCents += row.amountCents;
    else refundedCents += row.amountCents;
    if (!Number.isSafeInteger(receivedCents) || !Number.isSafeInteger(refundedCents)) throw new Error("Total hors limites.");
  }
  const issues = [...source.issues];
  if (source.unmatchedReceipts) issues.push(`${source.unmatchedReceipts} reçu(s) financier(s) non rapproché(s), non inclus dans les lignes exportées.`);
  return {
    format: "lnx-site-receipts" as const,
    version: 1 as const,
    origin: REVENUE_EXCHANGE_ORIGIN,
    generatedAt,
    period: { from: period.from, to: period.to, timeZone: "Europe/Paris" as const },
    mode: "LIVE" as const,
    // Always partial for all website receipts: two site flows remain excluded.
    status: "PARTIAL" as const,
    coverage: {
      heading: "Couverture incomplète : ventes numériques, créations musicales et Boutique LNX seulement.",
      includedCategories: [...REVENUE_CATEGORIES],
      excludedSiteFlows: ["SUPPORT", "RIGHTS"],
      excludedExternalSources: ["DISTROKID", "SACEM"],
      exhaustive: false,
      unmatchedReceipts: source.unmatchedReceipts,
      totalScope: "EXPORTED_ROWS_ONLY",
      dateNote: "Dates issues des preuves internes : paiement confirmé, confirmation du remboursement, ou paidAt de la facture numérique. Ce dernier est enregistré lors de la préparation de la facture après confirmation ; il ne constitue pas un horodatage indépendant du prestataire de paiement.",
    },
    rows,
    totals: { currency: "EUR" as const, receivedCents, refundedCents, balanceCents: receivedCents - refundedCents },
    issues,
  };
}
