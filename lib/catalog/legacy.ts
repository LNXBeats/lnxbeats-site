import { homeEditorial } from "@/data/home";
import { projects } from "@/data/discography";
import { platformLabelOverride } from "@/lib/catalog/platform-label";
import type {
  DataConfidence,
  PlatformId,
  Project,
  ProjectDataConfidence,
  ProjectKind,
  ProjectStatus,
  TrackStatus,
} from "@/lib/catalog/types";

export const CATALOG_SOURCE_VERSION = "v0.6.0.3-legacy-1";
export const LEGACY_CATALOG_PROJECT_COUNT = 25;

const projectTypeMap = { album: "ALBUM", single: "SINGLE", project: "PROJECT" } as const;
const projectStatusMap = {
  published: "PUBLISHED",
  "in-development": "IN_DEVELOPMENT",
  draft: "DRAFT",
  archive: "ARCHIVED",
} as const;
const trackStatusMap = { released: "RELEASED", announced: "ANNOUNCED", unlisted: "UNLISTED" } as const;
const platformMap = {
  spotify: "SPOTIFY",
  appleMusic: "APPLE_MUSIC",
  deezer: "DEEZER",
  youtube: "YOUTUBE",
  amazonMusic: "AMAZON_MUSIC",
  distroKid: "DISTROKID",
  other: "OTHER",
} as const;
const confidenceMap = {
  confirmed: "CONFIRMED",
  partial: "PARTIAL",
  placeholder: "PLACEHOLDER",
  unknown: "UNKNOWN",
} as const;
const creditRoleMap = {
  artist: "ARTIST",
  writer: "WRITER",
  composer: "COMPOSER",
  producer: "PRODUCER",
  featuring: "FEATURING",
  other: "OTHER",
} as const;

const confidenceDomains: ReadonlyArray<[keyof ProjectDataConfidence, string]> = [
  ["identity", "IDENTITY"],
  ["editorial", "EDITORIAL"],
  ["release", "RELEASE"],
  ["artwork", "ARTWORK"],
  ["tracklist", "TRACKLIST"],
  ["platforms", "PLATFORMS"],
  ["genres", "GENRES"],
  ["credits", "CREDITS"],
  ["seo", "SEO"],
];

export function isIsoDate(value: string | null): value is string {
  if (value === null) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function parseLegacyDuration(value: string | undefined) {
  if (!value) return null;
  const match = /^(\d{1,3}):(\d{2})$/.exec(value);
  if (!match || Number(match[2]) > 59) throw new Error(`Invalid legacy duration: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function validateReleaseUrl(platform: PlatformId, rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("Only HTTPS platform URLs are accepted.");
  const allowed: Partial<Record<PlatformId, readonly string[]>> = {
    spotify: ["open.spotify.com"],
    appleMusic: ["music.apple.com"],
    deezer: ["deezer.com", "www.deezer.com", "link.deezer.com"],
    youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
    amazonMusic: ["music.amazon.fr", "music.amazon.com"],
    distroKid: ["distrokid.com", "direct.distrokid.com"],
  };
  const domains = allowed[platform];
  if (domains && !domains.includes(url.hostname.toLowerCase())) {
    throw new Error(`The URL domain does not match ${platform}.`);
  }
  return url.toString();
}

export function getLegacyCatalogue() {
  if (projects.length !== LEGACY_CATALOG_PROJECT_COUNT) {
    throw new Error(`Expected ${LEGACY_CATALOG_PROJECT_COUNT} legacy projects, found ${projects.length}.`);
  }
  const slugs = new Set(projects.map(({ slug }) => slug));
  if (slugs.size !== projects.length) throw new Error("Legacy project slugs are not unique.");
  return projects;
}

export function legacyProjectRecord(project: Project, index: number) {
  if (project.releaseDate !== null && !isIsoDate(project.releaseDate)) {
    throw new Error(`Invalid release date for ${project.slug}.`);
  }
  if (project.trackCount !== null && project.trackCount < project.tracks.length) {
    throw new Error(`Declared track count is lower than the named tracklist for ${project.slug}.`);
  }
  const positions = new Set(project.tracks.map(({ number }) => number));
  if (positions.size !== project.tracks.length || [...positions].some((position) => position <= 0)) {
    throw new Error(`Invalid track positions for ${project.slug}.`);
  }

  return {
    slug: project.slug,
    title: project.title,
    subtitle: project.subtitle ?? null,
    type: projectTypeMap[project.type],
    status: projectStatusMap[project.status],
    catalogPosition: index + 1,
    highlighted: project.featured,
    featured: project.slug === homeEditorial.spotlightProjectSlug,
    shortDescription: project.shortDescription,
    description: project.description,
    releaseDate: project.releaseDate ? new Date(`${project.releaseDate}T00:00:00.000Z`) : null,
    trackCount: project.trackCount,
    artworkTone: project.artworkTone,
    seoTitle: project.seo.title ?? null,
    seoDescription: project.seo.description,
    legacySourceVersion: CATALOG_SOURCE_VERSION,
    confidence: confidenceMap[project.dataConfidence.overall],
    tracks: project.tracks.map((track) => ({
      position: track.number,
      title: track.title,
      durationSeconds: parseLegacyDuration(track.duration),
      status: trackStatusMap[track.status ?? "released"],
      confidence: "CONFIRMED" as const,
    })),
    platformLinks: project.platforms
      .filter(({ scope }) => scope !== "artist")
      .map((link, position) => ({
        platform: platformMap[link.platform],
        scope: link.scope === "release" ? "RELEASE" as const : "STORE" as const,
        url: validateReleaseUrl(link.platform, link.url),
        label: platformLabelOverride(link.label, link.platform, link.scope),
        position,
        confidence: "CONFIRMED" as const,
      })),
    credits: project.credits.map((credit, position) => ({
      name: credit.name,
      role: creditRoleMap[credit.role],
      note: credit.detail ?? null,
      position,
      confidence: "CONFIRMED" as const,
    })),
    confidenceAnnotations: confidenceDomains.map(([domain, dbDomain]) => ({
      domain: dbDomain,
      level: confidenceMap[project.dataConfidence[domain]],
      source: "Legacy catalogue V0.6.0.2",
    })),
  };
}

export function normalizeProjectForParity(project: Project) {
  return {
    slug: project.slug,
    title: project.title,
    subtitle: project.subtitle ?? null,
    type: project.type,
    status: project.status,
    releaseDate: project.releaseDate,
    description: project.description,
    shortDescription: project.shortDescription,
    highlighted: project.featured,
    trackCount: project.trackCount,
    tracks: project.tracks.map(({ number, title, duration, status }) => ({ number, title, duration: duration ?? null, status: status ?? "released" })),
    platforms: project.platforms.map(({ platform, label, url, scope }) => ({ platform, label, url, scope })),
    seo: { title: project.seo.title ?? null, description: project.seo.description },
    artworkTone: project.artworkTone,
    dataConfidence: project.dataConfidence,
  };
}

export function mapProjectType(value: ProjectKind) {
  return projectTypeMap[value];
}

export function mapProjectStatus(value: ProjectStatus) {
  return projectStatusMap[value];
}

export function mapConfidence(value: DataConfidence) {
  return confidenceMap[value];
}

export function mapTrackStatus(value: TrackStatus) {
  return trackStatusMap[value];
}
