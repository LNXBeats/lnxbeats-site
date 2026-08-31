import "server-only";

import { unlink } from "node:fs/promises";
import path from "node:path";

import type { Prisma, PrismaClient, ShopReadinessAlertKind } from "@/generated/prisma/client";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { shopSavPrivateRoot } from "@/lib/shop/evidence-service";
import { assertShopProductionReadinessQaEnabled } from "@/lib/shop/production-readiness-config";
import { savEvidencePurgeDueAt, savFirstAnalysisIsOverdue } from "@/lib/shop/readiness-domain";

type Transaction = Prisma.TransactionClient;
type AlertCandidate = Readonly<{ kind: ShopReadinessAlertKind; entityType: string; entityId: string; summary: string }>;

async function synchronizeAlerts(transaction: Transaction, kind: ShopReadinessAlertKind, candidates: readonly AlertCandidate[], now: Date) {
  const activeIds = candidates.map(({ entityId }) => entityId);
  await transaction.shopReadinessAlert.updateMany({
    where: { kind, status: "OPEN", ...(activeIds.length ? { entityId: { notIn: activeIds } } : {}) },
    data: { status: "RESOLVED", resolvedAt: now },
  });
  for (const candidate of candidates) {
    await transaction.shopReadinessAlert.upsert({
      where: { kind_entityType_entityId: { kind, entityType: candidate.entityType, entityId: candidate.entityId } },
      update: { status: "OPEN", summary: candidate.summary, lastDetectedAt: now, resolvedAt: null },
      create: { ...candidate, firstDetectedAt: now, lastDetectedAt: now },
    });
  }
  return candidates.length;
}

async function expireReservations(transaction: Transaction, now: Date) {
  const candidates = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "shop_orders"
    WHERE "status" = 'OPEN'::"ShopOrderStatus"
      AND "paymentStatus" = 'AWAITING_PAYMENT'::"ShopPaymentStatus"
      AND "paymentReviewAt" IS NULL
      AND "reservationExpiresAt" <= ${now}
    ORDER BY "reservationExpiresAt", "id"
    LIMIT 100
  `;
  let expired = 0;
  for (const candidate of candidates) {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shop-payments:order:${candidate.id}`})) IS NULL AS locked`;
    const [order] = await transaction.$queryRaw<Array<{ status: string; paymentStatus: string; paymentReviewAt: Date | null }>>`
      SELECT "status"::text AS status, "paymentStatus"::text AS "paymentStatus", "paymentReviewAt"
      FROM "shop_orders"
      WHERE "id" = ${candidate.id}::uuid
      FOR UPDATE
    `;
    if (!order || order.status !== "OPEN" || order.paymentStatus !== "AWAITING_PAYMENT" || order.paymentReviewAt) continue;
    const reservations = await transaction.stockReservation.findMany({ where: { shopOrderId: candidate.id, status: "ACTIVE" } });
    for (const reservation of reservations) {
      const changed = await transaction.stockReservation.updateMany({ where: { id: reservation.id, status: "ACTIVE" }, data: { status: "EXPIRED", expiredAt: now } });
      if (changed.count) await transaction.shopOrderEvent.create({ data: { shopOrderId: candidate.id, stockReservationId: reservation.id, type: "STOCK_RESERVATION_EXPIRED", metadata: { productId: reservation.productId, quantity: reservation.quantity } } });
    }
    const changed = await transaction.shopOrder.updateMany({ where: { id: candidate.id, status: "OPEN", paymentStatus: "AWAITING_PAYMENT", paymentReviewAt: null }, data: { status: "EXPIRED", expiredAt: now } });
    if (changed.count) {
      expired += 1;
      await transaction.shopOrderEvent.create({ data: { shopOrderId: candidate.id, type: "SHOP_ORDER_EXPIRED", metadata: { reservationCount: reservations.length, source: "PHASE5E_MAINTENANCE" } } });
    }
  }
  return expired;
}

async function purgeEvidence(transaction: Transaction, now: Date, root: string) {
  const candidates = await transaction.shopReturnEvidence.findMany({
    where: { status: "ACTIVE", request: { closedAt: { not: null } } },
    include: { request: { select: { id: true, closedAt: true } } },
    take: 100,
    orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
  });
  let purged = 0;
  for (const evidence of candidates) {
    if (!evidence.request.closedAt || savEvidencePurgeDueAt(evidence.request.closedAt) > now) continue;
    const absolute = path.resolve(root, evidence.storageKey);
    if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error("Evidence storage path escaped its private root.");
    await unlink(absolute).catch((error: unknown) => {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    });
    const changed = await transaction.shopReturnEvidence.updateMany({ where: { id: evidence.id, status: "ACTIVE" }, data: { status: "PURGED", purgeDueAt: savEvidencePurgeDueAt(evidence.request.closedAt), purgedAt: now } });
    if (changed.count) {
      purged += 1;
      await transaction.shopReturnAuditEvent.create({ data: { shopReturnRequestId: evidence.request.id, action: "EVIDENCE_PURGED", idempotencyKey: `shop-return-evidence:${evidence.id}:purged:v1`, metadata: { retentionDays: 90 } } });
    }
  }
  return purged;
}

async function readinessCandidates(transaction: Transaction, now: Date) {
  const returns = await transaction.shopReturnRequest.findMany({ where: { status: { in: ["REQUESTED", "UNDER_REVIEW"] }, reviewedAt: null }, select: { id: true, requestNumber: true, requestedAt: true, reviewedAt: true } });
  const payments = await transaction.payment.findMany({ where: { status: { in: ["PENDING", "REQUIRES_REVIEW"] } }, select: { id: true, status: true } });
  const refunds = await transaction.refundAttempt.findMany({ where: { status: { in: ["PENDING", "REQUIRES_REVIEW"] } }, select: { id: true, status: true } });
  const shipping = await transaction.shopShippingProviderAttempt.findMany({ where: { status: { in: ["PENDING", "REQUIRES_REVIEW"] } }, select: { id: true, status: true } });
  const sav = returns.filter((row) => savFirstAnalysisIsOverdue(row.requestedAt, row.reviewedAt, now)).map((row) => ({ kind: "SAV_FIRST_ANALYSIS_OVERDUE" as const, entityType: "SHOP_RETURN", entityId: row.id, summary: `${row.requestNumber} attend une première analyse depuis plus de 5 jours ouvrés.` }));
  const payment = payments.map((row) => ({ kind: "PAYMENT_REVIEW_REQUIRED" as const, entityType: "PAYMENT", entityId: row.id, summary: `Paiement ${row.status} à examiner sans mutation automatique.` }));
  const refund = refunds.map((row) => ({ kind: "REFUND_REVIEW_REQUIRED" as const, entityType: "REFUND_ATTEMPT", entityId: row.id, summary: `Remboursement ${row.status} à examiner sans retry aveugle.` }));
  const shipment = shipping.map((row) => ({ kind: "SHIPPING_REVIEW_REQUIRED" as const, entityType: "SHIPPING_ATTEMPT", entityId: row.id, summary: `Expédition ${row.status} à examiner sans mutation métier.` }));
  return { sav, payment, refund, shipment };
}

export async function runShopReadinessMaintenance(
  now = new Date(),
  options: Readonly<{ client?: PrismaClient; privateRoot?: string; skipEnvironmentGuard?: boolean }> = {},
) {
  if (!options.client) assertDatabaseConfigured();
  if (!options.skipEnvironmentGuard) assertShopProductionReadinessQaEnabled();
  const client = options.client ?? prisma;
  const root = path.resolve(options.privateRoot ?? shopSavPrivateRoot());
  return client.$transaction(async (transaction) => {
    const [lock] = await transaction.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext('shop-phase5e-readiness-maintenance')) AS locked`;
    if (!lock?.locked) return { outcome: "SKIPPED_OVERLAP" as const };
    const idempotencyKey = `phase5e:${now.toISOString()}`;
    const replay = await transaction.shopMaintenanceRun.findUnique({ where: { idempotencyKey } });
    if (replay?.completedAt) {
      const metrics = replay.metrics as Partial<Record<"reservationsExpired" | "evidencePurged" | "savAlerts" | "paymentAlerts" | "refundAlerts" | "shippingAlerts", number>>;
      return {
        outcome: "REPLAYED" as const,
        reservationsExpired: metrics.reservationsExpired ?? 0,
        evidencePurged: metrics.evidencePurged ?? 0,
        savAlerts: metrics.savAlerts ?? 0,
        paymentAlerts: metrics.paymentAlerts ?? 0,
        refundAlerts: metrics.refundAlerts ?? 0,
        shippingAlerts: metrics.shippingAlerts ?? 0,
      };
    }
    const run = await transaction.shopMaintenanceRun.create({ data: { idempotencyKey, outcome: "COMPLETED", startedAt: now } });
    const reservationsExpired = await expireReservations(transaction, now);
    const evidencePurged = await purgeEvidence(transaction, now, root);
    const candidates = await readinessCandidates(transaction, now);
    const savAlerts = await synchronizeAlerts(transaction, "SAV_FIRST_ANALYSIS_OVERDUE", candidates.sav, now);
    const paymentAlerts = await synchronizeAlerts(transaction, "PAYMENT_REVIEW_REQUIRED", candidates.payment, now);
    const refundAlerts = await synchronizeAlerts(transaction, "REFUND_REVIEW_REQUIRED", candidates.refund, now);
    const shippingAlerts = await synchronizeAlerts(transaction, "SHIPPING_REVIEW_REQUIRED", candidates.shipment, now);
    const metrics = { reservationsExpired, evidencePurged, savAlerts, paymentAlerts, refundAlerts, shippingAlerts };
    await transaction.shopMaintenanceRun.update({ where: { id: run.id }, data: { metrics, completedAt: now } });
    return { outcome: "COMPLETED" as const, ...metrics };
  });
}

export async function shopReadinessDashboard(client: PrismaClient = prisma) {
  const [alerts, openCustomerRequests, draftRates, activeRates] = await Promise.all([
    client.shopReadinessAlert.findMany({ where: { status: "OPEN" }, orderBy: [{ firstDetectedAt: "asc" }, { id: "asc" }] }),
    client.shopOrderCustomerRequest.count({ where: { status: { in: ["REQUESTED", "APPROVED"] } } }),
    client.shippingRateVersion.count({ where: { scope: "COMMERCIAL_CANDIDATE", status: "DRAFT" } }),
    client.shippingRateVersion.count({ where: { scope: "COMMERCIAL_CANDIDATE", status: "ACTIVE" } }),
  ]);
  return { alerts, openCustomerRequests, draftRates, activeRates } as const;
}
