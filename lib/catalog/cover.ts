import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { catalogCoverAltOverride } from "@/lib/catalog/cover-alt";
import { removeCatalogCover, writeCatalogCover } from "@/lib/catalog/media-storage";
import { optionalText } from "@/lib/catalog/validation";
import type { MediaStorageReference } from "@/lib/media/storage";

const maximumUploadBytes = 10 * 1024 * 1024;
const maximumPixels = 40_000_000;
const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const CATALOG_COVER_MAXIMUM_BYTES = maximumUploadBytes;
export const CATALOG_COVER_MAXIMUM_PIXELS = maximumPixels;

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

function detectedMimeType(source: Buffer) {
  if (source.length >= 3 && source[0] === 0xff && source[1] === 0xd8 && source[2] === 0xff) return "image/jpeg";
  if (source.length >= 8 && source.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (source.length >= 12 && source.toString("ascii", 0, 4) === "RIFF" && source.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function hasMatchingExtension(filename: string, mimeType: string) {
  const extension = path.extname(filename).toLowerCase();
  if (!extension) return true;
  if (mimeType === "image/jpeg") return extension === ".jpg" || extension === ".jpeg";
  if (mimeType === "image/png") return extension === ".png";
  return mimeType === "image/webp" && extension === ".webp";
}

export async function normalizeCatalogCover(file: File) {
  if (file.size <= 0) throw new CatalogCoverError("EMPTY_FILE");
  if (file.size > maximumUploadBytes) throw new CatalogCoverError("FILE_TOO_LARGE");
  if (!acceptedTypes.has(file.type)) throw new CatalogCoverError("UNSUPPORTED_FORMAT");

  const source = Buffer.from(await file.arrayBuffer());
  const realMimeType = detectedMimeType(source);
  if (!realMimeType) throw new CatalogCoverError("UNSUPPORTED_FORMAT");
  if (file.type !== realMimeType || !hasMatchingExtension(file.name, realMimeType)) throw new CatalogCoverError("MIME_MISMATCH");

  try {
    const metadata = await sharp(source, { animated: false, limitInputPixels: false, failOn: "warning" }).metadata();
    if (!metadata.width || !metadata.height || metadata.pages && metadata.pages > 1) throw new CatalogCoverError("UNREADABLE_IMAGE");
    if (metadata.width * metadata.height > maximumPixels) throw new CatalogCoverError("TOO_MANY_PIXELS");
    if (`image/${metadata.format}` !== realMimeType) throw new CatalogCoverError("MIME_MISMATCH");

    const bytes = await sharp(source, { animated: false, limitInputPixels: maximumPixels, failOn: "warning" })
      .rotate()
      .resize(1_600, 1_600, { fit: "cover", position: "centre", withoutEnlargement: false })
      .webp({ quality: 88, effort: 5 })
      .toBuffer();
    return { bytes, width: 1_600, height: 1_600 };
  } catch (error) {
    if (error instanceof CatalogCoverError) throw error;
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
