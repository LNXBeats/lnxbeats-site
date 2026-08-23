import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { parseNotificationConfiguration } from "@/lib/notifications/config";
import {
  classifyNotificationFailure,
  manualRetryAllowed,
  MAXIMUM_NOTIFICATION_ATTEMPTS,
  NOTIFICATION_LEASE_MS,
  NOTIFICATION_PAYLOAD_VERSION,
  NOTIFICATION_TEMPLATE_VERSION,
  notificationBackoffMs,
  notificationDefinition,
  OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY,
  normalizeNotificationRecipient,
  parseNotificationPayload,
  recipientHash,
} from "@/lib/notifications/domain";
import { sendOrderNotificationEmail } from "@/lib/notifications/email";
import {
  applyResendWebhookNotificationEvent,
  resendWebhookEventCode,
  unmatchedResendWebhookEventCode,
  type ResendBounceType,
  type ResendWebhookEventType,
  type VerifiedResendWebhookEvent,
  type WebhookNotification,
} from "@/lib/notifications/resend-webhook";
import type {
  NotificationFailure,
  NotificationTransportResult,
  OrderNotificationKind,
  OrderNotificationMessage,
} from "@/lib/notifications/types";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;

export const ownerNewOrderNotificationKey = (orderId: string) => `order:${orderId}:owner-new:email`;
export const customerPaymentNotificationKey = (orderId: string) => `order:${orderId}:payment-confirmed:email`;
export const customerDeliveryNotificationKey = (orderId: string) => `order:${orderId}:delivery-ready:email`;

function notificationEnvironmentSnapshot() {
  const value = process.env.NOTIFICATION_DEPLOYMENT_ENV?.trim().toLowerCase();
  return value === "development" || value === "staging" || value === "production"
    ? value
    : process.env.NODE_ENV === "production" ? "production" : "development";
}

function notificationRecipientSnapshot(value: string | null | undefined) {
  if (!value) return null;
  try {
    return normalizeNotificationRecipient(value);
  } catch {
    return null;
  }
}

type ResourceSnapshot = Readonly<{
  type?: "ORDER" | "RIGHTS_REQUEST";
  id?: string | null;
  reference?: string | null;
  workTitle?: string;
  rightsRequestNumber?: string;
  rightsRequestType?: "PUBLICATION_LICENSE" | "EXPLOITATION_PARTNERSHIP";
  requestedPriceCents?: number;
  refundAmountCents?: number;
}>;

export async function enqueueOrderNotification(
  transaction: Transaction,
  input: Readonly<{
    orderId: string;
    kind: OrderNotificationKind;
    recipient: string | null;
    idempotencyKey: string;
    resource?: ResourceSnapshot;
  }>,
) {
  const definition = notificationDefinition(input.kind);
  const order = await transaction.order.findUniqueOrThrow({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      customerEmail: true,
      totalCents: true,
      currency: true,
      coverIncluded: true,
      priorityProcessing: true,
      createdAt: true,
      title: true,
    },
  });
  const workTitle = input.resource?.workTitle ?? order.title;
  const payload = {
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    totalCents: order.totalCents,
    currency: order.currency,
    coverIncluded: order.coverIncluded,
    priorityProcessing: order.priorityProcessing,
    createdAt: order.createdAt.toISOString(),
    ...(workTitle ? { workTitle } : {}),
    ...(input.resource?.rightsRequestNumber ? {
      rightsRequestNumber: input.resource.rightsRequestNumber,
      rightsRequestType: input.resource.rightsRequestType,
      requestedPriceCents: input.resource.requestedPriceCents,
    } : {}),
    ...(input.resource?.refundAmountCents ? { refundAmountCents: input.resource.refundAmountCents } : {}),
  } satisfies Prisma.InputJsonObject;
  const recipient = notificationRecipientSnapshot(input.recipient);
  const resourceType = input.resource?.type ?? "ORDER";
  const resourceId = input.resource?.id ?? order.id;
  const resourceReference = input.resource?.reference ?? order.orderNumber;
  const notification = await transaction.orderNotification.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      orderId: order.id,
      kind: input.kind,
      channel: "EMAIL",
      priority: definition.priority,
      recipient,
      idempotencyKey: input.idempotencyKey,
      templateKey: definition.templateKey,
      templateVersion: NOTIFICATION_TEMPLATE_VERSION,
      payloadVersion: NOTIFICATION_PAYLOAD_VERSION,
      payload,
      resourceType,
      resourceId,
      resourceReference,
      deploymentEnvironment: notificationEnvironmentSnapshot(),
    },
    select: { id: true, orderId: true, kind: true, channel: true, resourceType: true, resourceId: true },
  });
  if (
    notification.orderId !== order.id
    || notification.kind !== input.kind
    || notification.channel !== "EMAIL"
    || notification.resourceType !== resourceType
    || notification.resourceId !== resourceId
  ) throw new Error("Notification idempotency key is already assigned to another logical event.");
  return { id: notification.id };
}

export function enqueueOwnerNewOrderNotification(transaction: Transaction, orderId: string) {
  return enqueueOrderNotification(transaction, {
    orderId,
    kind: "OWNER_NEW_ORDER",
    recipient: process.env.EMAIL_OWNER_RECIPIENT?.trim().toLowerCase() || null,
    idempotencyKey: ownerNewOrderNotificationKey(orderId),
  });
}

export async function enqueuePaymentConfirmedNotifications(transaction: Transaction, orderId: string) {
  const order = await transaction.order.findUniqueOrThrow({ where: { id: orderId }, select: { customerEmail: true } });
  await enqueueOwnerNewOrderNotification(transaction, orderId);
  await enqueueOrderNotification(transaction, {
    orderId,
    kind: "CUSTOMER_PAYMENT_CONFIRMED",
    recipient: order.customerEmail,
    idempotencyKey: customerPaymentNotificationKey(orderId),
  });
}

export function enqueueCustomerDeliveryNotification(transaction: Transaction, order: { id: string; customerEmail: string }) {
  return enqueueOrderNotification(transaction, {
    orderId: order.id,
    kind: "CUSTOMER_DELIVERY_READY",
    recipient: order.customerEmail,
    idempotencyKey: customerDeliveryNotificationKey(order.id),
  });
}

export interface NotificationDispatchRepository {
  claim(id: string): Promise<OrderNotificationMessage | null>;
  markSent(id: string, result: NotificationTransportResult): Promise<void>;
  markFailed(id: string, failure: NotificationFailure): Promise<void>;
}

const EARLY_RESEND_MESSAGE_EVENT_TYPES = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
] as const satisfies readonly ResendWebhookEventType[];
type EarlyResendMessageEventType = (typeof EARLY_RESEND_MESSAGE_EVENT_TYPES)[number];

function earlyBounceType(code: string | null): ResendBounceType | null {
  if (code?.includes("EMAIL_BOUNCED_PERMANENT")) return "Permanent";
  if (code?.includes("EMAIL_BOUNCED_TRANSIENT")) return "Transient";
  if (code?.includes("EMAIL_BOUNCED_UNDETERMINED")) return "Undetermined";
  return null;
}

function logNotification(event: string, fields: Record<string, string | number | boolean | null>) {
  console.info(JSON.stringify({ event, ...fields }));
}

export const databaseNotificationDispatchRepository: NotificationDispatchRepository = {
  async claim(id) {
    assertDatabaseConfigured();
    const runtimeEnvironment = parseNotificationConfiguration().deploymentEnvironment;
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${id}`})) IS NULL AS locked`;
      const now = new Date();
      const notification = await transaction.orderNotification.findUnique({
        where: { id },
        include: {
          order: {
            select: {
              orderNumber: true, customerName: true, customerEmail: true, totalCents: true, currency: true,
              coverIncluded: true, priorityProcessing: true, createdAt: true,
            },
          },
        },
      });
      if (!notification) return null;
      if (notification.deploymentEnvironment !== runtimeEnvironment) return null;
      const claimable = notification.status === "PENDING"
        || notification.status === "FAILED_RETRYABLE"
        || (notification.status === "PROCESSING" && notification.leaseExpiresAt !== null && notification.leaseExpiresAt <= now);
      if (!claimable || notification.availableAt > now) return null;
      if (notification.attempts >= MAXIMUM_NOTIFICATION_ATTEMPTS) {
        await transaction.orderNotification.update({
          where: { id },
          data: {
            status: "FAILED_FINAL", failedAt: notification.failedAt ?? now,
            processingStartedAt: null, leaseExpiresAt: null,
            lastErrorCode: notification.lastErrorCode ?? "ATTEMPTS_EXHAUSTED",
            lastErrorMessage: "Le nombre maximal de tentatives est atteint.",
          },
        });
        await transaction.notificationEvent.create({
          data: { notificationId: id, outcome: "REQUIRES_REVIEW", code: "ATTEMPTS_EXHAUSTED", occurredAt: now },
        });
        return null;
      }
      if (notification.recipient) {
        const suppression = await transaction.notificationSuppression.findUnique({
          where: { channel_recipient: { channel: notification.channel, recipient: notification.recipient } },
          select: { active: true },
        });
        if (suppression?.active) {
          await transaction.orderNotification.update({
            where: { id },
            data: {
              status: "SUPPRESSED", failedAt: now, processingStartedAt: null, leaseExpiresAt: null,
              lastErrorCode: "RECIPIENT_SUPPRESSED", lastErrorMessage: "L’adresse destinataire est supprimée.",
            },
          });
          await transaction.notificationEvent.create({
            data: { notificationId: id, outcome: "REQUIRES_REVIEW", code: "RECIPIENT_SUPPRESSED", occurredAt: now },
          });
          return null;
        }
      }
      let payload;
      try {
        payload = parseNotificationPayload(notification.payload);
      } catch {
        await transaction.orderNotification.update({
          where: { id },
          data: {
            status: "FAILED_FINAL", failedAt: now, processingStartedAt: null, leaseExpiresAt: null,
            lastErrorCode: "INVALID_PAYLOAD", lastErrorMessage: "Le snapshot de notification est invalide.",
          },
        });
        await transaction.notificationEvent.create({
          data: { notificationId: id, outcome: "REQUIRES_REVIEW", code: "INVALID_PAYLOAD", occurredAt: now },
        });
        return null;
      }
      const claimed = await transaction.orderNotification.updateMany({
        where: { id, status: notification.status, updatedAt: notification.updatedAt },
        data: {
          status: "PROCESSING",
          attempts: { increment: 1 },
          processingStartedAt: now,
          leaseExpiresAt: new Date(now.getTime() + NOTIFICATION_LEASE_MS),
          failedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (claimed.count !== 1) return null;
      await transaction.notificationEvent.create({
        data: {
          notificationId: id,
          outcome: "PROCESSED",
          code: notification.status === "PROCESSING" ? "EXPIRED_LEASE_RECLAIMED" : "DISPATCH_CLAIMED",
          occurredAt: now,
        },
      });
      return {
        id: notification.id,
        kind: notification.kind,
        channel: notification.channel,
        priority: notification.priority,
        recipient: notification.recipient,
        idempotencyKey: notification.idempotencyKey,
        templateKey: notification.templateKey,
        templateVersion: notification.templateVersion,
        payloadVersion: notification.payloadVersion,
        payload,
        resourceType: notification.resourceType,
        resourceId: notification.resourceId,
        resourceReference: notification.resourceReference,
        deploymentEnvironment: notification.deploymentEnvironment as OrderNotificationMessage["deploymentEnvironment"],
        order: notification.order,
      };
    }, { isolationLevel: "ReadCommitted" });
  },
  async markSent(id, result) {
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      if (result.provider === "RESEND" && result.providerMessageId) {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:webhook:message:${result.providerMessageId}`})) IS NULL AS locked`;
      }
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${id}`})) IS NULL AS locked`;
      const notification = await transaction.orderNotification.findUnique({
        where: { id },
        select: {
          status: true,
          recipient: true,
          deploymentEnvironment: true,
          sentAt: true,
          deliveredAt: true,
          failedAt: true,
          lastErrorCode: true,
          lastErrorMessage: true,
        },
      });
      if (!notification || notification.status !== "PROCESSING") throw new Error("Notification claim is no longer current.");

      const earlyCandidates = result.provider === "RESEND" && result.providerMessageId
        ? await transaction.notificationEvent.findMany({
          where: {
            providerMessageId: result.providerMessageId,
            providerEventType: { in: [...EARLY_RESEND_MESSAGE_EVENT_TYPES] },
            notificationId: null,
            outcome: "REQUIRES_REVIEW",
            code: { startsWith: `UNMATCHED_${notification.deploymentEnvironment.toUpperCase()}_` },
          },
          orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          take: 50,
          select: { id: true, providerEventId: true, providerEventType: true, occurredAt: true, code: true },
        })
        : [];
      const earlyEvents = notification.recipient ? earlyCandidates.flatMap((candidate) => {
        if (!candidate.providerEventId || !EARLY_RESEND_MESSAGE_EVENT_TYPES.includes(candidate.providerEventType as EarlyResendMessageEventType)) return [];
        const event: VerifiedResendWebhookEvent = {
          providerEventId: candidate.providerEventId,
          type: candidate.providerEventType as EarlyResendMessageEventType,
          occurredAt: candidate.occurredAt,
          providerMessageId: result.providerMessageId,
          recipient: notification.recipient,
          suppressionOrigin: null,
          bounceType: earlyBounceType(candidate.code),
          bounceSubType: null,
          deploymentEnvironment: notification.deploymentEnvironment as OrderNotificationMessage["deploymentEnvironment"],
        };
        return candidate.code === unmatchedResendWebhookEventCode(event, notification.recipient)
          ? [{ id: candidate.id, event }]
          : [];
      }) : [];

      let reconciledState: WebhookNotification = {
        status: notification.status,
        sentAt: notification.sentAt,
        deliveredAt: notification.deliveredAt,
        failedAt: notification.failedAt,
        lastErrorCode: notification.lastErrorCode,
        lastErrorMessage: notification.lastErrorMessage,
      };
      const reconciledEvents: Array<{ id: string; code: string; outcome: "PROCESSED" | "IGNORED" }> = [];
      for (const earlyEvent of earlyEvents) {
        const applied = applyResendWebhookNotificationEvent(reconciledState, earlyEvent.event);
        reconciledState = applied.notification;
        reconciledEvents.push({
          id: earlyEvent.id,
          outcome: applied.outcome,
          code: `${resendWebhookEventCode(earlyEvent.event)}_${applied.outcome === "PROCESSED" ? "RECONCILED" : "IGNORED"}`.slice(0, 80),
        });
      }
      if (result.deliveredImmediately) {
        reconciledState = {
          status: "DELIVERED",
          sentAt: now,
          deliveredAt: now,
          failedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        };
      } else if (reconciledState.status === "PROCESSING") {
        reconciledState = { ...reconciledState, status: "SENT", sentAt: now };
      }
      const updated = await transaction.orderNotification.updateMany({
        where: { id, status: "PROCESSING" },
        data: {
          status: reconciledState.status,
          provider: result.provider,
          providerMessageId: result.providerMessageId,
          sentAt: reconciledState.sentAt ?? now,
          deliveredAt: reconciledState.deliveredAt,
          processingStartedAt: null,
          leaseExpiresAt: null,
          failedAt: reconciledState.failedAt,
          lastErrorCode: reconciledState.lastErrorCode,
          lastErrorMessage: reconciledState.lastErrorMessage ?? null,
        },
      });
      if (updated.count !== 1) throw new Error("Notification claim is no longer current.");
      for (const earlyEvent of reconciledEvents) {
        await transaction.notificationEvent.update({
          where: { id: earlyEvent.id },
          data: { notificationId: id, outcome: earlyEvent.outcome, code: earlyEvent.code },
        });
      }
      await transaction.notificationEvent.create({
        data: {
          notificationId: id, providerMessageId: result.providerMessageId,
          outcome: "PROCESSED",
          code: result.deliveredImmediately ? "CAPTURE_DELIVERED" : earlyEvents.length ? "PROVIDER_ACCEPTED_AFTER_WEBHOOK" : "PROVIDER_ACCEPTED",
          occurredAt: now,
        },
      });
    });
  },
  async markFailed(id, failure) {
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${id}`})) IS NULL AS locked`;
      const notification = await transaction.orderNotification.findUnique({ where: { id }, select: { status: true, attempts: true } });
      if (!notification || notification.status !== "PROCESSING") return;
      const retryable = failure.retryable && notification.attempts < MAXIMUM_NOTIFICATION_ATTEMPTS;
      const updated = await transaction.orderNotification.updateMany({
        where: { id, status: "PROCESSING" },
        data: {
          status: retryable ? "FAILED_RETRYABLE" : "FAILED_FINAL",
          availableAt: retryable ? new Date(now.getTime() + notificationBackoffMs(notification.attempts)) : now,
          processingStartedAt: null,
          leaseExpiresAt: null,
          failedAt: now,
          lastErrorCode: failure.code.slice(0, 80),
          lastErrorMessage: failure.message.slice(0, 240),
        },
      });
      if (updated.count !== 1) return;
      await transaction.notificationEvent.create({
        data: { notificationId: id, outcome: retryable ? "IGNORED" : "REQUIRES_REVIEW", code: failure.code.slice(0, 80), occurredAt: now },
      });
    });
  },
};

export async function dispatchOrderNotification(
  id: string,
  dependencies: {
    repository: NotificationDispatchRepository;
    sendEmail(message: OrderNotificationMessage): Promise<NotificationTransportResult>;
  } = { repository: databaseNotificationDispatchRepository, sendEmail: sendOrderNotificationEmail },
) {
  const message = await dependencies.repository.claim(id);
  if (!message) return { delivered: false, skipped: true } as const;
  try {
    if (message.channel !== "EMAIL") throw new Error("No real SMS provider is configured.");
    if (!message.recipient) {
      await dependencies.repository.markFailed(id, { code: "RECIPIENT_MISSING", message: "La destination est absente.", retryable: false });
      return { delivered: false, skipped: false } as const;
    }
    normalizeNotificationRecipient(message.recipient);
    const result = await dependencies.sendEmail(message);
    await dependencies.repository.markSent(id, result);
    logNotification("notification.dispatch.accepted", { notificationId: id, provider: result.provider, delivered: result.deliveredImmediately });
    return { delivered: true, skipped: false } as const;
  } catch (error) {
    const failure = classifyNotificationFailure(error);
    await dependencies.repository.markFailed(id, failure);
    logNotification("notification.dispatch.failed", { notificationId: id, code: failure.code, retryable: failure.retryable });
    return { delivered: false, skipped: false } as const;
  }
}

export function globalNotificationDispatchWhere(now: Date, deploymentEnvironment = notificationEnvironmentSnapshot()): Prisma.OrderNotificationWhereInput {
  return {
    idempotencyKey: { not: OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY },
    deploymentEnvironment,
    attempts: { lt: MAXIMUM_NOTIFICATION_ATTEMPTS },
    availableAt: { lte: now },
    OR: [
      { status: "PENDING" },
      { status: "FAILED_RETRYABLE" },
      { status: "PROCESSING", leaseExpiresAt: { lte: now } },
    ],
  };
}

export async function dispatchPendingOrderNotifications(
  limit = 10,
  dependencies: Readonly<{
    dispatch(id: string): Promise<{ delivered: boolean; skipped: boolean }>;
  }> = { dispatch: dispatchOrderNotification },
) {
  assertDatabaseConfigured();
  const configuration = parseNotificationConfiguration();
  if (!configuration.emailEnabled || !configuration.workerEnabled) throw new Error("Notification worker is disabled.");
  const now = new Date();
  const pending = await prisma.orderNotification.findMany({
    where: globalNotificationDispatchWhere(now, configuration.deploymentEnvironment),
    orderBy: [{ priority: "asc" }, { availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(limit, 1), 25),
    select: { id: true },
  });
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  for (const notification of pending) {
    const result = await dependencies.dispatch(notification.id);
    if (result.skipped) skipped += 1;
    else if (result.delivered) delivered += 1;
    else failed += 1;
  }
  return { claimed: delivered + failed, delivered, failed, skipped } as const;
}

export async function retryNotificationManually(id: string, actorUserId: string) {
  assertDatabaseConfigured();
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${id}`})) IS NULL AS locked`;
    const notification = await transaction.orderNotification.findUnique({ where: { id } });
    if (!notification) throw new Error("Notification introuvable.");
    let recipient = notification.recipient;
    if (!recipient && notificationDefinition(notification.kind).audience === "OWNER") {
      const configuredRecipient = parseNotificationConfiguration().ownerRecipient;
      recipient = configuredRecipient ? normalizeNotificationRecipient(configuredRecipient) : null;
    }
    const suppression = recipient ? await transaction.notificationSuppression.findUnique({
      where: { channel_recipient: { channel: notification.channel, recipient } },
      select: { active: true },
    }) : null;
    if (!manualRetryAllowed({
      status: notification.status,
      suppressionActive: suppression?.active ?? false,
      attempts: notification.attempts,
    })) {
      throw new Error("Cette notification ne peut pas être rejouée.");
    }
    if (!recipient) throw new Error("La destination de cette notification reste indisponible.");
    if (notification.providerMessageId) {
      const delivered = await transaction.orderNotification.count({
        where: { idempotencyKey: notification.idempotencyKey, status: { in: ["SENT", "DELIVERED", "COMPLAINED"] } },
      });
      if (delivered > 0) throw new Error("Une notification identique a déjà été acceptée.");
    }
    await transaction.orderNotification.update({
      where: { id },
      data: {
        recipient,
        status: "PENDING", availableAt: new Date(), processingStartedAt: null, leaseExpiresAt: null,
        failedAt: null, lastErrorCode: null, lastErrorMessage: null,
      },
    });
    await transaction.notificationEvent.create({
      data: { notificationId: id, actorUserId, outcome: "PROCESSED", code: "ADMIN_MANUAL_RETRY", occurredAt: new Date() },
    });
  });
}

export async function suppressNotificationRecipientManually(id: string, actorUserId: string) {
  assertDatabaseConfigured();
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${id}`})) IS NULL AS locked`;
    const notification = await transaction.orderNotification.findUnique({
      where: { id },
      select: { id: true, channel: true, recipient: true },
    });
    if (!notification?.recipient) throw new Error("La destination de cette notification est indisponible.");
    const recipient = normalizeNotificationRecipient(notification.recipient);
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:suppression:${recipient}`})) IS NULL AS locked`;
    const existing = await transaction.notificationSuppression.findUnique({
      where: { channel_recipient: { channel: notification.channel, recipient } },
      select: { active: true },
    });
    if (existing?.active) throw new Error("Cette destination est déjà supprimée.");

    const now = new Date();
    await transaction.notificationSuppression.upsert({
      where: { channel_recipient: { channel: notification.channel, recipient } },
      update: {
        active: true,
        reason: "MANUAL",
        provider: null,
        sourceEventId: null,
        lastEventAt: now,
        removedAt: null,
      },
      create: {
        channel: notification.channel,
        recipient,
        recipientHashSha256: recipientHash(recipient),
        reason: "MANUAL",
        active: true,
        lastEventAt: now,
      },
    });
    const affected = await transaction.orderNotification.findMany({
      where: {
        channel: notification.channel,
        recipient,
        status: { in: ["PENDING", "FAILED_RETRYABLE"] },
      },
      select: { id: true },
    });
    if (affected.length) {
      await transaction.orderNotification.updateMany({
        where: { id: { in: affected.map((entry) => entry.id) } },
        data: {
          status: "SUPPRESSED",
          failedAt: now,
          processingStartedAt: null,
          leaseExpiresAt: null,
          lastErrorCode: "RECIPIENT_SUPPRESSED_MANUALLY",
          lastErrorMessage: "L’adresse destinataire a été supprimée par un administrateur.",
        },
      });
    }
    const auditedIds = new Set([id, ...affected.map((entry) => entry.id)]);
    await transaction.notificationEvent.createMany({
      data: [...auditedIds].map((notificationId) => ({
        notificationId,
        actorUserId,
        outcome: "PROCESSED" as const,
        code: "ADMIN_MANUAL_SUPPRESSION",
        occurredAt: now,
      })),
    });
  });
}
