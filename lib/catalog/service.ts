import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { deleteMediaObject } from "@/lib/media/storage";
import { getCatalogDeletionEligibility, parseCatalogSlug } from "@/lib/catalog/lifecycle";
import { platformLabelOverride } from "@/lib/catalog/platform-label";
import {
  boundedInteger, optionalText, parseConfidence, parseDate, parseHttpsUrl, parsePlatform,
  parseCreditRole, parseJukeboxPlacement, parseProjectStatus, parseProjectType, parseTrackStatus, requiredText,
} from "@/lib/catalog/validation";

type Transaction = Prisma.TransactionClient;

export class CatalogConflictError extends Error {
  constructor(message = "Ce projet a été modifié depuis l’ouverture de la page.") {
    super(message);
    this.name = "CatalogConflictError";
  }
}

export class CatalogLifecycleError extends Error {
  constructor(message: string, readonly code: "SLUG_TAKEN" | "POSITION_TAKEN" | "DELETE_FORBIDDEN" | "CONFIRMATION_INVALID" | "PROJECT_NOT_FOUND") {
    super(message);
    this.name = "CatalogLifecycleError";
  }
}

const projectTypeDb = { album: "ALBUM", single: "SINGLE", project: "PROJECT" } as const;
const projectStatusDb = { published: "PUBLISHED", "in-development": "IN_DEVELOPMENT", draft: "DRAFT", archive: "ARCHIVED" } as const;
const trackStatusDb = { released: "RELEASED", announced: "ANNOUNCED", unlisted: "UNLISTED" } as const;
const confidenceDb = { confirmed: "CONFIRMED", partial: "PARTIAL", placeholder: "PLACEHOLDER", unknown: "UNKNOWN" } as const;
const platformDb = { spotify: "SPOTIFY", appleMusic: "APPLE_MUSIC", deezer: "DEEZER", youtube: "YOUTUBE", amazonMusic: "AMAZON_MUSIC", distroKid: "DISTROKID", other: "OTHER" } as const;
const creditRoleDb = { artist: "ARTIST", writer: "WRITER", composer: "COMPOSER", producer: "PRODUCER", featuring: "FEATURING", engineer: "ENGINEER", other: "OTHER" } as const;

const adminInclude = {
  tracks: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  platformLinks: { where: { scope: { in: ["RELEASE" as const, "STORE" as const] } }, orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  credits: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  confidenceAnnotations: { orderBy: [{ domain: "asc" as const }] },
  assets: {
    where: { role: { in: ["COVER" as const, "AUDIO_PREVIEW" as const] } },
    orderBy: [{ role: "asc" as const }, { position: "asc" as const }, { createdAt: "desc" as const }],
    include: { asset: true },
  },
} satisfies Prisma.ProjectInclude;

export async function listAdminCatalogProjects(query = "", status = "all") {
  assertDatabaseConfigured();
  const search = query.trim().slice(0, 120);
  const allowedStatuses = ["DRAFT", "IN_DEVELOPMENT", "PUBLISHED", "ARCHIVED"] as const;
  const normalizedStatus = allowedStatuses.includes(status as typeof allowedStatuses[number]) ? status as typeof allowedStatuses[number] : null;
  return prisma.project.findMany({
    where: {
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
      ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ catalogPosition: "asc" }, { id: "asc" }],
    include: {
      _count: { select: { tracks: true, platformLinks: true } },
      assets: { where: { role: { in: ["COVER", "AUDIO_PREVIEW"] } }, select: { role: true } },
    },
  });
}

export async function getAdminCatalogProject(slug: string) {
  assertDatabaseConfigured();
  return prisma.project.findUnique({ where: { slug }, include: adminInclude });
}

function createProjectValues(input: Record<string, unknown>) {
  const status = parseProjectStatus(input.status ?? "draft");
  const publicVisible = input.publicVisible === "on" || input.publicVisible === true;
  const jukeboxPlacement = parseJukeboxPlacement(input.jukeboxPlacement ?? "none");
  const jukeboxPosition = boundedInteger(input.jukeboxPosition, "La position jukebox", 1, 999, true);
  const effectivePlacement = status === "archive" ? "none" : jukeboxPlacement;
  if (effectivePlacement !== "none" && status === "draft") throw new Error("Un brouillon ne peut pas rejoindre un jukebox.");
  if (effectivePlacement === "published" && status !== "published") throw new Error("Le jukebox des parutions exige un projet publié.");
  if (effectivePlacement === "development" && status !== "in-development") throw new Error("Le jukebox développement exige le statut correspondant.");
  return {
    slug: parseCatalogSlug(input.slug),
    title: requiredText(input.title, "Le titre", 240),
    subtitle: optionalText(input.subtitle, "Le sous-titre", 240),
    type: projectTypeDb[parseProjectType(input.type)],
    status: projectStatusDb[status],
    publicVisible: status === "archive" ? false : publicVisible,
    jukeboxPlacement: effectivePlacement === "published" ? "PUBLISHED" as const : effectivePlacement === "development" ? "DEVELOPMENT" as const : null,
    jukeboxPosition: effectivePlacement === "none" ? null : jukeboxPosition,
    shortDescription: optionalText(input.shortDescription, "La description courte", 1_000),
    description: optionalText(input.description, "La description", 10_000),
    releaseDate: parseDate(input.releaseDate),
  };
}

export async function createCatalogProject(input: Record<string, unknown>) {
  assertDatabaseConfigured();
  const values = createProjectValues(input);
  const requestedPosition = boundedInteger(input.catalogPosition, "La position catalogue", 1, 1_000_000, true);
  try {
    return await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('catalog-project-creation')) IS NULL AS locked`;
      if (await transaction.project.findUnique({ where: { slug: values.slug }, select: { id: true } })) {
        throw new CatalogLifecycleError("Ce slug est déjà utilisé.", "SLUG_TAKEN");
      }
      const maximum = await transaction.project.aggregate({ _max: { catalogPosition: true } });
      const catalogPosition = requestedPosition ?? (maximum._max.catalogPosition ?? 0) + 1;
      if (await transaction.project.findUnique({ where: { catalogPosition }, select: { id: true } })) {
        throw new CatalogLifecycleError("Cette position catalogue est déjà utilisée.", "POSITION_TAKEN");
      }
      return transaction.project.create({
        data: {
          ...values,
          catalogPosition,
          featured: false,
          highlighted: false,
          trackCount: null,
          confidence: "UNKNOWN",
          legacySourceVersion: null,
        },
      });
    });
  } catch (error) {
    if (error instanceof CatalogLifecycleError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
      throw new CatalogLifecycleError(target.includes("slug") ? "Ce slug est déjà utilisé." : "Cette position catalogue est déjà utilisée.", target.includes("slug") ? "SLUG_TAKEN" : "POSITION_TAKEN");
    }
    throw error;
  }
}

async function withLifecycleLocks<T>(transaction: Transaction, projectId: string, operation: () => Promise<T>) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-cover:${projectId}`})) IS NULL AS locked`;
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-audio:${projectId}`})) IS NULL AS locked`;
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-project:${projectId}`})) IS NULL AS locked`;
  return operation();
}

export async function hideCatalogProject(projectId: string) {
  assertDatabaseConfigured();
  return prisma.$transaction((transaction) => withLifecycleLocks(transaction, projectId, async () => {
    const current = await transaction.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!current) throw new CatalogLifecycleError("Projet introuvable.", "PROJECT_NOT_FOUND");
    return transaction.project.update({ where: { id: projectId }, data: { publicVisible: false, featured: false, legacySourceVersion: null } });
  }));
}

export async function archiveCatalogProject(projectId: string) {
  assertDatabaseConfigured();
  return prisma.$transaction((transaction) => withLifecycleLocks(transaction, projectId, async () => {
    const current = await transaction.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!current) throw new CatalogLifecycleError("Projet introuvable.", "PROJECT_NOT_FOUND");
    return transaction.project.update({ where: { id: projectId }, data: { status: "ARCHIVED", publicVisible: false, featured: false, jukeboxPlacement: null, jukeboxPosition: null, legacySourceVersion: null } });
  }));
}

export async function deleteCatalogProject(projectId: string, rawConfirmation: unknown) {
  assertDatabaseConfigured();
  const confirmation = typeof rawConfirmation === "string" ? rawConfirmation.trim() : "";
  const removableAssets = await prisma.$transaction((transaction) => withLifecycleLocks(transaction, projectId, async () => {
    const project = await transaction.project.findUnique({
      where: { id: projectId },
      select: {
        id: true, slug: true, featured: true, publicVisible: true, status: true,
        tracks: { select: { id: true } },
        assets: { select: { assetId: true } },
      },
    });
    if (!project) throw new CatalogLifecycleError("Projet introuvable.", "PROJECT_NOT_FOUND");
    if (confirmation !== project.slug) throw new CatalogLifecycleError("La confirmation ne correspond pas au slug.", "CONFIRMATION_INVALID");
    const eligibility = getCatalogDeletionEligibility(project);
    if (!eligibility.eligible) throw new CatalogLifecycleError(eligibility.reason, "DELETE_FORBIDDEN");

    const trackIds = project.tracks.map(({ id }) => id);
    const assetIds = [...new Set(project.assets.map(({ assetId }) => assetId))];
    await transaction.credit.deleteMany({ where: { OR: [{ projectId }, ...(trackIds.length ? [{ trackId: { in: trackIds } }] : [])] } });
    await transaction.platformLink.deleteMany({ where: { projectId } });
    await transaction.confidenceAnnotation.deleteMany({ where: { projectId } });
    await transaction.favorite.deleteMany({ where: { projectId } });
    await transaction.projectAsset.deleteMany({ where: { projectId } });
    await transaction.track.deleteMany({ where: { projectId } });
    await transaction.project.delete({ where: { id: projectId } });

    return assetIds.length ? transaction.asset.findMany({
      where: { id: { in: assetIds }, projects: { none: {} }, orders: { none: {} } },
      select: { id: true, storageKey: true, storageBackend: true, storageProvider: true, visibility: true },
    }) : [];
  }));

  let cleanupFailed = false;
  for (const asset of removableAssets) {
    try {
      const stillOrphaned = await prisma.asset.count({ where: { id: asset.id, projects: { none: {} }, orders: { none: {} } } });
      if (!stillOrphaned) continue;
      await deleteMediaObject(asset);
      await prisma.asset.deleteMany({ where: { id: asset.id, projects: { none: {} }, orders: { none: {} } } });
    }
    catch { cleanupFailed = true; console.error("An orphaned catalogue media object could not be removed after project deletion."); }
  }
  return { deletedAssets: removableAssets.length, cleanupFailed };
}

async function withProjectLock<T>(projectId: string, operation: (transaction: Transaction) => Promise<T>) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-project:${projectId}`})) IS NULL AS locked`;
    return operation(transaction);
  });
}

function optimisticDate(value: unknown) {
  const date = new Date(requiredText(value, "La version", 80));
  if (Number.isNaN(date.getTime())) throw new CatalogConflictError();
  return date;
}

export async function updateCatalogProject(projectId: string, input: Record<string, unknown>) {
  assertDatabaseConfigured();
  const updatedAt = optimisticDate(input.updatedAt);
  const type = parseProjectType(input.type);
  const status = parseProjectStatus(input.status);
  const featured = input.featured === "on" || input.featured === true;
  const requestedPublicVisible = input.publicVisible === "on" || input.publicVisible === true;
  const jukeboxPlacement = parseJukeboxPlacement(input.jukeboxPlacement);
  const jukeboxPosition = boundedInteger(input.jukeboxPosition, "La position jukebox", 1, 999, true);
  const effectivePlacement = status === "archive" ? "none" : jukeboxPlacement;
  if (status !== "archive" && featured && status !== "published") throw new Error("Seul un projet publié peut être mis en avant.");
  if (status !== "archive" && featured && !requestedPublicVisible) throw new Error("Un projet masqué ne peut pas être mis en avant.");
  if (effectivePlacement !== "none" && status === "draft") throw new Error("Un brouillon ne peut pas rejoindre un jukebox.");
  if (effectivePlacement === "published" && status !== "published") throw new Error("Le jukebox des parutions exige un projet publié.");
  if (effectivePlacement === "development" && status !== "in-development") throw new Error("Le jukebox développement exige le statut correspondant.");
  const publicVisible = status === "archive" ? false : requestedPublicVisible;
  const trackCount = boundedInteger(input.trackCount, "Le nombre de pistes", 0, 999, true);
  return withProjectLock(projectId, async (transaction) => {
    const current = await transaction.project.findUnique({ where: { id: projectId }, select: { updatedAt: true, _count: { select: { tracks: true } } } });
    if (!current || current.updatedAt.getTime() !== updatedAt.getTime()) throw new CatalogConflictError();
    if (trackCount !== null && trackCount < current._count.tracks) throw new Error("Le nombre annoncé ne peut pas être inférieur au nombre de pistes nommées.");
    if (featured) await transaction.project.updateMany({ where: { featured: true, id: { not: projectId } }, data: { featured: false } });
    const result = await transaction.project.updateMany({
      where: { id: projectId, updatedAt },
      data: {
        title: requiredText(input.title, "Le titre", 240),
        subtitle: optionalText(input.subtitle, "Le sous-titre", 240),
        type: projectTypeDb[type], status: projectStatusDb[status],
        shortDescription: optionalText(input.shortDescription, "La description courte", 1_000),
        description: optionalText(input.description, "La description", 10_000),
        releaseDate: parseDate(input.releaseDate), featured: publicVisible ? featured : false, publicVisible, trackCount,
        jukeboxPlacement: effectivePlacement === "published" ? "PUBLISHED" : effectivePlacement === "development" ? "DEVELOPMENT" : null,
        jukeboxPosition: effectivePlacement === "none" ? null : jukeboxPosition,
        seoTitle: optionalText(input.seoTitle, "Le titre SEO", 240),
        seoDescription: optionalText(input.seoDescription, "La description SEO", 1_000),
        legacySourceVersion: null,
      },
    });
    if (result.count !== 1) throw new CatalogConflictError();
    return transaction.project.findUniqueOrThrow({ where: { id: projectId } });
  });
}

export async function addCatalogTrack(projectId: string, input: Record<string, unknown>) {
  const title = requiredText(input.title, "Le titre", 240);
  const durationSeconds = boundedInteger(input.durationSeconds, "La durée", 0, 86_400, true);
  const status = trackStatusDb[parseTrackStatus(input.status)];
  return withProjectLock(projectId, async (transaction) => {
    const project = await transaction.project.findUniqueOrThrow({ where: { id: projectId }, select: { trackCount: true } });
    const aggregate = await transaction.track.aggregate({ where: { projectId }, _max: { position: true } });
    const track = await transaction.track.create({ data: { projectId, title, durationSeconds, status, confidence: "CONFIRMED", position: (aggregate._max.position ?? 0) + 1 } });
    const count = await transaction.track.count({ where: { projectId } });
    await transaction.project.update({ where: { id: projectId }, data: { trackCount: Math.max(project.trackCount ?? 0, count), legacySourceVersion: null } });
    return track;
  });
}

export async function updateCatalogTrack(projectId: string, trackId: string, input: Record<string, unknown>) {
  const title = requiredText(input.title, "Le titre", 240);
  const durationSeconds = boundedInteger(input.durationSeconds, "La durée", 0, 86_400, true);
  const status = trackStatusDb[parseTrackStatus(input.status)];
  return withProjectLock(projectId, async (transaction) => {
    const result = await transaction.track.updateMany({ where: { id: trackId, projectId }, data: { title, durationSeconds, status } });
    if (result.count !== 1) throw new Error("Piste introuvable.");
    await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
  });
}

export async function moveCatalogTrack(projectId: string, trackId: string, direction: "up" | "down") {
  return withProjectLock(projectId, async (transaction) => {
    const track = await transaction.track.findFirst({ where: { id: trackId, projectId } });
    if (!track) throw new Error("Piste introuvable.");
    const neighbor = await transaction.track.findFirst({
      where: { projectId, position: direction === "up" ? { lt: track.position } : { gt: track.position } },
      orderBy: { position: direction === "up" ? "desc" : "asc" },
    });
    if (!neighbor) return;
    const maximum = await transaction.track.aggregate({ where: { projectId }, _max: { position: true } });
    const temporaryPosition = (maximum._max.position ?? 0) + 1;
    await transaction.track.update({ where: { id: track.id }, data: { position: temporaryPosition } });
    await transaction.track.update({ where: { id: neighbor.id }, data: { position: track.position } });
    await transaction.track.update({ where: { id: track.id }, data: { position: neighbor.position } });
    await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
  });
}

export async function deleteCatalogTrack(projectId: string, trackId: string) {
  return withProjectLock(projectId, async (transaction) => {
    const track = await transaction.track.findFirst({ where: { id: trackId, projectId } });
    if (!track) throw new Error("Piste introuvable.");
    await transaction.track.delete({ where: { id: trackId } });
    const remaining = await transaction.track.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, position: true } });
    const offset = (remaining.at(-1)?.position ?? 0) + remaining.length + 1;
    for (const item of remaining) await transaction.track.update({ where: { id: item.id }, data: { position: item.position + offset } });
    for (const [index, item] of remaining.entries()) await transaction.track.update({ where: { id: item.id }, data: { position: index + 1 } });
    await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
  });
}

export async function addCatalogCredit(projectId: string, input: Record<string, unknown>) {
  const name = requiredText(input.name, "Le nom du crédit", 180);
  const role = creditRoleDb[parseCreditRole(input.role)];
  const note = optionalText(input.note, "La précision du crédit", 1_000);
  return withProjectLock(projectId, async (transaction) => {
    const aggregate = await transaction.credit.aggregate({ where: { projectId, trackId: null }, _max: { position: true } });
    const credit = await transaction.credit.create({
      data: { projectId, name, role, note, position: (aggregate._max.position ?? 0) + 1, confidence: "CONFIRMED" },
    });
    await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
    return credit;
  });
}

export async function updateCatalogCredit(projectId: string, creditId: string, input: Record<string, unknown>) {
  const name = requiredText(input.name, "Le nom du crédit", 180);
  const role = creditRoleDb[parseCreditRole(input.role)];
  const note = optionalText(input.note, "La précision du crédit", 1_000);
  return withProjectLock(projectId, async (transaction) => {
    const result = await transaction.credit.updateMany({ where: { id: creditId, projectId, trackId: null }, data: { name, role, note, confidence: "CONFIRMED" } });
    if (result.count !== 1) throw new Error("Crédit introuvable.");
    await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
  });
}

export async function deleteCatalogCredit(projectId: string, creditId: string) {
  return withProjectLock(projectId, async (transaction) => {
    const result = await transaction.credit.deleteMany({ where: { id: creditId, projectId, trackId: null } });
    if (result.count !== 1) throw new Error("Crédit introuvable.");
    await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
  });
}

export async function addCatalogPlatformLink(projectId: string, input: Record<string, unknown>) {
  const platform = parsePlatform(input.platform);
  const publicScope = input.scope === "store" ? "store" as const : "release" as const;
  const scope = publicScope === "store" ? "STORE" as const : "RELEASE" as const;
  const label = platformLabelOverride(optionalText(input.label, "Le libellé", 180), platform, publicScope);
  return withProjectLock(projectId, async (transaction) => {
    const aggregate = await transaction.platformLink.aggregate({ where: { projectId }, _max: { position: true } });
    const link = await transaction.platformLink.create({ data: { projectId, platform: platformDb[platform], scope, url: parseHttpsUrl(input.url, platform), label, position: (aggregate._max.position ?? -1) + 1, confidence: "CONFIRMED" } });
    await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
    return link;
  });
}

export async function updateCatalogPlatformLink(projectId: string, linkId: string, input: Record<string, unknown>) {
  const platform = parsePlatform(input.platform);
  const publicScope = input.scope === "store" ? "store" as const : "release" as const;
  const scope = publicScope === "store" ? "STORE" as const : "RELEASE" as const;
  const label = platformLabelOverride(optionalText(input.label, "Le libellé", 180), platform, publicScope);
  const result = await prisma.platformLink.updateMany({ where: { id: linkId, projectId }, data: { platform: platformDb[platform], scope, url: parseHttpsUrl(input.url, platform), label, confidence: "CONFIRMED" } });
  if (result.count !== 1) throw new Error("Lien introuvable.");
  await prisma.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
}

export async function deleteCatalogPlatformLink(projectId: string, linkId: string) {
  const result = await prisma.platformLink.deleteMany({ where: { id: linkId, projectId } });
  if (result.count !== 1) throw new Error("Lien introuvable.");
  await prisma.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
}

const confidenceDomains = ["IDENTITY", "EDITORIAL", "RELEASE", "ARTWORK", "TRACKLIST", "PLATFORMS", "GENRES", "CREDITS", "SEO"] as const;

export async function updateCatalogConfidence(projectId: string, input: Record<string, unknown>, reviewerId: string) {
  const overall = confidenceDb[parseConfidence(input.overall)];
  return withProjectLock(projectId, async (transaction) => {
    await transaction.project.update({ where: { id: projectId }, data: { confidence: overall, legacySourceVersion: null } });
    for (const domain of confidenceDomains) {
      const value = confidenceDb[parseConfidence(input[domain.toLowerCase()])];
      await transaction.confidenceAnnotation.upsert({
        where: { projectId_domain: { projectId, domain } },
        create: { projectId, domain, level: value, source: "Administration LNX", verifiedAt: new Date(), verifiedById: reviewerId },
        update: { level: value, source: "Administration LNX", verifiedAt: new Date(), verifiedById: reviewerId },
      });
    }
  });
}
