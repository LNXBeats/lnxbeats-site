import "server-only";

import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";

import {
  classifyCommanderOperation,
  classifyNotificationOperation,
  classifyRightsOperation,
  classifyShopOrderOperation,
  classifyShopReturnOperation,
  classifyUncorrelatedFinancialEventOperation,
  commanderAttentionStatuses,
  rightsAdminAttentionStatuses,
  sortAdminActionItems,
  type AdminActionItem,
  type OperationClassification,
} from "@/lib/admin/operations";
import {
  adminNotificationAttentionWhere,
  adminUncorrelatedPaymentReviewEventWhere,
} from "@/lib/admin/operation-queries";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { shopAfterSalesQaEnabled } from "@/lib/shop/after-sales-config";

const ACTION_CANDIDATE_LIMIT = 12;
const COCKPIT_ACTION_LIMIT = 20;

export const commanderAttentionWhere = {
  OR: [
    { status: { in: [...commanderAttentionStatuses] } },
    { payments: { some: { status: "REQUIRES_REVIEW" } } },
    { payments: { some: { status: "REFUND_PENDING" } } },
    {
      status: { in: ["REFUSED", "CANCELLED"] },
      payments: { some: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } } },
    },
    {
      status: "REFUNDED",
      payments: { some: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } } },
    },
    { payments: { some: { incidents: { some: { requiresOperatorReview: true, status: { not: "RESOLVED" } } } } } },
    { rightsRequests: { some: { status: { in: [...rightsAdminAttentionStatuses] } } } },
  ],
} satisfies Prisma.OrderWhereInput;

export const commanderCockpitWhere = {
  OR: [
    { status: { in: [...commanderAttentionStatuses] } },
    { payments: { some: { status: "REQUIRES_REVIEW" } } },
    { payments: { some: { status: "REFUND_PENDING" } } },
    {
      status: { in: ["REFUSED", "CANCELLED"] },
      payments: { some: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } } },
    },
    {
      status: "REFUNDED",
      payments: { some: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } } },
    },
    { payments: { some: { incidents: { some: { requiresOperatorReview: true, status: { not: "RESOLVED" } } } } } },
  ],
} satisfies Prisma.OrderWhereInput;

export const commanderCriticalWhere = {
  OR: [
    { status: "REFUND_PENDING" },
    { payments: { some: { status: { in: ["REQUIRES_REVIEW", "REFUND_PENDING"] } } } },
    {
      status: "REFUNDED",
      payments: { some: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } } },
    },
    { payments: { some: { incidents: { some: { requiresOperatorReview: true, status: { not: "RESOLVED" } } } } } },
  ],
} satisfies Prisma.OrderWhereInput;

export const shopOrderAttentionWhere = {
  OR: [
    { paymentReviewAt: { not: null } },
    {
      status: "OPEN",
      paymentStatus: "PAID",
      paymentReviewAt: null,
      fulfillmentStatus: { in: ["PENDING", "PREPARING", "READY_TO_SHIP"] },
    },
    { customerRequests: { some: { status: "REQUESTED" } } },
    {
      customerRequests: {
        some: {
          refundAttempt: {
            is: {
              status: { in: ["PENDING", "PROCESSING", "REQUIRES_REVIEW"] },
            },
          },
        },
      },
    },
    { shippingProviderAttempts: { some: { status: { in: ["PENDING", "REQUIRES_REVIEW"] } } } },
  ],
} satisfies Prisma.ShopOrderWhereInput;

const shopOrderCriticalWhere = {
  OR: [
    { paymentReviewAt: { not: null } },
    {
      customerRequests: {
        some: {
          refundAttempt: {
            is: { status: { in: ["PENDING", "PROCESSING", "REQUIRES_REVIEW"] } },
          },
        },
      },
    },
  ],
} satisfies Prisma.ShopOrderWhereInput;

const rightsAttentionWhere = {
  status: { in: [...rightsAdminAttentionStatuses] },
} satisfies Prisma.RightsRequestWhereInput;

function actionItem(
  domain: AdminActionItem["domain"],
  id: string,
  reference: string,
  occurredAt: Date,
  href: string,
  classification: OperationClassification,
): AdminActionItem {
  return {
    key: `${domain}:${id}:${classification.reasonCode}`,
    domain,
    reasonCode: classification.reasonCode,
    priority: classification.priority,
    occurredAt,
    reference,
    label: classification.label,
    href,
  };
}

type CandidateId = Readonly<{ id: string; occurredAt: Date }>;

async function loadActionCandidateIds(now: Date) {
  const [commander, shopOrders, rights, notifications, shopReturns, financialEvents] = await Promise.all([
    prisma.$queryRaw<CandidateId[]>`
      SELECT candidate."id", candidate."occurredAt"
      FROM (
        SELECT orders."id",
          CASE
            WHEN EXISTS (
              SELECT 1 FROM "payment_incidents" incidents
              JOIN "payments" payments ON payments."id" = incidents."paymentId"
              WHERE payments."orderId" = orders."id"
                AND incidents."requiresOperatorReview" = TRUE
                AND incidents."status" <> 'RESOLVED'
            ) OR EXISTS (
              SELECT 1 FROM "payments" payments
              WHERE payments."orderId" = orders."id"
                AND payments."status" IN ('REQUIRES_REVIEW', 'REFUND_PENDING')
            ) THEN 0
            WHEN orders."status" = 'REFUNDED' AND EXISTS (
              SELECT 1 FROM "payments" payments
              WHERE payments."orderId" = orders."id"
                AND payments."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED')
            ) THEN 0
            WHEN orders."status" IN ('REFUSED', 'CANCELLED') AND EXISTS (
              SELECT 1 FROM "payments" payments
              WHERE payments."orderId" = orders."id"
                AND payments."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED')
            ) THEN 1
            ELSE 2
          END AS "priorityRank",
          CASE
            WHEN EXISTS (
              SELECT 1 FROM "payment_incidents" incidents
              JOIN "payments" payments ON payments."id" = incidents."paymentId"
              WHERE payments."orderId" = orders."id"
                AND incidents."requiresOperatorReview" = TRUE
                AND incidents."status" <> 'RESOLVED'
            ) THEN COALESCE((
              SELECT MIN(incidents."openedAt") FROM "payment_incidents" incidents
              JOIN "payments" payments ON payments."id" = incidents."paymentId"
              WHERE payments."orderId" = orders."id"
                AND incidents."requiresOperatorReview" = TRUE
                AND incidents."status" <> 'RESOLVED'
            ), orders."updatedAt")
            WHEN EXISTS (
              SELECT 1 FROM "payments" payments
              WHERE payments."orderId" = orders."id"
                AND payments."status" IN ('REQUIRES_REVIEW', 'REFUND_PENDING')
            ) THEN COALESCE((
              SELECT MIN(payments."updatedAt") FROM "payments" payments
              WHERE payments."orderId" = orders."id"
                AND payments."status" IN ('REQUIRES_REVIEW', 'REFUND_PENDING')
            ), orders."updatedAt")
            WHEN orders."status" IN ('REFUSED', 'CANCELLED', 'REFUNDED') THEN COALESCE((
              SELECT MIN(payments."updatedAt") FROM "payments" payments
              WHERE payments."orderId" = orders."id"
                AND payments."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED')
            ), orders."updatedAt")
            ELSE orders."updatedAt"
          END AS "occurredAt"
        FROM "orders" orders
        WHERE (
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
            WHERE payments."orderId" = orders."id"
              AND payments."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED')
          ))
          OR (orders."status" = 'REFUNDED' AND EXISTS (
            SELECT 1 FROM "payments" payments
            WHERE payments."orderId" = orders."id"
              AND payments."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED')
          ))
        )
      ) candidate
      ORDER BY candidate."priorityRank" ASC, candidate."occurredAt" ASC, candidate."id" ASC
      LIMIT ${ACTION_CANDIDATE_LIMIT}
    `,
    prisma.$queryRaw<CandidateId[]>`
      SELECT orders."id",
        CASE
          WHEN orders."paymentReviewAt" IS NOT NULL THEN orders."paymentReviewAt"
          WHEN EXISTS (
            SELECT 1 FROM "shop_order_customer_requests" requests
            JOIN "refund_attempts" attempts ON attempts."shopCustomerRequestId" = requests."id"
            WHERE requests."shopOrderId" = orders."id"
              AND attempts."status" IN ('PENDING', 'PROCESSING', 'REQUIRES_REVIEW')
          ) THEN COALESCE((
            SELECT MIN(attempts."updatedAt") FROM "shop_order_customer_requests" requests
            JOIN "refund_attempts" attempts ON attempts."shopCustomerRequestId" = requests."id"
            WHERE requests."shopOrderId" = orders."id"
              AND attempts."status" IN ('PENDING', 'PROCESSING', 'REQUIRES_REVIEW')
          ), orders."updatedAt")
          WHEN EXISTS (
            SELECT 1 FROM "shop_shipping_provider_attempts" attempts
            WHERE attempts."shopOrderId" = orders."id" AND attempts."status" IN ('PENDING', 'REQUIRES_REVIEW')
          ) THEN COALESCE((
            SELECT MIN(attempts."updatedAt") FROM "shop_shipping_provider_attempts" attempts
            WHERE attempts."shopOrderId" = orders."id" AND attempts."status" IN ('PENDING', 'REQUIRES_REVIEW')
          ), orders."updatedAt")
          WHEN EXISTS (
            SELECT 1 FROM "shop_order_customer_requests" requests
            WHERE requests."shopOrderId" = orders."id" AND requests."status" = 'REQUESTED'
          ) THEN COALESCE((
            SELECT MIN(requests."requestedAt") FROM "shop_order_customer_requests" requests
            WHERE requests."shopOrderId" = orders."id" AND requests."status" = 'REQUESTED'
          ), orders."updatedAt")
          ELSE orders."updatedAt"
        END AS "occurredAt"
      FROM "shop_orders" orders
      WHERE (
        orders."paymentReviewAt" IS NOT NULL
        OR (orders."status" = 'OPEN' AND orders."paymentStatus" = 'PAID' AND orders."paymentReviewAt" IS NULL AND orders."fulfillmentStatus" IN ('PENDING', 'PREPARING', 'READY_TO_SHIP'))
        OR EXISTS (SELECT 1 FROM "shop_order_customer_requests" requests WHERE requests."shopOrderId" = orders."id" AND requests."status" = 'REQUESTED')
        OR EXISTS (
          SELECT 1 FROM "shop_order_customer_requests" requests
          JOIN "refund_attempts" attempts ON attempts."shopCustomerRequestId" = requests."id"
          WHERE requests."shopOrderId" = orders."id" AND attempts."status" IN ('PENDING', 'PROCESSING', 'REQUIRES_REVIEW')
        )
        OR EXISTS (SELECT 1 FROM "shop_shipping_provider_attempts" attempts WHERE attempts."shopOrderId" = orders."id" AND attempts."status" IN ('PENDING', 'REQUIRES_REVIEW'))
      )
      ORDER BY
        CASE
          WHEN orders."paymentReviewAt" IS NOT NULL OR EXISTS (
            SELECT 1 FROM "shop_order_customer_requests" requests
            JOIN "refund_attempts" attempts ON attempts."shopCustomerRequestId" = requests."id"
            WHERE requests."shopOrderId" = orders."id" AND attempts."status" IN ('PENDING', 'PROCESSING', 'REQUIRES_REVIEW')
          ) THEN 0
          WHEN EXISTS (SELECT 1 FROM "shop_shipping_provider_attempts" attempts WHERE attempts."shopOrderId" = orders."id" AND attempts."status" IN ('PENDING', 'REQUIRES_REVIEW'))
            OR EXISTS (SELECT 1 FROM "shop_order_customer_requests" requests WHERE requests."shopOrderId" = orders."id" AND requests."status" = 'REQUESTED') THEN 1
          ELSE 2
        END ASC,
        "occurredAt" ASC,
        orders."id" ASC
      LIMIT ${ACTION_CANDIDATE_LIMIT}
    `,
    prisma.$queryRaw<CandidateId[]>`
      SELECT requests."id", requests."updatedAt" AS "occurredAt"
      FROM "rights_requests" requests
      WHERE requests."status" IN ('SUBMITTED', 'UNDER_REVIEW', 'PREAUTHORIZATION_GENERATED', 'CONTRACT_PREPARATION', 'CLIENT_ACCEPTED', 'ADMIN_VALIDATED')
      ORDER BY CASE WHEN requests."status" = 'CLIENT_ACCEPTED' THEN 1 ELSE 2 END ASC, requests."updatedAt" ASC, requests."id" ASC
      LIMIT ${ACTION_CANDIDATE_LIMIT}
    `,
    prisma.$queryRaw<CandidateId[]>`
      SELECT notifications."id", COALESCE(notifications."leaseExpiresAt", notifications."updatedAt") AS "occurredAt"
      FROM "order_notifications" notifications
      WHERE (
        (notifications."status" = 'FAILED_RETRYABLE' AND notifications."attempts" < 5)
        OR notifications."status" IN ('FAILED_FINAL', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED')
        OR (notifications."status" = 'PROCESSING' AND (notifications."leaseExpiresAt" <= ${now} OR notifications."leaseExpiresAt" IS NULL))
      )
      ORDER BY CASE WHEN notifications."status" = 'PROCESSING' THEN 0 ELSE 1 END ASC, "occurredAt" ASC, notifications."id" ASC
      LIMIT ${ACTION_CANDIDATE_LIMIT}
    `,
    prisma.$queryRaw<CandidateId[]>`
      SELECT requests."id", requests."updatedAt" AS "occurredAt"
      FROM "shop_return_requests" requests
      WHERE requests."status" IN ('REQUESTED', 'UNDER_REVIEW', 'AWAITING_RETURN', 'RETURN_RECEIVED')
         OR requests."refundStatus" = 'REQUIRES_REVIEW'
         OR (requests."status" IN ('APPROVED', 'INSPECTED') AND NOT EXISTS (
           SELECT 1 FROM "refund_attempts" attempts WHERE attempts."shopReturnRequestId" = requests."id"
         ))
         OR EXISTS (
           SELECT 1 FROM "refund_attempts" attempts
           WHERE attempts."shopReturnRequestId" = requests."id" AND attempts."status" IN ('PROCESSING', 'PENDING', 'REQUIRES_REVIEW')
         )
         OR (requests."status" IN ('INSPECTED', 'REFUND_PENDING', 'REFUNDED') AND EXISTS (
           SELECT 1 FROM "shop_return_items" items
           WHERE items."shopReturnRequestId" = requests."id"
             AND items."restockDecision" = 'RESTOCKABLE'
             AND items."restockedQuantity" < items."restockableQuantity"
         ))
      ORDER BY CASE
        WHEN requests."refundStatus" = 'REQUIRES_REVIEW' OR EXISTS (
          SELECT 1 FROM "refund_attempts" attempts
          WHERE attempts."shopReturnRequestId" = requests."id" AND attempts."status" IN ('PROCESSING', 'PENDING', 'REQUIRES_REVIEW')
        ) THEN 0
        WHEN requests."status" IN ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'INSPECTED') THEN 1
        ELSE 2
      END ASC, requests."updatedAt" ASC, requests."id" ASC
      LIMIT ${ACTION_CANDIDATE_LIMIT}
    `,
    prisma.$queryRaw<CandidateId[]>`
      SELECT events."id", events."processedAt" AS "occurredAt"
      FROM "provider_events" events
      WHERE events."outcome" = 'REQUIRES_REVIEW'
        AND events."paymentId" IS NULL
        AND events."refundAttemptId" IS NULL
        AND events."incidentId" IS NULL
      ORDER BY events."processedAt" ASC, events."id" ASC
      LIMIT ${ACTION_CANDIDATE_LIMIT}
    `,
  ]);
  return { commander, shopOrders, rights, notifications, shopReturns, financialEvents } as const;
}

async function loadAdminActionSummary() {
  assertDatabaseConfigured();
  const now = new Date();
  const [
    commanderOrders,
    shopOrders,
    rights,
    notifications,
    shopReturnCountRows,
    financialEvents,
    commanderCritical,
    shopOrdersCritical,
    notificationsCritical,
    shopReturnsCritical,
  ] = await Promise.all([
    prisma.order.count({ where: commanderCockpitWhere }),
    prisma.shopOrder.count({ where: shopOrderAttentionWhere }),
    prisma.rightsRequest.count({ where: rightsAttentionWhere }),
    prisma.orderNotification.count({ where: adminNotificationAttentionWhere(now) }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "shop_return_requests" AS request
      WHERE request."status" IN ('REQUESTED', 'UNDER_REVIEW', 'AWAITING_RETURN', 'RETURN_RECEIVED')
         OR request."refundStatus" = 'REQUIRES_REVIEW'
         OR (
           request."status" IN ('APPROVED', 'INSPECTED')
           AND NOT EXISTS (
             SELECT 1 FROM "refund_attempts" AS attempt
             WHERE attempt."shopReturnRequestId" = request."id"
           )
         )
         OR EXISTS (
           SELECT 1 FROM "refund_attempts" AS attempt
           WHERE attempt."shopReturnRequestId" = request."id"
             AND attempt."status" IN ('PROCESSING', 'PENDING', 'REQUIRES_REVIEW')
         )
         OR (
           request."status" IN ('INSPECTED', 'REFUND_PENDING', 'REFUNDED')
           AND EXISTS (
             SELECT 1 FROM "shop_return_items" AS item
             WHERE item."shopReturnRequestId" = request."id"
               AND item."restockDecision" = 'RESTOCKABLE'
               AND item."restockedQuantity" < item."restockableQuantity"
           )
         )
    `,
    prisma.providerEvent.count({ where: adminUncorrelatedPaymentReviewEventWhere }),
    prisma.order.count({ where: commanderCriticalWhere }),
    prisma.shopOrder.count({ where: shopOrderCriticalWhere }),
    prisma.orderNotification.count({
      where: {
        status: "PROCESSING",
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
    }),
    prisma.shopReturnRequest.count({
      where: {
        OR: [
          { refundStatus: "REQUIRES_REVIEW" },
          { refundAttempt: { is: { status: { in: ["PROCESSING", "PENDING", "REQUIRES_REVIEW"] } } } },
        ],
      },
    }),
  ]);
  const shopReturns = Number(shopReturnCountRows[0]?.count ?? 0n);
  const commander = commanderOrders + financialEvents;
  const counts = { commander, shopOrders, rights, notifications, shopReturns } as const;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const commanderCriticalTotal = commanderCritical + financialEvents;
  const criticalTotal = commanderCriticalTotal + shopOrdersCritical + notificationsCritical + shopReturnsCritical;
  const shopReturnsHref = shopAfterSalesQaEnabled() ? "/admin/boutique/retours" : "/admin/boutique";
  return {
    counts,
    total,
    shopReturnsHref,
    financialEvents,
    actionRequiredCounts: {
      "/admin": total,
      "/admin/commandes": commander,
      "/admin/droits": rights,
      "/admin/notifications": notifications,
      "/admin/boutique/commandes": shopOrders,
      [shopReturnsHref]: shopReturns,
    },
    criticalActionRequiredCounts: {
      "/admin": criticalTotal,
      "/admin/commandes": commanderCriticalTotal,
      "/admin/notifications": notificationsCritical,
      "/admin/boutique/commandes": shopOrdersCritical,
      [shopReturnsHref]: shopReturnsCritical,
    },
  } as const;
}

export const getAdminActionSummary = cache(loadAdminActionSummary);

async function loadAdminCockpit() {
  assertDatabaseConfigured();
  const now = new Date();
  const [summary, candidateIds] = await Promise.all([getAdminActionSummary(), loadActionCandidateIds(now)]);

  const [
    commanderRows,
    shopOrderRows,
    rightsRows,
    notificationRows,
    shopReturnRows,
    financialEventRows,
  ] = await Promise.all([
    prisma.order.findMany({
      where: { id: { in: candidateIds.commander.map((candidate) => candidate.id) } },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        updatedAt: true,
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
    }),
    prisma.shopOrder.findMany({
      where: { id: { in: candidateIds.shopOrders.map((candidate) => candidate.id) } },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        paymentReviewAt: true,
        updatedAt: true,
        customerRequests: {
          where: { status: "REQUESTED" },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          select: { id: true },
          take: 1,
        },
        payments: {
          where: {
            refundAttempts: {
              some: {
                shopCustomerRequestId: { not: null },
                status: { in: ["PENDING", "PROCESSING", "REQUIRES_REVIEW"] },
              },
            },
          },
          select: { id: true },
          take: 1,
        },
        shippingProviderAttempts: {
          where: { status: { in: ["PENDING", "REQUIRES_REVIEW"] } },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          select: { id: true },
          take: 25,
        },
      },
    }),
    prisma.rightsRequest.findMany({
      where: { id: { in: candidateIds.rights.map((candidate) => candidate.id) } },
      select: { id: true, requestNumber: true, status: true, updatedAt: true },
    }),
    prisma.orderNotification.findMany({
      where: { id: { in: candidateIds.notifications.map((candidate) => candidate.id) } },
      select: {
        id: true,
        kind: true,
        status: true,
        attempts: true,
        leaseExpiresAt: true,
        updatedAt: true,
      },
    }),
    prisma.shopReturnRequest.findMany({
      where: { id: { in: candidateIds.shopReturns.map((candidate) => candidate.id) } },
      select: {
        id: true,
        requestNumber: true,
        status: true,
        refundStatus: true,
        updatedAt: true,
        refundAttempt: { select: { id: true, status: true } },
        items: {
          where: { restockDecision: "RESTOCKABLE" },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take: 50,
          select: { restockableQuantity: true, restockedQuantity: true },
        },
      },
    }),
    prisma.providerEvent.findMany({
      where: { id: { in: candidateIds.financialEvents.map((candidate) => candidate.id) } },
      select: {
        id: true,
        provider: true,
        type: true,
        outcome: true,
        paymentId: true,
        refundAttemptId: true,
        incidentId: true,
        processedAt: true,
      },
    }),
  ]);

  const candidateOccurredAt = {
    commander: new Map(candidateIds.commander.map((candidate) => [candidate.id, candidate.occurredAt])),
    shopOrders: new Map(candidateIds.shopOrders.map((candidate) => [candidate.id, candidate.occurredAt])),
    rights: new Map(candidateIds.rights.map((candidate) => [candidate.id, candidate.occurredAt])),
    notifications: new Map(candidateIds.notifications.map((candidate) => [candidate.id, candidate.occurredAt])),
    shopReturns: new Map(candidateIds.shopReturns.map((candidate) => [candidate.id, candidate.occurredAt])),
    financialEvents: new Map(candidateIds.financialEvents.map((candidate) => [candidate.id, candidate.occurredAt])),
  } as const;

  const commanderActions = commanderRows.flatMap((row) => {
    const classification = classifyCommanderOperation({
      status: row.status,
      hasPaymentReview: row.payments.some((payment) => payment.status === "REQUIRES_REVIEW"),
      hasUnresolvedFinancialIncident: row.payments.some((payment) => payment.incidents.length > 0),
      hasRefundPending: row.payments.some((payment) => payment.status === "REFUND_PENDING"),
      hasRefundDue: ["REFUSED", "CANCELLED"].includes(row.status)
        && row.payments.some((payment) => ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status)),
      hasRefundContradiction: row.status === "REFUNDED"
        && row.payments.some((payment) => ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status)),
    });
    return classification
      ? [actionItem("COMMANDER", row.id, row.orderNumber, candidateOccurredAt.commander.get(row.id) ?? row.updatedAt, `/admin/commandes/${encodeURIComponent(row.orderNumber)}`, classification)]
      : [];
  });

  const shopOrderActions = shopOrderRows.flatMap((row) => {
    const classification = classifyShopOrderOperation({
      status: row.status,
      paymentStatus: row.paymentStatus,
      fulfillmentStatus: row.fulfillmentStatus,
      paymentReviewAt: row.paymentReviewAt,
      hasCustomerRequest: row.customerRequests.length > 0,
      hasRefundReview: row.payments.length > 0,
      hasShippingReview: row.shippingProviderAttempts.length > 0,
    });
    return classification
      ? [actionItem("SHOP_ORDER", row.id, row.orderNumber, candidateOccurredAt.shopOrders.get(row.id) ?? row.updatedAt, `/admin/boutique/commandes/${encodeURIComponent(row.orderNumber)}`, classification)]
      : [];
  });

  const rightsActions = rightsRows.flatMap((row) => {
    const classification = classifyRightsOperation(row.status);
    return classification
      ? [actionItem("RIGHTS", row.id, row.requestNumber, candidateOccurredAt.rights.get(row.id) ?? row.updatedAt, `/admin/droits/${encodeURIComponent(row.requestNumber)}`, classification)]
      : [];
  });

  const notificationActions = notificationRows.flatMap((row) => {
    const classification = classifyNotificationOperation({
      status: row.status,
      attempts: row.attempts,
      suppressionActive: row.status === "SUPPRESSED",
      leaseExpiresAt: row.leaseExpiresAt,
    }, now);
    return classification
      ? [actionItem("NOTIFICATION", row.id, row.kind, candidateOccurredAt.notifications.get(row.id) ?? row.updatedAt, "/admin/notifications?filtre=attention", classification)]
      : [];
  });

  const shopReturnActions = shopReturnRows.flatMap((row) => {
    const classification = classifyShopReturnOperation({
      status: row.status,
      refundStatus: row.refundStatus,
      hasRefundAttempt: Boolean(row.refundAttempt),
      refundAttemptStatus: row.refundAttempt?.status,
      hasRestockRemaining: row.items.some((item) => item.restockedQuantity < item.restockableQuantity),
    });
    return classification
      ? [actionItem("SHOP_RETURN", row.id, row.requestNumber, candidateOccurredAt.shopReturns.get(row.id) ?? row.updatedAt, summary.shopReturnsHref === "/admin/boutique/retours" ? `/admin/boutique/retours/${encodeURIComponent(row.requestNumber)}` : summary.shopReturnsHref, classification)]
      : [];
  });

  const financialEventActions = financialEventRows.flatMap((row) => {
    const classification = classifyUncorrelatedFinancialEventOperation(row);
    return classification
      ? [actionItem(
          "FINANCIAL_EVENT",
          row.id,
          `${row.provider} · ${row.type}`,
          candidateOccurredAt.financialEvents.get(row.id) ?? row.processedAt,
          "/admin/commandes?filtre=attention#admin-payment-review-title",
          classification,
        )]
      : [];
  });

  return {
    ...summary,
    actions: sortAdminActionItems([
      ...commanderActions,
      ...shopOrderActions,
      ...rightsActions,
      ...notificationActions,
      ...shopReturnActions,
      ...financialEventActions,
    ]).slice(0, COCKPIT_ACTION_LIMIT),
  } as const;
}

export const getAdminCockpit = cache(loadAdminCockpit);
