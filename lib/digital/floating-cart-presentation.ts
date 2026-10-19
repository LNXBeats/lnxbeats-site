import { digitalQuotedCartIds } from "./cart-presentation";

/** Display a total only from the same validated server quote as the selection.
 * This is never a price source for checkout or a grant of purchase eligibility. */
export function floatingDigitalCartQuote(value: unknown, requested: string[]) {
  const ids = digitalQuotedCartIds(value, requested);
  if (!ids || !value || typeof value !== "object") return null;
  const totalCents = (value as { totalCents?: unknown }).totalCents;
  if (typeof totalCents !== "number" || !Number.isSafeInteger(totalCents) || totalCents < 0) return null;
  if (!ids.length && totalCents !== 0) return null;
  return { ids, totalCents };
}

export function showFloatingDigitalCart(pathname: string) {
  // A checkout, account, physical shop or confirmation must not gain another
  // overlaid action. This component already has a visible navigation there.
  return pathname === "/discographie" || pathname.startsWith("/album/");
}
