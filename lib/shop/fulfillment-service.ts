import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  enqueueShopPreparingNotification,
  enqueueShopShippedNotification,
} from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import type { ShopTrackingDetails } from "@/lib/shop/fulfillment-domain";
import {
  findShopCancellationBarrier,
  lockShopOrderForMutation,
} from "@/lib/shop/order-coordination";
import { assertShopShippingOperationsQaEnabled } from "@/lib/shop/shipping-operations-config";

type Transaction = Prisma.TransactionClient;

type ServiceDependencies = Readonly<{
  client?: PrismaClient;
  assertEnabled?: () => void;
  beforeCommitForTesting?: (transaction: Transaction) => Promise<void>;
}>;

function dependencies(input: ServiceDependencies = {}) {
  if (!input.client) assertDatabaseConfigured();
  return {
    client: input.client ?? prisma,
    assertEnabled: input.assertEnabled ?? assertShopShippingOperationsQaEnabled,
    beforeCommitForTesting: input.beforeCommitForTesting,
  };
}

export class ShopFulfillmentError extends Error {
  constructor(
    message: string,
    readonly code: "ORDER_NOT_FOUND" | "PAYMENT_REQUIRED" | "INVALID_TRANSITION" | "ACTOR_NOT_ADMIN" | "TRACKING_REQUIRED" | "CANCELLATION_IN_PROGRESS",
  ) {
    super(message);
    this.name = "ShopFulfillmentError";
  }
}

async function assertActiveAdmin(transaction: Transaction, actorAdminId: string) {
  const actor = await transaction.user.findFirst({
    where: { id: actorAdminId, role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  if (!actor) {
    throw new ShopFulfillmentError("Action réservée à un administrateur actif.", "ACTOR_NOT_ADMIN");
  }
}

async function lockedTransaction<T>(
  client: PrismaClient,
  operation: (transaction: Transaction) => Promise<T>,
  timeoutForTesting?: number,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: "ReadCommitted",
        ...(timeoutForTesting ? { timeout: timeoutForTesting } : {}),
      });
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code !== "P2034" && code !== "P2002") throw error;
    }
  }
  throw lastError;
}

async function loadLockedOrder(transaction: Transaction, orderNumber: string) {
  const identity = await transaction.shopOrder.findUnique({
    where: { orderNumber },
    select: { id: true },
  });
  if (!identity) throw new ShopFulfillmentError("Commande Boutique introuvable.", "ORDER_NOT_FOUND");
  if (!await lockShopOrderForMutation(transaction, identity.id)) {
    throw new ShopFulfillmentError("Commande Boutique introuvable.", "ORDER_NOT_FOUND");
  }
  const order = await transaction.shopOrder.findUnique({
    where: { id: identity.id },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      paymentReviewAt: true,
      fulfillmentStatus: true,
      shippingRequired: true,
      shippingMethod: true,
      shippingBillableGrams: true,
      shippingCarrier: true,
      trackingNumber: true,
      trackingUrl: true,
      trackingSource: true,
      trackingRevision: true,
    },
  });
  if (!order) throw new ShopFulfillmentError("Commande Boutique introuvable.", "ORDER_NOT_FOUND");
  return order;
}

async function assertNoCancellationBarrier(transaction: Transaction, shopOrderId: string) {
  if (await findShopCancellationBarrier(transaction, shopOrderId)) {
    throw new ShopFulfillmentError(
      "Une annulation financière est réservée pour cette commande.",
      "CANCELLATION_IN_PROGRESS",
    );
  }
}

function assertPaid(order: { status: string; paymentStatus: string; paymentReviewAt: Date | null }) {
  if (order.status !== "OPEN" || order.paymentStatus !== "PAID" || order.paymentReviewAt !== null) {
    throw new ShopFulfillmentError(
      "La préparation est verrouillée tant que le paiement n’est pas confirmé.",
      "PAYMENT_REQUIRED",
    );
  }
}

export async function markShopOrderPreparing(
  orderNumber: string,
  actorAdminId: string,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return lockedTransaction(client, async (transaction) => {
    await assertActiveAdmin(transaction, actorAdminId);
    const order = await loadLockedOrder(transaction, orderNumber);
    await assertNoCancellationBarrier(transaction, order.id);
    assertPaid(order);
    if (order.fulfillmentStatus === "PREPARING") return order;
    if (order.fulfillmentStatus !== "PENDING") {
      throw new ShopFulfillmentError("Cette commande ne peut pas passer en préparation.", "INVALID_TRANSITION");
    }
    const changed = await transaction.shopOrder.updateMany({
      where: {
        id: order.id,
        status: "OPEN",
        paymentStatus: "PAID",
        paymentReviewAt: null,
        fulfillmentStatus: "PENDING",
      },
      data: { fulfillmentStatus: "PREPARING", preparingAt: now },
    });
    if (changed.count !== 1) throw new ShopFulfillmentError(
      "La préparation est verrouillée tant que le paiement n’est pas confirmé.",
      "PAYMENT_REQUIRED",
    );
    await transaction.shopOrderLifecycleEvent.create({
      data: {
        shopOrderId: order.id,
        actorUserId: actorAdminId,
        type: "PREPARATION_STARTED",
        idempotencyKey: `shop-order:${order.id}:preparing:v1`,
        metadata: { fulfillmentStatus: "PREPARING" },
      },
    });
    await enqueueShopPreparingNotification(transaction, order.id);
    console.info(JSON.stringify({ event: "shop.shipment.preparation_started", shopOrderId: order.id }));
    return transaction.shopOrder.findUniqueOrThrow({ where: { id: order.id } });
  });
}

export async function markShopOrderReadyToShip(
  orderNumber: string,
  actorAdminId: string,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return lockedTransaction(client, async (transaction) => {
    await assertActiveAdmin(transaction, actorAdminId);
    const order = await loadLockedOrder(transaction, orderNumber);
    await assertNoCancellationBarrier(transaction, order.id);
    assertPaid(order);
    if (order.fulfillmentStatus !== "PREPARING") {
      throw new ShopFulfillmentError("Seule une commande en préparation peut être déclarée prête.", "INVALID_TRANSITION");
    }
    const changed = await transaction.shopOrder.updateMany({
      where: {
        id: order.id,
        status: "OPEN",
        paymentStatus: "PAID",
        paymentReviewAt: null,
        fulfillmentStatus: "PREPARING",
      },
      data: {
        fulfillmentStatus: "READY_TO_SHIP",
        readyToShipAt: now,
      },
    });
    if (changed.count !== 1) throw new ShopFulfillmentError(
      "La préparation est verrouillée tant que le paiement n’est pas confirmé.",
      "PAYMENT_REQUIRED",
    );
    await transaction.shopOrderLifecycleEvent.create({
      data: {
        shopOrderId: order.id,
        actorUserId: actorAdminId,
        type: "SHIPMENT_READY",
        idempotencyKey: `shop-order:${order.id}:ready-to-ship:v1`,
        metadata: {
          fulfillmentStatus: "READY_TO_SHIP",
          shippingMethodSnapshot: order.shippingMethod,
          shippingBillableGramsSnapshot: order.shippingBillableGrams,
        },
      },
    });
    console.info(JSON.stringify({ event: "shop.shipment.ready", shopOrderId: order.id }));
    return transaction.shopOrder.findUniqueOrThrow({ where: { id: order.id } });
  });
}

export async function recordShopOrderTracking(
  orderNumber: string,
  actorAdminId: string,
  tracking: ShopTrackingDetails,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return lockedTransaction(client, async (transaction) => {
    await assertActiveAdmin(transaction, actorAdminId);
    const order = await loadLockedOrder(transaction, orderNumber);
    await assertNoCancellationBarrier(transaction, order.id);
    assertPaid(order);
    if (!order.shippingRequired || order.fulfillmentStatus !== "READY_TO_SHIP") {
      throw new ShopFulfillmentError("Le suivi ne peut être enregistré que pour une expédition prête.", "INVALID_TRANSITION");
    }
    if (
      order.trackingSource === "MANUAL"
      && order.shippingCarrier === tracking.carrier
      && order.trackingNumber === tracking.trackingNumber
      && order.trackingUrl === tracking.trackingUrl
    ) return order;
    const nextRevision = order.trackingRevision + 1;
    const changed = await transaction.shopOrder.updateMany({
      where: {
        id: order.id,
        status: "OPEN",
        paymentStatus: "PAID",
        paymentReviewAt: null,
        fulfillmentStatus: "READY_TO_SHIP",
        trackingRevision: order.trackingRevision,
      },
      data: {
        shippingCarrier: tracking.carrier,
        trackingNumber: tracking.trackingNumber,
        trackingUrl: tracking.trackingUrl,
        trackingSource: "MANUAL",
        trackingRecordedAt: now,
        trackingRevision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new ShopFulfillmentError("Le suivi a été modifié par une autre action.", "INVALID_TRANSITION");
    await transaction.shopOrderLifecycleEvent.create({
      data: {
        shopOrderId: order.id,
        actorUserId: actorAdminId,
        type: "TRACKING_RECORDED",
        idempotencyKey: `shop-order:${order.id}:tracking:${nextRevision}`,
        metadata: {
          source: "MANUAL",
          revision: nextRevision,
          carrier: tracking.carrier,
          trackingNumber: tracking.trackingNumber,
          trackingUrl: tracking.trackingUrl,
        },
      },
    });
    console.info(JSON.stringify({ event: "shop.shipment.tracking_recorded", shopOrderId: order.id, source: "MANUAL", revision: nextRevision }));
    return transaction.shopOrder.findUniqueOrThrow({ where: { id: order.id } });
  });
}

export async function markShopOrderShipped(
  orderNumber: string,
  actorAdminId: string,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  const { client, assertEnabled, beforeCommitForTesting } = dependencies(options);
  assertEnabled();
  return lockedTransaction(client, async (transaction) => {
    await assertActiveAdmin(transaction, actorAdminId);
    const order = await loadLockedOrder(transaction, orderNumber);
    await assertNoCancellationBarrier(transaction, order.id);
    assertPaid(order);
    if (order.fulfillmentStatus === "SHIPPED") return order;
    if (order.fulfillmentStatus !== "READY_TO_SHIP") {
      throw new ShopFulfillmentError("Seule une expédition prête peut être confirmée.", "INVALID_TRANSITION");
    }
    if (order.shippingRequired && (!order.trackingNumber || !order.trackingSource)) {
      throw new ShopFulfillmentError("Un suivi validé est requis avant l’expédition.", "TRACKING_REQUIRED");
    }
    const changed = await transaction.shopOrder.updateMany({
      where: {
        id: order.id,
        status: "OPEN",
        paymentStatus: "PAID",
        paymentReviewAt: null,
        fulfillmentStatus: "READY_TO_SHIP",
        trackingRevision: order.trackingRevision,
      },
      data: { fulfillmentStatus: "SHIPPED", shippedAt: now },
    });
    if (changed.count !== 1) throw new ShopFulfillmentError(
      "La confirmation d’expédition a été précédée par une autre mutation.",
      "INVALID_TRANSITION",
    );
    await transaction.shopOrderLifecycleEvent.create({
      data: {
        shopOrderId: order.id,
        actorUserId: actorAdminId,
        type: "ORDER_SHIPPED",
        idempotencyKey: `shop-order:${order.id}:shipped:v1`,
        metadata: {
          fulfillmentStatus: "SHIPPED",
          trackingSource: order.trackingSource,
          trackingRevision: order.trackingRevision,
          carrierProvided: order.shippingCarrier !== null,
          trackingProvided: order.trackingNumber !== null,
          trackingUrlProvided: order.trackingUrl !== null,
        },
      },
    });
    await enqueueShopShippedNotification(transaction, order.id);
    await beforeCommitForTesting?.(transaction);
    console.info(JSON.stringify({ event: "shop.shipment.confirmed", shopOrderId: order.id, trackingRevision: order.trackingRevision }));
    return transaction.shopOrder.findUniqueOrThrow({ where: { id: order.id } });
  }, beforeCommitForTesting ? 30_000 : undefined);
}
