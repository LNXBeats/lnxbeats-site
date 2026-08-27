import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Prisma } from "@/generated/prisma/client";
import { removeCatalogImage, writeCatalogImage } from "@/lib/catalog/media-storage";
import {
  ADMIN_IMAGE_MAXIMUM_BYTES,
  ADMIN_IMAGE_MAXIMUM_PIXELS,
  AdminImageError,
  normalizeAdminImage,
} from "@/lib/media/admin-image";
import { sha256Hex, type MediaStorageReference } from "@/lib/media/storage";
import { activeStorageMetadata } from "@/lib/media/storage/config";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { parseProductIdentity, parseProductLockVersion } from "@/lib/shop/product-domain";

type Transaction = Prisma.TransactionClient;
type ProductImageReference = Pick<
  MediaStorageReference,
  "storageKey" | "storageBackend" | "storageProvider" | "visibility"
>;
type ProductImageCleanupCandidate = ProductImageReference & { id: string };

export const PRODUCT_IMAGE_MAXIMUM_BYTES = ADMIN_IMAGE_MAXIMUM_BYTES;
export const PRODUCT_IMAGE_MAXIMUM_PIXELS = ADMIN_IMAGE_MAXIMUM_PIXELS;
export type ProductImageErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "MIME_MISMATCH"
  | "UNREADABLE_IMAGE"
  | "TOO_MANY_PIXELS"
  | "INVALID_PRODUCT_ID"
  | "INVALID_VERSION"
  | "INVALID_ALT"
  | "RIGHTS_CONFIRMATION_REQUIRED"
  | "NOT_FOUND"
  | "NOT_DRAFT"
  | "SHARED_ASSET"
  | "NO_IMAGE";

export class ProductImageError extends Error {
  constructor(readonly code: ProductImageErrorCode, message: string = code) {
    super(message);
    this.name = "ProductImageError";
  }
}

export class ProductImageConflictError extends Error {
  constructor(readonly currentAssetId: string | null, readonly currentLockVersion: number) {
    super("Le visuel a été modifié depuis l’ouverture de cette fiche.");
    this.name = "ProductImageConflictError";
  }
}

function parseExpectedLockVersion(value: unknown) {
  try {
    return parseProductLockVersion(value);
  } catch {
    throw new ProductImageError("INVALID_VERSION", "La version du produit est invalide.");
  }
}

function parseExpectedAssetId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return parseProductIdentity(value);
  } catch {
    throw new ProductImageError("INVALID_VERSION", "La version du visuel est invalide.");
  }
}

export function parseProductImageAlt(value: unknown) {
  if (typeof value !== "string") throw new ProductImageError("INVALID_ALT", "Le texte alternatif est requis.");
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) {
    throw new ProductImageError("INVALID_ALT", "Le texte alternatif doit contenir entre 1 et 500 caractères.");
  }
  return normalized;
}

export function productImageVersionMatches(expectedAssetId: string | null, currentAssetId: string | null) {
  return expectedAssetId === currentAssetId;
}

export async function normalizeProductImage(file: File) {
  try {
    return await normalizeAdminImage(file, "contained-product");
  } catch (error) {
    if (error instanceof AdminImageError) throw new ProductImageError(error.code);
    throw new ProductImageError("UNREADABLE_IMAGE");
  }
}

async function lockedProductImageState(transaction: Transaction, productId: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shop-product:${productId}`})) IS NULL AS locked`;
  const product = await transaction.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      lockVersion: true,
      assets: {
        where: { position: 0 },
        take: 1,
        select: {
          asset: {
            select: {
              id: true,
              storageKey: true,
              storageBackend: true,
              storageProvider: true,
              visibility: true,
            },
          },
        },
      },
    },
  });
  if (!product) throw new ProductImageError("NOT_FOUND", "Produit introuvable.");
  if (product.status !== "DRAFT") {
    throw new ProductImageError("NOT_DRAFT", "Dépubliez d’abord le produit pour modifier son visuel.");
  }
  return {
    product,
    currentAssetId: product.assets[0]?.asset.id ?? null,
    currentReference: product.assets[0]?.asset ?? null,
  };
}

async function assertCurrentProductImageVersion(productId: string, expectedLockVersion: number, expectedAssetId: string | null) {
  return prisma.$transaction(async (transaction) => {
    const state = await lockedProductImageState(transaction, productId);
    if (state.product.lockVersion !== expectedLockVersion || !productImageVersionMatches(expectedAssetId, state.currentAssetId)) {
      throw new ProductImageConflictError(state.currentAssetId, state.product.lockVersion);
    }
    return state;
  });
}

function auditMetadata(value: Record<string, string | number | boolean | null>) {
  return value satisfies Prisma.InputJsonObject;
}

function safeFilename(filename: string) {
  const base = path.basename(filename || "visuel-produit")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 180)
    .replace(/\.(?:jpe?g|png|webp)$/i, "");
  return `${base || "visuel-produit"}.webp`;
}

async function removeNewObjectAfterFailure(candidate: ProductImageCleanupCandidate, productId: string) {
  try {
    const stillOrphaned = await prisma.$transaction(async (transaction) => {
      // If the activation connection was lost during COMMIT, this waits until
      // PostgreSQL has conclusively committed or rolled back that transaction.
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shop-product:${productId}`})) IS NULL AS locked`;
      return transaction.asset.count({
        where: {
          id: candidate.id,
          products: { none: {} },
          projects: { none: {} },
          orders: { none: {} },
          contractDocuments: { none: {} },
        },
      });
    });
    if (!stillOrphaned) return;
    await removeCatalogImage(candidate);
    await prisma.asset.deleteMany({
      where: {
        id: candidate.id,
        products: { none: {} },
        projects: { none: {} },
        orders: { none: {} },
        contractDocuments: { none: {} },
      },
    });
  } catch {
    console.error("A staged product image could not be fully cleaned after a failed activation.");
  }
}

async function removeObsoleteObject(candidate: ProductImageCleanupCandidate) {
  try {
    const stillOrphaned = await prisma.asset.count({
      where: {
        id: candidate.id,
        products: { none: {} },
        projects: { none: {} },
        orders: { none: {} },
        contractDocuments: { none: {} },
      },
    });
    if (!stillOrphaned) return;
    await removeCatalogImage(candidate);
    await prisma.asset.deleteMany({
      where: {
        id: candidate.id,
        products: { none: {} },
        projects: { none: {} },
        orders: { none: {} },
        contractDocuments: { none: {} },
      },
    });
  } catch {
    console.error("An obsolete product image could not be removed after replacement.");
  }
}

async function assertDedicatedProductImageAsset(transaction: Transaction, assetId: string) {
  const asset = await transaction.asset.findUnique({
    where: { id: assetId },
    select: {
      _count: { select: { products: true, projects: true, orders: true, contractDocuments: true } },
    },
  });
  if (
    !asset
    || asset._count.products !== 1
    || asset._count.projects !== 0
    || asset._count.orders !== 0
    || asset._count.contractDocuments !== 0
  ) {
    throw new ProductImageError(
      "SHARED_ASSET",
      "Ce visuel est partagé. Remplacez-le par un visuel dédié avant de modifier son texte alternatif.",
    );
  }
}

export async function replaceAdminProductImage(input: {
  productId: unknown;
  expectedLockVersion: unknown;
  expectedAssetId: unknown;
  file: File;
  alt: unknown;
  rightsConfirmed: boolean;
  actorAdminId: string;
}) {
  assertDatabaseConfigured();
  let productId: string;
  try {
    productId = parseProductIdentity(input.productId);
  } catch {
    throw new ProductImageError("INVALID_PRODUCT_ID", "Produit invalide.");
  }
  const expectedLockVersion = parseExpectedLockVersion(input.expectedLockVersion);
  const expectedAssetId = parseExpectedAssetId(input.expectedAssetId);
  const alt = parseProductImageAlt(input.alt);
  if (!input.rightsConfirmed) {
    throw new ProductImageError("RIGHTS_CONFIRMATION_REQUIRED", "Confirmez les droits de publication de cette image.");
  }

  await assertCurrentProductImageVersion(productId, expectedLockVersion, expectedAssetId);
  const normalized = await normalizeProductImage(input.file);
  const storageKey = `catalog/images/${randomUUID()}.webp`;
  const storage = activeStorageMetadata();
  const stagedAsset = await prisma.asset.create({
    data: {
      type: "IMAGE",
      storageKey,
      filename: safeFilename(input.file.name),
      mimeType: "image/webp",
      sizeBytes: BigInt(normalized.bytes.length),
      width: normalized.width,
      height: normalized.height,
      storageBackend: storage.storageBackend,
      storageProvider: storage.storageProvider,
      visibility: "PUBLIC",
      checksumSha256: sha256Hex(normalized.bytes),
      alt,
      rightsStatus: "CLEARED",
      rightsNote: "Droits de publication confirmés par l’administrateur lors du téléversement.",
      confidence: "CONFIRMED",
    },
  });
  let newReference: ProductImageCleanupCandidate = {
    id: stagedAsset.id,
    storageKey,
    storageBackend: storage.storageBackend,
    storageProvider: storage.storageProvider,
    visibility: "PUBLIC",
  };
  let obsoleteReference: ProductImageCleanupCandidate | null = null;

  try {
    const stored = await writeCatalogImage(storageKey, normalized.bytes);
    newReference = {
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
    ) {
      throw new Error("Product image storage metadata changed during staging.");
    }
    const result = await prisma.$transaction(async (transaction) => {
      const state = await lockedProductImageState(transaction, productId);
      if (state.product.lockVersion !== expectedLockVersion || !productImageVersionMatches(expectedAssetId, state.currentAssetId)) {
        throw new ProductImageConflictError(state.currentAssetId, state.product.lockVersion);
      }

      if (state.currentAssetId) {
        await transaction.productAsset.delete({
          where: { productId_assetId: { productId, assetId: state.currentAssetId } },
        });
        if (state.currentReference) obsoleteReference = state.currentReference;
      }

      await transaction.productAsset.create({ data: { productId, assetId: stagedAsset.id, position: 0 } });
      await transaction.product.update({
        where: { id: productId },
        data: { lockVersion: { increment: 1 }, updatedByAdminId: input.actorAdminId },
      });
      await transaction.productAuditEvent.create({
        data: {
          productId,
          action: "UPDATED",
          actorAdminId: input.actorAdminId,
          metadata: auditMetadata({
            area: "PRIMARY_IMAGE",
            operation: expectedAssetId ? "REPLACED" : "ADDED",
            assetId: stagedAsset.id,
          }),
        },
      });
      return { assetId: stagedAsset.id, slug: state.product.slug };
    });
    if (obsoleteReference) await removeObsoleteObject(obsoleteReference);
    return result;
  } catch (error) {
    await removeNewObjectAfterFailure(newReference, productId);
    throw error;
  }
}

export async function updateAdminProductImageAlt(input: {
  productId: unknown;
  expectedLockVersion: unknown;
  expectedAssetId: unknown;
  alt: unknown;
  actorAdminId: string;
}) {
  assertDatabaseConfigured();
  let productId: string;
  try {
    productId = parseProductIdentity(input.productId);
  } catch {
    throw new ProductImageError("INVALID_PRODUCT_ID", "Produit invalide.");
  }
  const expectedLockVersion = parseExpectedLockVersion(input.expectedLockVersion);
  const expectedAssetId = parseExpectedAssetId(input.expectedAssetId);
  const alt = parseProductImageAlt(input.alt);
  return prisma.$transaction(async (transaction) => {
    const state = await lockedProductImageState(transaction, productId);
    if (state.product.lockVersion !== expectedLockVersion || !productImageVersionMatches(expectedAssetId, state.currentAssetId)) {
      throw new ProductImageConflictError(state.currentAssetId, state.product.lockVersion);
    }
    if (!state.currentAssetId) throw new ProductImageError("NO_IMAGE", "Aucun visuel à modifier.");
    await assertDedicatedProductImageAsset(transaction, state.currentAssetId);
    await transaction.asset.update({ where: { id: state.currentAssetId }, data: { alt } });
    await transaction.product.update({
      where: { id: productId },
      data: { lockVersion: { increment: 1 }, updatedByAdminId: input.actorAdminId },
    });
    await transaction.productAuditEvent.create({
      data: {
        productId,
        action: "UPDATED",
        actorAdminId: input.actorAdminId,
        metadata: auditMetadata({ area: "PRIMARY_IMAGE", operation: "ALT_UPDATED", assetId: state.currentAssetId }),
      },
    });
    return { assetId: state.currentAssetId, slug: state.product.slug };
  });
}

export async function deleteAdminProductImage(input: {
  productId: unknown;
  expectedLockVersion: unknown;
  expectedAssetId: unknown;
  actorAdminId: string;
}) {
  assertDatabaseConfigured();
  let productId: string;
  try {
    productId = parseProductIdentity(input.productId);
  } catch {
    throw new ProductImageError("INVALID_PRODUCT_ID", "Produit invalide.");
  }
  const expectedLockVersion = parseExpectedLockVersion(input.expectedLockVersion);
  const expectedAssetId = parseExpectedAssetId(input.expectedAssetId);
  let obsoleteReference: ProductImageCleanupCandidate | null = null;
  const result = await prisma.$transaction(async (transaction) => {
    const state = await lockedProductImageState(transaction, productId);
    if (state.product.lockVersion !== expectedLockVersion || !productImageVersionMatches(expectedAssetId, state.currentAssetId)) {
      throw new ProductImageConflictError(state.currentAssetId, state.product.lockVersion);
    }
    if (!state.currentAssetId) throw new ProductImageError("NO_IMAGE", "Aucun visuel à supprimer.");
    await transaction.productAsset.delete({
      where: { productId_assetId: { productId, assetId: state.currentAssetId } },
    });
    if (state.currentReference) obsoleteReference = state.currentReference;
    await transaction.product.update({
      where: { id: productId },
      data: { lockVersion: { increment: 1 }, updatedByAdminId: input.actorAdminId },
    });
    await transaction.productAuditEvent.create({
      data: {
        productId,
        action: "UPDATED",
        actorAdminId: input.actorAdminId,
        metadata: auditMetadata({ area: "PRIMARY_IMAGE", operation: "REMOVED", assetId: state.currentAssetId }),
      },
    });
    return { slug: state.product.slug };
  });
  if (obsoleteReference) await removeObsoleteObject(obsoleteReference);
  return result;
}

export async function getAdminProductImage(productId: unknown) {
  assertDatabaseConfigured();
  let id: string;
  try {
    id = parseProductIdentity(productId);
  } catch {
    return null;
  }
  const relation = await prisma.productAsset.findFirst({
    where: {
      productId: id,
      position: 0,
      asset: {
        type: { in: ["IMAGE", "COVER"] },
        mimeType: { startsWith: "image/" },
      },
    },
    select: {
      asset: {
        select: {
          id: true,
          storageKey: true,
          storageBackend: true,
          storageProvider: true,
          visibility: true,
          mimeType: true,
          sizeBytes: true,
          checksumSha256: true,
          filename: true,
          updatedAt: true,
        },
      },
    },
  });
  return relation?.asset ?? null;
}
