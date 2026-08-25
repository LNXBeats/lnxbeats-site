import "server-only";

import type { NotificationProvider, NotificationStatus, Prisma } from "@/generated/prisma/client";

import {
  NOTIFICATION_PRODUCTION_CONFIRMATION,
  parseNotificationConfiguration,
  type NotificationConfiguration,
} from "@/lib/notifications/config";
import {
  isFictitiousRecipient,
  isOfficialResendTestRecipient,
  PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY,
} from "@/lib/notifications/domain";
import { enqueueOrderNotification } from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export const PRODUCTION_OWNER_EMAIL_SMOKE_CONFIRMATION = "I_UNDERSTAND_THIS_SENDS_ONE_REAL_PRODUCTION_OWNER_EMAIL";
export const PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER = "LNX-TEST-PROD-OWNER-0812";
const PRODUCTION_OWNER_EMAIL_SMOKE_TITLE = "[TEST PRODUCTION] Vérification e-mail propriétaire V0.8.1.2";
const PRODUCTION_OWNER_EMAIL_SMOKE_CUSTOMER_EMAIL = "production-owner-smoke@lnx.invalid";
const PRODUCTION_OWNER_EMAIL_SMOKE_CUSTOMER_NAME = "[TEST PRODUCTION] Aucun client réel";

export type ProductionOwnerEmailSmokeStatus = Readonly<{
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

export type ProductionOwnerEmailSmokeCreation = ProductionOwnerEmailSmokeStatus & Readonly<{ created: boolean }>;

export interface ProductionOwnerEmailSmokeRepository {
  create(recipient: string): Promise<ProductionOwnerEmailSmokeCreation>;
  read(recipient: string): Promise<ProductionOwnerEmailSmokeStatus | null>;
  finalizeFailedAttempt(notificationId: string, recipient: string): Promise<void>;
}

function isReservedExampleRecipient(value: string) {
  const domain = value.toLowerCase().split("@").at(-1) ?? "";
  return ["example.com", "example.net", "example.org"].includes(domain);
}

export function assertProductionOwnerEmailSmokeEnvironment(
  environment: Record<string, string | undefined> = process.env,
): NotificationConfiguration {
  const configuration = parseNotificationConfiguration(environment);
  const recipient = configuration.ownerRecipient;
  if (
    environment.NODE_ENV !== "production"
    || environment.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() !== "production"
    || environment.NOTIFICATION_DEPLOYMENT_ENV !== "production"
    || environment.NOTIFICATION_EMAIL_TRANSPORT !== "resend"
    || environment.EMAIL_NOTIFICATIONS_ENABLED !== "true"
    || environment.OWNER_EMAIL_NOTIFICATIONS_ENABLED !== "true"
    || environment.CLIENT_EMAIL_NOTIFICATIONS_ENABLED !== "false"
    || environment.NOTIFICATION_WORKER_ENABLED !== "false"
    || environment.NOTIFICATION_SCHEDULER_MODE !== "disabled"
    || environment.PAYMENTS_ENABLED !== "false"
    || environment.SMS_TRANSPORT !== "disabled"
    || environment.SMS_NOTIFICATIONS_ENABLED !== "false"
    || environment.NOTIFICATION_PRODUCTION_CONFIRM !== NOTIFICATION_PRODUCTION_CONFIRMATION
    || environment.NOTIFICATION_PRODUCTION_OWNER_SMOKE_CONFIRM !== PRODUCTION_OWNER_EMAIL_SMOKE_CONFIRMATION
    || configuration.deploymentEnvironment !== "production"
    || configuration.emailTransport !== "resend"
    || !configuration.emailEnabled
    || !configuration.ownerEmailEnabled
    || configuration.clientEmailEnabled
    || configuration.workerEnabled
    || configuration.smsTransport !== "disabled"
    || configuration.smsEnabled
    || !configuration.emailConfigured
    || !configuration.webhookConfigured
    || !configuration.workerConfigured
    || !configuration.resendApiKey
    || !configuration.resendWebhookSecret
    || !configuration.emailFrom
    || !configuration.emailReplyTo
    || !configuration.canonicalUrl
    || !recipient
    || isFictitiousRecipient(recipient)
    || isReservedExampleRecipient(recipient)
    || isOfficialResendTestRecipient(recipient)
    || recipient.endsWith("@resend.dev")
  ) {
    throw new Error("Production owner email smoke test is unavailable.");
  }
  return configuration;
}

export function productionOwnerEmailSmokeOrderData(cancelledAt: Date = new Date()): Prisma.OrderCreateInput {
  return {
    orderNumber: PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER,
    customerEmail: PRODUCTION_OWNER_EMAIL_SMOKE_CUSTOMER_EMAIL,
    customerName: PRODUCTION_OWNER_EMAIL_SMOKE_CUSTOMER_NAME,
    status: "CANCELLED",
    title: PRODUCTION_OWNER_EMAIL_SMOKE_TITLE,
    brief: "Fixture synthétique réservée à un unique test e-mail propriétaire Production. Aucun client et aucun paiement réel.",
    basePriceCents: 0,
    coverPriceCents: 0,
    priorityPriceCents: 0,
    totalCents: 0,
    pricingVersion: "production-owner-smoke-v0812",
    cancelledAt,
  };
}

type ProductionOwnerSmokeIdentity = Readonly<{
  recipient: string | null;
  kind: string;
  channel: string;
  idempotencyKey: string;
  resourceType: string;
  resourceReference: string | null;
  deploymentEnvironment: string;
  order: Readonly<{
    orderNumber: string;
    userId: string | null;
    customerId: string | null;
    status: string;
    customerEmail: string;
    customerName: string | null;
    title: string | null;
    basePriceCents: number;
    coverPriceCents: number;
    priorityPriceCents: number;
    totalCents: number;
    pricingVersion: string;
    cancelledAt: Date | null;
    _count: Readonly<{ payments: number; notifications: number }>;
  }>;
}>;

function assertProductionOwnerSmokeIdentity(recipient: string, fixture: ProductionOwnerSmokeIdentity) {
  if (
    fixture.recipient !== recipient
    || fixture.kind !== "OWNER_NEW_ORDER"
    || fixture.channel !== "EMAIL"
    || fixture.idempotencyKey !== PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY
    || fixture.resourceType !== "ORDER"
    || fixture.resourceReference !== PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER
    || fixture.deploymentEnvironment !== "production"
    || fixture.order.orderNumber !== PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER
    || fixture.order.userId !== null
    || fixture.order.customerId !== null
    || fixture.order.status !== "CANCELLED"
    || fixture.order.customerEmail !== PRODUCTION_OWNER_EMAIL_SMOKE_CUSTOMER_EMAIL
    || fixture.order.customerName !== PRODUCTION_OWNER_EMAIL_SMOKE_CUSTOMER_NAME
    || fixture.order.title !== PRODUCTION_OWNER_EMAIL_SMOKE_TITLE
    || fixture.order.basePriceCents !== 0
    || fixture.order.coverPriceCents !== 0
    || fixture.order.priorityPriceCents !== 0
    || fixture.order.totalCents !== 0
    || fixture.order.pricingVersion !== "production-owner-smoke-v0812"
    || fixture.order.cancelledAt === null
    || fixture.order._count.payments !== 0
    || fixture.order._count.notifications !== 1
  ) {
    throw new Error("Production owner email smoke fixture identity mismatch.");
  }
}

const identitySelect = {
  recipient: true,
  kind: true,
  channel: true,
  idempotencyKey: true,
  resourceType: true,
  resourceReference: true,
  deploymentEnvironment: true,
  order: {
    select: {
      orderNumber: true,
      userId: true,
      customerId: true,
      status: true,
      customerEmail: true,
      customerName: true,
      title: true,
      basePriceCents: true,
      coverPriceCents: true,
      priorityPriceCents: true,
      totalCents: true,
      pricingVersion: true,
      cancelledAt: true,
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
}, suppressionActive: boolean): ProductionOwnerEmailSmokeStatus {
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

async function readProductionOwnerSmoke(recipient: string): Promise<ProductionOwnerEmailSmokeStatus | null> {
  const notification = await prisma.orderNotification.findUnique({
    where: { idempotencyKey: PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY },
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
  assertProductionOwnerSmokeIdentity(recipient, notification);
  const suppression = await prisma.notificationSuppression.findUnique({
    where: { channel_recipient: { channel: "EMAIL", recipient } },
    select: { active: true },
  });
  return statusResult(notification, suppression?.active ?? false);
}

export const databaseProductionOwnerEmailSmokeRepository: ProductionOwnerEmailSmokeRepository = {
  async create(recipient) {
    assertDatabaseConfigured();
    const creation = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"notifications:production-owner-email-smoke:v0812"})) IS NULL AS locked`;
      const current = await transaction.orderNotification.findUnique({
        where: { idempotencyKey: PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY },
        select: { ...identitySelect, id: true },
      });
      if (current) {
        assertProductionOwnerSmokeIdentity(recipient, current);
        return { created: false, notificationId: current.id };
      }

      const existingOrder = await transaction.order.findUnique({
        where: { orderNumber: PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER },
        select: {
          id: true,
          orderNumber: true,
          userId: true,
          customerId: true,
          status: true,
          customerEmail: true,
          customerName: true,
          title: true,
          basePriceCents: true,
          coverPriceCents: true,
          priorityPriceCents: true,
          totalCents: true,
          pricingVersion: true,
          cancelledAt: true,
          _count: { select: { payments: true, notifications: true } },
        },
      });
      if (existingOrder && (
        existingOrder.userId !== null
        || existingOrder.customerId !== null
        || existingOrder.status !== "CANCELLED"
        || existingOrder.customerEmail !== PRODUCTION_OWNER_EMAIL_SMOKE_CUSTOMER_EMAIL
        || existingOrder.customerName !== PRODUCTION_OWNER_EMAIL_SMOKE_CUSTOMER_NAME
        || existingOrder.title !== PRODUCTION_OWNER_EMAIL_SMOKE_TITLE
        || existingOrder.basePriceCents !== 0
        || existingOrder.coverPriceCents !== 0
        || existingOrder.priorityPriceCents !== 0
        || existingOrder.totalCents !== 0
        || existingOrder.pricingVersion !== "production-owner-smoke-v0812"
        || existingOrder.cancelledAt === null
        || existingOrder._count.payments !== 0
        || existingOrder._count.notifications !== 0
      )) {
        throw new Error("Production owner email smoke Order identity mismatch.");
      }
      const order = existingOrder ?? await transaction.order.create({
        data: productionOwnerEmailSmokeOrderData(),
        select: { id: true },
      });
      const notification = await enqueueOrderNotification(transaction, {
        orderId: order.id,
        kind: "OWNER_NEW_ORDER",
        recipient,
        idempotencyKey: PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY,
        resource: {
          type: "ORDER",
          id: order.id,
          reference: PRODUCTION_OWNER_EMAIL_SMOKE_ORDER_NUMBER,
          workTitle: PRODUCTION_OWNER_EMAIL_SMOKE_TITLE,
        },
      });
      await transaction.notificationEvent.create({
        data: {
          notificationId: notification.id,
          outcome: "PROCESSED",
          code: "PRODUCTION_OWNER_SMOKE_CREATED",
          occurredAt: new Date(),
        },
      });
      return { created: true, notificationId: notification.id };
    }, { isolationLevel: "ReadCommitted" });
    const status = await readProductionOwnerSmoke(recipient);
    if (!status || status.notificationId !== creation.notificationId) {
      throw new Error("Production owner email smoke fixture is unavailable.");
    }
    return { created: creation.created, ...status };
  },

  async read(recipient) {
    assertDatabaseConfigured();
    return readProductionOwnerSmoke(recipient);
  },

  async finalizeFailedAttempt(notificationId, recipient) {
    assertDatabaseConfigured();
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${notificationId}`})) IS NULL AS locked`;
      const notification = await transaction.orderNotification.findUnique({
        where: { id: notificationId },
        select: { ...identitySelect, status: true },
      });
      if (!notification) throw new Error("Production owner email smoke notification is unavailable.");
      assertProductionOwnerSmokeIdentity(recipient, notification);
      if (notification.status !== "FAILED_RETRYABLE") return;
      const updated = await transaction.orderNotification.updateMany({
        where: { id: notificationId, status: "FAILED_RETRYABLE" },
        data: {
          status: "FAILED_FINAL",
          availableAt: new Date(),
          processingStartedAt: null,
          leaseExpiresAt: null,
          lastErrorCode: "PRODUCTION_OWNER_SMOKE_ONE_SHOT_FAILED",
          lastErrorMessage: "Le test propriétaire Production one-shot a échoué et ne sera jamais retenté automatiquement.",
        },
      });
      if (updated.count !== 1) throw new Error("Production owner email smoke failure state changed concurrently.");
      await transaction.notificationEvent.create({
        data: {
          notificationId,
          outcome: "REQUIRES_REVIEW",
          code: "PRODUCTION_OWNER_SMOKE_ONE_SHOT_FAILED",
          occurredAt: new Date(),
        },
      });
    }, { isolationLevel: "ReadCommitted" });
  },
};
