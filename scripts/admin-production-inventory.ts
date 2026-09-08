import type { Prisma } from "@/generated/prisma/client";

import { rightsOffers } from "@/data/rights-offer";
import { classifyMusicOrderCleanup } from "@/lib/admin/cleanup-classification";
import {
  classifyCommanderOperation,
  commanderAttentionStatuses,
  rightsAdminAttentionStatuses,
} from "@/lib/admin/operations";
import { adminUncorrelatedPaymentReviewEventWhere } from "@/lib/admin/operation-queries";
import { prisma } from "@/lib/prisma";
import { evaluateRightsCommerceReadiness } from "@/lib/rights/commerce";
import { isLegalTemplateUsable } from "@/lib/rights/domain";
import { validateContractTemplate } from "@/lib/rights/templates";

const INVENTORY_CONFIRMATION = "read-only-v120-admin-inventory";
const MUSIC_ORDER_LIMIT = 10;
const QA_TITLE_MARKER = /\b(?:qa|test|fixture|e2e|demo)\b/i;

type CleanupClassification = "DELETE_SAFE" | "ARCHIVE_REQUIRED" | "KEEP_ACTION_REQUIRED";

function assertProductionInventoryEnvironment(environment: NodeJS.ProcessEnv) {
  const railwayProduction = environment.RAILWAY_ENVIRONMENT_NAME === "production"
    || environment.RAILWAY_ENVIRONMENT === "production";
  if (!railwayProduction) throw new Error("PRODUCTION_RAILWAY_ENVIRONMENT_REQUIRED");
  if (environment.RAILWAY_ENVIRONMENT_NAME && environment.RAILWAY_ENVIRONMENT_NAME !== "production") {
    throw new Error("PRODUCTION_RAILWAY_ENVIRONMENT_REQUIRED");
  }
  if (environment.RAILWAY_ENVIRONMENT && environment.RAILWAY_ENVIRONMENT !== "production") {
    throw new Error("PRODUCTION_RAILWAY_ENVIRONMENT_REQUIRED");
  }
  if (environment.LNX_ADMIN_INVENTORY_CONFIRM !== INVENTORY_CONFIRMATION) {
    throw new Error("READ_ONLY_INVENTORY_CONFIRMATION_REQUIRED");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(environment.DATABASE_URL ?? "");
  } catch {
    throw new Error("POSTGRESQL_DATABASE_REQUIRED");
  }
  if (databaseUrl.protocol !== "postgresql:" && databaseUrl.protocol !== "postgres:") {
    throw new Error("POSTGRESQL_DATABASE_REQUIRED");
  }
}

const commanderActionableWhere = {
  OR: [
    { status: { in: [...commanderAttentionStatuses] } },
    { payments: { some: { status: { in: ["REQUIRES_REVIEW", "REFUND_PENDING"] as const } } } },
    {
      status: { in: ["REFUSED", "CANCELLED", "REFUNDED"] as const },
      payments: { some: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] as const } } },
    },
    {
      payments: {
        some: {
          incidents: {
            some: { requiresOperatorReview: true, status: { not: "RESOLVED" as const } },
          },
        },
      },
    },
  ],
} satisfies Prisma.OrderWhereInput;

const shopActionableWhere = {
  OR: [
    { paymentReviewAt: { not: null } },
    {
      status: "OPEN" as const,
      paymentStatus: "PAID" as const,
      paymentReviewAt: null,
      fulfillmentStatus: { in: ["PENDING", "PREPARING", "READY_TO_SHIP"] as const },
    },
    { customerRequests: { some: { status: "REQUESTED" as const } } },
    {
      customerRequests: {
        some: {
          refundAttempt: {
            is: { status: { in: ["PENDING", "PROCESSING", "REQUIRES_REVIEW"] as const } },
          },
        },
      },
    },
    {
      shippingProviderAttempts: {
        some: { status: { in: ["PENDING", "REQUIRES_REVIEW"] as const } },
      },
    },
  ],
} satisfies Prisma.ShopOrderWhereInput;

const notificationActionableWhere = (now: Date) => ({
  OR: [
    { status: "FAILED_RETRYABLE" as const, attempts: { lt: 5 } },
    { status: { in: ["FAILED_FINAL", "BOUNCED", "COMPLAINED", "SUPPRESSED"] as const } },
    {
      status: "PROCESSING" as const,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    },
  ],
}) satisfies Prisma.OrderNotificationWhereInput;

const musicOrderSelect = {
  orderNumber: true,
  title: true,
  customerEmail: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  serviceStartedAt: true,
  deliveredAt: true,
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
      incidents: {
        where: { requiresOperatorReview: true, status: { not: "RESOLVED" as const } },
        select: { status: true, requiresOperatorReview: true },
      },
    },
  },
  invoices: { select: { creditNotes: { select: { reasonCode: true } } } },
  notifications: { select: { status: true } },
  withdrawalRequests: { select: { status: true } },
} satisfies Prisma.OrderSelect;

type MusicOrderRow = Prisma.OrderGetPayload<{ select: typeof musicOrderSelect }>;

function hasQaTitleMarker(title: string | null) {
  return Boolean(title && QA_TITLE_MARKER.test(title));
}

function classifyMusicOrder(row: MusicOrderRow): CleanupClassification {
  return classifyMusicOrderCleanup(row).classification;
}

function musicOrderInventory(row: MusicOrderRow) {
  const paymentEvidence = row.payments.length > 0;
  const invoice = row.invoices.length > 0;
  const creditNote = row.invoices.some((item) => item.creditNotes.length > 0);
  const refund = row.payments.some((payment) => payment.refundedAmountCents > 0
    || payment.refundAttempts.length > 0
    || ["REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status));
  const openAction = Boolean(classifyCommanderOperation({
    status: row.status,
    hasPaymentReview: row.payments.some((payment) => payment.status === "REQUIRES_REVIEW"),
    hasUnresolvedFinancialIncident: row.payments.some((payment) => payment.incidents.length > 0),
    hasRefundPending: row.payments.some((payment) => payment.status === "REFUND_PENDING"),
    hasRefundDue: ["REFUSED", "CANCELLED", "REFUNDED"].includes(row.status)
      && row.payments.some((payment) => ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status)),
    hasRightsReview: row.rightsRequests.some((request) => (
      rightsAdminAttentionStatuses as readonly string[]
    ).includes(request.status)),
  }));

  return {
    reference: row.orderNumber,
    title: hasQaTitleMarker(row.title) ? "[essai détecté]" : "[masqué]",
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    paymentEvidence,
    invoice,
    creditNote,
    refund,
    openAction,
    classification: classifyMusicOrder(row),
  } as const;
}

async function buildInventory(transaction: Prisma.TransactionClient) {
  const now = new Date();
  const [
    commander,
    shopOrders,
    rights,
    notifications,
    financialEvents,
    shopReturnCountRows,
    musicRows,
    templates,
  ] = await Promise.all([
    transaction.order.count({ where: commanderActionableWhere }),
    transaction.shopOrder.count({ where: shopActionableWhere }),
    transaction.rightsRequest.count({ where: { status: { in: [...rightsAdminAttentionStatuses] } } }),
    transaction.orderNotification.count({ where: notificationActionableWhere(now) }),
    transaction.providerEvent.count({ where: adminUncorrelatedPaymentReviewEventWhere }),
    transaction.$queryRaw<Array<{ count: bigint }>>`
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
    transaction.order.findMany({
      // Mirrors the default Admin list so the ten rows describe the same surface.
      orderBy: [{ updatedAt: "desc" }, { orderNumber: "desc" }],
      take: MUSIC_ORDER_LIMIT,
      select: musicOrderSelect,
    }),
    transaction.contractTemplate.findMany({
      orderBy: [{ type: "asc" }, { version: "desc" }],
      select: {
        type: true,
        version: true,
        status: true,
        sourceMarkup: true,
        approvedAt: true,
        approvedByAdminId: true,
        legalReviewReference: true,
        _count: { select: { documents: true } },
      },
    }),
  ]);

  const musicOrders = musicRows.map(musicOrderInventory);
  const classifications: Record<CleanupClassification, string[]> = {
    DELETE_SAFE: [],
    ARCHIVE_REQUIRED: [],
    KEEP_ACTION_REQUIRED: [],
  };
  for (const order of musicOrders) classifications[order.classification].push(order.reference);

  const commerce = evaluateRightsCommerceReadiness(templates);
  return {
    generatedAt: now.toISOString(),
    environment: "production",
    database: "postgresql",
    transactionReadOnly: true,
    actionableCounts: {
      commander: commander + financialEvents,
      uncorrelatedFinancialEvents: financialEvents,
      shopOrders,
      shopReturns: Number(shopReturnCountRows[0]?.count ?? 0n),
      rights,
      notifications,
    },
    musicOrders,
    classifications,
    rights: {
      commerceState: commerce.state,
      open: commerce.open,
      reasons: commerce.reasons,
      offers: commerce.offers.map((offer) => ({
        type: offer.type,
        label: rightsOffers[offer.type].label,
        priceCents: offer.priceCents,
        currency: offer.currency,
        pricingVersion: offer.pricingVersion,
        requiredTemplateType: offer.requiredTemplateType,
        templateVersion: offer.templateVersion,
        templateStatus: offer.templateStatus,
        templateSourceValid: offer.templateSourceValid,
        legalReviewApproved: offer.legalReviewApproved,
        rendererBound: offer.rendererBound,
        billingReady: offer.billingReady,
        paymentReady: offer.paymentReady,
        activationReady: offer.activationReady,
      })),
      templates: templates.map((template) => ({
        type: template.type,
        version: template.version,
        status: template.status,
        sourceValid: validateContractTemplate(template.sourceMarkup).ok,
        legalReviewApproved: isLegalTemplateUsable(
          template.status,
          template.approvedAt,
          template.approvedByAdminId,
          template.legalReviewReference,
        ),
        legalReviewReferencePresent: Boolean(template.legalReviewReference),
        documentCount: template._count.documents,
      })),
    },
  } as const;
}

async function run() {
  assertProductionInventoryEnvironment(process.env);
  const inventory = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
    const state = await transaction.$queryRaw<Array<{ transaction_read_only: string }>>`
      SHOW transaction_read_only
    `;
    if (state[0]?.transaction_read_only !== "on") throw new Error("READ_ONLY_TRANSACTION_NOT_CONFIRMED");
    return buildInventory(transaction);
  });
  console.info(JSON.stringify(inventory, null, 2));
}

function safeFailureCode(error: unknown) {
  const expected = new Set([
    "PRODUCTION_RAILWAY_ENVIRONMENT_REQUIRED",
    "READ_ONLY_INVENTORY_CONFIRMATION_REQUIRED",
    "POSTGRESQL_DATABASE_REQUIRED",
    "READ_ONLY_TRANSACTION_NOT_CONFIRMED",
  ]);
  if (error instanceof Error && expected.has(error.message)) return error.message;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return /^P\d{4}$/.test(error.code) ? error.code : "UNEXPECTED_ERROR";
  }
  return "UNEXPECTED_ERROR";
}

run()
  .catch((error) => {
    console.error(`ADMIN_PRODUCTION_INVENTORY_FAILED:${safeFailureCode(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
