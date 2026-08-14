import "server-only";

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";

import type { Prisma } from "@/generated/prisma/client";

import type { OrderDeliveryUpload } from "@/lib/orders/audio-request";
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
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  durationMs: number | null;
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
  }): Promise<{ delivery: PersistedOrderDelivery; previousReference: PrivateDeliveryReference | null }>;
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

async function paidOrderForDelivery(transaction: Transaction, orderNumber: string) {
  const order = await transaction.order.findUnique({
    where: { orderNumber },
    include: {
      payments: {
        where: { status: "SUCCEEDED" },
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
    const previous = order.assets[0]?.asset ?? null;
    let previousReference: PrivateDeliveryReference | null = null;
    if (previous) {
      await transaction.orderAsset.delete({
        where: { orderId_assetId_role: { orderId: order.id, assetId: previous.id, role: "DELIVERY" } },
      });
      await transaction.asset.delete({ where: { id: previous.id } });
      previousReference = {
        storageKey: previous.storageKey,
        storageBackend: previous.storageBackend,
        storageProvider: previous.storageProvider,
        visibility: previous.visibility,
      };
    }
    const delivery = await transaction.asset.create({
      data: {
        type: "AUDIO",
        storageKey: input.stored.storageKey,
        filename: input.source.originalFilename,
        mimeType: input.source.mimeType,
        sizeBytes: BigInt(input.source.sizeBytes),
        durationMs: input.source.durationMs,
        storageBackend: input.stored.storageBackend,
        storageProvider: input.stored.storageProvider,
        visibility: "PRIVATE",
        checksumSha256: input.source.checksumSha256,
        rightsStatus: "CLEARED",
        rightsNote: "Master privé déposé par l’administration pour cette commande.",
        confidence: "CONFIRMED",
      },
    });
    await transaction.orderAsset.create({
      data: { orderId: order.id, assetId: delivery.id, role: "DELIVERY", position: 0 },
    });
    await transaction.orderEvent.create({
      data: {
        orderId: order.id,
        toStatus: order.status,
        note: previous
          ? `Master de livraison remplacé par l’administration (${input.source.extension.toUpperCase()}).`
          : `Master de livraison ajouté par l’administration (${input.source.extension.toUpperCase()}).`,
        visibility: "INTERNAL",
        actorUserId: input.actor.id,
      },
    });
    return { delivery, previousReference };
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
    const { delivery, previousReference } = await dependencies.persist({ actor, orderNumber, source, stored });
    if (previousReference) {
      await dependencies.delete(previousReference).catch(() => {
        console.warn("A replaced private delivery object requires storage reconciliation.");
      });
    }
    return delivery;
  } catch (error) {
    await dependencies.delete(newReference).catch(() => undefined);
    throw error;
  }
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
      asset: { type: "AUDIO", visibility: "PRIVATE", mimeType: { in: ["audio/mpeg", "audio/wav"] } },
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
