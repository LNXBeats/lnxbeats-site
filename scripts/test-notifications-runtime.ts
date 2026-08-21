import assert from "node:assert/strict";

import {
  databaseNotificationDispatchRepository,
  dispatchOrderNotification,
  enqueuePaymentConfirmedNotifications,
  enqueueCustomerDeliveryNotification,
  enqueueOrderNotification,
  retryNotificationManually,
} from "@/lib/notifications/service";
import { loadAndAssertNotificationQaEnvironment } from "@/lib/notifications/qa-guard";
import { processVerifiedResendWebhookEvent } from "@/lib/notifications/resend-webhook";
import type { NotificationTransportResult } from "@/lib/notifications/types";
import { prisma } from "@/lib/prisma";

const EMAIL = "lnx-v073-notifications-member@example.invalid";
const OWNER = "lnx-v073-notifications-owner@example.invalid";
const ORDER_NUMBER = "LNX-2099-073001";
const PROVIDER_EVENT_PREFIX = "svix_v073_runtime_";

async function scope() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  const order = await prisma.order.findUnique({ where: { orderNumber: ORDER_NUMBER }, select: { id: true } });
  const notificationIds = order ? (await prisma.orderNotification.findMany({ where: { orderId: order.id }, select: { id: true } })).map(({ id }) => id) : [];
  return { userId: user?.id, orderId: order?.id, notificationIds };
}

async function cleanup() {
  const current = await scope();
  await prisma.$transaction(async (transaction) => {
    await transaction.notificationEvent.deleteMany({ where: { OR: [{ providerEventId: { startsWith: PROVIDER_EVENT_PREFIX } }, ...(current.notificationIds.length ? [{ notificationId: { in: current.notificationIds } }] : [])] } });
    await transaction.notificationSuppression.deleteMany({ where: { recipient: { in: [EMAIL, OWNER] } } });
    if (current.orderId) {
      await transaction.orderNotification.deleteMany({ where: { orderId: current.orderId } });
      await transaction.orderEvent.deleteMany({ where: { orderId: current.orderId } });
      await transaction.order.delete({ where: { id: current.orderId } });
    }
    if (current.userId) await transaction.user.delete({ where: { id: current.userId } });
  });
}

async function assertClean(stage: string) {
  const [users, orders, notifications, events, suppressions] = await Promise.all([
    prisma.user.count({ where: { email: EMAIL } }),
    prisma.order.count({ where: { orderNumber: ORDER_NUMBER } }),
    prisma.orderNotification.count({ where: { order: { orderNumber: ORDER_NUMBER } } }),
    prisma.notificationEvent.count({ where: { providerEventId: { startsWith: PROVIDER_EVENT_PREFIX } } }),
    prisma.notificationSuppression.count({ where: { recipient: { in: [EMAIL, OWNER] } } }),
  ]);
  assert.deepEqual({ users, orders, notifications, events, suppressions }, { users: 0, orders: 0, notifications: 0, events: 0, suppressions: 0 }, `${stage}: fixtures remain.`);
}

async function main() {
  await loadAndAssertNotificationQaEnvironment();
  await cleanup();
  await assertClean("precondition");
  try {
    const user = await prisma.user.create({ data: { email: EMAIL, emailVerified: true, emailVerifiedAt: new Date(), displayName: "Member Notifications QA", status: "ACTIVE", role: "MEMBER" } });
    const order = await prisma.order.create({ data: { orderNumber: ORDER_NUMBER, userId: user.id, customerEmail: EMAIL, customerName: "Member Notifications QA", status: "PAYMENT_CONFIRMED", title: "Notification QA", brief: "Fixture locale et jetable.", coverIncluded: true, priorityProcessing: true, coverPriceCents: 1_000, priorityPriceCents: 3_000, totalCents: 9_000 } });

    await prisma.$transaction(async (transaction) => { await enqueuePaymentConfirmedNotifications(transaction, order.id); });
    await prisma.$transaction(async (transaction) => { await enqueuePaymentConfirmedNotifications(transaction, order.id); });
    assert.equal(await prisma.orderNotification.count({ where: { orderId: order.id } }), 2, "The same payment event must create exactly two logical notifications.");

    const ownerNotification = await prisma.orderNotification.findUniqueOrThrow({ where: { idempotencyKey: `order:${order.id}:owner-new:email` } });
    let calls = 0;
    const result: NotificationTransportResult = { provider: "CAPTURE", providerMessageId: "capture_v073_owner", deliveredImmediately: true };
    const send = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 25)); return result; };
    const concurrent = await Promise.all([
      dispatchOrderNotification(ownerNotification.id, { repository: databaseNotificationDispatchRepository, sendEmail: send }),
      dispatchOrderNotification(ownerNotification.id, { repository: databaseNotificationDispatchRepository, sendEmail: send }),
    ]);
    assert.equal(calls, 1, "Two workers sent the same notification.");
    assert.equal(concurrent.filter(({ delivered }) => delivered).length, 1);

    await prisma.$transaction(async (transaction) => { await enqueueCustomerDeliveryNotification(transaction, { id: order.id, customerEmail: EMAIL }); });
    const delivery = await prisma.orderNotification.findUniqueOrThrow({ where: { idempotencyKey: `order:${order.id}:delivery-ready:email` } });
    await dispatchOrderNotification(delivery.id, {
      repository: databaseNotificationDispatchRepository,
      sendEmail: async () => { throw Object.assign(new Error("temporary"), { statusCode: 503 }); },
    });
    const failed = await prisma.orderNotification.findUniqueOrThrow({ where: { id: delivery.id } });
    assert.equal(failed.status, "FAILED_RETRYABLE");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAYMENT_CONFIRMED");
    await retryNotificationManually(delivery.id, user.id);
    await dispatchOrderNotification(delivery.id, { repository: databaseNotificationDispatchRepository, sendEmail: async () => ({ provider: "CAPTURE", providerMessageId: "capture_v073_delivery", deliveredImmediately: true }) });
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: delivery.id } })).status, "DELIVERED");

    const clientPayment = await prisma.orderNotification.findUniqueOrThrow({ where: { idempotencyKey: `order:${order.id}:payment-confirmed:email` } });
    const sentAt = new Date();
    await prisma.orderNotification.update({ where: { id: clientPayment.id }, data: { status: "SENT", provider: "RESEND", providerMessageId: "email_v073_runtime", sentAt } });
    const deliveredEvent = { providerEventId: `${PROVIDER_EVENT_PREFIX}delivered`, type: "email.delivered", occurredAt: new Date(), providerMessageId: "email_v073_runtime", recipient: EMAIL, suppressionOrigin: null } as const;
    assert.deepEqual(await processVerifiedResendWebhookEvent(deliveredEvent), { outcome: "PROCESSED", duplicate: false });
    assert.deepEqual(await processVerifiedResendWebhookEvent(deliveredEvent), { outcome: "PROCESSED", duplicate: true });
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: clientPayment.id } })).status, "DELIVERED");

    const complainedEvent = { ...deliveredEvent, providerEventId: `${PROVIDER_EVENT_PREFIX}complained`, type: "email.complained", occurredAt: new Date(Date.now() + 1_000) } as const;
    await processVerifiedResendWebhookEvent(complainedEvent);
    const complained = await prisma.orderNotification.findUniqueOrThrow({ where: { id: clientPayment.id } });
    assert.equal(complained.status, "COMPLAINED");
    assert.equal((await prisma.notificationSuppression.findUniqueOrThrow({ where: { channel_recipient: { channel: "EMAIL", recipient: EMAIL } } })).active, true);

    const suppressionRemoved = { providerEventId: `${PROVIDER_EVENT_PREFIX}suppression-removed`, type: "suppression.removed", occurredAt: new Date(Date.now() + 2_000), providerMessageId: null, recipient: EMAIL, suppressionOrigin: "complaint" } as const;
    await processVerifiedResendWebhookEvent(suppressionRemoved);
    assert.equal((await prisma.notificationSuppression.findUniqueOrThrow({ where: { channel_recipient: { channel: "EMAIL", recipient: EMAIL } } })).active, false);

    await prisma.$transaction(async (transaction) => {
      await enqueueOrderNotification(transaction, { orderId: order.id, kind: "CUSTOMER_ORDER_ACCEPTED", recipient: EMAIL, idempotencyKey: `order:${order.id}:accepted:email` });
    });
    const accepted = await prisma.orderNotification.findUniqueOrThrow({ where: { idempotencyKey: `order:${order.id}:accepted:email` } });
    await prisma.orderNotification.update({ where: { id: accepted.id }, data: { status: "SENT", provider: "RESEND", providerMessageId: "email_v073_bounce", sentAt: new Date() } });
    const bouncedEvent = { providerEventId: `${PROVIDER_EVENT_PREFIX}bounced`, type: "email.bounced", occurredAt: new Date(Date.now() + 3_000), providerMessageId: "email_v073_bounce", recipient: EMAIL, suppressionOrigin: null } as const;
    await processVerifiedResendWebhookEvent(bouncedEvent);
    assert.equal((await prisma.orderNotification.findUniqueOrThrow({ where: { id: accepted.id } })).status, "BOUNCED");
    assert.equal((await prisma.notificationSuppression.findUniqueOrThrow({ where: { channel_recipient: { channel: "EMAIL", recipient: EMAIL } } })).reason, "HARD_BOUNCE");

    const counts = await prisma.orderNotification.groupBy({ by: ["status"], where: { orderId: order.id }, _count: { _all: true } });
    assert.ok(counts.some(({ status }) => status === "DELIVERED"));
    assert.ok(counts.some(({ status }) => status === "COMPLAINED"));
    console.info("Notification runtime QA passed: idempotence, concurrent claim, retry, delivery, bounce, complaint and suppression lifecycle.");
  } finally {
    await cleanup();
    await assertClean("cleanup");
    await prisma.$disconnect();
  }
}

await main();
