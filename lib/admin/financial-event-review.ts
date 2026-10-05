import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, assertDatabaseConfigured } from "@/lib/prisma";
import { classifyFinancialReview, type CheckoutReviewEvidence } from "@/lib/admin/financial-event-policy";
import { readFinancialCheckout } from "@/lib/admin/financial-event-stripe";

export const financialEventSelect = {
  id: true, provider: true, providerEventId: true, type: true, livemode: true, objectId: true,
  outcome: true, processedAt: true, paymentId: true, refundAttemptId: true, incidentId: true,
  technicalReview: true,
  payment: { select: { order: { select: { orderNumber: true } }, shopOrder: { select: { orderNumber: true } } } },
} satisfies Prisma.ProviderEventSelect;
type Db = Pick<Prisma.TransactionClient, "providerEvent" | "supportContribution" | "payment">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function snapshot(db: Db, id: string) {
  if (!uuid.test(id)) return null;
  const row = await db.providerEvent.findUnique({ where: { id }, select: financialEventSelect });
  if (!row) return null;
  const [support, matchingPayments] = row.objectId ? await Promise.all([
    db.supportContribution.findUnique({ where: { providerReference: row.objectId }, select: {
      id: true, provider: true, providerReference: true, mode: true, status: true,
      amountCents: true, currency: true, paymentReference: true, refundReference: true,
    } }),
    db.payment.count({ where: { providerCheckoutId: row.objectId } }),
  ]) : [null, 0] as const;
  return { ...row, support, matchingPayments, reviewed: !!row.technicalReview };
}

export async function getFinancialEventReview(id: string,
  readProof: (id: string, live: boolean) => Promise<CheckoutReviewEvidence | null> = readFinancialCheckout) {
  assertDatabaseConfigured();
  const row = await snapshot(prisma, id);
  if (!row) return null;
  const proof = row.provider === "STRIPE" && row.objectId ? await readProof(row.objectId, row.livemode) : null;
  return { row, proof, classification: classifyFinancialReview(row, proof) };
}

/** Provider reads finish before the transaction. No payment/order/support write.
 * Serializable + event lock + unique audit key make retries/double-clicks safe. */
export async function resolveFinancialEventReview(id: string, actorId: string,
  readProof: (id: string, live: boolean) => Promise<CheckoutReviewEvidence | null> = readFinancialCheckout) {
  assertDatabaseConfigured();
  if (!uuid.test(id) || !uuid.test(actorId)) throw new Error("Revue refusée.");
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true, status: true } });
  if (actor?.role !== "ADMIN" || actor.status !== "ACTIVE") throw new Error("Revue refusée.");
  const initial = await snapshot(prisma, id);
  if (!initial) throw new Error("Revue refusée.");
  if (initial.technicalReview) return "ALREADY_REVIEWED";
  const proof = initial.provider === "STRIPE" && initial.objectId ? await readProof(initial.objectId, initial.livemode) : null;
  for (let retry = 0; retry < 3; retry++) {
    try {
      return await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "provider_events" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const current = await snapshot(tx, id);
        if (!current) throw new Error("Revue refusée.");
        const currentActor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, status: true } });
        if (currentActor?.role !== "ADMIN" || currentActor.status !== "ACTIVE") throw new Error("Revue refusée.");
        if (current.technicalReview) return "ALREADY_REVIEWED";
        if (!classifyFinancialReview(current, proof).eligible || !proof) throw new Error("Revue refusée.");
        await tx.providerEventTechnicalReview.create({ data: {
          eventId: id, actorId, reason: "EXPIRED_UNPAID_SUPPORT_CHECKOUT",
          evidence: { sessionId: proof.sessionId, livemode: proof.livemode, status: proof.status,
            paymentStatus: proof.paymentStatus, paymentIntentId: proof.paymentIntentId,
            amountCents: proof.amountCents, currency: proof.currency, contributionId: current.support!.id },
        } });
        return "REVIEWED";
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2034" && retry < 2) continue;
      throw new Error("Classement refusé : conserver la revue technique.");
    }
  }
  throw new Error("Revue refusée.");
}
