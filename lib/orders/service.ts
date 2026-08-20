import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

import { orderOffer } from "@/data/order-offer";
import {
  assertPhotoCapacity,
  calculateOrderPrice,
  canAccessOrder,
  formatOrderNumber,
  type OrderActor,
  type OrderDraftInput,
  validateOrderForSubmission,
} from "@/lib/orders/domain";
import {
  deletePrivateOrderFile,
  readPrivateOrderFile,
  writePrivateOrderFile,
} from "@/lib/orders/storage";
import type { SerializedOrder } from "@/lib/orders/types";
import { normalizeOrderImage, type NormalizedOrderImage } from "@/lib/orders/upload";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { canReadOrderMedia } from "@/lib/media/authorization";
import { personalUseTermsSnapshot } from "@/lib/rights/domain";

export class OrderServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "OrderServiceError";
  }
}

const orderInclude = {
  events: {
    where: { visibility: "CLIENT" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  assets: {
    where: { role: { in: ["REFERENCE", "DELIVERY"] } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { asset: true },
  },
  payments: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      amountCents: true,
      currency: true,
      paymentMethod: true,
      checkoutExpiresAt: true,
      paidAt: true,
      failedAt: true,
      expiredAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.OrderInclude;

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
type Transaction = Prisma.TransactionClient;

function optional(value: string) {
  return value || null;
}

function dataFromInput(input: OrderDraftInput) {
  const pricing = calculateOrderPrice(input);
  return {
    title: optional(input.title),
    recipient: optional(input.recipient),
    occasion: optional(input.occasion),
    brief: input.brief,
    musicalDirection: optional(input.musicalDirection),
    emotion: optional(input.emotion),
    importantDetails: optional(input.importantDetails),
    wordsToInclude: optional(input.wordsToInclude),
    avoid: optional(input.avoid),
    pronunciationNotes: optional(input.pronunciationNotes),
    usage: pricing.usage,
    coverIncluded: input.coverIncluded,
    priorityProcessing: input.priorityProcessing,
    basePriceCents: pricing.basePriceCents,
    coverPriceCents: pricing.coverPriceCents,
    priorityPriceCents: pricing.priorityPriceCents,
    totalCents: pricing.totalCents,
    currency: pricing.currency,
    pricingVersion: pricing.pricingVersion,
    contractRequired: pricing.contractRequired,
  } as const;
}

const editableTerminalPaymentStatuses = ["CANCELED", "EXPIRED"] as const;

async function assertOrderEditableForPayment(
  transaction: Transaction,
  order: { id: string; status: string },
) {
  if (order.status === "DRAFT") return;
  if (order.status !== "AWAITING_PAYMENT") {
    throw new OrderServiceError("Cette commande ne peut plus être modifiée.", 409, "ORDER_NOT_EDITABLE");
  }
  const blockingPayment = await transaction.payment.findFirst({
    where: {
      orderId: order.id,
      status: { notIn: [...editableTerminalPaymentStatuses] },
    },
    select: { id: true },
  });
  if (blockingPayment) {
    throw new OrderServiceError("Terminez ou annulez la session de paiement avant de modifier la commande.", 409, "PAYMENT_SESSION_ACTIVE");
  }
}

export function serializeOrder(order: OrderWithRelations): SerializedOrder {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    customerEmail: order.customerEmail,
    customerName: order.customerName,
    title: order.title ?? "",
    recipient: order.recipient ?? "",
    occasion: order.occasion ?? "",
    brief: order.brief,
    musicalDirection: order.musicalDirection ?? "",
    emotion: order.emotion ?? "",
    importantDetails: order.importantDetails ?? "",
    wordsToInclude: order.wordsToInclude ?? "",
    avoid: order.avoid ?? "",
    pronunciationNotes: order.pronunciationNotes ?? "",
    usage: order.usage,
    coverIncluded: order.coverIncluded,
    priorityProcessing: order.priorityProcessing,
    basePriceCents: order.basePriceCents,
    coverPriceCents: order.coverPriceCents,
    priorityPriceCents: order.priorityPriceCents,
    totalCents: order.totalCents,
    currency: order.currency,
    pricingVersion: order.pricingVersion,
    personalUseTermsVersion: order.personalUseTermsVersion,
    personalUseTermsHashSha256: order.personalUseTermsHashSha256,
    personalUseTermsAcceptedAt: order.personalUseTermsAcceptedAt?.toISOString() ?? null,
    contractRequired: order.contractRequired,
    revisionAllowance: order.revisionAllowance,
    revisionUsed: order.revisionUsed,
    submittedAt: order.submittedAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    downloadExpiresAt: order.downloadExpiresAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    events: order.events.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),
    photos: order.assets.filter(({ asset, role }) => role === "REFERENCE" && asset.type === "IMAGE").map(({ asset, position }) => ({
      id: asset.id,
      filename: asset.filename,
      mimeType: asset.mimeType,
      sizeBytes: Number(asset.sizeBytes),
      width: asset.width,
      height: asset.height,
      position,
    })),
    delivery: order.status === "DELIVERED"
      ? order.assets.filter(({ role, asset }) => role === "DELIVERY" && asset.type === "AUDIO").map(({ asset, createdAt }) => ({
          id: asset.id,
          filename: asset.filename,
          mimeType: asset.mimeType,
          sizeBytes: Number(asset.sizeBytes),
          durationMs: asset.durationMs ?? 0,
          createdAt: createdAt.toISOString(),
        }))[0] ?? null
      : null,
    payments: order.payments.map((payment) => ({
      id: payment.id,
      status: payment.status,
      amountCents: payment.amountCents,
      currency: payment.currency,
      paymentMethod: payment.paymentMethod,
      checkoutExpiresAt: payment.checkoutExpiresAt?.toISOString() ?? null,
      paidAt: payment.paidAt?.toISOString() ?? null,
      failedAt: payment.failedAt?.toISOString() ?? null,
      expiredAt: payment.expiredAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    })),
  };
}

async function withOrderLock<T>(lockKey: string, operation: (transaction: Transaction) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})) IS NULL AS locked`;
        return operation(transaction);
      });
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") throw error;
    }
  }
  throw lastError;
}

async function nextOrderNumber(transaction: Transaction) {
  const values = await transaction.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('lnx_order_number_seq') AS value`;
  const sequence = values[0]?.value;
  if (sequence === undefined) throw new OrderServiceError("Le numéro de commande n’a pas pu être généré.", 500, "NUMBER_GENERATION_FAILED");
  return formatOrderNumber(sequence);
}

async function customerForActor(transaction: Transaction, actor: OrderActor) {
  const existing = await transaction.customer.findFirst({
    where: { OR: [{ userId: actor.id }, { email: actor.email }] },
  });
  if (existing && existing.userId && existing.userId !== actor.id) {
    throw new OrderServiceError("Le profil client ne peut pas être associé à ce compte.", 409, "CUSTOMER_CONFLICT");
  }
  if (existing) {
    return transaction.customer.update({
      where: { id: existing.id },
      data: { userId: actor.id, email: actor.email, displayName: actor.name },
    });
  }
  return transaction.customer.create({
    data: { userId: actor.id, email: actor.email, displayName: actor.name },
  });
}

export async function enforceOrderRateLimit(
  actorId: string,
  action: "draft" | "finalize" | "upload" | "delete" | "rights",
) {
  assertDatabaseConfigured();
  const limits = {
    draft: { windowMs: 10 * 60_000, max: 90 },
    finalize: { windowMs: 60 * 60_000, max: 10 },
    upload: { windowMs: 60 * 60_000, max: 30 },
    delete: { windowMs: 60 * 60_000, max: 30 },
    rights: { windowMs: 60 * 60_000, max: 5 },
  } as const;
  const limit = limits[action];
  const key = `orders:${action}:${actorId}`;
  const now = BigInt(Date.now());

  const allowed = await withOrderLock(key, async (transaction) => {
    const current = await transaction.rateLimit.findUnique({ where: { key } });
    if (!current) {
      await transaction.rateLimit.create({ data: { key, count: 1, lastRequest: now } });
      return true;
    }
    if (now - current.lastRequest >= BigInt(limit.windowMs)) {
      await transaction.rateLimit.update({ where: { key }, data: { count: 1, lastRequest: now } });
      return true;
    }
    if (current.count >= limit.max) return false;
    await transaction.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return true;
  });

  if (!allowed) throw new OrderServiceError("Trop de demandes ont été reçues. Réessayez plus tard.", 429, "RATE_LIMITED");
}

export async function createDraftOrder(actor: OrderActor, input: OrderDraftInput) {
  assertDatabaseConfigured();
  return withOrderLock(`drafts:${actor.id}`, async (transaction) => {
    const draftCount = await transaction.order.count({ where: { userId: actor.id, status: "DRAFT" } });
    if (draftCount >= orderOffer.maxActiveDrafts) {
      throw new OrderServiceError("Vous avez déjà dix brouillons actifs.", 409, "DRAFT_LIMIT_REACHED");
    }
    const customer = await customerForActor(transaction, actor);
    const orderNumber = await nextOrderNumber(transaction);
    const order = await transaction.order.create({
      data: {
        orderNumber,
        userId: actor.id,
        customerId: customer.id,
        customerEmail: actor.email,
        customerName: actor.name,
        ...dataFromInput(input),
        revisionAllowance: orderOffer.revisionAllowance,
        events: {
          create: {
            toStatus: "DRAFT",
            note: "Brouillon créé.",
            visibility: "CLIENT",
            actorUserId: actor.id,
          },
        },
      },
      include: orderInclude,
    });
    return serializeOrder(order);
  });
}

export async function saveDraftOrder(actor: OrderActor, orderNumber: string, input: OrderDraftInput) {
  assertDatabaseConfigured();
  return withOrderLock(`payments:order:${orderNumber}`, async (transaction) => {
    const current = await transaction.order.findFirst({
      where: { orderNumber, userId: actor.id, status: { in: ["DRAFT", "AWAITING_PAYMENT"] } },
      select: { id: true, status: true },
    });
    if (!current) throw new OrderServiceError("Cette commande est introuvable.", 404, "ORDER_NOT_FOUND");
    await assertOrderEditableForPayment(transaction, current);
    await transaction.order.update({ where: { id: current.id }, data: dataFromInput(input) });
    const order = await transaction.order.findUniqueOrThrow({ where: { id: current.id }, include: orderInclude });
    return serializeOrder(order);
  });
}

export async function finalizeOrder(actor: OrderActor, orderNumber: string, input: OrderDraftInput, personalUseTermsAccepted: boolean) {
  assertDatabaseConfigured();
  const validation = validateOrderForSubmission(input);
  if (!validation.ok) throw new OrderServiceError(validation.message, 400, "INVALID_BRIEF");

  return withOrderLock(`payments:order:${orderNumber}`, async (transaction) => {
    const draft = await transaction.order.findFirst({ where: { orderNumber, userId: actor.id, status: { in: ["DRAFT", "AWAITING_PAYMENT"] } } });
    if (!draft) throw new OrderServiceError("Cette commande est introuvable.", 404, "ORDER_NOT_FOUND");
    await assertOrderEditableForPayment(transaction, draft);
    if (draft.status === "DRAFT" && !personalUseTermsAccepted) {
      throw new OrderServiceError("Confirmez les conditions d’usage personnel avant le paiement.", 400, "PERSONAL_USE_TERMS_REQUIRED");
    }
    const submittedAt = new Date();
    const terms = personalUseTermsSnapshot();
    await transaction.order.update({
      where: { id: draft.id },
      data: {
        ...dataFromInput(input),
        ...(draft.status === "DRAFT" ? {
          status: "AWAITING_PAYMENT" as const,
          submittedAt,
          personalUseTermsVersion: terms.version,
          personalUseTermsHashSha256: terms.hashSha256,
          personalUseTermsAcceptedAt: submittedAt,
        } : {}),
      },
    });
    if (draft.status === "DRAFT") {
      await transaction.orderEvent.create({
        data: {
          orderId: draft.id,
          fromStatus: "DRAFT",
          toStatus: "AWAITING_PAYMENT",
          note: "Demande enregistrée. Le paiement reste à finaliser.",
          visibility: "CLIENT",
          actorUserId: actor.id,
        },
      });
    }
    const order = await transaction.order.findUniqueOrThrow({ where: { id: draft.id }, include: orderInclude });
    return serializeOrder(order);
  });
}

export async function listMemberOrders(actor: OrderActor) {
  assertDatabaseConfigured();
  const orders = await prisma.order.findMany({
    where: { userId: actor.id },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: orderInclude,
  });
  return orders.map(serializeOrder);
}

export async function getOrderForActor(actor: OrderActor, orderNumber: string) {
  assertDatabaseConfigured();
  const order = await prisma.order.findUnique({ where: { orderNumber }, include: orderInclude });
  if (!order || !canAccessOrder(actor, order.userId)) return null;
  return serializeOrder(order);
}

export async function getDraftForActor(actor: OrderActor, orderNumber?: string) {
  assertDatabaseConfigured();
  const order = await prisma.order.findFirst({
    where: {
      userId: actor.id,
      status: "DRAFT",
      ...(orderNumber ? { orderNumber } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: orderInclude,
  });
  return order ? serializeOrder(order) : null;
}

export async function getCommanderOrderForActor(actor: OrderActor, orderNumber?: string) {
  assertDatabaseConfigured();
  const order = await prisma.order.findFirst({
    where: {
      userId: actor.id,
      ...(orderNumber
        ? { orderNumber, status: { in: ["DRAFT", "AWAITING_PAYMENT"] } }
        : { status: "DRAFT" }),
    },
    orderBy: { updatedAt: "desc" },
    include: orderInclude,
  });
  return order ? serializeOrder(order) : null;
}

export async function deleteDraftOrder(actor: OrderActor, orderNumber: string) {
  assertDatabaseConfigured();
  const storageKeys = await withOrderLock(`order:${orderNumber}`, async (transaction) => {
    const order = await transaction.order.findFirst({
      where: { orderNumber, userId: actor.id, status: "DRAFT" },
      include: { assets: { include: { asset: true } } },
    });
    if (!order) throw new OrderServiceError("Ce brouillon est introuvable.", 404, "ORDER_NOT_FOUND");
    const assetIds = order.assets.map(({ assetId }) => assetId);
    await transaction.orderAsset.deleteMany({ where: { orderId: order.id } });
    await transaction.orderEvent.deleteMany({ where: { orderId: order.id } });
    await transaction.order.delete({ where: { id: order.id } });
    if (assetIds.length) await transaction.asset.deleteMany({ where: { id: { in: assetIds } } });
    return order.assets.map(({ asset }) => asset);
  });
  await Promise.all(storageKeys.map((asset) => deletePrivateOrderFile(asset)));
}

type RawOrderPhoto = { buffer: Buffer; originalFilename: string; declaredMimeType: string };

type PendingPhoto = NormalizedOrderImage & {
  storageKey: string;
  storageBackend: "LOCAL" | "OBJECT";
  storageProvider: string;
  visibility: "PRIVATE";
};

export async function addOrderPhotos(actor: OrderActor, orderNumber: string, files: RawOrderPhoto[]) {
  assertDatabaseConfigured();
  if (!files.length || files.length > orderOffer.maxPhotos) {
    throw new OrderServiceError("Sélectionnez entre une et dix photos.", 400, "INVALID_PHOTO_COUNT");
  }

  const { order, existingCount } = await withOrderLock(`payments:order:${orderNumber}`, async (transaction) => {
    const current = await transaction.order.findFirst({
      where: { orderNumber, userId: actor.id, status: { in: ["DRAFT", "AWAITING_PAYMENT"] } },
      select: { id: true, status: true },
    });
    if (!current) throw new OrderServiceError("Cette commande est introuvable.", 404, "ORDER_NOT_FOUND");
    await assertOrderEditableForPayment(transaction, current);
    return {
      order: current,
      existingCount: await transaction.orderAsset.count({
        where: { orderId: current.id, role: "REFERENCE", asset: { type: "IMAGE" } },
      }),
    };
  });
  if (!assertPhotoCapacity(existingCount, files.length)) {
    throw new OrderServiceError("Une commande peut contenir au maximum dix photos.", 400, "PHOTO_LIMIT_REACHED");
  }

  const pending: PendingPhoto[] = [];
  try {
    for (const file of files) {
      const normalized = await normalizeOrderImage(file);
      const storageKey = `orders/${order.id}/${randomUUID()}.webp`;
      const stored = await writePrivateOrderFile(storageKey, normalized.buffer, normalized.checksum);
      pending.push({
        ...normalized,
        storageKey,
        storageBackend: stored.storageBackend,
        storageProvider: stored.storageProvider,
        visibility: stored.visibility,
      });
    }

    await withOrderLock(`payments:order:${orderNumber}`, async (transaction) => {
      const current = await transaction.order.findFirst({
        where: { id: order.id, userId: actor.id, status: { in: ["DRAFT", "AWAITING_PAYMENT"] } },
        select: { id: true, status: true },
      });
      if (!current) throw new OrderServiceError("Cette commande est introuvable.", 404, "ORDER_NOT_FOUND");
      await assertOrderEditableForPayment(transaction, current);
      const count = await transaction.orderAsset.count({
        where: { orderId: order.id, role: "REFERENCE", asset: { type: "IMAGE" } },
      });
      if (!assertPhotoCapacity(count, pending.length)) {
        throw new OrderServiceError("Une commande peut contenir au maximum dix photos.", 400, "PHOTO_LIMIT_REACHED");
      }
      for (const [index, photo] of pending.entries()) {
        const asset = await transaction.asset.create({
          data: {
            type: "IMAGE",
            storageKey: photo.storageKey,
            filename: photo.originalFilename,
            mimeType: photo.mimeType,
            sizeBytes: BigInt(photo.sizeBytes),
            storageBackend: photo.storageBackend,
            storageProvider: photo.storageProvider,
            visibility: photo.visibility,
            checksumSha256: photo.checksum,
            width: photo.width,
            height: photo.height,
            rightsStatus: "PENDING",
            rightsNote: "Photo de référence client réencodée sans métadonnées pour une commande V0.6.",
            confidence: "CONFIRMED",
          },
        });
        await transaction.orderAsset.create({
          data: { orderId: order.id, assetId: asset.id, role: "REFERENCE", position: count + index },
        });
      }
    });
  } catch (error) {
    await Promise.all(pending.map((photo) => deletePrivateOrderFile(photo)));
    throw error;
  }

  const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
  return serializeOrder(refreshed);
}

export async function getOrderPhotoForActor(actor: OrderActor, orderNumber: string, assetId: string) {
  assertDatabaseConfigured();
  const link = await prisma.orderAsset.findFirst({
    where: {
      order: {
        orderNumber,
        ...(actor.role === "ADMIN" ? {} : { userId: actor.id }),
      },
      assetId,
      role: "REFERENCE",
      asset: { type: "IMAGE", visibility: "PRIVATE" },
    },
    include: { asset: true, order: { select: { userId: true } } },
  });
  if (!link || !canReadOrderMedia(actor, link.order.userId)) return null;
  return { asset: link.asset, buffer: await readPrivateOrderFile(link.asset) };
}

export async function deleteOrderPhoto(actor: OrderActor, orderNumber: string, assetId: string) {
  assertDatabaseConfigured();
  const mediaReference = await withOrderLock(`payments:order:${orderNumber}`, async (transaction) => {
    const order = await transaction.order.findFirst({
      where: { orderNumber, userId: actor.id, status: { in: ["DRAFT", "AWAITING_PAYMENT"] } },
      select: { id: true, status: true },
    });
    if (!order) throw new OrderServiceError("Cette commande est introuvable.", 404, "ORDER_NOT_FOUND");
    await assertOrderEditableForPayment(transaction, order);
    const link = await transaction.orderAsset.findFirst({
      where: {
        orderId: order.id,
        assetId,
        role: "REFERENCE",
        asset: { type: "IMAGE", visibility: "PRIVATE" },
      },
      include: { asset: true },
    });
    if (!link) throw new OrderServiceError("Cette photo est introuvable.", 404, "PHOTO_NOT_FOUND");
    await transaction.orderAsset.delete({
      where: { orderId_assetId_role: { orderId: link.orderId, assetId: link.assetId, role: "REFERENCE" } },
    });
    await transaction.asset.delete({ where: { id: link.assetId } });
    return link.asset;
  });
  await deletePrivateOrderFile(mediaReference);
}
