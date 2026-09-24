import { CatalogValidationError } from "@/lib/catalog/validation";
import { slugifyTitle } from "@/lib/seo/slugs";

const RESERVED_CATALOG_SLUGS = new Set(["nouveau"]);

export type CatalogDeletionState = {
  featured: boolean;
  publicVisible: boolean;
  status: "DRAFT" | "IN_DEVELOPMENT" | "PUBLISHED" | "ARCHIVED";
};

export type CatalogDeletionEligibility = {
  eligible: boolean;
  reason: string;
};

export function normalizeCatalogSlug(value: unknown) {
  return slugifyTitle(value);
}

export function parseCatalogSlug(value: unknown) {
  const slug = normalizeCatalogSlug(value);
  if (!slug || RESERVED_CATALOG_SLUGS.has(slug) || !/^[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/.test(slug)) {
    throw new CatalogValidationError("Le slug doit contenir des lettres, des chiffres ou des tirets.", "INVALID_SLUG");
  }
  return slug;
}

export function getCatalogDeletionEligibility(project: CatalogDeletionState): CatalogDeletionEligibility {
  if (project.featured) {
    return {
      eligible: false,
      reason: "Retirez ou remplacez d’abord la mise en avant de l’accueil.",
    };
  }
  if (project.publicVisible) {
    return {
      eligible: false,
      reason: "Masquez d’abord le projet du site avant toute suppression définitive.",
    };
  }
  if (project.status !== "DRAFT" && project.status !== "ARCHIVED") {
    return {
      eligible: false,
      reason: "Archivez le projet ou replacez-le en brouillon avant sa suppression définitive.",
    };
  }
  return {
    eligible: true,
    reason: "Ce projet masqué peut être supprimé définitivement après confirmation.",
  };
}
