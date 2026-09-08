import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { commanderAttentionWhere } from "@/lib/admin/cockpit";
import {
  getAdminOrderTransition,
  getOrderTransitionTimestamps,
  normalizeAdminNote,
} from "@/lib/admin/order-machine";
import {
  adminOrderFilters,
  classifyCommanderOperation,
  compareOperationClassifications,
  commanderActiveStatuses,
  rightsAdminAttentionStatuses,
  type AdminOrderFilter,
} from "@/lib/admin/operations";
import { adminPaymentReviewEventWhere } from "@/lib/admin/operation-queries";
import type { KnownOrderStatus } from "@/lib/orders/status";
import { enqueueCustomerDeliveryNotification, enqueueOrderNotification } from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { ORDER_DELIVERY_MIME_TYPES } from "@/lib/orders/audio-request";
import { MAXIMUM_ORDER_DELIVERIES } from "@/lib/orders/delivery";
import { runSequentialDatabaseQueries } from "@/lib/database/sequential-queries";

type Transaction = Prisma.TransactionClient;

export class AdminServiceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "AdminServiceError";
  }
}

export { adminOrderFilters } from "@/lib/admin/operations";
export type { AdminOrderFilter } from "@/lib/admin/operations";

const paidFulfillmentTargets = new Set<KnownOrderStatus>([
  "RECEIVED", "REVIEWING", "ACCEPTED", "IN_PROGRESS", "FIRST_VERSION_READY",
  "REVISION_REQUESTED", "FINALIZING", "DELIVERED",
]);

export function parseAdminOrderFilter(value: unknown): AdminOrderFilter {
  return typeof value === "string" && adminOrderFilters.includes(value as AdminOrderFilter)
    ? value as AdminOrderFilter
    : "attention";
}

export async function listAdminPaymentReviewEvents() {
  assertDatabaseConfigured();
  return prisma.providerEvent.findMany({
    where: adminPaymentReviewEventWhere,
    orderBy: [{ processedAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true,
      type: true,
      processedAt: true,
      payment: {
        select: {
          order: { select: { orderNumber: true, title: true, recipient: true } },
        },
      },
    },
  });
}

async function listUnarchivedCommanderOrderIds(filter: Exclude<AdminOrderFilter, "archives">) {
  return prisma.$queryRaw<Array<{ id: string }>>`
    SELECT orders."id"
    FROM "orders" orders
    WHERE (
      ${filter}::text = 'attention'
      OR NOT EXISTS (
        SELECT 1 FROM "admin_record_archives" archive
        WHERE archive."recordType" = 'MUSIC_ORDER' AND archive."recordId" = orders."id"
      )
    ) AND (
      ${filter}::text = 'all'
      OR (${filter}::text = 'attention' AND (
        orders."status" IN ('PAYMENT_CONFIRMED', 'RECEIVED', 'SUBMITTED', 'REVIEWING', 'REVISION_REQUESTED', 'FIRST_VERSION_READY', 'REFUND_PENDING')
        OR EXISTS (SELECT 1 FROM "payments" payments WHERE payments."orderId" = orders."id" AND payments."status" IN ('REQUIRES_REVIEW', 'REFUND_PENDING'))
        OR EXISTS (
          SELECT 1 FROM "payment_incidents" incidents
          JOIN "payments" payments ON payments."id" = incidents."paymentId"
          WHERE payments."orderId" = orders."id"
            AND incidents."requiresOperatorReview" = TRUE
            AND incidents."status" <> 'RESOLVED'
        )
        OR (orders."status" IN ('REFUSED', 'CANCELLED') AND EXISTS (
          SELECT 1 FROM "payments" payments
          WHERE payments."orderId" = orders."id" AND payments."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED')
        ))
        OR (orders."status" = 'REFUNDED' AND EXISTS (
          SELECT 1 FROM "payments" payments
          WHERE payments."orderId" = orders."id" AND payments."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED')
        ))
        OR EXISTS (
          SELECT 1 FROM "rights_requests" requests
          WHERE requests."orderId" = orders."id"
            AND requests."status" IN ('SUBMITTED', 'UNDER_REVIEW', 'PREAUTHORIZATION_GENERATED', 'CONTRACT_PREPARATION', 'CLIENT_ACCEPTED', 'ADMIN_VALIDATED')
        )
      ))
      OR (${filter}::text = 'active' AND orders."status" IN ('ACCEPTED', 'IN_PROGRESS', 'FIRST_VERSION_READY', 'REVISION_REQUESTED', 'FINALIZING'))
      OR (${filter}::text = 'pending' AND orders."status" IN ('DRAFT', 'AWAITING_PAYMENT'))
      OR (${filter}::text = 'completed' AND orders."status" IN ('DELIVERED', 'REFUSED', 'CANCELLED', 'REFUNDED'))
    )
    ORDER BY orders."updatedAt" DESC, orders."id" DESC
    LIMIT 200
  `;
}

export async function getAdminOverview() {
  assertDatabaseConfigured();
  const [orders, attention, active, delivered, members, databaseProjects, featuredProject] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: commanderAttentionWhere }),
    prisma.order.count({ where: { status: { in: [...commanderActiveStatuses] } } }),
    prisma.order.count({ where: { status: "DELIVERED" } }),
    prisma.user.count(),
    prisma.project.count(),
    prisma.project.findFirst({ where: { featured: true }, select: { title: true, slug: true } }),
  ]);
  return {
    orders,
    attention,
    active,
    delivered,
    members,
    databaseProjects,
    featuredProject,
  };
}

export async function listAdminOrders(filter: AdminOrderFilter) {
  assertDatabaseConfigured();
  const archiveRows = filter === "archives"
    ? await prisma.adminRecordArchive.findMany({
        where: { recordType: "MUSIC_ORDER" },
        orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
        take: 200,
        select: { recordId: true, archivedAt: true },
      })
    : [];
  const archivedAtById = new Map(archiveRows.map((row) => [row.recordId, row.archivedAt]));
  const visibleIds = filter === "archives" ? [] : await listUnarchivedCommanderOrderIds(filter);
  const candidates = await prisma.order.findMany({
    where: filter === "archives"
      ? { id: { in: archiveRows.map((row) => row.recordId) } }
      : { id: { in: visibleIds.map((row) => row.id) } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      customerEmail: true,
      title: true,
      recipient: true,
      status: true,
      coverIncluded: true,
      illustrationFormat: true,
      illustrationFormatCustom: true,
      priorityProcessing: true,
      totalCents: true,
      createdAt: true,
      updatedAt: true,
      rightsRequests: {
        where: { status: { in: [...rightsAdminAttentionStatuses] } },
        select: { id: true },
      },
      payments: {
        where: {
          OR: [
            { status: { in: ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REQUIRES_REVIEW"] } },
            { incidents: { some: { requiresOperatorReview: true, status: { not: "RESOLVED" } } } },
          ],
        },
        select: {
          status: true,
          incidents: {
            where: { requiresOperatorReview: true, status: { not: "RESOLVED" } },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  const withOperations = (rows: typeof candidates, archived: boolean) => rows.map((order) => ({
    ...order,
    operation: classifyCommanderOperation({
      status: order.status,
      archived,
      hasPaymentReview: order.payments.some((payment) => payment.status === "REQUIRES_REVIEW"),
      hasUnresolvedFinancialIncident: order.payments.some((payment) => payment.incidents.length > 0),
      hasRefundPending: order.payments.some((payment) => payment.status === "REFUND_PENDING"),
      hasRefundDue: ["REFUSED", "CANCELLED"].includes(order.status)
        && order.payments.some((payment) => ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status)),
      hasRefundContradiction: order.status === "REFUNDED"
        && order.payments.some((payment) => ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status)),
      hasRightsReview: order.rightsRequests.length > 0,
    }),
  }));
  if (filter === "archives") {
    return withOperations(candidates.sort((left, right) => {
      const leftAt = archivedAtById.get(left.id)?.getTime() ?? 0;
      const rightAt = archivedAtById.get(right.id)?.getTime() ?? 0;
      return rightAt - leftAt || right.id.localeCompare(left.id);
    }), true);
  }
  return withOperations(candidates, false)
    .sort((left, right) => compareOperationClassifications(left.operation, right.operation)
      || right.updatedAt.getTime() - left.updatedAt.getTime()
      || right.id.localeCompare(left.id))
    .slice(0, 200);
}

export async function getAdminOrder(orderNumber: string) {
  assertDatabaseConfigured();
  return prisma.order.findUnique({
    where: { orderNumber },
    include: {
      events: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { actor: { select: { displayName: true, role: true } } },
      },
      assets: {
        where: { role: { in: ["REFERENCE", "DELIVERY"] } },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        include: { asset: true },
      },
      commercialLicenses: {
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      },
      rightsRequests: {
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { id: true, requestNumber: true, type: true, status: true, requestedPriceCents: true, currency: true, workTitle: true },
      },
      payments: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          provider: true,
          mode: true,
          status: true,
          amountCents: true,
          currency: true,
          pricingVersion: true,
          paymentMethod: true,
          failureCode: true,
          refundedAmountCents: true,
          refundedAt: true,
          invoice: { select: { id: true, invoiceNumber: true } },
          events: {
            where: { outcome: "REQUIRES_REVIEW" },
            select: { id: true },
          },
          providerCheckoutId: true,
          providerPaymentId: true,
          createdAt: true,
          updatedAt: true,
          refundAttempts: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              source: true,
              amountCents: true,
              currency: true,
              status: true,
              providerRefundId: true,
              failureCode: true,
              attempts: true,
              confirmedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          incidents: {
            orderBy: [{ openedAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              type: true,
              providerIncidentId: true,
              status: true,
              amountCents: true,
              currency: true,
              outcome: true,
              requiresOperatorReview: true,
              openedAt: true,
              resolvedAt: true,
            },
          },
          auditEvents: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 30,
            select: {
              id: true,
              action: true,
              amountCents: true,
              result: true,
              actorRole: true,
              createdAt: true,
            },
          },
        },
      },
      notifications: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          kind: true,
          channel: true,
          status: true,
          attempts: true,
          lastErrorCode: true,
          sentAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
}

export async function listAdminMembers() {
  assertDatabaseConfigured();
  return prisma.user.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      displayName: true,
      email: true,
      role: true,
      status: true,
      emailVerified: true,
      createdAt: true,
    },
  });
}

export async function getDatabaseCatalogueAudit() {
  assertDatabaseConfigured();
  return prisma.project.findMany({
    orderBy: [{ title: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      slug: true,
      title: true,
      type: true,
      status: true,
      featured: true,
      _count: { select: { tracks: true, platformLinks: true, assets: true } },
    },
  });
}

async function withOrderLock<T>(orderNumber: string, operation: (transaction: Transaction) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        // Payment checkout, webhooks and Admin lifecycle changes share this
        // exact key so Order status cannot diverge from payment state.
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`payments:order:${orderNumber}`})) IS NULL AS locked`;
        return operation(transaction);
      });
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") throw error;
    }
  }
  throw lastError;
}

export async function transitionOrderStatus(orderNumber: string, requestedStatus: string, actorUserId: string) {
  assertDatabaseConfigured();
  return withOrderLock(orderNumber, async (transaction) => {
    const order = await transaction.order.findUnique({ where: { orderNumber } });
    if (!order) throw new AdminServiceError("Commande introuvable.", "ORDER_NOT_FOUND");
    if (order.status === "DELIVERED" && requestedStatus === "DELIVERED") return "DELIVERED";
    const transition = getAdminOrderTransition(order.status, requestedStatus);
    if (!transition) throw new AdminServiceError("Transition de statut interdite.", "TRANSITION_NOT_ALLOWED");
    if (paidFulfillmentTargets.has(transition.to)) {
      const successfulPayments = await transaction.payment.count({
        where: { orderId: order.id, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } },
      });
      if (successfulPayments < 1) {
        throw new AdminServiceError("Cette étape exige un paiement confirmé.", "PAYMENT_REQUIRED");
      }
    }
    if (transition.to === "DELIVERED") {
      const [deliveries, validDeliveries] = await runSequentialDatabaseQueries(
        () => transaction.orderAsset.count({
          where: { orderId: order.id, role: "DELIVERY" },
        }),
        () => transaction.orderAsset.count({
          where: {
            orderId: order.id,
            role: "DELIVERY",
            asset: {
              type: { in: ["AUDIO", "DOCUMENT", "IMAGE"] },
              visibility: "PRIVATE",
              mimeType: { in: [...ORDER_DELIVERY_MIME_TYPES] },
            },
          },
        }),
      );
      if (deliveries < 1 || deliveries > MAXIMUM_ORDER_DELIVERIES || validDeliveries !== deliveries) {
        throw new AdminServiceError("Au moins un livrable privé valide est requis avant la publication.", "DELIVERY_REQUIRED");
      }
    }
    const now = new Date();
    const updated = await transaction.order.updateMany({
      where: { id: order.id, status: order.status },
      data: {
        status: transition.to,
        ...getOrderTransitionTimestamps(transition.to, now),
      },
    });
    if (updated.count !== 1) throw new AdminServiceError("La commande a changé entre-temps.", "ORDER_CONFLICT");
    await transaction.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: transition.to,
        note: transition.eventNote,
        visibility: transition.visibility,
        actorUserId,
      },
    });
    if (transition.to === "DELIVERED") {
      await enqueueCustomerDeliveryNotification(transaction, order);
    } else if (transition.to === "ACCEPTED" || transition.to === "IN_PROGRESS") {
      const kind = transition.to === "ACCEPTED" ? "CUSTOMER_ORDER_ACCEPTED" : "CUSTOMER_CREATION_STARTED";
      await enqueueOrderNotification(transaction, {
        orderId: order.id,
        kind,
        recipient: order.customerEmail,
        idempotencyKey: `order:${order.id}:${transition.to.toLowerCase()}:email`,
      });
    }
    return transition.to;
  });
}

export async function addInternalOrderNote(orderNumber: string, rawNote: unknown, actorUserId: string) {
  assertDatabaseConfigured();
  const note = normalizeAdminNote(rawNote);
  if (!note) throw new AdminServiceError("La note doit contenir entre 1 et 1 000 caractères.", "INVALID_NOTE");
  return withOrderLock(orderNumber, async (transaction) => {
    const order = await transaction.order.findUnique({ where: { orderNumber }, select: { id: true, status: true } });
    if (!order) throw new AdminServiceError("Commande introuvable.", "ORDER_NOT_FOUND");
    return transaction.orderEvent.create({
      data: {
        orderId: order.id,
        toStatus: order.status,
        note,
        visibility: "INTERNAL",
        actorUserId,
      },
    });
  });
}
