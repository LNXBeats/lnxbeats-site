import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

import { prisma } from "@/lib/prisma";
import { catalogCoverAltOverride } from "@/lib/catalog/cover-alt";
import { CatalogConflictError } from "@/lib/catalog/service";
import { removeCatalogCover, writeCatalogCover } from "@/lib/catalog/media-storage";
import { optionalText, requiredText } from "@/lib/catalog/validation";

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
  | "TOO_MANY_PIXELS";

export class CatalogCoverError extends Error {
  constructor(readonly code: CatalogCoverErrorCode) {
    super(code);
    this.name = "CatalogCoverError";
  }
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

export async function replaceCatalogCover(projectId: string, rawUpdatedAt: unknown, file: File, rawAlt: unknown) {
  const expectedUpdatedAt = new Date(requiredText(rawUpdatedAt, "La version", 80));
  if (Number.isNaN(expectedUpdatedAt.getTime())) throw new CatalogConflictError();
  const requestedAlt = optionalText(rawAlt, "Le texte alternatif", 500);
  const normalized = await normalizeCatalogCover(file);
  const storageKey = `catalog/covers/${randomUUID()}.webp`;
  const safeBase = path.basename(file.name || "cover").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 180);
  await writeCatalogCover(storageKey, normalized.bytes);
  let oldStorageKey: string | null = null;
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-cover:${projectId}`})) IS NULL AS locked`;
      const project = await transaction.project.findUnique({
        where: { id: projectId },
        include: { assets: { where: { role: "COVER" }, include: { asset: true } } },
      });
      if (!project || project.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new CatalogConflictError();
      const alt = catalogCoverAltOverride(requestedAlt, project.title);
      const previous = project.assets[0]?.asset;
      oldStorageKey = previous?.storageKey ?? null;
      if (previous) {
        await transaction.projectAsset.deleteMany({ where: { projectId, role: "COVER" } });
        await transaction.asset.delete({ where: { id: previous.id } });
      }
      const asset = await transaction.asset.create({
        data: {
          type: "COVER", storageKey, filename: `${safeBase || "cover"}.webp`, mimeType: "image/webp",
          sizeBytes: BigInt(normalized.bytes.length), width: normalized.width, height: normalized.height,
          alt, rightsStatus: "CLEARED", confidence: "CONFIRMED",
        },
      });
      await transaction.projectAsset.create({ data: { projectId, assetId: asset.id, role: "COVER", position: 0 } });
      await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
    });
  } catch (error) {
    await removeCatalogCover(storageKey);
    throw error;
  }
  if (oldStorageKey) {
    try { await removeCatalogCover(oldStorageKey); }
    catch { console.error("An obsolete catalogue cover could not be removed after replacement."); }
  }
}
