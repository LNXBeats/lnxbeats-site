import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Prisma } from "@/generated/prisma/client";
import { removeCatalogImage, writeCatalogImage } from "@/lib/catalog/media-storage";
import { sha256Hex, type MediaStorageReference } from "@/lib/media/storage";
import { activeStorageMetadata } from "@/lib/media/storage/config";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { parseExternalProductIdentity, parseExternalProductLockVersion } from "@/lib/shop/external-product-domain";
import {
  normalizeProductImage,
  parseProductImageAlt,
  ProductImageConflictError,
  ProductImageError,
  productImageVersionMatches,
} from "@/lib/shop/product-image";

type Transaction = Prisma.TransactionClient;
type Reference = Pick<MediaStorageReference, "storageKey" | "storageBackend" | "storageProvider" | "visibility"> & { id: string };

function assetId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  try { return parseExternalProductIdentity(value); } catch { throw new ProductImageError("INVALID_VERSION"); }
}

function version(value: unknown) {
  try { return parseExternalProductLockVersion(value); } catch { throw new ProductImageError("INVALID_VERSION"); }
}

function filename(value: string) {
  const base = path.basename(value || "visuel-distrokid").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 180).replace(/\.(?:jpe?g|png|webp)$/i, "");
  return `${base || "visuel-distrokid"}.webp`;
}

async function state(transaction: Transaction, id: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`external-shop-product:${id}`})) IS NULL AS locked`;
  const product = await transaction.externalShopProduct.findUnique({
    where: { id },
    include: { image: true },
  });
  if (!product) throw new ProductImageError("NOT_FOUND");
  if (product.status !== "DRAFT") throw new ProductImageError("NOT_DRAFT");
  return { product, currentAssetId: product.imageAssetId, currentReference: product.image as Reference | null };
}

async function orphan(id: string) {
  return prisma.asset.count({
    where: {
      id,
      externalShopProduct: null,
      products: { none: {} }, projects: { none: {} }, orders: { none: {} }, contractDocuments: { none: {} }, creations: { none: {} },
    },
  });
}

async function removeIfOrphaned(reference: Reference) {
  try {
    if (!await orphan(reference.id)) return;
    await removeCatalogImage(reference);
    await prisma.asset.deleteMany({
      where: {
        id: reference.id,
        externalShopProduct: null,
        products: { none: {} }, projects: { none: {} }, orders: { none: {} }, contractDocuments: { none: {} }, creations: { none: {} },
      },
    });
  } catch {
    console.error("An external product image could not be cleaned safely.");
  }
}

export async function replaceAdminExternalProductImage(input: {
  productId: unknown; expectedLockVersion: unknown; expectedAssetId: unknown; file: File; alt: unknown; rightsConfirmed: boolean; actorAdminId: string;
}) {
  assertDatabaseConfigured();
  let id: string;
  try { id = parseExternalProductIdentity(input.productId); } catch { throw new ProductImageError("INVALID_PRODUCT_ID"); }
  const expectedLockVersion = version(input.expectedLockVersion);
  const expectedAssetId = assetId(input.expectedAssetId);
  const alt = parseProductImageAlt(input.alt);
  if (!input.rightsConfirmed) throw new ProductImageError("RIGHTS_CONFIRMATION_REQUIRED");
  await prisma.$transaction(async (transaction) => {
    const current = await state(transaction, id);
    if (current.product.lockVersion !== expectedLockVersion || !productImageVersionMatches(expectedAssetId, current.currentAssetId)) {
      throw new ProductImageConflictError(current.currentAssetId, current.product.lockVersion);
    }
  });
  const normalized = await normalizeProductImage(input.file);
  const storageKey = `catalog/images/${randomUUID()}.webp`;
  const storage = activeStorageMetadata();
  const staged = await prisma.asset.create({ data: {
    type: "IMAGE", storageKey, filename: filename(input.file.name), mimeType: "image/webp", sizeBytes: BigInt(normalized.bytes.length),
    width: normalized.width, height: normalized.height, storageBackend: storage.storageBackend, storageProvider: storage.storageProvider,
    visibility: "PUBLIC", checksumSha256: sha256Hex(normalized.bytes), alt, rightsStatus: "CLEARED",
    rightsNote: "Droits de publication confirmés par l’administrateur lors du téléversement.", confidence: "CONFIRMED",
  } });
  let stagedReference: Reference = { id: staged.id, storageKey, storageBackend: storage.storageBackend, storageProvider: storage.storageProvider, visibility: "PUBLIC" };
  let obsolete: Reference | null = null;
  try {
    const stored = await writeCatalogImage(storageKey, normalized.bytes);
    stagedReference = { id: staged.id, storageKey, storageBackend: stored.storageBackend, storageProvider: stored.storageProvider, visibility: stored.visibility };
    if (stored.checksumSha256 !== staged.checksumSha256) throw new Error("External product image checksum mismatch.");
    const result = await prisma.$transaction(async (transaction) => {
      const current = await state(transaction, id);
      if (current.product.lockVersion !== expectedLockVersion || !productImageVersionMatches(expectedAssetId, current.currentAssetId)) {
        throw new ProductImageConflictError(current.currentAssetId, current.product.lockVersion);
      }
      obsolete = current.currentReference;
      await transaction.externalShopProduct.update({ where: { id }, data: { imageAssetId: staged.id, lockVersion: { increment: 1 }, updatedByAdminId: input.actorAdminId } });
      await transaction.externalShopProductAuditEvent.create({ data: { externalShopProductId: id, action: "UPDATED", actorAdminId: input.actorAdminId, metadata: { area: "PRIMARY_IMAGE", operation: expectedAssetId ? "REPLACED" : "ADDED", assetId: staged.id } } });
      return { assetId: staged.id, slug: id };
    });
    if (obsolete) await removeIfOrphaned(obsolete);
    return result;
  } catch (error) {
    await removeIfOrphaned(stagedReference);
    throw error;
  }
}

async function assertDedicated(transaction: Transaction, id: string) {
  const candidate = await transaction.asset.findUnique({
    where: { id },
    select: { externalShopProduct: { select: { id: true } }, _count: { select: { products: true, projects: true, orders: true, contractDocuments: true, creations: true } } },
  });
  if (!candidate || !candidate.externalShopProduct || Object.values(candidate._count).some(Boolean)) throw new ProductImageError("SHARED_ASSET");
}

export async function updateAdminExternalProductImageAlt(input: { productId: unknown; expectedLockVersion: unknown; expectedAssetId: unknown; alt: unknown; actorAdminId: string }) {
  assertDatabaseConfigured();
  let id: string;
  try { id = parseExternalProductIdentity(input.productId); } catch { throw new ProductImageError("INVALID_PRODUCT_ID"); }
  const expectedLockVersion = version(input.expectedLockVersion);
  const expectedAssetId = assetId(input.expectedAssetId);
  const alt = parseProductImageAlt(input.alt);
  return prisma.$transaction(async (transaction) => {
    const current = await state(transaction, id);
    if (current.product.lockVersion !== expectedLockVersion || !productImageVersionMatches(expectedAssetId, current.currentAssetId)) throw new ProductImageConflictError(current.currentAssetId, current.product.lockVersion);
    if (!current.currentAssetId) throw new ProductImageError("NO_IMAGE");
    await assertDedicated(transaction, current.currentAssetId);
    await transaction.asset.update({ where: { id: current.currentAssetId }, data: { alt } });
    await transaction.externalShopProduct.update({ where: { id }, data: { lockVersion: { increment: 1 }, updatedByAdminId: input.actorAdminId } });
    await transaction.externalShopProductAuditEvent.create({ data: { externalShopProductId: id, action: "UPDATED", actorAdminId: input.actorAdminId, metadata: { area: "PRIMARY_IMAGE", operation: "ALT_UPDATED", assetId: current.currentAssetId } } });
    return { assetId: current.currentAssetId, slug: id };
  });
}

export async function deleteAdminExternalProductImage(input: { productId: unknown; expectedLockVersion: unknown; expectedAssetId: unknown; actorAdminId: string }) {
  assertDatabaseConfigured();
  let id: string;
  try { id = parseExternalProductIdentity(input.productId); } catch { throw new ProductImageError("INVALID_PRODUCT_ID"); }
  const expectedLockVersion = version(input.expectedLockVersion);
  const expectedAssetId = assetId(input.expectedAssetId);
  let obsolete: Reference | null = null;
  const result = await prisma.$transaction(async (transaction) => {
    const current = await state(transaction, id);
    if (current.product.lockVersion !== expectedLockVersion || !productImageVersionMatches(expectedAssetId, current.currentAssetId)) throw new ProductImageConflictError(current.currentAssetId, current.product.lockVersion);
    if (!current.currentAssetId) throw new ProductImageError("NO_IMAGE");
    obsolete = current.currentReference;
    await transaction.externalShopProduct.update({ where: { id }, data: { imageAssetId: null, lockVersion: { increment: 1 }, updatedByAdminId: input.actorAdminId } });
    await transaction.externalShopProductAuditEvent.create({ data: { externalShopProductId: id, action: "UPDATED", actorAdminId: input.actorAdminId, metadata: { area: "PRIMARY_IMAGE", operation: "REMOVED", assetId: current.currentAssetId } } });
    return { slug: id };
  });
  if (obsolete) await removeIfOrphaned(obsolete);
  return result;
}

export async function getAdminExternalProductImage(productId: unknown) {
  assertDatabaseConfigured();
  let id: string;
  try { id = parseExternalProductIdentity(productId); } catch { return null; }
  const product = await prisma.externalShopProduct.findUnique({ where: { id }, select: { image: true } });
  return product?.image ?? null;
}
