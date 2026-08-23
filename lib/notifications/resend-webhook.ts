import "server-only";

import type {
  NotificationStatus,
  NotificationSuppressionReason,
  Prisma,
} from "@/generated/prisma/client";
import type { NotificationDeploymentEnvironment } from "@/lib/notifications/config";
import { normalizeNotificationRecipient, recipientHash } from "@/lib/notifications/domain";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export const RESEND_WEBHOOK_EVENT_TYPES = [
  "email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.failed", "email.suppressed",
  "suppression.added", "suppression.removed",
] as const;

export type ResendWebhookEventType = (typeof RESEND_WEBHOOK_EVENT_TYPES)[number];
export type ResendBounceType = "Permanent" | "Transient" | "Undetermined";

export type VerifiedResendWebhookEvent = Readonly<{
  providerEventId: string;
  type: ResendWebhookEventType | string;
  occurredAt: Date;
  providerMessageId: string | null;
  recipient: string | null;
  suppressionOrigin: "bounce" | "complaint" | "manual" | null;
  bounceType: ResendBounceType | null;
  bounceSubType: string | null;
  deploymentEnvironment: NotificationDeploymentEnvironment;
}>;

export type WebhookNotification = Readonly<{
  status: NotificationStatus;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage?: string | null;
}>;

function suppressionReason(event: VerifiedResendWebhookEvent): NotificationSuppressionReason {
  if (event.type === "email.bounced" || event.suppressionOrigin === "bounce") return "HARD_BOUNCE";
  if (event.type === "email.complained" || event.suppressionOrigin === "complaint") return "COMPLAINT";
  if (event.suppressionOrigin === "manual") return "MANUAL";
  return "PROVIDER_SUPPRESSED";
}

export function resendWebhookEventCode(event: VerifiedResendWebhookEvent) {
  if (event.type === "email.bounced") {
    return `EMAIL_BOUNCED_${(event.bounceType ?? "Undetermined").toUpperCase()}`;
  }
  return event.type.toUpperCase().replaceAll(".", "_");
}

export function unmatchedResendWebhookEventCode(
  event: VerifiedResendWebhookEvent,
  normalizedRecipient: string | null,
) {
  const environment = event.deploymentEnvironment.toUpperCase();
  const recipientProof = normalizedRecipient ? recipientHash(normalizedRecipient).slice(0, 16) : "NO_RECIPIENT";
  return `UNMATCHED_${environment}_${resendWebhookEventCode(event)}_${recipientProof}`.slice(0, 80);
}

function shouldSuppressRecipient(event: VerifiedResendWebhookEvent) {
  return event.type === "email.complained"
    || event.type === "email.suppressed"
    || event.type === "email.bounced" && event.bounceType === "Permanent";
}

export function resendWebhookNotificationUpdate(
  notification: WebhookNotification,
  event: VerifiedResendWebhookEvent,
): Prisma.OrderNotificationUpdateInput | null {
  const status = notification.status;
  const releaseLease = { processingStartedAt: null, leaseExpiresAt: null } as const;
  if (event.type === "email.sent") {
    if (status === "PROCESSING") return { ...releaseLease, status: "SENT", sentAt: notification.sentAt ?? event.occurredAt };
    return status === "SENT" ? {} : null;
  }
  if (event.type === "email.delivered") {
    if (["PROCESSING", "SENT"].includes(status)) {
      return {
        ...releaseLease,
        status: "DELIVERED",
        sentAt: notification.sentAt ?? event.occurredAt,
        deliveredAt: event.occurredAt,
        failedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      };
    }
    if (
      status === "BOUNCED"
      && ["BOUNCE_TRANSIENT", "BOUNCE_UNDETERMINED"].includes(notification.lastErrorCode ?? "")
      && (!notification.failedAt || event.occurredAt.getTime() >= notification.failedAt.getTime())
    ) {
      return {
        ...releaseLease,
        status: "DELIVERED",
        deliveredAt: event.occurredAt,
        failedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      };
    }
    return status === "DELIVERED" ? {} : null;
  }
  if (event.type === "email.delivery_delayed") return {};
  if (event.type === "email.bounced") {
    if (["PROCESSING", "SENT", "FAILED_RETRYABLE"].includes(status)) {
      const bounceType = event.bounceType ?? "Undetermined";
      return {
        ...releaseLease,
        status: "BOUNCED",
        sentAt: notification.sentAt ?? event.occurredAt,
        deliveredAt: null,
        failedAt: event.occurredAt,
        lastErrorCode: `BOUNCE_${bounceType.toUpperCase()}`,
        lastErrorMessage: bounceType === "Permanent"
          ? "L’adresse a rejeté définitivement le message."
          : "Le fournisseur a signalé un rejet non définitif à examiner.",
      };
    }
    return status === "BOUNCED" ? {} : null;
  }
  if (event.type === "email.complained") {
    if (notification.deliveredAt && event.occurredAt.getTime() < notification.deliveredAt.getTime()) return null;
    if (notification.failedAt && event.occurredAt.getTime() < notification.failedAt.getTime()) return null;
    if (["PROCESSING", "SENT", "DELIVERED", "BOUNCED", "FAILED_RETRYABLE", "FAILED_FINAL"].includes(status)) {
      return {
        ...releaseLease,
        status: "COMPLAINED",
        sentAt: notification.sentAt ?? event.occurredAt,
        deliveredAt: notification.deliveredAt ?? event.occurredAt,
        failedAt: event.occurredAt,
        lastErrorCode: "COMPLAINT",
        lastErrorMessage: "Une plainte a été reçue pour cette adresse.",
      };
    }
    return status === "COMPLAINED" ? {} : null;
  }
  if (event.type === "email.failed") {
    if (["PROCESSING", "SENT", "FAILED_RETRYABLE"].includes(status)) {
      return {
        ...releaseLease,
        status: "FAILED_FINAL",
        sentAt: notification.sentAt ?? event.occurredAt,
        deliveredAt: null,
        failedAt: event.occurredAt,
        lastErrorCode: "PROVIDER_DELIVERY_FAILED",
        lastErrorMessage: "Le fournisseur n’a pas pu livrer le message.",
      };
    }
    return status === "FAILED_FINAL" ? {} : null;
  }
  if (event.type === "email.suppressed") {
    if (notification.failedAt && event.occurredAt.getTime() < notification.failedAt.getTime()) return null;
    if (["PROCESSING", "SENT", "BOUNCED", "FAILED_RETRYABLE", "FAILED_FINAL"].includes(status)) {
      return {
        ...releaseLease,
        status: "SUPPRESSED",
        sentAt: notification.sentAt ?? event.occurredAt,
        deliveredAt: null,
        failedAt: event.occurredAt,
        lastErrorCode: "PROVIDER_SUPPRESSED",
        lastErrorMessage: "Le fournisseur a supprimé cette destination.",
      };
    }
    return status === "SUPPRESSED" ? {} : null;
  }
  return null;
}

export function applyResendWebhookNotificationEvent(
  notification: WebhookNotification,
  event: VerifiedResendWebhookEvent,
) {
  const update = resendWebhookNotificationUpdate(notification, event);
  if (update === null) return { notification, outcome: "IGNORED" as const };
  const dateValue = (value: unknown, fallback: Date | null) => value === null || value instanceof Date ? value : fallback;
  const stringValue = (value: unknown, fallback: string | null) => value === null || typeof value === "string" ? value : fallback;
  return {
    notification: {
      status: typeof update.status === "string" ? update.status as NotificationStatus : notification.status,
      sentAt: dateValue(update.sentAt, notification.sentAt),
      deliveredAt: dateValue(update.deliveredAt, notification.deliveredAt),
      failedAt: dateValue(update.failedAt, notification.failedAt),
      lastErrorCode: stringValue(update.lastErrorCode, notification.lastErrorCode),
      lastErrorMessage: stringValue(update.lastErrorMessage, notification.lastErrorMessage ?? null),
    } satisfies WebhookNotification,
    outcome: "PROCESSED" as const,
  };
}

async function applySuppression(
  transaction: Prisma.TransactionClient,
  input: { active: boolean; event: VerifiedResendWebhookEvent; recipient: string },
) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:suppression:${input.recipient}`})) IS NULL AS locked`;
  const current = await transaction.notificationSuppression.findUnique({
    where: { channel_recipient: { channel: "EMAIL", recipient: input.recipient } },
  });
  if (current?.active && current.reason === "MANUAL" && !input.active) return "MANUAL_BLOCK" as const;
  if (current && current.lastEventAt.getTime() >= input.event.occurredAt.getTime()) return "STALE" as const;

  const reason = suppressionReason(input.event);
  await transaction.notificationSuppression.upsert({
    where: { channel_recipient: { channel: "EMAIL", recipient: input.recipient } },
    update: {
      active: input.active,
      reason,
      provider: "RESEND",
      sourceEventId: input.event.providerEventId,
      lastEventAt: input.event.occurredAt,
      removedAt: input.active ? null : input.event.occurredAt,
    },
    create: {
      channel: "EMAIL",
      recipient: input.recipient,
      recipientHashSha256: recipientHash(input.recipient),
      reason,
      provider: "RESEND",
      active: input.active,
      sourceEventId: input.event.providerEventId,
      lastEventAt: input.event.occurredAt,
      removedAt: input.active ? null : input.event.occurredAt,
    },
  });
  if (input.active) {
    await transaction.orderNotification.updateMany({
      where: { recipient: input.recipient, status: { in: ["PENDING", "FAILED_RETRYABLE"] } },
      data: {
        status: "SUPPRESSED",
        failedAt: input.event.occurredAt,
        lastErrorCode: "RECIPIENT_SUPPRESSED",
        lastErrorMessage: "L’adresse destinataire est supprimée.",
      },
    });
  }
  return "APPLIED" as const;
}

export async function processVerifiedResendWebhookEvent(event: VerifiedResendWebhookEvent) {
  assertDatabaseConfigured();
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:webhook:${event.providerEventId}`})) IS NULL AS locked`;
    const existingEvent = await transaction.notificationEvent.findUnique({
      where: { providerEventId: event.providerEventId },
      select: { id: true, outcome: true, code: true, notificationId: true },
    });
    const mayReconcile = existingEvent?.outcome === "REQUIRES_REVIEW"
      && existingEvent.code?.startsWith("UNMATCHED_")
      && existingEvent.notificationId === null;
    if (existingEvent && !mayReconcile) return { outcome: existingEvent.outcome, duplicate: true } as const;

    const recordEvent = async (input: {
      code: string;
      notificationId?: string | null;
      outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW";
    }) => {
      const data = {
        providerEventType: event.type.slice(0, 80),
        providerMessageId: event.providerMessageId,
        notificationId: input.notificationId ?? null,
        outcome: input.outcome,
        code: input.code.slice(0, 80),
        occurredAt: event.occurredAt,
      } as const;
      if (existingEvent) {
        await transaction.notificationEvent.update({ where: { id: existingEvent.id }, data });
      } else {
        await transaction.notificationEvent.create({ data: { providerEventId: event.providerEventId, ...data } });
      }
    };

    if (!RESEND_WEBHOOK_EVENT_TYPES.includes(event.type as ResendWebhookEventType)) {
      await recordEvent({ outcome: "IGNORED", code: "EVENT_NOT_ALLOWLISTED" });
      return { outcome: "IGNORED", duplicate: Boolean(existingEvent) } as const;
    }

    if (event.providerMessageId) {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:webhook:message:${event.providerMessageId}`})) IS NULL AS locked`;
    }
    let notification = event.providerMessageId ? await transaction.orderNotification.findUnique({
      where: { providerMessageId: event.providerMessageId },
    }) : null;
    if (notification) {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${notification.id}`})) IS NULL AS locked`;
      notification = await transaction.orderNotification.findUnique({ where: { id: notification.id } });
    }
    const authAudit = !notification && event.providerMessageId ? await transaction.notificationEvent.findFirst({
      where: { providerMessageId: event.providerMessageId, providerEventType: { startsWith: "auth.email." } },
      select: { id: true },
    }) : null;
    const normalizedRecipient = event.recipient ? normalizeNotificationRecipient(event.recipient) : null;
    const recipientMatches = Boolean(notification && normalizedRecipient && notification.recipient === normalizedRecipient);
    const notificationMatchesEnvironment = notification?.deploymentEnvironment === event.deploymentEnvironment;

    if (event.type === "suppression.added" || event.type === "suppression.removed") {
      if (!normalizedRecipient) {
        await recordEvent({ outcome: "REQUIRES_REVIEW", code: "RECIPIENT_MISSING" });
        return { outcome: "REQUIRES_REVIEW", duplicate: Boolean(existingEvent) } as const;
      }
      const active = event.type === "suppression.added";
      const suppressionResult = await applySuppression(transaction, { active, event, recipient: normalizedRecipient });
      const outcome = suppressionResult === "APPLIED" ? "PROCESSED" : "IGNORED";
      await recordEvent({
        notificationId: recipientMatches && notificationMatchesEnvironment ? notification?.id : null,
        outcome,
        code: suppressionResult === "STALE"
          ? "STALE_SUPPRESSION_EVENT"
          : suppressionResult === "MANUAL_BLOCK"
            ? "MANUAL_SUPPRESSION_PRESERVED"
            : active ? "SUPPRESSION_ADDED" : "SUPPRESSION_REMOVED",
      });
      return { outcome, duplicate: Boolean(existingEvent) } as const;
    }

    const providerMatches = notification?.provider === "RESEND"
      || notification?.provider === null && notification.status === "PROCESSING";

    if (
      normalizedRecipient
      && shouldSuppressRecipient(event)
      && (!notification || recipientMatches && notificationMatchesEnvironment && providerMatches)
    ) {
      await applySuppression(transaction, { active: true, event, recipient: normalizedRecipient });
    }

    if (!notification) {
      const outcome = authAudit && event.type !== "email.failed" ? "PROCESSED" : "REQUIRES_REVIEW";
      await recordEvent({
        outcome,
        code: authAudit
          ? event.type === "email.failed" ? "AUTH_EMAIL_FAILED_REVIEW" : `AUTH_${resendWebhookEventCode(event)}`
          : unmatchedResendWebhookEventCode(event, normalizedRecipient),
      });
      return { outcome, duplicate: Boolean(existingEvent) } as const;
    }
    if (!recipientMatches) {
      await recordEvent({ notificationId: notification.id, outcome: "REQUIRES_REVIEW", code: "RECIPIENT_MISMATCH" });
      return { outcome: "REQUIRES_REVIEW", duplicate: Boolean(existingEvent) } as const;
    }
    if (!notificationMatchesEnvironment || !providerMatches) {
      await recordEvent({
        notificationId: notification.id,
        outcome: "REQUIRES_REVIEW",
        code: !providerMatches ? "PROVIDER_MISMATCH" : "DEPLOYMENT_ENVIRONMENT_MISMATCH",
      });
      return { outcome: "REQUIRES_REVIEW", duplicate: Boolean(existingEvent) } as const;
    }

    const update = resendWebhookNotificationUpdate(notification, event);
    const outcome = update === null ? "IGNORED" : "PROCESSED";
    if (update && (Object.keys(update).length > 0 || notification.provider === null)) {
      await transaction.orderNotification.update({
        where: { id: notification.id },
        data: { ...update, ...(notification.provider === null ? { provider: "RESEND" as const } : {}) },
      });
    }
    await recordEvent({ notificationId: notification.id, outcome, code: resendWebhookEventCode(event) });
    return { outcome, duplicate: Boolean(existingEvent) } as const;
  }, { isolationLevel: "ReadCommitted" });
}
