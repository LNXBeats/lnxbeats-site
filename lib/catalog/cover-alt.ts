export function automaticCatalogCoverAlt(title: string) {
  return `Pochette de « ${title.trim()} » — LNX Beats`;
}

export function catalogCoverAltOverride(value: string | null | undefined, title: string) {
  const trimmed = value?.trim() || null;
  if (!trimmed) return null;
  const normalizedTitle = title.trim();
  const formerAutomaticValues = new Set([
    `Pochette de ${normalizedTitle}`,
    automaticCatalogCoverAlt(normalizedTitle),
  ]);
  return formerAutomaticValues.has(trimmed) ? null : trimmed;
}

export function resolveCatalogCoverAlt(title: string, value: string | null | undefined) {
  return catalogCoverAltOverride(value, title) ?? automaticCatalogCoverAlt(title);
}
