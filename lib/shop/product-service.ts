import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  assertProductPublishable,
  countPublishableProductImages,
  parseProductEditorInput,
  parseStockAdjustmentInput,
  ProductValidationError,
} from "@/lib/shop/product-domain";

type Transaction = Prisma.TransactionClient;

export class ProductServiceError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "CONFLICT" | "SLUG_TAKEN" | "SLUG_IMMUTABLE" | "ARCHIVED" | "STOCK_DISABLED" | "STOCK_CONFIRMATION_REQUIRED" | "INSUFFICIENT_STOCK",
  ) {
    super(message);
    this.name = "ProductServiceError";
  }
}

async function withProductLock<T>(productId: string, operation: (transaction: Transaction) => Promise<T>) {
  assertDatabaseConfigured();
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shop-product:${productId}`})) IS NULL AS locked`;
    return operation(transaction);
  });
}

function auditPayload(value: Record<string, string | number | boolean | null>) {
  return value satisfies Prisma.InputJsonObject;
}

export async function listAdminProducts(query = "", status = "all") {
  assertDatabaseConfigured();
  const normalizedQuery = query.trim().slice(0, 120);
  const statuses = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
  const normalizedStatus = statuses.includes(status as typeof statuses[number])
    ? status as typeof statuses[number]
    : null;
  return prisma.product.findMany({
    where: {
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
      ...(normalizedQuery ? {
        OR: [
          { title: { contains: normalizedQuery, mode: "insensitive" as const } },
          { slug: { contains: normalizedQuery, mode: "insensitive" as const } },
        ],
      } : {}),
    },
    include: { _count: { select: { assets: true, stockAdjustments: true } } },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "asc" }],
  });
}

export async function getAdminProduct(slug: string) {
  assertDatabaseConfigured();
  return prisma.product.findUnique({
    where: { slug },
    include: {
      assets: { include: { asset: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      stockAdjustments: { include: { actorAdmin: { select: { displayName: true } } }, orderBy: { createdAt: "desc" }, take: 20 },
      auditEvents: { include: { actorAdmin: { select: { displayName: true } } }, orderBy: { occurredAt: "desc" }, take: 30 },
    },
  });
}

export async function createAdminProduct(input: Record<string, unknown>, actorUserId: string) {
  assertDatabaseConfigured();
  const values = parseProductEditorInput(input);
  try {
    return await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('shop-product-creation')) IS NULL AS locked`;
      if (await transaction.product.findUnique({ where: { slug: values.slug }, select: { id: true } })) {
        throw new ProductServiceError("Ce slug produit est déjà utilisé.", "SLUG_TAKEN");
      }
      const product = await transaction.product.create({
        data: {
          ...values,
          status: "DRAFT",
          publishedAt: null,
          archivedAt: null,
          lockVersion: 1,
          createdByAdminId: actorUserId,
          updatedByAdminId: actorUserId,
        },
      });
      await transaction.productAuditEvent.create({
        data: {
          productId: product.id,
          action: "CREATED",
          actorAdminId: actorUserId,
          metadata: auditPayload({
            slug: product.slug,
            status: product.status,
            priceCents: product.priceCents,
            trackInventory: product.trackInventory,
            stock: product.stock,
            shippingRequired: product.shippingRequired,
            shippingPriceCents: product.shippingPriceCents,
          }),
        },
      });
      return product;
    });
  } catch (error) {
    if (error instanceof ProductServiceError || error instanceof ProductValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ProductServiceError("Ce slug produit est déjà utilisé.", "SLUG_TAKEN");
    }
    throw error;
  }
}

export async function updateAdminProduct(
  productId: string,
  expectedLockVersion: number,
  input: Record<string, unknown>,
  actorUserId: string,
  options: { stockChangeConfirmed?: boolean } = {},
) {
  const values = parseProductEditorInput(input);
  try {
    return await withProductLock(productId, async (transaction) => {
      const current = await transaction.product.findUnique({ where: { id: productId } });
      if (!current) throw new ProductServiceError("Produit introuvable.", "NOT_FOUND");
      if (current.status === "ARCHIVED") throw new ProductServiceError("Un produit archivé est en lecture seule.", "ARCHIVED");
      if (current.lockVersion !== expectedLockVersion) throw new ProductServiceError("La fiche a changé. Rechargez la page.", "CONFLICT");
      if (values.slug !== current.slug) {
        throw new ProductServiceError("Le slug d’un produit existant est immuable.", "SLUG_IMMUTABLE");
      }
      const stockConfigurationChanged = values.trackInventory !== current.trackInventory
        || values.stock !== current.stock;
      if (stockConfigurationChanged && options.stockChangeConfirmed !== true) {
        throw new ProductServiceError(
          "Toute modification du suivi de stock ou de sa quantité doit être confirmée explicitement.",
          "STOCK_CONFIRMATION_REQUIRED",
        );
      }

      const update = await transaction.product.updateMany({
        where: { id: productId, lockVersion: expectedLockVersion, status: { not: "ARCHIVED" } },
        data: {
          ...values,
          lockVersion: { increment: 1 },
          updatedByAdminId: actorUserId,
        },
      });
      if (update.count !== 1) throw new ProductServiceError("La fiche a changé. Rechargez la page.", "CONFLICT");

      if (values.trackInventory && values.stock !== (current.stock ?? 0)) {
        const previousQuantity = current.trackInventory ? (current.stock ?? 0) : 0;
        await transaction.productStockAdjustment.create({
          data: {
            productId,
            stockBefore: previousQuantity,
            stockAfter: values.stock ?? 0,
            delta: (values.stock ?? 0) - previousQuantity,
            reason: current.trackInventory ? "Mise à jour de la fiche produit" : "Activation du suivi de stock",
            actorAdminId: actorUserId,
          },
        });
      }
      await transaction.productAuditEvent.create({
        data: {
          productId,
          action: "UPDATED",
          actorAdminId: actorUserId,
          metadata: auditPayload({
            previousSlug: current.slug,
            slug: values.slug,
            previousPriceCents: current.priceCents,
            priceCents: values.priceCents,
            trackInventory: values.trackInventory,
            previousStock: current.stock,
            stock: values.stock,
            shippingRequired: values.shippingRequired,
          }),
        },
      });
      return transaction.product.findUniqueOrThrow({ where: { id: productId } });
    });
  } catch (error) {
    if (error instanceof ProductServiceError || error instanceof ProductValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ProductServiceError("Ce slug produit est déjà utilisé.", "SLUG_TAKEN");
    }
    throw error;
  }
}

export async function publishAdminProduct(productId: string, expectedLockVersion: number, actorUserId: string) {
  return withProductLock(productId, async (transaction) => {
    const current = await transaction.product.findUnique({
      where: { id: productId },
      include: {
        assets: {
          where: { position: 0 },
          select: {
            asset: {
              select: {
                visibility: true,
                type: true,
                mimeType: true,
                alt: true,
                rightsStatus: true,
              },
            },
          },
        },
      },
    });
    if (!current) throw new ProductServiceError("Produit introuvable.", "NOT_FOUND");
    if (current.status === "ARCHIVED") throw new ProductServiceError("Un produit archivé ne peut pas être publié.", "ARCHIVED");
    if (current.lockVersion !== expectedLockVersion) throw new ProductServiceError("La fiche a changé. Rechargez la page.", "CONFLICT");
    assertProductPublishable({
      ...current,
      assetCount: countPublishableProductImages(current.assets.map(({ asset }) => asset)),
    });
    if (current.status === "PUBLISHED") return current;
    const publishedAt = new Date();
    const update = await transaction.product.updateMany({
      where: { id: productId, lockVersion: expectedLockVersion, status: "DRAFT" },
      data: { status: "PUBLISHED", publishedAt, lockVersion: { increment: 1 }, updatedByAdminId: actorUserId },
    });
    if (update.count !== 1) throw new ProductServiceError("La publication est entrée en conflit.", "CONFLICT");
    await transaction.productAuditEvent.create({
      data: { productId, action: "PUBLISHED", actorAdminId: actorUserId, metadata: auditPayload({ publishedAt: publishedAt.toISOString() }) },
    });
    return transaction.product.findUniqueOrThrow({ where: { id: productId } });
  });
}

export async function unpublishAdminProduct(productId: string, expectedLockVersion: number, actorUserId: string) {
  return withProductLock(productId, async (transaction) => {
    const current = await transaction.product.findUnique({ where: { id: productId } });
    if (!current) throw new ProductServiceError("Produit introuvable.", "NOT_FOUND");
    if (current.status === "ARCHIVED") throw new ProductServiceError("Un produit archivé est en lecture seule.", "ARCHIVED");
    if (current.lockVersion !== expectedLockVersion) throw new ProductServiceError("La fiche a changé. Rechargez la page.", "CONFLICT");
    if (current.status === "DRAFT") return current;
    const update = await transaction.product.updateMany({
      where: { id: productId, lockVersion: expectedLockVersion, status: "PUBLISHED" },
      data: { status: "DRAFT", publishedAt: null, lockVersion: { increment: 1 }, updatedByAdminId: actorUserId },
    });
    if (update.count !== 1) throw new ProductServiceError("La dépublication est entrée en conflit.", "CONFLICT");
    await transaction.productAuditEvent.create({
      data: { productId, action: "UNPUBLISHED", actorAdminId: actorUserId, metadata: auditPayload({ previousStatus: current.status }) },
    });
    return transaction.product.findUniqueOrThrow({ where: { id: productId } });
  });
}

export async function archiveAdminProduct(productId: string, expectedLockVersion: number, actorUserId: string) {
  return withProductLock(productId, async (transaction) => {
    const current = await transaction.product.findUnique({ where: { id: productId } });
    if (!current) throw new ProductServiceError("Produit introuvable.", "NOT_FOUND");
    if (current.lockVersion !== expectedLockVersion) throw new ProductServiceError("La fiche a changé. Rechargez la page.", "CONFLICT");
    if (current.status === "ARCHIVED") return current;
    const archivedAt = new Date();
    const update = await transaction.product.updateMany({
      where: { id: productId, lockVersion: expectedLockVersion, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED", archivedAt, lockVersion: { increment: 1 }, updatedByAdminId: actorUserId },
    });
    if (update.count !== 1) throw new ProductServiceError("L’archivage est entré en conflit.", "CONFLICT");
    await transaction.productAuditEvent.create({
      data: { productId, action: "ARCHIVED", actorAdminId: actorUserId, metadata: auditPayload({ previousStatus: current.status }) },
    });
    return transaction.product.findUniqueOrThrow({ where: { id: productId } });
  });
}

export async function adjustAdminProductStock(
  productId: string,
  expectedLockVersion: number,
  input: Record<string, unknown>,
  actorUserId: string,
) {
  const adjustment = parseStockAdjustmentInput(input);
  return withProductLock(productId, async (transaction) => {
    const current = await transaction.product.findUnique({ where: { id: productId } });
    if (!current) throw new ProductServiceError("Produit introuvable.", "NOT_FOUND");
    if (current.status === "ARCHIVED") throw new ProductServiceError("Un produit archivé est en lecture seule.", "ARCHIVED");
    if (current.lockVersion !== expectedLockVersion) throw new ProductServiceError("La fiche a changé. Rechargez la page.", "CONFLICT");
    if (!current.trackInventory || current.stock === null) {
      throw new ProductServiceError("Le suivi de stock n’est pas activé.", "STOCK_DISABLED");
    }
    const currentStock = current.stock;
    const newQuantity = currentStock + adjustment.delta;
    if (!Number.isSafeInteger(newQuantity) || newQuantity < 0 || newQuantity > 1_000_000) {
      throw new ProductServiceError("Cet ajustement rendrait le stock invalide.", "INSUFFICIENT_STOCK");
    }
    const update = await transaction.product.updateMany({
      where: { id: productId, lockVersion: expectedLockVersion, stock: currentStock, trackInventory: true },
      data: { stock: newQuantity, lockVersion: { increment: 1 }, updatedByAdminId: actorUserId },
    });
    if (update.count !== 1) throw new ProductServiceError("Le stock a changé. Rechargez la page.", "CONFLICT");
    await transaction.productStockAdjustment.create({
      data: {
        productId,
        stockBefore: currentStock,
        stockAfter: newQuantity,
        delta: adjustment.delta,
        reason: adjustment.reason,
        actorAdminId: actorUserId,
      },
    });
    await transaction.productAuditEvent.create({
      data: {
        productId,
        action: "STOCK_ADJUSTED",
        actorAdminId: actorUserId,
        metadata: auditPayload({ stockBefore: currentStock, stockAfter: newQuantity, delta: adjustment.delta }),
      },
    });
    return transaction.product.findUniqueOrThrow({ where: { id: productId } });
  });
}
