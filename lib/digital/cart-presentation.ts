/** Presentation only: prices and membership still come from the server quote. */
const euro = new Intl.NumberFormat("fr-FR", {
  style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function digitalMoney(cents: number) {
  // A non-breaking space binds the euro symbol to the complete amount.
  return euro.format(cents / 100).replace(/\s€$/, "\u00a0€");
}

export function digitalArticleCount(count: number) {
  return `${count} article${count === 1 ? "" : "s"}`;
}

/** Only server-quoted IDs from this selection may replace browser membership. */
export function digitalQuotedCartIds(value: unknown, requested: string[]): string[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { lines?: unknown }).lines)) return null;
  const lines = (value as { lines: unknown[] }).lines;
  const ids: string[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object" || typeof (line as { id?: unknown }).id !== "string") return null;
    const id = (line as { id: string }).id;
    if (!requested.includes(id) || ids.includes(id)) return null;
    ids.push(id);
  }
  return ids;
}
