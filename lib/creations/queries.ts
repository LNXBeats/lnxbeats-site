import "server-only";

import { prisma } from "@/lib/prisma";
import type { PublicCreation, PublicCreationAsset, PublicCreationCollaborator, PublicCreationLink } from "@/lib/creations/types";

const publicAssetState = {
  visibility: "PUBLIC" as const,
  rightsStatus: "CLEARED" as const,
};

const playableCreationFilter = {
  OR: [
    {
      role: "AUDIO" as const,
      asset: { ...publicAssetState, type: "AUDIO" as const, mimeType: "audio/mpeg" },
    },
    {
      role: "VIDEO" as const,
      asset: { ...publicAssetState, type: "VIDEO" as const, mimeType: "video/mp4" },
    },
  ],
};

const publicCreationWhere = {
  status: "PUBLISHED" as const,
  publishedAt: { not: null },
  assets: { some: playableCreationFilter },
};

const publicCreationSelect = {
  slug: true,
  title: true,
  summary: true,
  description: true,
  collaborator: true,
  credits: true,
  category: true,
  primaryMedia: true,
  position: true,
  publishedAt: true,
  updatedAt: true,
  seoTitle: true,
  seoDescription: true,
  assets: {
    where: { asset: publicAssetState },
    orderBy: [{ createdAt: "desc" as const }],
    select: {
      role: true,
      asset: {
        select: {
          id: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          width: true,
          height: true,
          durationMs: true,
          alt: true,
          type: true,
        },
      },
    },
  },
  externalLinks: {
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
    select: { id: true, label: true, url: true, position: true },
  },
  collaborators: {
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      displayName: true,
      role: true,
      position: true,
      links: {
        orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
        select: { id: true, platform: true, label: true, url: true, position: true },
      },
    },
  },
};

function safeAssetSize(value: bigint) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function mediaAsset(
  creation: Awaited<ReturnType<typeof loadPublicCreations>>[number],
  role: "COVER" | "VIDEO_POSTER" | "AUDIO" | "VIDEO",
): PublicCreationAsset | null {
  const match = creation.assets.find((link) => link.role === role)?.asset;
  if (!match) return null;
  if (role === "AUDIO" && (match.type !== "AUDIO" || match.mimeType !== "audio/mpeg")) return null;
  if (role === "VIDEO" && (match.type !== "VIDEO" || match.mimeType !== "video/mp4")) return null;
  if (
    (role === "COVER" || role === "VIDEO_POSTER")
    && ((match.type !== "COVER" && match.type !== "IMAGE") || match.mimeType !== "image/webp")
  ) return null;
  return {
    id: match.id,
    url: `/media/creations/${match.id}`,
    filename: match.filename,
    mimeType: match.mimeType,
    sizeBytes: safeAssetSize(match.sizeBytes),
    width: match.width,
    height: match.height,
    durationMs: match.durationMs,
    alt: match.alt,
  };
}

async function loadPublicCreations() {
  return prisma.creation.findMany({
    where: publicCreationWhere,
    orderBy: [{ position: "asc" }, { publishedAt: "desc" }, { id: "asc" }],
    select: publicCreationSelect,
  });
}

function publicExternalLink(
  link: Readonly<{ id: string; label: string; url: string; position: number }>,
): PublicCreationLink | null {
  try {
    const url = new URL(link.url.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { ...link, url: url.toString() };
  } catch {
    return null;
  }
}

function publicCollaborator(
  collaborator: Awaited<ReturnType<typeof loadPublicCreations>>[number]["collaborators"][number],
): PublicCreationCollaborator | null {
  const displayName = collaborator.displayName.trim();
  if (!displayName) return null;
  const links = collaborator.links.flatMap((link) => {
    try {
      const url = new URL(link.url.trim());
      if (url.protocol !== "https:" || url.username || url.password) return [];
      return [{ ...link, label: link.label?.trim() || null, url: url.toString() }];
    } catch {
      return [];
    }
  });
  return {
    id: collaborator.id,
    displayName,
    role: collaborator.role?.trim() || null,
    position: collaborator.position,
    links,
  };
}

function mapPublicCreation(creation: Awaited<ReturnType<typeof loadPublicCreations>>[number]): PublicCreation | null {
  const cover = mediaAsset(creation, "COVER");
  const poster = mediaAsset(creation, "VIDEO_POSTER");
  const audio = mediaAsset(creation, "AUDIO");
  const video = mediaAsset(creation, "VIDEO");
  const summary = creation.summary?.trim();
  if ((!audio && !video) || !summary || !creation.publishedAt) return null;
  const requestedPrimary = creation.primaryMedia?.toLowerCase();
  if (
    (requestedPrimary !== "cover" && requestedPrimary !== "audio" && requestedPrimary !== "video")
    || (requestedPrimary === "cover" && !cover)
    || (requestedPrimary === "audio" && !audio)
    || (requestedPrimary === "video" && !video)
  ) return null;
  const description = creation.description?.trim() || null;
  return {
    slug: creation.slug,
    title: creation.title,
    summary,
    description,
    collaborator: creation.collaborator?.trim() || null,
    credits: creation.credits?.trim() || null,
    category: creation.category?.trim() || null,
    primaryMedia: requestedPrimary,
    position: creation.position,
    publishedAt: creation.publishedAt.toISOString(),
    seo: {
      title: creation.seoTitle?.trim() || creation.title,
      description: creation.seoDescription?.trim() || summary,
    },
    cover,
    poster,
    audio,
    video,
    links: creation.externalLinks
      .map(publicExternalLink)
      .filter((link): link is PublicCreationLink => link !== null),
    collaborators: creation.collaborators
      .map(publicCollaborator)
      .filter((collaborator): collaborator is PublicCreationCollaborator => collaborator !== null),
  };
}

export async function listPublicCreations() {
  return (await loadPublicCreations())
    .map(mapPublicCreation)
    .filter((creation): creation is PublicCreation => creation !== null);
}

export async function getPublicCreation(slug: string) {
  if (!/^[a-z0-9-]{1,160}$/.test(slug)) return null;
  const creation = await prisma.creation.findFirst({
    where: { ...publicCreationWhere, slug },
    select: publicCreationSelect,
  });
  return creation ? mapPublicCreation(creation) : null;
}

export async function listSitemapCreations() {
  const creations = await loadPublicCreations();
  return creations.flatMap((creation) => mapPublicCreation(creation)
    ? [{ slug: creation.slug, updatedAt: creation.updatedAt }]
    : []);
}
