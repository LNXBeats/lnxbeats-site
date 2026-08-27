import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { catalogCoverAltOverride } from "@/lib/catalog/cover-alt";
import { removeCatalogCover, writeCatalogCover } from "@/lib/catalog/media-storage";
import { optionalText } from "@/lib/catalog/validation";
import {
  ADMIN_IMAGE_MAXIMUM_BYTES,
  ADMIN_IMAGE_MAXIMUM_PIXELS,
  AdminImageError,
  normalizeAdminImage,
} from "@/lib/media/admin-image";
import type { MediaStorageReference } from "@/lib/media/storage";

export const CATALOG_COVER_MAXIMUM_BYTES = ADMIN_IMAGE_MAXIMUM_BYTES;
export const CATALOG_COVER_MAXIMUM_PIXELS = ADMIN_IMAGE_MAXIMUM_PIXELS;

export type CatalogCoverErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "MIME_MISMATCH"
  | "UNREADABLE_IMAGE"
  | "TOO_MANY_PIXELS"
  | "INVALID_VERSION";

export class CatalogCoverError extends Error {
  constructor(readonly code: CatalogCoverErrorCode) {
    super(code);
    this.name = "CatalogCoverError";
  }
}

export class CatalogCoverConflictError extends Error {
  constructor(readonly currentCoverAssetId: string | null) {
    super("La cover a été modifiée depuis l’ouverture de cette fiche.");
    this.name = "CatalogCoverConflictError";
  }
}

export function catalogCoverVersionMatches(expectedCoverAssetId: string | null, currentCoverAssetId: string | null) {
  return expectedCoverAssetId === currentCoverAssetId;
}

function parseExpectedCoverAssetId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new CatalogCoverError("INVALID_VERSION");
  return value;
}

async function lockedCoverState(transaction: Prisma.TransactionClient, projectId: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-cover:${projectId}`})) IS NULL AS locked`;
  const project = await transaction.project.findUnique({
    where: { id: projectId },
    select: {
      title: true,
      assets: {
        where: { role: "COVER" },
        orderBy: [{ position: "asc" }, { createdAt: "desc" }],
        take: 1,
        select: { asset: { select: { id: true, storageKey: true, storageBackend: true, storageProvider: true, visibility: true } } },
      },
    },
  });
  if (!project) throw new CatalogCoverError("INVALID_VERSION");
  return {
    title: project.title,
    currentCoverAssetId: project.assets[0]?.asset.id ?? null,
    currentCoverReference: project.assets[0]?.asset ?? null,
  };
}

async function assertCurrentCoverVersion(projectId: string, expectedCoverAssetId: string | null) {
  return prisma.$transaction(async (transaction) => {
    const state = await lockedCoverState(transaction, projectId);
    if (!catalogCoverVersionMatches(expectedCoverAssetId, state.currentCoverAssetId)) {
      throw new CatalogCoverConflictError(state.currentCoverAssetId);
    }
    return state;
  });
}

export async function normalizeCatalogCover(file: File) {
  try {
    return await normalizeAdminImage(file, "square-cover");
  } catch (error) {
    if (error instanceof AdminImageError) throw new CatalogCoverError(error.code);
    throw new CatalogCoverError("UNREADABLE_IMAGE");
  }
}

export async function replaceCatalogCover(projectId: string, rawExpectedCoverAssetId: unknown, file: File, rawAlt: unknown) {
  const expectedCoverAssetId = parseExpectedCoverAssetId(rawExpectedCoverAssetId);
  const requestedAlt = optionalText(rawAlt, "Le texte alternatif", 500);
  // Fail before image normalization and media storage when the observed cover
  // is already stale. The guarded comparison is repeated during activation to
  // close the race between this preflight and the final transaction.
  await assertCurrentCoverVersion(projectId, expectedCoverAssetId);
  const normalized = await normalizeCatalogCover(file);
  const storageKey = `catalog/covers/${randomUUID()}.webp`;
  const safeBase = path.basename(file.name || "cover").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 180);
  const stored = await writeCatalogCover(storageKey, normalized.bytes);
  let oldReference: Pick<MediaStorageReference, "storageKey" | "storageBackend" | "storageProvider" | "visibility"> | null = null;
  try {
    await prisma.$transaction(async (transaction) => {
      const state = await lockedCoverState(transaction, projectId);
      if (!catalogCoverVersionMatches(expectedCoverAssetId, state.currentCoverAssetId)) {
        throw new CatalogCoverConflictError(state.currentCoverAssetId);
      }
      const alt = catalogCoverAltOverride(requestedAlt, state.title);
      oldReference = state.currentCoverReference;
      if (state.currentCoverAssetId) {
        await transaction.projectAsset.deleteMany({ where: { projectId, role: "COVER" } });
        await transaction.asset.delete({ where: { id: state.currentCoverAssetId } });
      }
      const asset = await transaction.asset.create({
        data: {
          type: "COVER", storageKey, filename: `${safeBase || "cover"}.webp`, mimeType: "image/webp",
          sizeBytes: BigInt(normalized.bytes.length), width: normalized.width, height: normalized.height,
          storageBackend: stored.storageBackend, storageProvider: stored.storageProvider,
          visibility: stored.visibility, checksumSha256: stored.checksumSha256,
          alt, rightsStatus: "CLEARED", confidence: "CONFIRMED",
        },
      });
      await transaction.projectAsset.create({ data: { projectId, assetId: asset.id, role: "COVER", position: 0 } });
      await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
    });
  } catch (error) {
    await removeCatalogCover({ storageKey, storageBackend: stored.storageBackend, storageProvider: stored.storageProvider, visibility: stored.visibility });
    throw error;
  }
  if (oldReference) {
    try { await removeCatalogCover(oldReference); }
    catch { console.error("An obsolete catalogue cover could not be removed after replacement."); }
  }
}

export async function deleteCatalogCover(projectId: string, rawExpectedCoverAssetId: unknown) {
  const expectedCoverAssetId = parseExpectedCoverAssetId(rawExpectedCoverAssetId);
  let mediaReference: Pick<MediaStorageReference, "storageKey" | "storageBackend" | "storageProvider" | "visibility"> | null = null;
  await prisma.$transaction(async (transaction) => {
    const state = await lockedCoverState(transaction, projectId);
    if (!catalogCoverVersionMatches(expectedCoverAssetId, state.currentCoverAssetId)) {
      throw new CatalogCoverConflictError(state.currentCoverAssetId);
    }
    if (!state.currentCoverAssetId || !state.currentCoverReference) return;
    mediaReference = state.currentCoverReference;
    await transaction.projectAsset.deleteMany({
      where: { projectId, assetId: state.currentCoverAssetId, role: "COVER" },
    });
    await transaction.asset.delete({ where: { id: state.currentCoverAssetId } });
    await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
  });
  if (mediaReference) await removeCatalogCover(mediaReference);
}
