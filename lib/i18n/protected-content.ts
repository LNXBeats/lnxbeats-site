// These are identities, not words to localize. Longest spelling must match first.
const BRAND_PATTERN = /LNX Beats Studio|LNX Beats|LNX BEATS/g;

export function brandSegments(text: string): Array<{ text: string; protected: boolean }> {
  const parts: Array<{ text: string; protected: boolean }> = [];
  let offset = 0;
  for (const match of text.matchAll(BRAND_PATTERN)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index), protected: false });
    parts.push({ text: match[0], protected: true });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), protected: false });
  return parts;
}

/** A faulty dictionary entry must not silently rename the brand. */
export function brandSafeTranslation(source: string, translated: string): string {
  const identities = (value: string) => brandSegments(value).filter(part => part.protected).map(part => part.text).sort();
  return JSON.stringify(identities(source)) === JSON.stringify(identities(translated)) ? translated : source;
}
