import "server-only";

import type { Prisma } from "@/generated/prisma/client";

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
      availableAt: true, sentAt: true, deliveredAt: true, provider: true, providerMessageId: true,
      lastErrorCode: true, lastErrorMessage: true, resourceType: true, resourceReference: true,
      createdAt: true, updatedAt: true,
    },
  });
  const suppressionTargets = rows.flatMap((row) => row.recipient ? [{ channel: row.channel, recipient: row.recipient }] : []);
  const suppressions = suppressionTargets.length ? await prisma.notificationSuppression.findMany({
    where: { active: true, OR: suppressionTargets },
    select: { channel: true, recipient: true },
  }) : [];
  const suppressed = new Set(suppressions.map((entry) => `${entry.channel}:${entry.recipient}`));
  return rows.map((row) => ({
    ...row,
    maskedRecipient: maskedRecipient(row.recipient),
    statusLabel: notificationStatusPresentation[row.status],
    suppressionActive: row.recipient ? suppressed.has(`${row.channel}:${row.recipient}`) : false,
  }));
}
