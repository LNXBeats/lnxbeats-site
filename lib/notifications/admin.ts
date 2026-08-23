import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { maskedProviderMessageId } from "@/lib/notifications/admin-presentation";
import { maskedRecipient, notificationStatusPresentation } from "@/lib/notifications/domain";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export const adminNotificationFilters = ["attention", "pending", "sent", "suppressed", "all"] as const;
export type AdminNotificationFilter = (typeof adminNotificationFilters)[number];

export function parseAdminNotificationFilter(value: unknown): AdminNotificationFilter {
  return typeof value === "string" && adminNotificationFilters.includes(value as AdminNotificationFilter)
    ? value as AdminNotificationFilter
    : "attention";
}

export async function listAdminNotifications(filter: AdminNotificationFilter) {
  assertDatabaseConfigured();
  const where: Prisma.OrderNotificationWhereInput | undefined = filter === "attention" ? { status: { in: ["FAILED_RETRYABLE", "FAILED_FINAL", "BOUNCED", "COMPLAINED", "SUPPRESSED"] } }
    : filter === "pending" ? { status: { in: ["PENDING", "PROCESSING", "FAILED_RETRYABLE"] } }
      : filter === "sent" ? { status: { in: ["SENT", "DELIVERED"] } }
        : filter === "suppressed" ? { status: { in: ["BOUNCED", "COMPLAINED", "SUPPRESSED"] } }
          : undefined;
  const rows = await prisma.orderNotification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true, kind: true, channel: true, priority: true, recipient: true, status: true, attempts: true,
      availableAt: true, processingStartedAt: true, leaseExpiresAt: true, sentAt: true, deliveredAt: true,
      failedAt: true, provider: true, providerMessageId: true,
      lastErrorCode: true, lastErrorMessage: true, resourceType: true, resourceReference: true,
      createdAt: true, updatedAt: true,
      events: {
        orderBy: [{ occurredAt: "desc" as const }, { createdAt: "desc" as const }],
        take: 8,
        select: {
          id: true, providerMessageId: true, providerEventType: true, outcome: true, code: true,
          occurredAt: true, createdAt: true,
        },
      },
    },
  });
  const suppressionTargets = rows.flatMap((row) => row.recipient ? [{ channel: row.channel, recipient: row.recipient }] : []);
  const suppressions = suppressionTargets.length ? await prisma.notificationSuppression.findMany({
    where: { OR: suppressionTargets },
    select: {
      channel: true, recipient: true, reason: true, provider: true, active: true,
      lastEventAt: true, removedAt: true, updatedAt: true,
    },
  }) : [];
  const suppressionsByTarget = new Map(suppressions.map((entry) => [`${entry.channel}:${entry.recipient}`, entry]));
  return rows.map((row) => ({
    ...row,
    hasRecipient: Boolean(row.recipient),
    maskedRecipient: maskedRecipient(row.recipient),
    maskedProviderMessageId: maskedProviderMessageId(row.providerMessageId),
    statusLabel: notificationStatusPresentation[row.status],
    suppression: row.recipient ? suppressionsByTarget.get(`${row.channel}:${row.recipient}`) ?? null : null,
    suppressionActive: row.recipient ? suppressionsByTarget.get(`${row.channel}:${row.recipient}`)?.active === true : false,
    events: row.events.map((event) => ({
      ...event,
      maskedProviderMessageId: maskedProviderMessageId(event.providerMessageId),
    })),
  }));
}

export async function listAdminNotificationReviewEvents() {
  assertDatabaseConfigured();
  const rows = await prisma.notificationEvent.findMany({
    where: { outcome: "REQUIRES_REVIEW" },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true, providerMessageId: true, providerEventType: true, code: true, occurredAt: true, createdAt: true,
      notification: {
        select: {
          id: true, recipient: true, resourceType: true, resourceReference: true, status: true,
        },
      },
    },
  });
  return rows.map((row) => ({
    ...row,
    maskedProviderMessageId: maskedProviderMessageId(row.providerMessageId),
    maskedRecipient: maskedRecipient(row.notification?.recipient ?? null),
    statusLabel: row.notification ? notificationStatusPresentation[row.notification.status] : "Événement non rapproché",
  }));
}

export async function listAdminNotificationSuppressions() {
  assertDatabaseConfigured();
  const rows = await prisma.notificationSuppression.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      recipient: true,
      reason: true,
      provider: true,
      active: true,
      lastEventAt: true,
      removedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((row) => ({ ...row, maskedRecipient: maskedRecipient(row.recipient) }));
}
