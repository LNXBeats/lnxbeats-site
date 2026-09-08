import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import {
  type AdminCleanupCandidate,
  type AdminManagedRecordType,
} from "@/lib/admin/cleanup-contract";
import {
  classifyMusicOrderCleanup,
  classifyRightsRequestCleanup,
  classifyShopOrderCleanup,
  type AdminCleanupClassification,
} from "@/lib/admin/cleanup-classification";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export {
  classifyMusicOrderCleanup,
  classifyRightsRequestCleanup,
  classifyShopOrderCleanup,
} from "@/lib/admin/cleanup-classification";
export type { AdminCleanupClassification } from "@/lib/admin/cleanup-classification";
export { ADMIN_CLEANUP_CONFIRMATION } from "@/lib/admin/cleanup-contract";
export type { AdminCleanupCandidate, AdminManagedRecordType } from "@/lib/admin/cleanup-contract";

type Transaction = Prisma.TransactionClient;

export const adminManagedRecordTypes = ["MUSIC_ORDER", "SHOP_ORDER", "RIGHTS_REQUEST"] as const;

const musicSelect = {
  id: true,
  orderNumber: true,
  title: true,
  customerEmail: true,
  status: true,
  serviceStartedAt: true,
  deliveredAt: true,
  createdAt: true,
  events: { select: { toStatus: true } },
  assets: { select: { role: true } },
  commercialLicenses: { select: { status: true, paymentStatus: true } },
  rightsRequests: { select: { status: true } },
  payments: {
    select: {
      status: true,
      amountCents: true,
      refundedAmountCents: true,
      refundAttempts: { select: { status: true } },
      incidents: { select: { status: true, requiresOperatorReview: true } },
    },
  },
  invoices: { select: { id: true } },
  notifications: { select: { status: true } },
  withdrawalRequests: { select: { status: true } },
} satisfies Prisma.OrderSelect;

const shopSelect = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  fulfillmentStatus: true,
  paymentReviewAt: true,
  createdAt: true,
  customerRequests: { where: { status: { in: ["REQUESTED", "APPROVED"] as const } }, select: { id: true } },
  payments: {
    select: {
      status: true,
      amountCents: true,
      refundedAmountCents: true,
      refundAttempts: { where: { status: { in: ["PROCESSING", "PENDING", "REQUIRES_REVIEW"] as const } }, select: { id: true } },
      incidents: { where: { requiresOperatorReview: true, status: { not: "RESOLVED" as const } }, select: { id: true } },
    },
  },
  shippingProviderAttempts: { where: { status: { in: ["REQUESTED", "PENDING", "REQUIRES_REVIEW"] as const } }, select: { id: true } },
  notifications: {
    where: { status: { in: ["PROCESSING", "FAILED", "FAILED_RETRYABLE", "FAILED_FINAL", "BOUNCED", "COMPLAINED", "SUPPRESSED"] as const } },
    select: { id: true },
  },
  withdrawalRequests: {
    where: {
      OR: [
        { status: { in: ["RECEIVED", "UNDER_REVIEW"] as const } },
        { refundStatus: "REFUND_REQUIRED" as const },
        { returnStatus: { in: ["PENDING", "AUTHORIZED"] as const } },
      ],
    },
    select: { id: true },
  },
  returnRequests: {
    where: { status: { notIn: ["REJECTED", "CLOSED", "CANCELLED"] as const } },
    select: { id: true },
  },
  items: {
    where: { reservation: { is: { status: "ACTIVE" as const } } },
    select: { productId: true },
  },
} satisfies Prisma.ShopOrderSelect;

export async function listAdminCleanupCandidates(): Promise<AdminCleanupCandidate[]> {
  assertDatabaseConfigured();
  const [archives, musicOrders, shopOrders, rightsRequests] = await Promise.all([
    prisma.adminRecordArchive.findMany({ select: { recordType: true, recordId: true } }),
    prisma.order.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 200, select: musicSelect }),
    prisma.shopOrder.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 200, select: shopSelect }),
    prisma.rightsRequest.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 200,
      select: { id: true, requestNumber: true, workTitle: true, status: true, createdAt: true },
    }),
  ]);
  const archived = new Set(archives.map((item) => `${item.recordType}:${item.recordId}`));
  const candidates: AdminCleanupCandidate[] = [];
  for (const order of musicOrders) {
    const classification = classifyMusicOrderCleanup(order);
    candidates.push({
      type: "MUSIC_ORDER", id: order.id, reference: order.orderNumber,
      label: order.title?.trim() || "Commande musicale sans titre", createdAt: order.createdAt,
      status: order.status, ...classification, archived: archived.has(`MUSIC_ORDER:${order.id}`),
    });
  }
  for (const order of shopOrders) {
    const openFinancialReviews = order.payments.reduce(
      (total, payment) => total + payment.refundAttempts.length + payment.incidents.length,
      order.shippingProviderAttempts.length,
    );
    const openOperationalActions = order.notifications.length
      + order.withdrawalRequests.length
      + order.returnRequests.length
      + order.items.length;
    const classification = classifyShopOrderCleanup({
      ...order,
      openCustomerRequests: order.customerRequests.length,
      openFinancialReviews,
      openOperationalActions,
      financialPayments: order.payments,
    });
    candidates.push({
      type: "SHOP_ORDER", id: order.id, reference: order.orderNumber,
      label: "Commande Boutique", createdAt: order.createdAt, status: `${order.status} · ${order.paymentStatus} · ${order.fulfillmentStatus}`,
      ...classification, archived: archived.has(`SHOP_ORDER:${order.id}`),
    });
  }
  for (const request of rightsRequests) {
    candidates.push({
      type: "RIGHTS_REQUEST", id: request.id, reference: request.requestNumber,
      label: request.workTitle, createdAt: request.createdAt, status: request.status,
      ...classifyRightsRequestCleanup(request.status), archived: archived.has(`RIGHTS_REQUEST:${request.id}`),
    });
  }
  return candidates.sort((left, right) => {
    const rank = { DELETE_SAFE: 0, ARCHIVE_REQUIRED: 1, KEEP_ACTION_REQUIRED: 2 } as const;
    return rank[left.classification] - rank[right.classification]
      || right.createdAt.getTime() - left.createdAt.getTime()
      || left.reference.localeCompare(right.reference);
  });
}

export async function listAdminArchives() {
  assertDatabaseConfigured();
  return prisma.adminRecordArchive.findMany({
    orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
    take: 300,
    select: {
      id: true, recordType: true, recordId: true, recordReference: true,
      classification: true, reason: true, archivedAt: true,
      archivedBy: { select: { displayName: true } },
    },
  });
}

type ParsedTarget = Readonly<{ type: AdminManagedRecordType; id: string; expected: AdminCleanupClassification }>;

export function parseAdminCleanupTargets(values: readonly string[]): ParsedTarget[] {
  const unique = new Map<string, ParsedTarget>();
  for (const raw of values) {
    const [type, id, expected, extra] = raw.split(":");
    if (extra || !adminManagedRecordTypes.includes(type as AdminManagedRecordType)) throw new Error("CLEANUP_TARGET_INVALID");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error("CLEANUP_TARGET_INVALID");
    if (!["DELETE_SAFE", "ARCHIVE_REQUIRED", "KEEP_ACTION_REQUIRED"].includes(expected)) throw new Error("CLEANUP_TARGET_INVALID");
    unique.set(`${type}:${id}`, { type: type as AdminManagedRecordType, id, expected: expected as AdminCleanupClassification });
  }
  return [...unique.values()];
}

async function classifyTarget(transaction: Transaction, target: ParsedTarget) {
  if (target.type === "MUSIC_ORDER") {
    const record = await transaction.order.findUnique({ where: { id: target.id }, select: musicSelect });
    if (!record) throw new Error("CLEANUP_TARGET_NOT_FOUND");
    return { reference: record.orderNumber, classification: classifyMusicOrderCleanup(record) };
  }
  if (target.type === "SHOP_ORDER") {
    const record = await transaction.shopOrder.findUnique({ where: { id: target.id }, select: shopSelect });
    if (!record) throw new Error("CLEANUP_TARGET_NOT_FOUND");
    const openFinancialReviews = record.payments.reduce(
      (total, payment) => total + payment.refundAttempts.length + payment.incidents.length,
      record.shippingProviderAttempts.length,
    );
    const openOperationalActions = record.notifications.length
      + record.withdrawalRequests.length
      + record.returnRequests.length
      + record.items.length;
    return {
      reference: record.orderNumber,
      classification: classifyShopOrderCleanup({
        ...record,
        openCustomerRequests: record.customerRequests.length,
        openFinancialReviews,
        openOperationalActions,
        financialPayments: record.payments,
      }),
    };
  }
  const record = await transaction.rightsRequest.findUnique({
    where: { id: target.id }, select: { requestNumber: true, status: true },
  });
  if (!record) throw new Error("CLEANUP_TARGET_NOT_FOUND");
  return { reference: record.requestNumber, classification: classifyRightsRequestCleanup(record.status) };
}

export async function executeAdminCleanupPlan(targets: readonly ParsedTarget[], actorUserId: string) {
  assertDatabaseConfigured();
  const result = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('admin:test-cleanup:v1.2')) IS NULL AS locked`;
    const counters = { deleted: 0, archived: 0, ignored: 0 };
    for (const target of targets) {
      const current = await classifyTarget(transaction, target);
      if (current.classification.classification !== target.expected) throw new Error("CLEANUP_CLASSIFICATION_CHANGED");
      if (target.expected === "KEEP_ACTION_REQUIRED") {
        counters.ignored += 1;
        continue;
      }
      if (target.expected === "ARCHIVE_REQUIRED") {
        const existing = await transaction.adminRecordArchive.findUnique({
          where: { recordType_recordId: { recordType: target.type, recordId: target.id } }, select: { id: true },
        });
        if (existing) {
          counters.ignored += 1;
          continue;
        }
        await transaction.adminRecordArchive.create({
          data: {
            recordType: target.type, recordId: target.id, recordReference: current.reference,
            classification: "ARCHIVE_REQUIRED", reason: current.classification.reason, archivedByUserId: actorUserId,
          },
        });
        await transaction.adminCleanupAuditEvent.create({
          data: {
            recordType: target.type, recordId: target.id, recordReference: current.reference,
            operation: "ARCHIVED", classification: "ARCHIVE_REQUIRED",
            reason: current.classification.reason, actorUserId,
          },
        });
        counters.archived += 1;
        continue;
      }
      if (target.type !== "MUSIC_ORDER") throw new Error("CLEANUP_HARD_DELETE_FORBIDDEN");
      await transaction.orderEvent.deleteMany({ where: { orderId: target.id } });
      await transaction.order.delete({ where: { id: target.id } });
      await transaction.adminCleanupAuditEvent.create({
        data: {
          recordType: target.type, recordId: target.id, recordReference: current.reference,
          operation: "HARD_DELETED", classification: "DELETE_SAFE",
          reason: current.classification.reason, actorUserId,
        },
      });
      counters.deleted += 1;
    }
    return counters;
  }, { isolationLevel: "Serializable" });
  return result;
}
