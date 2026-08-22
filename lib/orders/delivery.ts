import "server-only";

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";

import type { Prisma } from "@/generated/prisma/client";

import { ORDER_DELIVERY_MIME_TYPES, type OrderDeliveryUpload } from "@/lib/orders/audio-request";
import type { OrderActor } from "@/lib/orders/domain";
import { canReadOrderMedia } from "@/lib/media/authorization";
import { validateMediaStorageConfiguration } from "@/lib/media/storage/config";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { deletePrivateOrderFile, writePrivateOrderMedia } from "@/lib/orders/storage";
import { orderOffer } from "@/data/order-offer";

type Transaction = Prisma.TransactionClient;

type PrivateDeliveryReference = {
  storageKey: string;
  storageBackend: "LOCAL" | "OBJECT";
  storageProvider: string;
  visibility: "PUBLIC" | "PRIVATE";
};

type StoredPrivateDelivery = PrivateDeliveryReference & { checksumSha256: string };

export type PersistedOrderDelivery = {
  id: string;
  type: "AUDIO" | "DOCUMENT" | "IMAGE";
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
};

export type OrderDeliveryDependencies = {
  validateStorage(): { backend: string; provider: string };
  prepareOrder(orderNumber: string): Promise<{ id: string }>;
  write(input: {
    storageKey: string;
    source: OrderDeliveryUpload;
  }): Promise<StoredPrivateDelivery>;
  persist(input: {
    actor: OrderActor;
    orderNumber: string;
    source: OrderDeliveryUpload;
    stored: StoredPrivateDelivery;
  }): Promise<{ delivery: PersistedOrderDelivery }>;
  delete(reference: PrivateDeliveryReference): Promise<void>;
};

export type OrderDeliveryRemovalDependencies = {
  detach(input: { actor: OrderActor; orderNumber: string; assetId: string }): Promise<PrivateDeliveryReference>;
  delete(reference: PrivateDeliveryReference): Promise<void>;
};

export class OrderDeliveryError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "OrderDeliveryError";
  }
}

const deliveryPreparationStatuses = new Set([
  "PAYMENT_CONFIRMED",
  "RECEIVED",
  "SUBMITTED",
  "REVIEWING",
  "ACCEPTED",
  "IN_PROGRESS",
  "FIRST_VERSION_READY",
  "REVISION_REQUESTED",
  "FINALIZING",
]);

export const MAXIMUM_ORDER_DELIVERIES = 8;

export function orderAcceptsDeliveryUpload(status: string, hasSuccessfulPayment: boolean) {
  return hasSuccessfulPayment && deliveryPreparationStatuses.has(status);
}

async function withDeliveryOrderLock<T>(
  orderNumber: string,
  operation: (transaction: Transaction) => Promise<T>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`payments:order:${orderNumber}`})) IS NULL AS locked`;
        return operation(transaction);
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== "object" || !("code" in error) || (error.code !== "P2034" && error.code !== "P2002")) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function paidOrderForDelivery(transaction: Transaction, orderNumber: string, requireCapacity = true) {
  const order = await transaction.order.findUnique({
    where: { orderNumber },
    include: {
      payments: {
        where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } },
        select: { id: true },
      },
      assets: {
        where: { role: "DELIVERY" },
        include: { asset: true },
      },
    },
  });
  if (!order) throw new OrderDeliveryError("Commande introuvable.", 404, "ORDER_NOT_FOUND");
  if (!orderAcceptsDeliveryUpload(order.status, order.payments.length > 0)) {
    throw new OrderDeliveryError("Une livraison exige une commande payée encore en cours.", 409, "ORDER_NOT_DELIVERABLE");
  }
  if (requireCapacity && order.assets.length >= MAXIMUM_ORDER_DELIVERIES) {
    throw new OrderDeliveryError("Cette commande contient déjà le maximum de huit livrables.", 409, "DELIVERY_LIMIT_REACHED");
  }
  return order;
}

async function prepareOrderDelivery(orderNumber: string) {
  assertDatabaseConfigured();
  return withDeliveryOrderLock(orderNumber, async (transaction) => {
    const order = await paidOrderForDelivery(transaction, orderNumber);
    return { id: order.id };
  });
}

async function persistOrderDelivery(input: {
  actor: OrderActor;
  orderNumber: string;
  source: OrderDeliveryUpload;
  stored: StoredPrivateDelivery;
}) {
  return withDeliveryOrderLock(input.orderNumber, async (transaction) => {
    const order = await paidOrderForDelivery(transaction, input.orderNumber);
    const position = order.assets.reduce((highest, link) => Math.max(highest, link.position), -1) + 1;
    const delivery = await transaction.asset.create({
      data: {
        type: input.source.assetType,
        storageKey: input.stored.storageKey,
        filename: input.source.originalFilename,
        mimeType: input.source.mimeType,
        sizeBytes: BigInt(input.source.sizeBytes),
        durationMs: input.source.durationMs,
        width: input.source.width,
        height: input.source.height,
        storageBackend: input.stored.storageBackend,
        storageProvider: input.stored.storageProvider,
        visibility: "PRIVATE",
        checksumSha256: input.source.checksumSha256,
        rightsStatus: "CLEARED",
        rightsNote: "Livrable privé déposé par l’administration pour cette commande.",
        confidence: "CONFIRMED",
      },
    });
    await transaction.orderAsset.create({
      data: { orderId: order.id, assetId: delivery.id, role: "DELIVERY", position },
    });
    await transaction.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: order.status,
        note: `Livrable privé ajouté par l’administration (${input.source.extension.toUpperCase()}).`,
        visibility: "INTERNAL",
        actorUserId: input.actor.id,
      },
    });
    return {
      delivery: {
        id: delivery.id,
        type: input.source.assetType,
        filename: delivery.filename,
        mimeType: delivery.mimeType,
        sizeBytes: delivery.sizeBytes,
        durationMs: delivery.durationMs,
        width: delivery.width,
        height: delivery.height,
        createdAt: delivery.createdAt,
      },
    };
  });
}

const databaseOrderDeliveryDependencies: OrderDeliveryDependencies = {
  validateStorage: validateMediaStorageConfiguration,
  prepareOrder: prepareOrderDelivery,
  async write({ storageKey, source }) {
    const stored = await writePrivateOrderMedia({
      storageKey,
      body: createReadStream(source.path),
      contentLength: source.sizeBytes,
      contentType: source.mimeType,
      checksumSha256: source.checksumSha256,
    });
    return { ...stored, storageKey };
  },
  persist: persistOrderDelivery,
  delete: deletePrivateOrderFile,
};

export async function putOrderDelivery(
  actor: OrderActor,
  orderNumber: string,
  source: OrderDeliveryUpload,
  dependencies: OrderDeliveryDependencies = databaseOrderDeliveryDependencies,
) {
  if (actor.role !== "ADMIN") throw new OrderDeliveryError("Action réservée à l’administration.", 403, "ADMIN_REQUIRED");
  if (source.sizeBytes <= 0 || source.sizeBytes > orderOffer.maxDeliveryBytes) {
    throw new OrderDeliveryError("Le fichier de livraison doit peser au maximum 200 Mo.", 413, "DELIVERY_TOO_LARGE");
  }
  const configuration = dependencies.validateStorage();
  if (configuration.backend !== "OBJECT" || configuration.provider !== "r2") {
    throw new OrderDeliveryError("Le stockage privé de livraison est indisponible.", 503, "DELIVERY_STORAGE_UNAVAILABLE");
  }

  const prepared = await dependencies.prepareOrder(orderNumber);
  const storageKey = `orders/${prepared.id}/deliveries/${randomUUID()}.${source.extension}`;
  const stored = await dependencies.write({ storageKey, source });
  const newReference: PrivateDeliveryReference = stored;
  if (stored.storageBackend !== "OBJECT" || stored.storageProvider !== "r2" || stored.visibility !== "PRIVATE") {
    await dependencies.delete(newReference).catch(() => undefined);
    throw new OrderDeliveryError("Le stockage privé de livraison est indisponible.", 503, "DELIVERY_STORAGE_UNAVAILABLE");
  }

  try {
    const { delivery } = await dependencies.persist({ actor, orderNumber, source, stored });
    return delivery;
  } catch (error) {
    await dependencies.delete(newReference).catch(() => undefined);
    throw error;
  }
}

async function detachOrderDelivery(input: { actor: OrderActor; orderNumber: string; assetId: string }) {
  return withDeliveryOrderLock(input.orderNumber, async (transaction) => {
    const order = await paidOrderForDelivery(transaction, input.orderNumber, false);
    const link = order.assets.find(({ asset }) => asset.id === input.assetId);
    if (!link) throw new OrderDeliveryError("Livrable introuvable.", 404, "DELIVERY_NOT_FOUND");
    await transaction.orderAsset.delete({
      where: { orderId_assetId_role: { orderId: order.id, assetId: link.asset.id, role: "DELIVERY" } },
    });
    await transaction.asset.delete({ where: { id: link.asset.id } });
    await transaction.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: order.status,
        note: "Livrable privé retiré avant publication par l’administration.",
        visibility: "INTERNAL",
        actorUserId: input.actor.id,
      },
    });
    return {
      storageKey: link.asset.storageKey,
      storageBackend: link.asset.storageBackend,
      storageProvider: link.asset.storageProvider,
      visibility: link.asset.visibility,
    };
  });
}

const databaseOrderDeliveryRemovalDependencies: OrderDeliveryRemovalDependencies = {
  detach: detachOrderDelivery,
  delete: deletePrivateOrderFile,
};

export async function removeOrderDelivery(
  actor: OrderActor,
  orderNumber: string,
  assetId: string,
  dependencies: OrderDeliveryRemovalDependencies = databaseOrderDeliveryRemovalDependencies,
) {
  if (actor.role !== "ADMIN") throw new OrderDeliveryError("Action réservée à l’administration.", 403, "ADMIN_REQUIRED");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
    throw new OrderDeliveryError("Livrable introuvable.", 404, "DELIVERY_NOT_FOUND");
  }
  const reference = await dependencies.detach({ actor, orderNumber, assetId });
  await dependencies.delete(reference).catch(() => {
    console.warn("A detached private delivery object requires storage reconciliation.");
  });
}

export function canDownloadOrderDelivery(
  actor: OrderActor,
  order: { userId: string | null; status: string; downloadExpiresAt: Date | null },
  now = new Date(),
) {
  if (!canReadOrderMedia(actor, order.userId)) return false;
  if (actor.role === "ADMIN") return true;
  return order.status === "DELIVERED"
    && order.downloadExpiresAt !== null
    && order.downloadExpiresAt.getTime() > now.getTime();
}

export async function getOrderDeliveryForActor(
  actor: OrderActor,
  orderNumber: string,
  assetId: string,
) {
  assertDatabaseConfigured();
  const link = await prisma.orderAsset.findFirst({
    where: {
      assetId,
      role: "DELIVERY",
      asset: {
        type: { in: ["AUDIO", "DOCUMENT", "IMAGE"] },
        visibility: "PRIVATE",
        mimeType: { in: [...ORDER_DELIVERY_MIME_TYPES] },
      },
      order: {
        orderNumber,
      },
    },
    include: {
      asset: true,
      order: { select: { userId: true, status: true, downloadExpiresAt: true } },
    },
  });
  if (!link || !canDownloadOrderDelivery(actor, link.order)) return null;
  return link.asset;
}
