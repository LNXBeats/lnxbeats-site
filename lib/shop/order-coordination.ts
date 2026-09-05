import "server-only";

import type { Prisma } from "@/generated/prisma/client";

type Transaction = Prisma.TransactionClient;

export const SHOP_ORDER_MUTATION_LOCK_PREFIX = "shop-payments:order";

const cancellationBarrierStatuses = [
  "PROCESSING",
  "PENDING",
  "SUCCEEDED",
  "REQUIRES_REVIEW",
] as const;

const unresolvedShippingStatuses = [
  "REQUESTED",
  "PENDING",
  "SUCCEEDED",
  "REQUIRES_REVIEW",
] as const;

const shopReturnDispositionRefundStatuses = [
  "PROCESSING",
  "PENDING",
  "SUCCEEDED",
  "REQUIRES_REVIEW",
] as const;

/**
 * All financial and fulfillment mutations for a ShopOrder acquire this
 * advisory lock before the row lock. The UUID key intentionally matches the
 * payment/webhook and fulfillment convention already deployed.
 */
export async function lockShopOrderForMutation(
  transaction: Transaction,
  shopOrderId: string,
) {
  const key = `${SHOP_ORDER_MUTATION_LOCK_PREFIX}:${shopOrderId}`;
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "shop_orders"
    WHERE "id" = ${shopOrderId}::uuid
    FOR UPDATE
  `;
  return rows.length === 1;
}

/**
 * Shop SAV refunds already use this lock to reserve refundable capacity. A
 * full pre-shipping cancellation must share it instead of maintaining a
 * second, racy notion of availability.
 */
export async function lockShopRefundCapacity(
  transaction: Transaction,
  paymentId: string,
) {
  const key = `shop-after-sales:payment:${paymentId}`;
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS locked`;
}

/**
 * Every workflow that mutates the persisted stock for a Shop product must use
 * this exact lock primitive. Keeping the key and PostgreSQL hash function in
 * one place prevents otherwise independent cancellation and SAV transactions
 * from taking advisory locks that merely look equivalent.
 */
export async function lockShopProductStockForMutation(
  transaction: Transaction,
  productId: string,
) {
  const key = `shop-product:${productId}`;
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS locked`;
}

/**
 * The RefundAttempt is the durable shipping barrier while the provider call
 * happens outside a database transaction. FAILED is deliberately excluded:
 * callers may only set it after a certain provider refusal.
 */
export async function findShopCancellationBarrier(
  transaction: Transaction,
  shopOrderId: string,
) {
  return transaction.refundAttempt.findFirst({
    where: {
      status: { in: [...cancellationBarrierStatuses] },
      payment: { shopOrderId },
      shopCustomerRequest: {
        is: {
          shopOrderId,
          type: "PAID_ORDER_CANCELLATION",
        },
      },
    },
    select: {
      id: true,
      status: true,
      providerRefundId: true,
      shopCustomerRequestId: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * A full pre-shipping cancellation returns the original confirmed inventory
 * reservation to stock. It must therefore remain mutually exclusive with any
 * active or already-materialized after-sales disposition for the same order.
 *
 * Callers acquire the ShopOrder mutation lock before this read. The redundant
 * durable signals intentionally prevent a later SAV status change from hiding
 * an earlier refund or restock.
 */
export async function findShopReturnDispositionBarrier(
  transaction: Transaction,
  shopOrderId: string,
) {
  return transaction.shopReturnRequest.findFirst({
    where: {
      shopOrderId,
      OR: [
        {
          items: {
            some: {
              restockedQuantity: { gt: 0 },
              orderItem: { is: { inventoryTracked: true } },
            },
          },
        },
        { stockAdjustments: { some: {} } },
        {
          status: { in: ["INSPECTED", "REFUND_PENDING", "REFUNDED"] },
          items: {
            some: {
              restockableQuantity: { gt: 0 },
              orderItem: { is: { inventoryTracked: true } },
            },
          },
        },
        {
          refundAttempt: {
            is: { status: { in: [...shopReturnDispositionRefundStatuses] } },
          },
        },
      ],
    },
    select: {
      id: true,
      status: true,
      refundStatus: true,
      refundAttempt: {
        select: { id: true, status: true, providerRefundId: true },
      },
      items: {
        where: {
          restockedQuantity: { gt: 0 },
          orderItem: { is: { inventoryTracked: true } },
        },
        take: 1,
        select: { id: true, restockedQuantity: true },
      },
      stockAdjustments: {
        take: 1,
        select: { id: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export function hasValidShopCancellationInventoryReservations(
  items: ReadonlyArray<Readonly<{
    inventoryTracked: boolean;
    quantity: number;
    reservation: Readonly<{ status: string; quantity: number }> | null;
  }>>,
) {
  return items.every((item) => !item.inventoryTracked || (
    item.reservation?.status === "CONFIRMED"
    && item.reservation.quantity === item.quantity
  ));
}

/**
 * A carrier/provider request may already have escaped the database. Only a
 * certain FAILED result with no provider identifier is non-blocking.
 */
export async function findUnresolvedShopShippingIntent(
  transaction: Transaction,
  shopOrderId: string,
) {
  return transaction.shopShippingProviderAttempt.findFirst({
    where: {
      shopOrderId,
      OR: [
        { status: { in: [...unresolvedShippingStatuses] } },
        { providerShipmentId: { not: null } },
        { trackingNumber: { not: null } },
      ],
    },
    select: {
      id: true,
      status: true,
      providerShipmentId: true,
      trackingNumber: true,
    },
    orderBy: [{ attemptNumber: "desc" }, { id: "desc" }],
  });
}
