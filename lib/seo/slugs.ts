/** A public slug is an address, never a transliteration of private content. */
export function slugifyTitle(value: unknown, maximum = 160): string {
  if (typeof value !== "string") return "";
  const normalized = value
    .replace(/[œŒ]/g, "oe")
    .replace(/[æÆ]/g, "ae")
    .replace(/[ß]/g, "ss")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maximum)
    .replace(/-+$/g, "");
  if (normalized || !/[\p{Letter}\p{Number}]/u.test(value)) return normalized;
  // A title written entirely outside the Latin alphabet still needs a
  // deterministic URL. Keep it opaque rather than discarding the title.
  let hash = 2166136261;
  for (const character of value.normalize("NFKC")) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  return `creation-${(hash >>> 0).toString(36)}`.slice(0, maximum);
}

export function generatedSlugCandidate(title: unknown, reserved: ReadonlySet<string>): string {
  const candidate = slugifyTitle(title);
  return reserved.has(candidate) ? `${candidate.slice(0, 158)}-2` : candidate;
}

export async function availableSlug(
  title: string,
  taken: (candidate: string) => Promise<boolean>,
  maximum = 160,
): Promise<string> {
  const base = slugifyTitle(title, maximum);
  if (!base) throw new Error("Le titre ne peut pas produire une adresse publique.");
  for (let ordinal = 1; ordinal < 10_000; ordinal++) {
    const suffix = ordinal === 1 ? "" : `-${ordinal}`;
    const candidate = `${base.slice(0, maximum - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error("Aucune adresse publique disponible pour ce titre.");
}

export function nextFormerSlugs(current: string, former: readonly string[], next: string): string[] {
  return next === current ? [...former] : [...new Set([...former.filter((slug) => slug !== next), current])];
}
