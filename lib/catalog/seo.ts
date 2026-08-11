type CatalogSeoInput = {
  title: string;
  shortDescription: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export function effectiveCatalogSeoTitle(project: CatalogSeoInput) {
  return project.seoTitle?.trim() || `${project.title.trim()} — LNX Beats`;
}

export function effectiveCatalogSeoDescription(project: CatalogSeoInput) {
  return project.seoDescription?.trim()
    || project.description?.trim()
    || project.shortDescription?.trim()
    || `${project.title.trim()} — LNX Beats`;
}

export function catalogSeoMode(project: CatalogSeoInput) {
  const customFields = Number(Boolean(project.seoTitle?.trim())) + Number(Boolean(project.seoDescription?.trim()));
  if (customFields === 2) return "custom" as const;
  if (customFields === 1) return "mixed" as const;
  return "automatic" as const;
}
