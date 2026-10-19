export const REVENUE_CATEGORIES = ["DIGITAL", "COMMANDER", "SHOP"] as const;
export type RevenueCategory = typeof REVENUE_CATEGORIES[number];
export type RevenueMode = "LIVE" | "TEST";
export type RevenueEntry = {
  id: string; paymentKey: string; category: RevenueCategory; mode: RevenueMode;
  kind: "RECEIPT" | "REFUND"; at: string; amountCents: number; currency: string;
  order: string; title: string; customer: string; provider: string; reference: string;
  invoice: string; documentHref: string | null; orderHref: string;
};
export type RevenuePeriod = { start: Date; end: Date; from: string; to: string };
function midnightParis(y: number, m: number, d: number) {
  const target = Date.UTC(y, m - 1, d);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(p => [p.type, p.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += target - shown;
  }
  return new Date(guess);
}
export function revenuePeriod(from?: string, to?: string, now = new Date()): RevenuePeriod {
  const year = new Intl.DateTimeFormat("en", { timeZone: "Europe/Paris", year: "numeric" }).format(now);
  const first = from || `${year}-01-01`, last = to || `${year}-12-31`;
  const day = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Période invalide.");
    const [y, m, d] = value.split("-").map(Number);
    if (y < 2000 || y > 2100) throw new Error("Période invalide.");
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new Error("Période invalide.");
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return { start: midnightParis(y, m, d), end: midnightParis(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()) };
  };
  const start = day(first).start, end = day(last).end;
  if (end <= start || end.getTime() - start.getTime() > 367 * 86400000) throw new Error("Choisissez une période d’un an maximum.");
  return { start, end, from: first, to: last };
}
export function revenueSummary(entries: RevenueEntry[], period: RevenuePeriod, mode: RevenueMode) {
  const keys = new Set<string>();
  const rows = entries.filter(e => {
    if (e.mode !== mode) return false;
    if (!Number.isSafeInteger(e.amountCents) || e.amountCents <= 0 || e.currency !== "EUR" || !Number.isFinite(Date.parse(e.at))) throw new Error("Recette incohérente : rapprochement nécessaire.");
    if (keys.has(e.id)) throw new Error("Écriture dupliquée : rapprochement nécessaire.");
    keys.add(e.id);
    const at = new Date(e.at);
    return at >= period.start && at < period.end;
  }).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const totals = (list: RevenueEntry[]) => {
    const receivedCents = list.filter(r => r.kind === "RECEIPT").reduce((n, r) => n + r.amountCents, 0);
    const refundedCents = list.filter(r => r.kind === "REFUND").reduce((n, r) => n + r.amountCents, 0);
    if (!Number.isSafeInteger(receivedCents) || !Number.isSafeInteger(refundedCents)) throw new Error("Total hors limites.");
    return { receivedCents, refundedCents, balanceCents: receivedCents - refundedCents };
  };
  return { rows, ...totals(rows), categories: REVENUE_CATEGORIES.map(category => ({ category, ...totals(rows.filter(r => r.category === category)) })) };
}
export function revenueCsv(rows: RevenueEntry[]) {
  // Protect spreadsheet users from formula injection, including titles / names.
  const cell = (input: string | number) => {
    let value = String(input).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    if (/^[\s]*[=+@-]/.test(value)) value = `'${value}`;
    return `"${value.replaceAll('"', '""')}"`;
  };
  const header = ["Date Europe/Paris", "Type", "Activité", "Mode", "Commande", "Désignation", "Client", "Prestataire", "Référence paiement", "Facture / avoir", "Encaissement EUR", "Remboursement EUR", "Identifiant source"];
  const detail = rows.map(r => [new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "medium" }).format(new Date(r.at)), r.kind, r.category, r.mode, r.order, r.title, r.customer, r.provider, r.reference, r.invoice, r.kind === "RECEIPT" ? (r.amountCents / 100).toFixed(2).replace(".", ",") : "", r.kind === "REFUND" ? (r.amountCents / 100).toFixed(2).replace(".", ",") : "", r.id]);
  return "\uFEFF" + [header, ...detail].map(row => row.map(cell).join(";")).join("\r\n") + "\r\n";
}
