import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import {
  getAdminOrderTransition,
  getOrderDeletionEligibility,
  getOrderTransitionTimestamps,
  normalizeAdminNote,
} from "@/lib/admin/order-machine";
import type { KnownOrderStatus } from "@/lib/orders/status";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { deletePrivateOrderFile } from "@/lib/orders/storage";

type Transaction = Prisma.TransactionClient;

export class AdminServiceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "AdminServiceError";
  }
}

export const adminOrderFilters = ["all", "attention", "active", "delivered", "closed"] as const;
export type AdminOrderFilter = (typeof adminOrderFilters)[number];

const attentionStatuses: KnownOrderStatus[] = ["AWAITING_PAYMENT", "RECEIVED", "SUBMITTED", "REVIEWING", "REVISION_REQUESTED", "FIRST_VERSION_READY"];
const activeStatuses: KnownOrderStatus[] = ["ACCEPTED", "IN_PROGRESS", "FIRST_VERSION_READY", "REVISION_REQUESTED", "FINALIZING"];
const closedStatuses: KnownOrderStatus[] = ["REFUSED", "CANCELLED", "REFUND_PENDING", "REFUNDED"];

export function parseAdminOrderFilter(value: unknown): AdminOrderFilter {
  return typeof value === "string" && adminOrderFilters.includes(value as AdminOrderFilter)
    ? value as AdminOrderFilter
    : "all";
}

function statusesForFilter(filter: AdminOrderFilter): KnownOrderStatus[] | undefined {
  if (filter === "attention") return attentionStatuses;
  if (filter === "active") return activeStatuses;
  if (filter === "delivered") return ["DELIVERED"];
  if (filter === "closed") return closedStatuses;
  return undefined;
}

export async function getAdminOverview() {
  assertDatabaseConfigured();
  const [orders, attention, active, delivered, members, databaseProjects, featuredProject] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: { in: attentionStatuses } } }),
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
    where: statuses ? { status: { in: statuses } } : undefined,
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
      commercialLicenses: {
        where: { status: { in: ["REQUESTED", "CONTRACT_PENDING"] } },
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
        include: { actor: { select: { displayName: true } } },
      },
      assets: {
        where: { role: "REFERENCE" },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        include: { asset: true },
      },
      commercialLicenses: {
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
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
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`admin-order:${orderNumber}`})) IS NULL AS locked`;
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
    const transition = getAdminOrderTransition(order.status, requestedStatus);
    if (!transition) throw new AdminServiceError("Transition de statut interdite.", "TRANSITION_NOT_ALLOWED");
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
      select: { id: true, storageKey: true },
    }) : [];
    if (assetIds.length) {
      await transaction.asset.deleteMany({
        where: { id: { in: deletableAssets.map(({ id }) => id) } },
      });
    }
    return deletableAssets.map(({ storageKey }) => storageKey);
  });
  await Promise.all(storageKeys.map((storageKey) => deletePrivateOrderFile(storageKey)));
}
