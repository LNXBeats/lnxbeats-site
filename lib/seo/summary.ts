/** Metadata only: never changes the visible editorial text or saved content. */
export function automaticSeoSummary(value: string, maximum = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  const excerpt = normalized.slice(0, maximum - 1);
  const boundary = excerpt.lastIndexOf(" ");
  return `${excerpt.slice(0, boundary > maximum / 2 ? boundary : excerpt.length).trimEnd()}…`;
}
