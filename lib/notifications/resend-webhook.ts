import "server-only";

import { recipientHash, normalizeNotificationRecipient } from "@/lib/notifications/domain";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export const RESEND_WEBHOOK_EVENT_TYPES = [
  "email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.failed", "email.suppressed",
  "suppression.added", "suppression.removed",
] as const;

export type ResendWebhookEventType = (typeof RESEND_WEBHOOK_EVENT_TYPES)[number];

export type VerifiedResendWebhookEvent = Readonly<{
  providerEventId: string;
  type: ResendWebhookEventType | string;
  occurredAt: Date;
  providerMessageId: string | null;
  recipient: string | null;
  suppressionOrigin: "bounce" | "complaint" | "manual" | null;
}>;

function suppressionReason(event: VerifiedResendWebhookEvent) {
  if (event.type === "email.bounced" || event.suppressionOrigin === "bounce") return "HARD_BOUNCE" as const;
  if (event.type === "email.complained" || event.suppressionOrigin === "complaint") return "COMPLAINT" as const;
  return "PROVIDER_SUPPRESSED" as const;
}

function eventCode(type: string) {
  return type.toUpperCase().replaceAll(".", "_");
}

export async function processVerifiedResendWebhookEvent(event: VerifiedResendWebhookEvent) {
  assertDatabaseConfigured();
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:webhook:${event.providerEventId}`})) IS NULL AS locked`;
    const duplicate = await transaction.notificationEvent.findUnique({
      where: { providerEventId: event.providerEventId },
      select: { outcome: true },
    });
    if (duplicate) return { outcome: duplicate.outcome, duplicate: true } as const;

    if (!RESEND_WEBHOOK_EVENT_TYPES.includes(event.type as ResendWebhookEventType)) {
      await transaction.notificationEvent.create({
        data: {
          providerEventId: event.providerEventId, providerEventType: event.type.slice(0, 80),
          providerMessageId: event.providerMessageId, outcome: "IGNORED", code: "EVENT_NOT_ALLOWLISTED", occurredAt: event.occurredAt,
        },
      });
      return { outcome: "IGNORED", duplicate: false } as const;
    }

    const notification = event.providerMessageId ? await transaction.orderNotification.findUnique({
      where: { providerMessageId: event.providerMessageId },
    }) : null;
    const normalizedRecipient = event.recipient ? normalizeNotificationRecipient(event.recipient) : null;
    const recipientMatches = notification && normalizedRecipient
      ? notification.recipient === normalizedRecipient
      : Boolean(notification);

    if (event.type === "suppression.added" || event.type === "suppression.removed") {
      if (!normalizedRecipient) {
        await transaction.notificationEvent.create({
          data: { providerEventId: event.providerEventId, providerEventType: event.type, outcome: "REQUIRES_REVIEW", code: "RECIPIENT_MISSING", occurredAt: event.occurredAt },
        });
        return { outcome: "REQUIRES_REVIEW", duplicate: false } as const;
      }
      const active = event.type === "suppression.added";
      await transaction.notificationSuppression.upsert({
        where: { channel_recipient: { channel: "EMAIL", recipient: normalizedRecipient } },
        update: {
          active, reason: suppressionReason(event), provider: "RESEND", sourceEventId: event.providerEventId,
          lastEventAt: event.occurredAt, removedAt: active ? null : event.occurredAt,
        },
        create: {
          channel: "EMAIL", recipient: normalizedRecipient, recipientHashSha256: recipientHash(normalizedRecipient),
          reason: suppressionReason(event), provider: "RESEND", active, sourceEventId: event.providerEventId,
          lastEventAt: event.occurredAt, removedAt: active ? null : event.occurredAt,
        },
      });
      if (active) {
        await transaction.orderNotification.updateMany({
          where: { recipient: normalizedRecipient, status: { in: ["PENDING", "FAILED_RETRYABLE"] } },
          data: { status: "SUPPRESSED", failedAt: event.occurredAt, lastErrorCode: "RECIPIENT_SUPPRESSED", lastErrorMessage: "L’adresse destinataire est supprimée." },
        });
      }
      await transaction.notificationEvent.create({
        data: {
          providerEventId: event.providerEventId, providerEventType: event.type,
          providerMessageId: event.providerMessageId, notificationId: notification?.id,
          outcome: "PROCESSED", code: active ? "SUPPRESSION_ADDED" : "SUPPRESSION_REMOVED", occurredAt: event.occurredAt,
        },
      });
      return { outcome: "PROCESSED", duplicate: false } as const;
    }

    if (!notification || !recipientMatches) {
      await transaction.notificationEvent.create({
        data: {
          providerEventId: event.providerEventId, providerEventType: event.type,
          providerMessageId: event.providerMessageId, notificationId: notification?.id,
          outcome: "REQUIRES_REVIEW", code: notification ? "RECIPIENT_MISMATCH" : "NOTIFICATION_NOT_FOUND", occurredAt: event.occurredAt,
        },
      });
      return { outcome: "REQUIRES_REVIEW", duplicate: false } as const;
    }

    let update: Record<string, unknown> | null = null;
    let addSuppression = false;
    if (event.type === "email.sent") {
      if (notification.status === "SENT") update = {};
    } else if (event.type === "email.delivered") {
      if (notification.status === "SENT") update = { status: "DELIVERED", deliveredAt: event.occurredAt };
    } else if (event.type === "email.delivery_delayed") {
      update = {};
    } else if (event.type === "email.bounced") {
      if (notification.status === "SENT") update = { status: "BOUNCED", deliveredAt: null, failedAt: event.occurredAt, lastErrorCode: "HARD_BOUNCE", lastErrorMessage: "L’adresse a rejeté définitivement le message." };
      addSuppression = true;
    } else if (event.type === "email.complained") {
      if (notification.sentAt) update = { status: "COMPLAINED", deliveredAt: notification.deliveredAt ?? event.occurredAt, failedAt: event.occurredAt, lastErrorCode: "COMPLAINT", lastErrorMessage: "Une plainte a été reçue pour cette adresse." };
      addSuppression = true;
    } else if (event.type === "email.failed") {
      if (notification.status === "SENT") update = { status: "FAILED_FINAL", deliveredAt: null, failedAt: event.occurredAt, lastErrorCode: "PROVIDER_DELIVERY_FAILED", lastErrorMessage: "Le fournisseur n’a pas pu livrer le message." };
    } else if (event.type === "email.suppressed") {
      if (notification.status === "SENT") update = { status: "SUPPRESSED", deliveredAt: null, failedAt: event.occurredAt, lastErrorCode: "PROVIDER_SUPPRESSED", lastErrorMessage: "Le fournisseur a supprimé cette destination." };
      addSuppression = true;
    }

    const outcome = update === null ? "IGNORED" : "PROCESSED";
    if (update && Object.keys(update).length > 0) {
      await transaction.orderNotification.update({ where: { id: notification.id }, data: update });
    }
    if (addSuppression && normalizedRecipient) {
      await transaction.notificationSuppression.upsert({
        where: { channel_recipient: { channel: "EMAIL", recipient: normalizedRecipient } },
        update: { active: true, reason: suppressionReason(event), provider: "RESEND", sourceEventId: event.providerEventId, lastEventAt: event.occurredAt, removedAt: null },
        create: {
          channel: "EMAIL", recipient: normalizedRecipient, recipientHashSha256: recipientHash(normalizedRecipient),
          reason: suppressionReason(event), provider: "RESEND", sourceEventId: event.providerEventId, lastEventAt: event.occurredAt,
        },
      });
    }
    await transaction.notificationEvent.create({
      data: {
        providerEventId: event.providerEventId, providerEventType: event.type,
        providerMessageId: event.providerMessageId, notificationId: notification.id,
        outcome, code: eventCode(event.type), occurredAt: event.occurredAt,
      },
    });
    return { outcome, duplicate: false } as const;
  }, { isolationLevel: "ReadCommitted" });
}
