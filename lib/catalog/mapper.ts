import { officialLinks } from "@/data/site";
import { deriveCatalogConfidence } from "@/lib/catalog/confidence";
import { resolveCatalogCoverAlt } from "@/lib/catalog/cover-alt";
import { automaticPlatformLabel, resolvePlatformLabel } from "@/lib/catalog/platform-label";
import type {
  ArtworkTone,
  CreditRole,
  DataConfidence,
  PlatformId,
  Project,
  ProjectDataConfidence,
  ProjectStatus,
  TrackStatus,
} from "@/lib/catalog/types";

type DatabaseProject = {
  slug: string;
  title: string;
  subtitle: string | null;
  type: string;
  status: string;
  shortDescription: string | null;
  description: string | null;
  releaseDate: Date | null;
  highlighted: boolean;
  trackCount: number | null;
  artworkTone: string;
  seoTitle: string | null;
  seoDescription: string | null;
  confidence: string;
  tracks?: Array<{ id: string; position: number; title: string; durationSeconds: number | null; status: string }>;
  platformLinks?: Array<{ id: string; platform: string; scope: string; url: string; label: string | null }>;
  credits?: Array<{ name: string; role: string; note: string | null }>;
  confidenceAnnotations?: Array<{ domain: string; level: string }>;
  assets?: Array<{
    role: string;
    asset: { id: string; alt: string | null; durationMs: number | null; mimeType: string; updatedAt: Date };
  }>;
};

const artistPlatforms = [
  { platform: "spotify" as const, label: automaticPlatformLabel("spotify", "artist"), url: officialLinks.spotify, scope: "artist" as const },
  { platform: "appleMusic" as const, label: automaticPlatformLabel("appleMusic", "artist"), url: officialLinks.appleMusic, scope: "artist" as const },
  { platform: "deezer" as const, label: automaticPlatformLabel("deezer", "artist"), url: officialLinks.deezer, scope: "artist" as const },
];

const projectTypeMap = { ALBUM: "album", SINGLE: "single", PROJECT: "project" } as const;
const projectStatusMap = { PUBLISHED: "published", IN_DEVELOPMENT: "in-development", ARCHIVED: "archive", DRAFT: "draft" } as const;
const trackStatusMap = { RELEASED: "released", ANNOUNCED: "announced", UNLISTED: "unlisted", DRAFT: "unlisted" } as const;
const platformMap: Record<string, PlatformId> = {
  SPOTIFY: "spotify",
  APPLE_MUSIC: "appleMusic",
  DEEZER: "deezer",
  YOUTUBE: "youtube",
  AMAZON_MUSIC: "amazonMusic",
  DISTROKID: "distroKid",
  OTHER: "other",
};
const confidenceMap: Record<string, DataConfidence> = {
  CONFIRMED: "confirmed",
  PARTIAL: "partial",
  PLACEHOLDER: "placeholder",
  UNKNOWN: "unknown",
};
const creditRoleMap: Record<string, CreditRole> = {
  ARTIST: "artist",
  WRITER: "writer",
  COMPOSER: "composer",
  PRODUCER: "producer",
  FEATURING: "featuring",
  OTHER: "other",
  ENGINEER: "other",
};

function durationLabel(seconds: number | null) {
  if (seconds === null) return undefined;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function legacyConfidenceSummary(project: DatabaseProject): ProjectDataConfidence {
  const annotations = new Map((project.confidenceAnnotations ?? []).map(({ domain, level }) => [domain, confidenceMap[level] ?? "unknown"]));
  return {
    overall: confidenceMap[project.confidence] ?? "unknown",
    identity: annotations.get("IDENTITY") ?? "unknown",
    editorial: annotations.get("EDITORIAL") ?? "unknown",
    release: annotations.get("RELEASE") ?? "unknown",
    artwork: annotations.get("ARTWORK") ?? "unknown",
    tracklist: annotations.get("TRACKLIST") ?? "unknown",
    platforms: annotations.get("PLATFORMS") ?? "unknown",
    genres: annotations.get("GENRES") ?? "unknown",
    credits: annotations.get("CREDITS") ?? "unknown",
    seo: annotations.get("SEO") ?? "unknown",
  };
}

export function mapDatabaseProject(project: DatabaseProject): Project {
  const releaseDate = project.releaseDate?.toISOString().slice(0, 10) ?? null;
  const coverAsset = project.assets?.find(({ role }) => role === "COVER")?.asset;
  const audioAsset = project.assets?.find(({ role }) => role === "AUDIO_PREVIEW")?.asset;
  const directPlatforms = (project.platformLinks ?? []).map((link) => {
    const platform = platformMap[link.platform] ?? "other";
    const scope = link.scope === "STORE" ? "store" as const : link.scope === "ARTIST" ? "artist" as const : "release" as const;
    return { id: link.id, platform, label: resolvePlatformLabel(link.label, platform, scope), url: link.url, scope };
  });
  const dataConfidence = deriveCatalogConfidence({
    ...project,
    tracks: project.tracks ?? [],
    platformLinks: project.platformLinks ?? [],
    credits: project.credits ?? [],
    assets: (project.assets ?? []).filter(({ role }) => role === "COVER"),
    legacy: legacyConfidenceSummary(project),
  });
  return {
    slug: project.slug,
    title: project.title,
    subtitle: project.subtitle ?? undefined,
    type: projectTypeMap[project.type as keyof typeof projectTypeMap] ?? "project",
    year: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
    releaseDate,
    description: project.description ?? project.shortDescription ?? "",
    shortDescription: project.shortDescription ?? project.description ?? "",
    cover: coverAsset ? `/media/catalog/${coverAsset.id}` : null,
    coverAlt: coverAsset ? resolveCatalogCoverAlt(project.title, coverAsset.alt) : undefined,
    audioPreview: audioAsset?.durationMs && audioAsset.mimeType === "audio/mpeg" ? {
      id: audioAsset.id,
      url: `/media/catalog/audio/${audioAsset.id}`,
      durationMs: audioAsset.durationMs,
    } : null,
    featured: project.highlighted,
    status: (projectStatusMap[project.status as keyof typeof projectStatusMap] ?? "archive") as ProjectStatus,
    genres: [],
    credits: (project.credits ?? []).map((credit) => ({
      name: credit.name,
      role: creditRoleMap[credit.role] ?? "other",
      detail: credit.note ?? undefined,
    })),
    tracks: (project.tracks ?? []).map((track) => ({
      id: track.id,
      number: track.position,
      title: track.title,
      duration: durationLabel(track.durationSeconds),
      status: (trackStatusMap[track.status as keyof typeof trackStatusMap] ?? "unlisted") as TrackStatus,
    })),
    trackCount: project.trackCount,
    platforms: [...directPlatforms, ...(project.status === "PUBLISHED" ? artistPlatforms : [])],
    seo: {
      title: project.seoTitle ?? undefined,
      description: project.seoDescription ?? project.description ?? project.shortDescription ?? `${project.title} — LNX Beats`,
    },
    artworkTone: (["gold", "wine", "graphite", "bronze", "ivory"].includes(project.artworkTone) ? project.artworkTone : "graphite") as ArtworkTone,
    dataConfidence,
  };
}
