import type { RevenueExchange } from "./revenue-document-package";

export type RevenueSyncCursor = { occurredAt: string; externalId: string };

function valid(value: RevenueSyncCursor) {
  return Number.isFinite(Date.parse(value.occurredAt)) && value.occurredAt === new Date(value.occurredAt).toISOString()
    && /^lnxbeats\.fr:LIVE:[A-Za-z0-9:_-]+$/.test(value.externalId);
}
export function encodeRevenueSyncCursor(value: RevenueSyncCursor) {
  if (!valid(value)) throw new Error("Curseur invalide.");
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export function decodeRevenueSyncCursor(value: string | null): RevenueSyncCursor | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{1,500}$/.test(value)) throw new Error("Curseur invalide.");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (Object.keys(parsed).length !== 2 || typeof parsed.occurredAt !== "string" || typeof parsed.externalId !== "string") throw new Error();
    const cursor = { occurredAt: parsed.occurredAt, externalId: parsed.externalId };
    if (!valid(cursor)) throw new Error();
    return cursor;
  } catch { throw new Error("Curseur invalide."); }
}
const after = (left: RevenueSyncCursor, right: RevenueSyncCursor) => left.occurredAt > right.occurredAt
  || (left.occurredAt === right.occurredAt && left.externalId > right.externalId);

/** Re-read a bounded overlap so a late provider/document reconciliation is not lost. */
export function revenueSyncWindowStart(cursor: RevenueSyncCursor, overlapDays = 31) {
  const start = new Date(cursor.occurredAt);
  start.setUTCDate(start.getUTCDate() - overlapDays);
  return start.toISOString().slice(0, 10);
}

export function sliceRevenueExchange(exchange: RevenueExchange, cursor: RevenueSyncCursor | null) {
  // Receiver idempotence absorbs this deliberate overlap. Filtering strictly
  // after the cursor would permanently lose late reconciliations.
  const rows = exchange.rows;
  const receivedCents = rows.filter(row => row.kind === "RECEIPT").reduce((sum, row) => sum + row.amountCents, 0);
  const refundedCents = rows.filter(row => row.kind === "REFUND").reduce((sum, row) => sum + row.amountCents, 0);
  const last = rows.at(-1), next = last && (!cursor || after({ occurredAt: last.occurredAt, externalId: last.externalId }, cursor))
    ? { occurredAt: last.occurredAt, externalId: last.externalId } : cursor;
  return { exchange: { ...exchange, rows, totals: { currency: "EUR" as const, receivedCents, refundedCents, balanceCents: receivedCents - refundedCents } },
    nextCursor: next ? encodeRevenueSyncCursor(next) : null };
}
