import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  enqueueShopPreparingNotification,
  enqueueShopShippedNotification,
} from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import type { ShopShipmentDetails } from "@/lib/shop/fulfillment-domain";

type Transaction = Prisma.TransactionClient;

export class ShopFulfillmentError extends Error {
  constructor(
    message: string,
    readonly code: "ORDER_NOT_FOUND" | "PAYMENT_REQUIRED" | "INVALID_TRANSITION" | "ACTOR_NOT_ADMIN",
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

async function lockedTransaction<T>(operation: (transaction: Transaction) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code !== "P2034" && code !== "P2002") throw error;
    }
  }
  throw lastError;
}

async function lockOrder(transaction: Transaction, shopOrderId: string) {
  const key = `shop-payments:order:${shopOrderId}`;
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "shop_orders"
    WHERE "id" = ${shopOrderId}::uuid
    FOR UPDATE
  `;
  if (rows.length !== 1) throw new ShopFulfillmentError("Commande Boutique introuvable.", "ORDER_NOT_FOUND");
}

async function loadLockedOrder(transaction: Transaction, orderNumber: string) {
  const identity = await transaction.shopOrder.findUnique({
    where: { orderNumber },
    select: { id: true },
  });
  if (!identity) throw new ShopFulfillmentError("Commande Boutique introuvable.", "ORDER_NOT_FOUND");
  await lockOrder(transaction, identity.id);
  const order = await transaction.shopOrder.findUnique({
    where: { id: identity.id },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      paymentReviewAt: true,
      fulfillmentStatus: true,
    },
  });
  if (!order) throw new ShopFulfillmentError("Commande Boutique introuvable.", "ORDER_NOT_FOUND");
  return order;
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
) {
  assertDatabaseConfigured();
  return lockedTransaction(async (transaction) => {
    await assertActiveAdmin(transaction, actorAdminId);
    const order = await loadLockedOrder(transaction, orderNumber);
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
    return transaction.shopOrder.findUniqueOrThrow({ where: { id: order.id } });
  });
}

export async function markShopOrderShipped(
  orderNumber: string,
  actorAdminId: string,
  shipment: ShopShipmentDetails,
  now = new Date(),
) {
  assertDatabaseConfigured();
  return lockedTransaction(async (transaction) => {
    await assertActiveAdmin(transaction, actorAdminId);
    const order = await loadLockedOrder(transaction, orderNumber);
    assertPaid(order);
    if (order.fulfillmentStatus === "SHIPPED") return order;
    if (order.fulfillmentStatus !== "PREPARING") {
      throw new ShopFulfillmentError("Seule une commande en préparation peut être expédiée.", "INVALID_TRANSITION");
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
        fulfillmentStatus: "SHIPPED",
        shippedAt: now,
        shippingCarrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber,
        trackingUrl: shipment.trackingUrl,
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
        type: "ORDER_SHIPPED",
        idempotencyKey: `shop-order:${order.id}:shipped:v1`,
        metadata: {
          fulfillmentStatus: "SHIPPED",
          carrierProvided: shipment.carrier !== null,
          trackingProvided: shipment.trackingNumber !== null,
          trackingUrlProvided: shipment.trackingUrl !== null,
        },
      },
    });
    await enqueueShopShippedNotification(transaction, order.id);
    return transaction.shopOrder.findUniqueOrThrow({ where: { id: order.id } });
  });
}
