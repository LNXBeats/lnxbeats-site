export type CreationStatus = "draft" | "published" | "archived";
export type CreationPrimaryMedia = "cover" | "audio" | "video";
export type CreationMediaKind = "audio" | "video";
export type CreationVideoOrientation = "landscape" | "portrait" | "square";

export type PublicCreationAsset = Readonly<{
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  alt: string | null;
}>;

export type PublicCreationLink = Readonly<{
  id: string;
  label: string;
  url: string;
  position: number;
}>;

export type PublicCreationCollaboratorLink = Readonly<{
  id: string;
  platform: string;
  label: string | null;
  url: string;
  position: number;
}>;

export type PublicCreationCollaborator = Readonly<{
  id: string;
  displayName: string;
  role: string | null;
  position: number;
  links: readonly PublicCreationCollaboratorLink[];
}>;

export type PublicCreation = Readonly<{
  slug: string;
  title: string;
  summary: string;
  description: string | null;
  collaborator: string | null;
  credits: string | null;
  category: string | null;
  primaryMedia: CreationPrimaryMedia;
  position: number;
  publishedAt: string | null;
  seo: Readonly<{ title: string; description: string }>;
  cover: PublicCreationAsset | null;
  poster: PublicCreationAsset | null;
  audio: PublicCreationAsset | null;
  video: PublicCreationAsset | null;
  links: readonly PublicCreationLink[];
  collaborators?: readonly PublicCreationCollaborator[];
}>;

export function creationCollaboratorNames(creation: Pick<PublicCreation, "collaborator" | "collaborators">) {
  const structured = (creation.collaborators ?? []).map(({ displayName }) => displayName.trim()).filter(Boolean);
  if (structured.length) return structured;
  return creation.collaborator?.trim() ? [creation.collaborator.trim()] : [];
}

export function creationArtwork(creation: PublicCreation) {
  return creation.cover ?? creation.poster;
}

export function creationAvailableMedia(creation: PublicCreation): CreationMediaKind[] {
  return [creation.audio ? "audio" : null, creation.video ? "video" : null]
    .filter((kind): kind is CreationMediaKind => kind !== null);
}

export function creationPresentationMedia(creation: PublicCreation): CreationPrimaryMedia[] {
  return [
    creationArtwork(creation) ? "cover" : null,
    creation.audio ? "audio" : null,
    creation.video ? "video" : null,
  ].filter((kind): kind is CreationPrimaryMedia => kind !== null);
}

export function resolvedCreationPrimaryMedia(creation: Pick<PublicCreation, "primaryMedia" | "cover" | "poster" | "audio" | "video">): CreationPrimaryMedia {
  if (creation.primaryMedia === "video" && creation.video) return "video";
  if (creation.primaryMedia === "audio" && creation.audio) return "audio";
  if (creation.primaryMedia === "cover" && (creation.cover || creation.poster)) return "cover";
  if (creation.video) return "video";
  if (creation.audio) return "audio";
  return "cover";
}

export function creationVideoOrientation(
  video: Pick<PublicCreationAsset, "width" | "height"> | null,
): CreationVideoOrientation {
  if (!video?.width || !video.height || video.width <= 0 || video.height <= 0) return "landscape";
  const ratio = video.width / video.height;
  if (ratio >= 0.9 && ratio <= 1.1) return "square";
  return ratio < 1 ? "portrait" : "landscape";
}
