import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Prisma } from "@/generated/prisma/client";
import { getCreationPublicationBlockers } from "@/lib/creations/domain";
import {
  CREATION_MEDIA_DELETION_CONFIRMATION,
  type CreationMediaRole,
} from "@/lib/creations/media-contract";
import type { CreationMediaUpload } from "@/lib/creations/media-request";
import { removeCreationMedia, writeCreationMedia, type CreationMediaReference } from "@/lib/creations/media-storage";
import { parseCreationIdentity, parseCreationLockVersion, parseCreationSlug } from "@/lib/creations/validation";
import { activeStorageMetadata } from "@/lib/media/storage/config";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
type CleanupCandidate = CreationMediaReference & { id: string };

const ROLE_CONFIGURATION = {
  COVER: { directory: "cover", extension: "webp", type: "COVER", mimeType: "image/webp" },
  VIDEO_POSTER: { directory: "poster", extension: "webp", type: "IMAGE", mimeType: "image/webp" },
  AUDIO: { directory: "audio", extension: "mp3", type: "AUDIO", mimeType: "audio/mpeg" },
  VIDEO: { directory: "video", extension: "mp4", type: "VIDEO", mimeType: "video/mp4" },
} as const satisfies Record<CreationMediaRole, {
  directory: string;
  extension: string;
  type: "COVER" | "IMAGE" | "AUDIO" | "VIDEO";
  mimeType: string;
}>;

export { CREATION_MEDIA_DELETION_CONFIRMATION };

export type CreationMediaErrorCode =
  | "INVALID_IDENTITY"
  | "INVALID_VERSION"
  | "RIGHTS_CONFIRMATION_REQUIRED"
  | "NOT_FOUND"
  | "ARCHIVED"
  | "CONFLICT"
  | "NO_MEDIA"
  | "PUBLISHED_INVARIANT"
  | "STORAGE_INTEGRITY";

export class CreationMediaError extends Error {
  constructor(readonly code: CreationMediaErrorCode, message: string = code) {
    super(message);
    this.name = "CreationMediaError";
  }
}

export class CreationMediaConflictError extends CreationMediaError {
  constructor(
    readonly currentAssetId: string | null,
    readonly currentLockVersion: number,
  ) {
    super("CONFLICT", "Le média ou la fiche a changé. Rechargez la page.");
    this.name = "CreationMediaConflictError";
  }
}

export function creationMediaStorageKey(
  creationId: string,
  role: CreationMediaRole,
  assetId: string,
) {
  const configuration = ROLE_CONFIGURATION[role];
  return `creations/${creationId}/${configuration.directory}/${assetId}.${configuration.extension}`;
}

function parseExpectedAssetId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  try {
    return parseCreationIdentity(value);
  } catch {
    throw new CreationMediaError("INVALID_VERSION", "La version du média est invalide.");
  }
}

function parseIdentity(value: unknown) {
  try {
    return parseCreationIdentity(value);
  } catch {
    throw new CreationMediaError("INVALID_IDENTITY", "La création est invalide.");
  }
}

function parseVersion(value: unknown) {
  try {
    return parseCreationLockVersion(value);
  } catch {
    throw new CreationMediaError("INVALID_VERSION", "La version de la création est invalide.");
  }
}

function parseSlug(value: unknown) {
  try {
    return parseCreationSlug(value);
  } catch {
    throw new CreationMediaError("INVALID_IDENTITY", "Le slug de la création est invalide.");
  }
}

function safeFilename(filename: string, role: CreationMediaRole) {
  const extension = ROLE_CONFIGURATION[role].extension;
  const withoutExtension = path.basename(filename || `creation-${role.toLowerCase()}`)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 180)
    .replace(/\.(?:jpe?g|png|webp|mp3|mp4)$/i, "");
  return `${withoutExtension || `creation-${role.toLowerCase()}`}.${extension}`;
}

async function lockedCreationMediaState(
  transaction: Transaction,
  creationId: string,
  role: CreationMediaRole,
) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`creation:${creationId}`})) IS NULL AS locked`;
  const creation = await transaction.creation.findUnique({
    where: { id: creationId },
    include: {
      assets: {
        include: {
          asset: {
            select: {
              id: true,
              type: true,
              mimeType: true,
              visibility: true,
              rightsStatus: true,
              storageKey: true,
              storageBackend: true,
              storageProvider: true,
            },
          },
        },
        orderBy: { role: "asc" },
      },
    },
  });
  if (!creation) throw new CreationMediaError("NOT_FOUND", "Création introuvable.");
  if (creation.status === "ARCHIVED") throw new CreationMediaError("ARCHIVED", "Une création archivée est en lecture seule.");
  const current = creation.assets.find((relation) => relation.role === role)?.asset ?? null;
  return { creation, current };
}

function assertExpectedState(
  state: Awaited<ReturnType<typeof lockedCreationMediaState>>,
  expectedLockVersion: number,
  expectedAssetId: string | null,
) {
  if (state.creation.lockVersion !== expectedLockVersion || (state.current?.id ?? null) !== expectedAssetId) {
    throw new CreationMediaConflictError(state.current?.id ?? null, state.creation.lockVersion);
  }
}

async function preflight(
  creationId: string,
  slug: string,
  role: CreationMediaRole,
  expectedLockVersion: number,
  expectedAssetId: string | null,
) {
  return prisma.$transaction(async (transaction) => {
    const state = await lockedCreationMediaState(transaction, creationId, role);
    if (state.creation.slug !== slug) throw new CreationMediaError("INVALID_IDENTITY", "La création ne correspond pas au slug fourni.");
    assertExpectedState(state, expectedLockVersion, expectedAssetId);
    return { title: state.creation.title };
  });
}

function orphanWhere(id: string) {
  return {
    id,
    creations: { none: {} },
    projects: { none: {} },
    products: { none: {} },
    orders: { none: {} },
    contractDocuments: { none: {} },
  } satisfies Prisma.AssetWhereInput;
}

async function removeOrphanedCandidate(candidate: CleanupCandidate, creationId: string, label: "staged" | "obsolete") {
  try {
    const stillOrphaned = await prisma.$transaction(async (transaction) => {
      // This also resolves an ambiguous COMMIT result before any object is
      // removed: a successfully activated media relation always wins.
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`creation:${creationId}`})) IS NULL AS locked`;
      return transaction.asset.count({ where: orphanWhere(candidate.id) });
    });
    if (!stillOrphaned) return;
    await removeCreationMedia(candidate);
    await prisma.asset.deleteMany({ where: orphanWhere(candidate.id) });
  } catch {
    console.error(`A ${label} creation media object could not be fully cleaned.`);
  }
}

function assertUploadContract(upload: CreationMediaUpload) {
  const configuration = ROLE_CONFIGURATION[upload.role];
  if (
    upload.mimeType !== configuration.mimeType
    || upload.extension !== configuration.extension
    || !Number.isSafeInteger(upload.sizeBytes)
    || upload.sizeBytes <= 0
    || !/^[0-9a-f]{64}$/i.test(upload.checksumSha256)
  ) {
    throw new CreationMediaError("STORAGE_INTEGRITY", "Les métadonnées du média validé sont incohérentes.");
  }
}

export async function replaceAdminCreationMedia(upload: CreationMediaUpload & { activationAssetId?: string }) {
  assertDatabaseConfigured();
  const creationId = parseIdentity(upload.creationId);
  const slug = parseSlug(upload.slug);
  const expectedLockVersion = parseVersion(upload.expectedLockVersion);
  const expectedAssetId = parseExpectedAssetId(upload.expectedAssetId);
  if (!upload.rightsConfirmed) {
    throw new CreationMediaError("RIGHTS_CONFIRMATION_REQUIRED", "Confirmez les droits de diffusion de ce média.");
  }
  assertUploadContract(upload);
  const assetId = upload.activationAssetId ? parseIdentity(upload.activationAssetId) : randomUUID();
  if (upload.activationAssetId) {
    const activated = await prisma.creationAsset.findUnique({
      where: { creationId_role: { creationId, role: upload.role } },
      include: { creation: { select: { slug: true, lockVersion: true } }, asset: true },
    });
    if (activated?.assetId === assetId) {
      if (
        activated.creation.slug !== slug
        || activated.asset.mimeType !== upload.mimeType
        || activated.asset.sizeBytes !== BigInt(upload.sizeBytes)
        || activated.asset.checksumSha256 !== upload.checksumSha256
      ) throw new CreationMediaError("STORAGE_INTEGRITY", "Le média déjà activé ne correspond pas à la session.");
      return { assetId, slug, lockVersion: activated.creation.lockVersion };
    }
  }
  const preflightState = await preflight(creationId, slug, upload.role, expectedLockVersion, expectedAssetId);

  const configuration = ROLE_CONFIGURATION[upload.role];
  const storageKey = creationMediaStorageKey(creationId, upload.role, assetId);
  const storage = activeStorageMetadata();
  const existingStagedAsset = upload.activationAssetId
    ? await prisma.asset.findUnique({ where: { id: assetId } })
    : null;
  if (existingStagedAsset && (
    existingStagedAsset.storageKey !== storageKey
    || existingStagedAsset.mimeType !== configuration.mimeType
    || existingStagedAsset.sizeBytes !== BigInt(upload.sizeBytes)
    || existingStagedAsset.checksumSha256 !== upload.checksumSha256
    || existingStagedAsset.visibility !== "PUBLIC"
  )) throw new CreationMediaError("STORAGE_INTEGRITY", "Le média réservé ne correspond pas à la session.");
  const stagedAsset = existingStagedAsset ?? await prisma.asset.create({
    data: {
      id: assetId,
      type: configuration.type,
      storageKey,
      filename: safeFilename(upload.originalFilename, upload.role),
      mimeType: configuration.mimeType,
      sizeBytes: BigInt(upload.sizeBytes),
      width: upload.width,
      height: upload.height,
      durationMs: upload.durationMs,
      storageBackend: storage.storageBackend,
      storageProvider: storage.storageProvider,
      visibility: "PUBLIC",
      checksumSha256: upload.checksumSha256,
      alt: upload.alt ?? preflightState.title,
      rightsStatus: "CLEARED",
      rightsNote: "Droits de diffusion confirmés par l’administrateur lors du téléversement.",
      confidence: "CONFIRMED",
    },
  });
  let stagedReference: CleanupCandidate = {
    id: stagedAsset.id,
    storageKey,
    storageBackend: storage.storageBackend,
    storageProvider: storage.storageProvider,
    visibility: "PUBLIC",
  };
  let obsoleteReference: CleanupCandidate | null = null;

  try {
    const stored = await writeCreationMedia(storageKey, upload);
    stagedReference = {
      id: stagedAsset.id,
      storageKey,
      storageBackend: stored.storageBackend,
      storageProvider: stored.storageProvider,
      visibility: stored.visibility,
    };
    if (
      stored.storageBackend !== stagedAsset.storageBackend
      || stored.storageProvider !== stagedAsset.storageProvider
      || stored.visibility !== stagedAsset.visibility
      || stored.checksumSha256 !== stagedAsset.checksumSha256
      || stored.metadata.contentLength !== upload.sizeBytes
      || stored.metadata.contentType !== upload.mimeType
    ) {
      throw new CreationMediaError("STORAGE_INTEGRITY", "Le stockage a retourné des métadonnées incohérentes.");
    }

    const result = await prisma.$transaction(async (transaction) => {
      const state = await lockedCreationMediaState(transaction, creationId, upload.role);
      if (state.creation.slug !== slug) throw new CreationMediaError("INVALID_IDENTITY");
      assertExpectedState(state, expectedLockVersion, expectedAssetId);
      if (state.current) {
        obsoleteReference = {
          id: state.current.id,
          storageKey: state.current.storageKey,
          storageBackend: state.current.storageBackend,
          storageProvider: state.current.storageProvider,
          visibility: state.current.visibility,
        };
        await transaction.creationAsset.delete({
          where: { creationId_role: { creationId, role: upload.role } },
        });
      }
      await transaction.creationAsset.create({ data: { creationId, role: upload.role, assetId: stagedAsset.id } });
      const updated = await transaction.creation.updateMany({
        where: { id: creationId, lockVersion: expectedLockVersion, status: { not: "ARCHIVED" } },
        data: { lockVersion: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new CreationMediaConflictError(state.current?.id ?? null, state.creation.lockVersion);
      }
      return { assetId: stagedAsset.id, slug, lockVersion: expectedLockVersion + 1 };
    });
    if (obsoleteReference) await removeOrphanedCandidate(obsoleteReference, creationId, "obsolete");
    return result;
  } catch (error) {
    await removeOrphanedCandidate(stagedReference, creationId, "staged");
    throw error;
  }
}

export async function deleteAdminCreationMedia(input: {
  creationId: unknown;
  slug: unknown;
  role: CreationMediaRole;
  expectedLockVersion: unknown;
  expectedAssetId: unknown;
}) {
  assertDatabaseConfigured();
  const creationId = parseIdentity(input.creationId);
  const slug = parseSlug(input.slug);
  const expectedLockVersion = parseVersion(input.expectedLockVersion);
  const expectedAssetId = parseExpectedAssetId(input.expectedAssetId);
  let obsoleteReference: CleanupCandidate | null = null;

  const result = await prisma.$transaction(async (transaction) => {
    const state = await lockedCreationMediaState(transaction, creationId, input.role);
    if (state.creation.slug !== slug) throw new CreationMediaError("INVALID_IDENTITY");
    assertExpectedState(state, expectedLockVersion, expectedAssetId);
    if (!state.current) throw new CreationMediaError("NO_MEDIA", "Aucun média ne correspond à cette version.");

    if (state.creation.status === "PUBLISHED") {
      const remainingAssets = state.creation.assets.filter((relation) => relation.role !== input.role);
      if (getCreationPublicationBlockers({ ...state.creation, assets: remainingAssets }).length) {
        throw new CreationMediaError(
          "PUBLISHED_INVARIANT",
          "Dépubliez la création ou choisissez un autre média principal avant cette suppression.",
        );
      }
    }

    obsoleteReference = {
      id: state.current.id,
      storageKey: state.current.storageKey,
      storageBackend: state.current.storageBackend,
      storageProvider: state.current.storageProvider,
      visibility: state.current.visibility,
    };
    await transaction.creationAsset.delete({
      where: { creationId_role: { creationId, role: input.role } },
    });
    const updated = await transaction.creation.updateMany({
      where: { id: creationId, lockVersion: expectedLockVersion, status: { not: "ARCHIVED" } },
      data: { lockVersion: { increment: 1 } },
    });
    if (updated.count !== 1) throw new CreationMediaConflictError(state.current.id, state.creation.lockVersion);
    return { slug, lockVersion: expectedLockVersion + 1 };
  });
  if (obsoleteReference) await removeOrphanedCandidate(obsoleteReference, creationId, "obsolete");
  return result;
}

export async function getAdminCreationMediaAsset(assetId: unknown) {
  assertDatabaseConfigured();
  let id: string;
  try { id = parseCreationIdentity(assetId); }
  catch { return null; }
  return prisma.asset.findFirst({
    where: { id, creations: { some: {} } },
    select: {
      id: true,
      storageKey: true,
      storageBackend: true,
      storageProvider: true,
      visibility: true,
      checksumSha256: true,
      mimeType: true,
      sizeBytes: true,
      updatedAt: true,
    },
  });
}
