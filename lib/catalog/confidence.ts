import type { DataConfidence, ProjectDataConfidence } from "@/lib/catalog/types";

type ConfidenceInput = {
  status: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  description: string | null;
  releaseDate: Date | null;
  trackCount: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  tracks: readonly unknown[];
  platformLinks: readonly unknown[];
  credits: readonly unknown[];
  assets: readonly unknown[];
  legacy?: Partial<ProjectDataConfidence>;
};

function fallback(value: DataConfidence | undefined, defaultValue: DataConfidence) {
  return value ?? defaultValue;
}

export function deriveCatalogConfidence(project: ConfidenceInput): ProjectDataConfidence {
  const identity: DataConfidence = project.slug && project.title ? "confirmed" : "unknown";
  const editorial: DataConfidence = fallback(project.legacy?.editorial, project.description && project.shortDescription ? "confirmed" : project.description || project.shortDescription ? "partial" : "unknown");
  const release: DataConfidence = project.releaseDate ? "confirmed" : fallback(project.legacy?.release, "unknown");
  const artwork: DataConfidence = project.assets.length ? "confirmed" : fallback(project.legacy?.artwork, "placeholder");
  const tracklist: DataConfidence = project.tracks.length > 0 && project.trackCount !== null && project.tracks.length >= project.trackCount
    ? "confirmed"
    : project.tracks.length > 0 || project.trackCount !== null && project.trackCount > 0
      ? "partial"
      : "unknown";
  const platforms: DataConfidence = project.platformLinks.length ? "confirmed" : fallback(project.legacy?.platforms, "unknown");
  const genres: DataConfidence = fallback(project.legacy?.genres, "unknown");
  const credits: DataConfidence = project.credits.length ? "confirmed" : fallback(project.legacy?.credits, "unknown");
  // Title, editorial copy and the project title provide safe public fallbacks.
  // Empty override fields therefore do not create artificial work for ADMIN.
  const effectiveSeoTitle = project.seoTitle?.trim() || project.title.trim();
  const effectiveSeoDescription = project.seoDescription?.trim()
    || project.description?.trim()
    || project.shortDescription?.trim()
    || project.title.trim();
  const seo: DataConfidence = effectiveSeoTitle && effectiveSeoDescription ? "confirmed" : "unknown";
  const principal = [identity, editorial, release, artwork, tracklist, platforms, seo];
  const overall: DataConfidence = principal.every((value) => value === "confirmed")
    ? "confirmed"
    : project.status === "IN_DEVELOPMENT" && principal.filter((value) => value === "confirmed").length <= 2
      ? "placeholder"
      : "partial";

  return { overall, identity, editorial, release, artwork, tracklist, platforms, genres, credits, seo };
}

export function projectCompletenessLabel(confidence: ProjectDataConfidence) {
  return confidence.overall === "confirmed" ? "Informations principales complètes" : "Projet à compléter";
}
