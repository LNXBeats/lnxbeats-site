// Exact commercial fact explicitly approved by Ludovic on 2026-10-05.
// Bounded historical fallback, like the existing official MPN registry:
// avoids a production backfill during the Preview-only review phase.
// A subsequently stored Admin value takes precedence. No price/stock/image changes.
export function resolvedMerchantColor(product: { slug: string; merchantColor?: string | null }) {
  return product.merchantColor?.trim() || (product.slug === "badge-lnx-beats" ? "Multicolore" : null);
}
