import "server-only";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// A reading preference, NOT a financial review, reconciliation or cancellation.
// Reuse the append-only audit store; signed receipts and final reviews stay intact.
export const FINANCIAL_RECEIPT_VISIBILITY = "ADMIN_FINANCIAL_RECEIPT_VISIBILITY_V1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const financialReceiptVisibilitySelect = {
  id: true, provider: true, providerEventId: true, type: true, livemode: true,
  outcome: true, processedAt: true, objectId: true, paymentId: true, refundAttemptId: true, incidentId: true,
  technicalReview: { select: { id: true } },
} as const;
type Receipt = Prisma.ProviderEventGetPayload<{select: typeof financialReceiptVisibilitySelect}>;
type Visibility = { revision: string; seen: boolean; at: string | null };
export function financialReceiptFingerprint(receipt: Receipt) {
  return billingSnapshotHash(receipt);
}
export async function getFinancialReceiptVisibility(receipts: Receipt[]) {
  if (!receipts.length) return new Map<string, Visibility>();
  const events = await prisma.digitalEvent.findMany({
    where: { kind: FINANCIAL_RECEIPT_VISIBILITY, actorId: { not: null }, OR: receipts.map(row => ({ details: { path: ["eventId"], equals: row.id } })) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1000,
    select: { id: true, actorId: true, details: true, createdAt: true },
  });
  const result = new Map<string, Visibility>();
  for (const row of receipts) {
    const event = events.find(e => (e.details as {eventId?: unknown})?.eventId === row.id);
    const details = event?.details as { seen?: unknown; snapshotHash?: unknown } | undefined;
    result.set(row.id, { revision: event?.id ?? "", seen: details?.seen === true && details.snapshotHash === financialReceiptFingerprint(row), at: event?.createdAt.toISOString() ?? null });
  }
  return result;
}

export async function setFinancialReceiptSeen(input: {
  eventId: string; actorId: string; seen: boolean; expectedHash: string; expectedRevision: string; requestId: string;
}) {
  if (!uuid.test(input.eventId) || !uuid.test(input.actorId) || !uuid.test(input.requestId) || typeof input.seen !== "boolean"
    || !/^[a-f0-9]{64}$/.test(input.expectedHash) || input.expectedRevision !== "" && !uuid.test(input.expectedRevision)) throw Error("Requête de lecture invalide.");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "provider_events" WHERE "id" = ${input.eventId}::uuid FOR UPDATE`;
    const actor = await tx.user.findFirst({ where: { id: input.actorId, role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
    if (!actor) throw Error("Accès administrateur requis.");
    const receipt = await tx.providerEvent.findUnique({ where: { id: input.eventId }, select: financialReceiptVisibilitySelect });
    if (!receipt || financialReceiptFingerprint(receipt) !== input.expectedHash) throw Error("Le reçu a changé : rechargez le suivi financier.");
    const externalKey = `admin-receipt-seen:${input.eventId}:${input.requestId}`;
    const replay = await tx.digitalEvent.findUnique({ where: { externalKey }, select: { id: true, details: true, actorId: true } });
    if (replay) {
      const details = replay.details as {snapshotHash?: unknown;seen?: unknown};
      if (replay.actorId !== actor.id || details.snapshotHash !== input.expectedHash || details.seen !== input.seen) throw Error("Requête déjà utilisée.");
      return replay.id;
    }
    const previous = await tx.digitalEvent.findFirst({ where: { kind: FINANCIAL_RECEIPT_VISIBILITY, actorId: { not: null }, details: { path: ["eventId"], equals: receipt.id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, createdAt: true } });
    if ((previous?.id ?? "") !== input.expectedRevision) throw Error("L’état de lecture a changé : rechargez le suivi financier.");
    const event = await tx.digitalEvent.create({ data: {
      kind: FINANCIAL_RECEIPT_VISIBILITY, actorId: actor.id, externalKey,
      details: { eventId: receipt.id, snapshotHash: input.expectedHash, seen: input.seen, scope: "READING_PREFERENCE_ONLY_NO_FINANCIAL_RESOLUTION" },
      createdAt: new Date(Math.max(Date.now(), (previous?.createdAt.getTime() ?? 0) + 1)),
    }, select: { id: true } });
    return event.id;
  });
}
