import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import {
  getAdminOrderTransition,
  getOrderDeletionEligibility,
  getOrderTransitionTimestamps,
  normalizeAdminNote,
} from "@/lib/admin/order-machine";
import type { KnownOrderStatus } from "@/lib/orders/status";
import { enqueueCustomerDeliveryNotification, enqueueOrderNotification } from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { deletePrivateOrderFile } from "@/lib/orders/storage";
import { ORDER_DELIVERY_MIME_TYPES } from "@/lib/orders/audio-request";
import { MAXIMUM_ORDER_DELIVERIES } from "@/lib/orders/delivery";

type Transaction = Prisma.TransactionClient;

export class AdminServiceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "AdminServiceError";
  }
}

export const adminOrderFilters = ["attention", "active", "pending", "delivered", "closed", "all"] as const;
export type AdminOrderFilter = (typeof adminOrderFilters)[number];

const attentionStatuses: KnownOrderStatus[] = ["PAYMENT_CONFIRMED", "RECEIVED", "SUBMITTED", "REVIEWING", "REVISION_REQUESTED", "FIRST_VERSION_READY"];
const activeStatuses: KnownOrderStatus[] = ["ACCEPTED", "IN_PROGRESS", "FIRST_VERSION_READY", "REVISION_REQUESTED", "FINALIZING"];
const pendingStatuses: KnownOrderStatus[] = ["DRAFT", "AWAITING_PAYMENT"];
const closedStatuses: KnownOrderStatus[] = ["REFUSED", "CANCELLED", "REFUND_PENDING", "REFUNDED"];
const paymentReviewFailureCodeFilter = { startsWith: "WEBHOOK_" } as const;
const paidFulfillmentTargets = new Set<KnownOrderStatus>([
  "RECEIVED", "REVIEWING", "ACCEPTED", "IN_PROGRESS", "FIRST_VERSION_READY",
  "REVISION_REQUESTED", "FINALIZING", "DELIVERED",
]);

export function parseAdminOrderFilter(value: unknown): AdminOrderFilter {
  return typeof value === "string" && adminOrderFilters.includes(value as AdminOrderFilter)
    ? value as AdminOrderFilter
    : "attention";
}

function statusesForFilter(filter: AdminOrderFilter): KnownOrderStatus[] | undefined {
  if (filter === "attention") return attentionStatuses;
  if (filter === "active") return activeStatuses;
  if (filter === "pending") return pendingStatuses;
  if (filter === "delivered") return ["DELIVERED"];
  if (filter === "closed") return closedStatuses;
  return undefined;
}

export async function listAdminPaymentReviewEvents() {
  assertDatabaseConfigured();
  return prisma.providerEvent.findMany({
    where: { outcome: "REQUIRES_REVIEW" },
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

export async function getAdminOverview() {
  assertDatabaseConfigured();
  const [orders, attention, active, delivered, members, databaseProjects, featuredProject] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({
      where: {
        OR: [
          { status: { in: attentionStatuses } },
          { payments: { some: { OR: [{ status: "REQUIRES_REVIEW" }, { failureCode: paymentReviewFailureCodeFilter }] } } },
          { payments: { some: { events: { some: { outcome: "REQUIRES_REVIEW" } } } } },
        ],
      },
    }),
    prisma.order.count({ where: { status: { in: activeStatuses } } }),
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
  const statuses = statusesForFilter(filter);
  return prisma.order.findMany({
    where: filter === "attention"
      ? {
          OR: [
            { status: { in: statuses } },
            { payments: { some: { OR: [{ status: "REQUIRES_REVIEW" }, { failureCode: paymentReviewFailureCodeFilter }] } } },
            { payments: { some: { events: { some: { outcome: "REQUIRES_REVIEW" } } } } },
          ],
        }
      : statuses ? { status: { in: statuses } } : undefined,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      orderNumber: true,
      customerName: true,
      customerEmail: true,
      title: true,
      recipient: true,
      status: true,
      coverIncluded: true,
      priorityProcessing: true,
      totalCents: true,
      createdAt: true,
      updatedAt: true,
      rightsRequests: {
        where: { status: { in: ["SUBMITTED", "INFORMATION_REQUIRED", "UNDER_REVIEW", "PREAUTHORIZATION_GENERATED", "CONTRACT_PREPARATION", "CONTRACT_READY", "CLIENT_ACCEPTED", "ADMIN_VALIDATED", "READY_FOR_PAYMENT"] } },
        select: { id: true },
      },
      payments: {
        where: {
          OR: [
            { status: "REQUIRES_REVIEW" },
            { failureCode: paymentReviewFailureCodeFilter },
            { events: { some: { outcome: "REQUIRES_REVIEW" } } },
          ],
        },
        select: { id: true },
      },
    },
  });
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
      const [deliveries, validDeliveries] = await Promise.all([
        transaction.orderAsset.count({
          where: { orderId: order.id, role: "DELIVERY" },
        }),
        transaction.orderAsset.count({
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
      ]);
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

export async function deleteEligibleAdminOrder(orderNumber: string) {
  assertDatabaseConfigured();
  const storageKeys = await withOrderLock(orderNumber, async (transaction) => {
    const order = await transaction.order.findUnique({
      where: { orderNumber },
      include: {
        events: { select: { toStatus: true } },
        assets: { include: { asset: true } },
        commercialLicenses: { select: { id: true } },
        rightsRequests: { select: { id: true } },
        payments: { select: { id: true } },
      },
    });
    if (!order) throw new AdminServiceError("Commande introuvable.", "ORDER_NOT_FOUND");
    const eligibility = getOrderDeletionEligibility(order);
    if (!eligibility.eligible) throw new AdminServiceError(eligibility.reason, "ORDER_DELETE_FORBIDDEN");

    const assetIds = order.assets.map(({ assetId }) => assetId);
    await transaction.orderAsset.deleteMany({ where: { orderId: order.id } });
    await transaction.orderEvent.deleteMany({ where: { orderId: order.id } });
    await transaction.order.delete({ where: { id: order.id } });
    const deletableAssets = assetIds.length ? await transaction.asset.findMany({
      where: { id: { in: assetIds }, projects: { none: {} }, orders: { none: {} } },
      select: { id: true, storageKey: true, storageBackend: true, storageProvider: true, visibility: true },
    }) : [];
    if (assetIds.length) {
      await transaction.asset.deleteMany({
        where: { id: { in: deletableAssets.map(({ id }) => id) } },
      });
    }
    return deletableAssets;
  });
  await Promise.all(storageKeys.map((asset) => deletePrivateOrderFile(asset)));
}
