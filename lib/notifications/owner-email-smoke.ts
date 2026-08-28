import "server-only";

import type { NotificationProvider, NotificationStatus, Prisma } from "@/generated/prisma/client";

import { parseNotificationConfiguration, type NotificationConfiguration } from "@/lib/notifications/config";
import {
  isFictitiousRecipient,
  isOfficialResendTestRecipient,
  OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY,
} from "@/lib/notifications/domain";
import { enqueueOrderNotification } from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export const OWNER_EMAIL_SMOKE_CONFIRMATION = "I_UNDERSTAND_THIS_SENDS_ONE_REAL_OWNER_EMAIL";
export const OWNER_EMAIL_SMOKE_ORDER_NUMBER = "LNX-QA-OWNER-SMOKE-01";
const OWNER_EMAIL_SMOKE_TITLE = "[TEST] Owner email smoke test V0.7.3.2";
const OWNER_EMAIL_SMOKE_CUSTOMER_EMAIL = "owner-smoke-test@lnx.invalid";

export type OwnerEmailSmokeStatus = Readonly<{
  notificationId: string;
  status: NotificationStatus;
  attempts: number;
  provider: NotificationProvider | null;
  providerMessageIdPresent: boolean;
  sentAtPresent: boolean;
  deliveredAtPresent: boolean;
  failedAtPresent: boolean;
  lastErrorCode: string | null;
  eventTypes: readonly string[];
  suppressionActive: boolean;
}>;

export type OwnerEmailSmokeCreation = OwnerEmailSmokeStatus & Readonly<{ created: boolean }>;

export interface OwnerEmailSmokeRepository {
  create(recipient: string): Promise<OwnerEmailSmokeCreation>;
  read(recipient: string): Promise<OwnerEmailSmokeStatus | null>;
  finalizeFailedAttempt(notificationId: string, recipient: string): Promise<void>;
}

export function assertOwnerEmailSmokeEnvironment(
  environment: Record<string, string | undefined> = process.env,
): NotificationConfiguration {
  const configuration = parseNotificationConfiguration(environment);
  const recipient = configuration.ownerRecipient;
  if (
    environment.NODE_ENV !== "production"
    || environment.RAILWAY_ENVIRONMENT_NAME !== "staging"
    || /production/i.test(environment.RAILWAY_ENVIRONMENT ?? "")
    || environment.NOTIFICATION_DEPLOYMENT_ENV !== "staging"
    || environment.NOTIFICATION_EMAIL_TRANSPORT !== "resend"
    || environment.NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM !== OWNER_EMAIL_SMOKE_CONFIRMATION
    || environment.NOTIFICATION_STAGING_QA_CONFIRM !== undefined
    || environment.EMAIL_NOTIFICATIONS_ENABLED !== "true"
    || environment.OWNER_EMAIL_NOTIFICATIONS_ENABLED !== "true"
    || environment.CLIENT_EMAIL_NOTIFICATIONS_ENABLED !== "false"
    || environment.PAYMENTS_ENABLED !== "false"
    || environment.SMS_TRANSPORT !== "disabled"
    || environment.SMS_NOTIFICATIONS_ENABLED !== "false"
    || configuration.deploymentEnvironment !== "staging"
    || configuration.emailTransport !== "resend"
    || !configuration.emailEnabled
    || !configuration.ownerEmailEnabled
    || configuration.clientEmailEnabled
    || configuration.smsTransport !== "disabled"
    || configuration.smsEnabled
    || !configuration.workerConfigured
    || !recipient
    || isFictitiousRecipient(recipient)
    || isOfficialResendTestRecipient(recipient)
  ) {
    throw new Error("Owner email smoke test is unavailable.");
  }
  return configuration;
}

export function ownerEmailSmokeOrderData(cancelledAt: Date = new Date()): Prisma.OrderCreateInput {
  return {
    orderNumber: OWNER_EMAIL_SMOKE_ORDER_NUMBER,
    customerEmail: OWNER_EMAIL_SMOKE_CUSTOMER_EMAIL,
    customerName: "Smoke test propriétaire [TEST]",
    status: "CANCELLED",
    title: OWNER_EMAIL_SMOKE_TITLE,
    brief: "Fixture synthétique V0.7.3.2 réservée à un unique test e-mail propriétaire staging.",
    basePriceCents: 0,
    coverPriceCents: 0,
    priorityPriceCents: 0,
    totalCents: 0,
    pricingVersion: "qa-owner-smoke-v0732",
    cancelledAt,
  };
}

type OwnerSmokeIdentity = Readonly<{
  recipient: string | null;
  kind: string;
  channel: string;
  idempotencyKey: string;
  order: Readonly<{
    orderNumber: string;
    userId: string | null;
    customerId: string | null;
    status: string;
    customerEmail: string;
    title: string | null;
    _count: Readonly<{ payments: number; notifications: number }>;
  }> | null;
}>;

function assertOwnerSmokeIdentity(recipient: string, fixture: OwnerSmokeIdentity) {
  if (
    fixture.recipient !== recipient
    || fixture.kind !== "OWNER_NEW_ORDER"
    || fixture.channel !== "EMAIL"
    || fixture.idempotencyKey !== OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY
    || !fixture.order
    || fixture.order.orderNumber !== OWNER_EMAIL_SMOKE_ORDER_NUMBER
    || fixture.order.userId !== null
    || fixture.order.customerId !== null
    || fixture.order.status !== "CANCELLED"
    || fixture.order.customerEmail !== OWNER_EMAIL_SMOKE_CUSTOMER_EMAIL
    || fixture.order.title !== OWNER_EMAIL_SMOKE_TITLE
    || fixture.order._count.payments !== 0
    || fixture.order._count.notifications !== 1
  ) {
    throw new Error("Owner email smoke fixture identity mismatch.");
  }
}

const identitySelect = {
  recipient: true,
  kind: true,
  channel: true,
  idempotencyKey: true,
  order: {
    select: {
      orderNumber: true,
      userId: true,
      customerId: true,
      status: true,
      customerEmail: true,
      title: true,
      _count: { select: { payments: true, notifications: true } },
    },
  },
} satisfies Prisma.OrderNotificationSelect;

function statusResult(notification: {
  id: string;
  status: NotificationStatus;
  attempts: number;
  provider: NotificationProvider | null;
  providerMessageId: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  lastErrorCode: string | null;
  events: readonly { providerEventType: string | null }[];
}, suppressionActive: boolean): OwnerEmailSmokeStatus {
  return {
    notificationId: notification.id,
    status: notification.status,
    attempts: notification.attempts,
    provider: notification.provider,
    providerMessageIdPresent: notification.providerMessageId !== null,
    sentAtPresent: notification.sentAt !== null,
    deliveredAtPresent: notification.deliveredAt !== null,
    failedAtPresent: notification.failedAt !== null,
    lastErrorCode: notification.lastErrorCode,
    eventTypes: notification.events.flatMap(({ providerEventType }) => providerEventType ? [providerEventType] : []),
    suppressionActive,
  };
}

async function readOwnerSmoke(recipient: string): Promise<OwnerEmailSmokeStatus | null> {
  const notification = await prisma.orderNotification.findUnique({
    where: { idempotencyKey: OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY },
    select: {
      ...identitySelect,
      id: true,
      status: true,
      attempts: true,
      provider: true,
      providerMessageId: true,
      sentAt: true,
      deliveredAt: true,
      failedAt: true,
      lastErrorCode: true,
      events: {
        where: { providerEventType: { not: null } },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { providerEventType: true },
      },
    },
  });
  if (!notification) return null;
  assertOwnerSmokeIdentity(recipient, notification);
  const suppression = await prisma.notificationSuppression.findUnique({
    where: { channel_recipient: { channel: "EMAIL", recipient } },
    select: { active: true },
  });
  return statusResult(notification, suppression?.active ?? false);
}

export const databaseOwnerEmailSmokeRepository: OwnerEmailSmokeRepository = {
  async create(recipient) {
    assertDatabaseConfigured();
    const creation = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"notifications:owner-email-smoke:v0732"})) IS NULL AS locked`;
      const current = await transaction.orderNotification.findUnique({
        where: { idempotencyKey: OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY },
        select: { ...identitySelect, id: true, status: true },
      });
      if (current) {
        assertOwnerSmokeIdentity(recipient, current);
        return { created: false, notificationId: current.id };
      }

      const existingOrder = await transaction.order.findUnique({
        where: { orderNumber: OWNER_EMAIL_SMOKE_ORDER_NUMBER },
        select: {
          id: true,
          orderNumber: true,
          userId: true,
          customerId: true,
          status: true,
          customerEmail: true,
          title: true,
          _count: { select: { payments: true, notifications: true } },
        },
      });
      if (existingOrder && (
        existingOrder.userId !== null
        || existingOrder.customerId !== null
        || existingOrder.status !== "CANCELLED"
        || existingOrder.customerEmail !== OWNER_EMAIL_SMOKE_CUSTOMER_EMAIL
        || existingOrder.title !== OWNER_EMAIL_SMOKE_TITLE
        || existingOrder._count.payments !== 0
        || existingOrder._count.notifications !== 0
      )) {
        throw new Error("Owner email smoke Order identity mismatch.");
      }
      const order = existingOrder ?? await transaction.order.create({
        data: ownerEmailSmokeOrderData(),
        select: { id: true },
      });
      const notification = await enqueueOrderNotification(transaction, {
        orderId: order.id,
        kind: "OWNER_NEW_ORDER",
        recipient,
        idempotencyKey: OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY,
        resource: {
          type: "ORDER",
          id: order.id,
          reference: OWNER_EMAIL_SMOKE_ORDER_NUMBER,
          workTitle: OWNER_EMAIL_SMOKE_TITLE,
        },
      });
      return { created: true, notificationId: notification.id };
    }, { isolationLevel: "ReadCommitted" });
    const status = await readOwnerSmoke(recipient);
    if (!status || status.notificationId !== creation.notificationId) throw new Error("Owner email smoke fixture is unavailable.");
    return { created: creation.created, ...status };
  },

  async read(recipient) {
    assertDatabaseConfigured();
    return readOwnerSmoke(recipient);
  },

  async finalizeFailedAttempt(notificationId, recipient) {
    assertDatabaseConfigured();
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${notificationId}`})) IS NULL AS locked`;
      const notification = await transaction.orderNotification.findUnique({
        where: { id: notificationId },
        select: { ...identitySelect, status: true },
      });
      if (!notification) throw new Error("Owner email smoke notification is unavailable.");
      assertOwnerSmokeIdentity(recipient, notification);
      if (notification.status !== "FAILED_RETRYABLE") return;
      const updated = await transaction.orderNotification.updateMany({
        where: { id: notificationId, status: "FAILED_RETRYABLE" },
        data: {
          status: "FAILED_FINAL",
          availableAt: new Date(),
          lastErrorCode: "OWNER_SMOKE_ONE_SHOT_FAILED",
          lastErrorMessage: "Le test propriétaire one-shot a échoué et ne sera pas retenté automatiquement.",
        },
      });
      if (updated.count !== 1) throw new Error("Owner email smoke failure state changed concurrently.");
      await transaction.notificationEvent.create({
        data: {
          notificationId,
          outcome: "REQUIRES_REVIEW",
          code: "OWNER_SMOKE_ONE_SHOT_FAILED",
          occurredAt: new Date(),
        },
      });
    }, { isolationLevel: "ReadCommitted" });
  },
};
