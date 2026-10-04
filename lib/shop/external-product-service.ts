import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  externalProductPublicationBlockers,
  ExternalProductValidationError,
  parseExternalProductEditorInput,
} from "@/lib/shop/external-product-domain";

type Transaction = Prisma.TransactionClient;

export class ExternalProductServiceError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "CONFLICT" | "ARCHIVED" | "INCOMPLETE") {
    super(message);
    this.name = "ExternalProductServiceError";
  }
}

function metadata(value: Record<string, string | number | boolean | null>) {
  return value satisfies Prisma.InputJsonObject;
}

async function locked<T>(id: string, operation: (transaction: Transaction) => Promise<T>) {
  assertDatabaseConfigured();
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`external-shop-product:${id}`})) IS NULL AS locked`;
    return operation(transaction);
  });
}

export async function listAdminExternalProducts(query = "", status = "all") {
  assertDatabaseConfigured();
  const normalizedQuery = query.trim().slice(0, 120);
  const statuses = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
  const normalizedStatus = statuses.includes(status as typeof statuses[number]) ? status as typeof statuses[number] : null;
  return prisma.externalShopProduct.findMany({
    where: {
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
      ...(normalizedQuery ? { title: { contains: normalizedQuery, mode: "insensitive" as const } } : {}),
    },
    include: { image: { select: { id: true } } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

export async function listPublicExternalProducts() {
  assertDatabaseConfigured();
  return prisma.externalShopProduct.findMany({
    where: {
      status: "PUBLISHED",
      image: { is: { type: "IMAGE", visibility: "PUBLIC", rightsStatus: "CLEARED", mimeType: { startsWith: "image/" } } },
    },
    select: {
      id: true, title: true, providerLabel: true, externalUrl: true, priceCents: true, currency: true, position: true,
      image: { select: { id: true, alt: true, width: true, height: true } },
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

export async function getAdminExternalProduct(id: string) {
  assertDatabaseConfigured();
  return prisma.externalShopProduct.findUnique({
    where: { id },
    include: {
      image: true,
      auditEvents: { include: { actorAdmin: { select: { displayName: true } } }, orderBy: { occurredAt: "desc" }, take: 30 },
    },
  });
}

export async function createAdminExternalProduct(input: Record<string, unknown>, actorUserId: string) {
  assertDatabaseConfigured();
  const values = parseExternalProductEditorInput(input);
  return prisma.$transaction(async (transaction) => {
    const product = await transaction.externalShopProduct.create({
      data: { ...values, status: "DRAFT", createdByAdminId: actorUserId, updatedByAdminId: actorUserId },
    });
    await transaction.externalShopProductAuditEvent.create({
      data: {
        externalShopProductId: product.id,
        action: "CREATED",
        actorAdminId: actorUserId,
        metadata: metadata({ provider: product.provider, externalUrl: product.externalUrl, position: product.position }),
      },
    });
    return product;
  });
}

export async function updateAdminExternalProduct(id: string, expectedLockVersion: number, input: Record<string, unknown>, actorUserId: string) {
  const values = parseExternalProductEditorInput(input);
  return locked(id, async (transaction) => {
    const current = await transaction.externalShopProduct.findUnique({ where: { id } });
    if (!current) throw new ExternalProductServiceError("Produit externe introuvable.", "NOT_FOUND");
    if (current.status === "ARCHIVED") throw new ExternalProductServiceError("Cette fiche est archivée.", "ARCHIVED");
    if (current.lockVersion !== expectedLockVersion) throw new ExternalProductServiceError("La fiche a changé.", "CONFLICT");
    const update = await transaction.externalShopProduct.updateMany({
      where: { id, lockVersion: expectedLockVersion, status: { not: "ARCHIVED" } },
      data: { ...values, lockVersion: { increment: 1 }, updatedByAdminId: actorUserId },
    });
    if (update.count !== 1) throw new ExternalProductServiceError("La fiche a changé.", "CONFLICT");
    await transaction.externalShopProductAuditEvent.create({
      data: { externalShopProductId: id, action: "UPDATED", actorAdminId: actorUserId, metadata: metadata({ externalUrl: values.externalUrl, position: values.position }) },
    });
    return transaction.externalShopProduct.findUniqueOrThrow({ where: { id } });
  });
}

export async function publishAdminExternalProduct(id: string, expectedLockVersion: number, actorUserId: string) {
  return locked(id, async (transaction) => {
    const current = await transaction.externalShopProduct.findUnique({ where: { id }, include: { image: true } });
    if (!current) throw new ExternalProductServiceError("Produit externe introuvable.", "NOT_FOUND");
    if (current.status === "ARCHIVED") throw new ExternalProductServiceError("Cette fiche est archivée.", "ARCHIVED");
    if (current.lockVersion !== expectedLockVersion) throw new ExternalProductServiceError("La fiche a changé.", "CONFLICT");
    if (externalProductPublicationBlockers(current).length) throw new ExternalProductServiceError("La fiche externe est incomplète.", "INCOMPLETE");
    if (current.status === "PUBLISHED") return current;
    const publishedAt = new Date();
    const update = await transaction.externalShopProduct.updateMany({
      where: { id, lockVersion: expectedLockVersion, status: "DRAFT" },
      data: { status: "PUBLISHED", publishedAt, lockVersion: { increment: 1 }, updatedByAdminId: actorUserId },
    });
    if (update.count !== 1) throw new ExternalProductServiceError("La fiche a changé.", "CONFLICT");
    await transaction.externalShopProductAuditEvent.create({ data: { externalShopProductId: id, action: "PUBLISHED", actorAdminId: actorUserId } });
    return transaction.externalShopProduct.findUniqueOrThrow({ where: { id } });
  });
}

export async function unpublishAdminExternalProduct(id: string, expectedLockVersion: number, actorUserId: string) {
  return locked(id, async (transaction) => {
    const current = await transaction.externalShopProduct.findUnique({ where: { id } });
    if (!current) throw new ExternalProductServiceError("Produit externe introuvable.", "NOT_FOUND");
    if (current.status === "ARCHIVED") throw new ExternalProductServiceError("Cette fiche est archivée.", "ARCHIVED");
    if (current.lockVersion !== expectedLockVersion) throw new ExternalProductServiceError("La fiche a changé.", "CONFLICT");
    if (current.status === "DRAFT") return current;
    const update = await transaction.externalShopProduct.updateMany({
      where: { id, lockVersion: expectedLockVersion, status: "PUBLISHED" },
      data: { status: "DRAFT", publishedAt: null, lockVersion: { increment: 1 }, updatedByAdminId: actorUserId },
    });
    if (update.count !== 1) throw new ExternalProductServiceError("La fiche a changé.", "CONFLICT");
    await transaction.externalShopProductAuditEvent.create({ data: { externalShopProductId: id, action: "UNPUBLISHED", actorAdminId: actorUserId } });
    return transaction.externalShopProduct.findUniqueOrThrow({ where: { id } });
  });
}

export async function archiveAdminExternalProduct(id: string, expectedLockVersion: number, actorUserId: string) {
  return locked(id, async (transaction) => {
    const current = await transaction.externalShopProduct.findUnique({ where: { id } });
    if (!current) throw new ExternalProductServiceError("Produit externe introuvable.", "NOT_FOUND");
    if (current.status === "ARCHIVED") return current;
    if (current.lockVersion !== expectedLockVersion) throw new ExternalProductServiceError("La fiche a changé.", "CONFLICT");
    const archivedAt = new Date();
    const update = await transaction.externalShopProduct.updateMany({
      where: { id, lockVersion: expectedLockVersion, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED", archivedAt, publishedAt: null, lockVersion: { increment: 1 }, updatedByAdminId: actorUserId },
    });
    if (update.count !== 1) throw new ExternalProductServiceError("La fiche a changé.", "CONFLICT");
    await transaction.externalShopProductAuditEvent.create({ data: { externalShopProductId: id, action: "ARCHIVED", actorAdminId: actorUserId } });
    return transaction.externalShopProduct.findUniqueOrThrow({ where: { id } });
  });
}

export function isExternalProductDomainError(error: unknown) {
  return error instanceof ExternalProductServiceError || error instanceof ExternalProductValidationError;
}
