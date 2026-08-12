export type ProjectKind = "album" | "single" | "project";
export type ProjectStatus = "published" | "in-development" | "draft" | "archive";
export type TrackStatus = "released" | "announced" | "unlisted";
export type ArtworkTone = "gold" | "wine" | "graphite" | "bronze" | "ivory";
export type PlatformId = "spotify" | "appleMusic" | "deezer" | "youtube" | "amazonMusic" | "distroKid" | "other";
export type DataConfidence = "confirmed" | "partial" | "placeholder" | "unknown";
export type CreditRole = "artist" | "writer" | "composer" | "producer" | "featuring" | "other";

export type ProjectTrack = {
  readonly id?: string;
  readonly number: number;
  readonly title: string;
  readonly duration?: string;
  readonly status?: TrackStatus;
};

export type ProjectPlatform = {
  readonly id?: string;
  readonly platform: PlatformId;
  readonly label: string;
  readonly url: string;
  readonly scope: "release" | "artist" | "store";
};

export type ProjectCredit = {
  readonly name: string;
  readonly role: CreditRole;
  readonly detail?: string;
};

export type ProjectDataConfidence = {
  readonly overall: DataConfidence;
  readonly identity: DataConfidence;
  readonly editorial: DataConfidence;
  readonly release: DataConfidence;
  readonly artwork: DataConfidence;
  readonly tracklist: DataConfidence;
  readonly platforms: DataConfidence;
  readonly genres: DataConfidence;
  readonly credits: DataConfidence;
  readonly seo: DataConfidence;
};

export type PublicProject = {
  readonly slug: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly type: ProjectKind;
  readonly year: number | null;
  readonly releaseDate: string | null;
  readonly description: string;
  readonly shortDescription: string;
  readonly cover: string | null;
  readonly coverAlt?: string;
  readonly audioPreview?: {
    readonly id: string;
    readonly url: string;
    readonly durationMs: number;
  } | null;
  readonly featured: boolean;
  readonly status: ProjectStatus;
  readonly genres: readonly string[];
  readonly credits: readonly ProjectCredit[];
  readonly tracks: readonly ProjectTrack[];
  readonly trackCount: number | null;
  readonly platforms: readonly ProjectPlatform[];
  readonly seo: {
    readonly title?: string;
    readonly description: string;
  };
  readonly artworkTone: ArtworkTone;
  readonly dataConfidence: ProjectDataConfidence;
};

export type Project = PublicProject;

export function getProjectKindLabel(type: ProjectKind) {
  return type === "album" ? "Album" : type === "single" ? "Single" : "Projet";
}

export function getProjectStatusLabel(status: ProjectStatus) {
  if (status === "published") return "Publié";
  if (status === "in-development") return "En développement";
  if (status === "draft") return "Brouillon";
  return "Archivé";
}

export function getProjectConfidenceLabel(confidence: DataConfidence) {
  if (confidence === "confirmed") return "Informations confirmées";
  if (confidence === "partial") return "Informations partielles";
  if (confidence === "placeholder") return "Présentation provisoire";
  return "Informations non documentées";
}

export function getCreditRoleLabel(role: CreditRole) {
  if (role === "artist") return "Artiste";
  if (role === "writer") return "Auteur";
  if (role === "composer") return "Compositeur";
  if (role === "producer") return "Production";
  if (role === "featuring") return "Featuring";
  return "Autre crédit";
}
