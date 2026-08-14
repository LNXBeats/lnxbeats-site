import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { sendOrderNotificationEmail } from "@/lib/notifications/email";
import type { OrderNotificationMessage } from "@/lib/notifications/types";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
const MAXIMUM_NOTIFICATION_ATTEMPTS = 5;
const NOTIFICATION_RETRY_DELAY_MS = 5 * 60_000;

export const ownerNewOrderNotificationKey = (orderId: string) => `order:${orderId}:owner-new:email`;
export const customerDeliveryNotificationKey = (orderId: string) => `order:${orderId}:delivery-ready:email`;

export function enqueueOwnerNewOrderNotification(transaction: Transaction, orderId: string) {
  const recipient = process.env.ADMIN_EMAIL?.trim().toLowerCase() || null;
  const idempotencyKey = ownerNewOrderNotificationKey(orderId);
  return transaction.orderNotification.upsert({
    where: { idempotencyKey },
    update: {},
    create: { orderId, kind: "OWNER_NEW_ORDER", channel: "EMAIL", recipient, idempotencyKey },
    select: { id: true },
  });
}

export function enqueueCustomerDeliveryNotification(
  transaction: Transaction,
  order: { id: string; customerEmail: string },
) {
  const idempotencyKey = customerDeliveryNotificationKey(order.id);
  return transaction.orderNotification.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      orderId: order.id,
      kind: "CUSTOMER_DELIVERY_READY",
      channel: "EMAIL",
      recipient: order.customerEmail.trim().toLowerCase(),
      idempotencyKey,
    },
    select: { id: true },
  });
}

export interface NotificationDispatchRepository {
  claim(id: string): Promise<OrderNotificationMessage | null>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, code: string): Promise<void>;
}

const databaseDispatchRepository: NotificationDispatchRepository = {
  async claim(id) {
    assertDatabaseConfigured();
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${id}`})) IS NULL AS locked`;
      const notification = await transaction.orderNotification.findUnique({
        where: { id },
        include: {
          order: {
            select: {
              orderNumber: true,
              customerName: true,
              customerEmail: true,
              totalCents: true,
              currency: true,
              coverIncluded: true,
              priorityProcessing: true,
              createdAt: true,
            },
          },
        },
      });
      if (!notification || notification.status === "SENT") return null;
      if (notification.attempts >= MAXIMUM_NOTIFICATION_ATTEMPTS) return null;
      const staleProcessing = notification.status === "PROCESSING"
        && notification.updatedAt.getTime() < Date.now() - 10 * 60_000;
      if (notification.status === "PROCESSING" && !staleProcessing) return null;
      if (
        notification.status === "FAILED"
        && notification.updatedAt.getTime() >= Date.now() - NOTIFICATION_RETRY_DELAY_MS
      ) return null;
      await transaction.orderNotification.update({
        where: { id },
        data: { status: "PROCESSING", attempts: { increment: 1 }, lastErrorCode: null },
      });
      return {
        id: notification.id,
        kind: notification.kind,
        channel: notification.channel,
        recipient: notification.recipient,
        idempotencyKey: notification.idempotencyKey,
        order: notification.order,
      };
    }, { isolationLevel: "ReadCommitted" });
  },
  async markSent(id) {
    await prisma.orderNotification.updateMany({
      where: { id, status: "PROCESSING" },
      data: { status: "SENT", sentAt: new Date(), lastErrorCode: null },
    });
  },
  async markFailed(id, code) {
    await prisma.orderNotification.updateMany({
      where: { id, status: "PROCESSING" },
      data: { status: "FAILED", lastErrorCode: code },
    });
  },
};

function failureCode(message: OrderNotificationMessage) {
  return message.channel === "SMS" ? "SMS_PROVIDER_NOT_CONFIGURED" : "EMAIL_DELIVERY_FAILED";
}

export async function dispatchOrderNotification(
  id: string,
  dependencies: {
    repository: NotificationDispatchRepository;
    sendEmail(message: OrderNotificationMessage): Promise<void>;
  } = { repository: databaseDispatchRepository, sendEmail: sendOrderNotificationEmail },
) {
  const message = await dependencies.repository.claim(id);
  if (!message) return { delivered: false, skipped: true } as const;
  try {
    if (message.channel !== "EMAIL") throw new Error("SMS provider is not configured.");
    await dependencies.sendEmail(message);
    await dependencies.repository.markSent(id);
    return { delivered: true, skipped: false } as const;
  } catch {
    await dependencies.repository.markFailed(id, failureCode(message));
    return { delivered: false, skipped: false } as const;
  }
}

export async function dispatchPendingOrderNotifications(limit = 10) {
  assertDatabaseConfigured();
  const stale = new Date(Date.now() - 10 * 60_000);
  const retryable = new Date(Date.now() - NOTIFICATION_RETRY_DELAY_MS);
  const pending = await prisma.orderNotification.findMany({
    where: {
      OR: [
        { status: "PENDING", attempts: { lt: MAXIMUM_NOTIFICATION_ATTEMPTS } },
        { status: "FAILED", attempts: { lt: MAXIMUM_NOTIFICATION_ATTEMPTS }, updatedAt: { lt: retryable } },
        { status: "PROCESSING", attempts: { lt: MAXIMUM_NOTIFICATION_ATTEMPTS }, updatedAt: { lt: stale } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(limit, 1), 25),
    select: { id: true },
  });
  for (const notification of pending) await dispatchOrderNotification(notification.id);
}
