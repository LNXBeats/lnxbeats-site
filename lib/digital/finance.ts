import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { DigitalError, assertDigitalUuid, requireDigitalEnvironment } from "./domain";
import { enqueueDigitalEmail, prepareDigitalCreditNote } from "./documents";
import { digitalFinanceGateway } from "./finance-providers";
import { DIGITAL_PERSISTENT_FINANCIAL_INCIDENTS,refundTargets, type DigitalRefundTarget, type DigitalRefundEvidence, type DigitalDisputeEvidence, type DigitalFinanceGateway } from "./finance-policy";
import { assertNoCreditedSourceRefund,reviewDependentDigitalCompletions } from "./completion";
type Tx = Prisma.TransactionClient;
const reservedStatuses = ["REQUESTED", "PENDING", "REQUIRES_REVIEW", "SUCCEEDED"];
async function lock(tx: Tx, userId: string) { await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-user:${userId}`})) IS NULL AS locked`; }
async function admin(tx: Tx, actor: OrderActor) { const u = await tx.user.findFirst({ where: { id: actor.id, role: "ADMIN", status: "ACTIVE", emailVerified: true } }); if (!u) throw new DigitalError("ADMIN_REQUIRED", 403); }
async function parent(id: string) { assertDigitalUuid(id); return prisma.digitalOrder.findUniqueOrThrow({ where: { id }, select: { userId: true, mode: true } }); }
async function orderState(tx: Tx, orderId: string) {
  const o = await tx.digitalOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: { include: { entitlements: true } }, refunds: true, disputes: true, attempts: { where: { status: "PAID" } } } });
  const financialIncident = !!await tx.digitalEvent.findFirst({ where: { orderId, kind: { in: [...DIGITAL_PERSISTENT_FINANCIAL_INCIDENTS] } } });
  const suspended = financialIncident || o.disputes.some(d => ["OPEN", "REQUIRES_REVIEW"].includes(d.status))
    || o.refunds.some(r => r.status === "SUCCEEDED" && r.allocationStatus === "REVIEW");
  const lost = o.disputes.some(d => d.status === "LOST");
  for (const l of o.lines) {
    const revoked = lost || o.refunds.some(r => r.status === "SUCCEEDED" && r.purpose === "RESOLUTION" && (r.targets as unknown as DigitalRefundTarget[]).some(t => t.lineId === l.id));
    // Never revive previously revoked rights. WON can restore only a still-suspended source.
    await tx.digitalEntitlement.updateMany({ where: { lineId: l.id, status: { not: "REVOKED" } }, data: { status: revoked ? "REVOKED" : suspended ? "SUSPENDED" : "ACTIVE" } });
  }
  const sum = o.refunds.filter(r => r.status === "SUCCEEDED").reduce((n, r) => n + r.amountCents, 0);
  await tx.digitalOrder.update({ where: { id: orderId }, data: { status: financialIncident || o.refunds.some(r => r.allocationStatus === "REVIEW" && r.status === "SUCCEEDED") ? "REQUIRES_REVIEW"
    : o.disputes.some(d => ["OPEN", "LOST", "REQUIRES_REVIEW"].includes(d.status)) ? "DISPUTED" : sum >= o.totalCents ? "REFUNDED" : sum ? "PARTIALLY_REFUNDED" : "PAID" } });
}
export async function requestDigitalRefund(actor: OrderActor, id: string, input: { idempotencyKey: string; targets: unknown; purpose: string; confirmedAmountCents: number }) {
  const mode = requireDigitalEnvironment(); assertDigitalUuid(input.idempotencyKey); const head = await parent(id);
  if (head.mode !== mode) throw new DigitalError("REFUND_REQUIRES_REVIEW", 409);
  const targets = refundTargets(input.targets), amountCents = targets.reduce((s, t) => s + t.amountCents, 0);
  if (input.confirmedAmountCents !== amountCents || !["RESOLUTION", "PRICE_REDUCTION"].includes(input.purpose)) throw new DigitalError("REFUND_CONFIRMATION_REQUIRED");
  return prisma.$transaction(async tx => {
    await lock(tx, head.userId); await admin(tx, actor);
    const key = `dcn-refund:${input.idempotencyKey}`;
    const previous = await tx.digitalRefund.findUnique({ where: { idempotencyKey: key } });
    if (previous) { if (previous.orderId !== id || previous.amountCents !== amountCents || previous.purpose !== input.purpose || billingSnapshotHash(previous.targets) !== billingSnapshotHash(targets)) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409); return previous; }
    const o = await tx.digitalOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, attempts: { where: { status: "PAID" } }, refunds: true, disputes: true } });
    if (!o || !["PAID", "PARTIALLY_REFUNDED"].includes(o.status) || o.attempts.length !== 1 || !o.attempts[0].paymentReference || o.disputes.some(d => d.status !== "WON")) throw new DigitalError("REFUND_REQUIRES_REVIEW", 409);
    // A refund of an already-credited single needs a commercial/legal decision, never an automatic cross-refund.
    await assertNoCreditedSourceRefund(tx,targets.map(t=>t.lineId));
    const reserved = o.refunds.filter(r => reservedStatuses.includes(r.status));
    if (reserved.reduce((s, r) => s + r.amountCents, 0) + amountCents > o.totalCents) throw new DigitalError("REFUND_AMOUNT_EXCEEDED", 409);
    if (reserved.some(r => r.allocationStatus === "REVIEW")) throw new DigitalError("REFUND_REQUIRES_REVIEW", 409);
    for (const t of targets) {
      const l = o.lines.find(l => l.id === t.lineId); if (!l) throw new DigitalError("INVALID_REFUND");
      const used = reserved.flatMap(r => r.targets as unknown as DigitalRefundTarget[]).filter(t => t.lineId === l.id).reduce((s, t) => s + t.amountCents, 0);
      if (t.amountCents + used > l.priceCents) throw new DigitalError("REFUND_AMOUNT_EXCEEDED", 409);
      if (input.purpose === "RESOLUTION" && t.amountCents + used !== l.priceCents) throw new DigitalError("PARTIAL_ALBUM_REQUIRES_REVIEW", 409);
    }
    const r = await tx.digitalRefund.create({ data: { orderId: id, actorId: actor.id, provider: o.attempts[0].provider, paymentReference: o.attempts[0].paymentReference,
      idempotencyKey: key, amountCents, targets, purpose: input.purpose } });
    await tx.digitalEvent.create({ data: { orderId: id, actorId: actor.id, kind: "REFUND_REQUESTED", details: { refundId: r.id, amountCents, targets, purpose: input.purpose } } });
    return r;
  });
}
export async function recordDigitalRefundEvidence(e: DigitalRefundEvidence, merchantId: string) {
  const mode = requireDigitalEnvironment(); const head = await parent(e.orderId);
  return prisma.$transaction(async tx => {
    await lock(tx, head.userId);
    const o = await tx.digitalOrder.findUniqueOrThrow({ where: { id: e.orderId }, include: { lines: true, refunds: true, attempts: { where: { status: "PAID" } } } });
    if (!e.authenticated || e.mode !== mode || o.mode !== mode || e.currency !== "EUR" || e.merchantId !== merchantId || !merchantId || !e.reference
      || !Number.isSafeInteger(e.amountCents) || e.amountCents < 1 || o.attempts.length !== 1 || o.attempts[0].provider !== e.provider || o.attempts[0].paymentReference !== e.paymentReference) throw new DigitalError("REFUND_EVIDENCE_INVALID", 409);
    let r = e.localRefundId ? await tx.digitalRefund.findUnique({ where: { id: e.localRefundId } }) : await tx.digitalRefund.findUnique({ where: { providerReference: e.reference } });
    if (e.provider === "STRIPE" && e.localRefundId && !r) throw new DigitalError("REFUND_EVIDENCE_INVALID", 409);
    if (r && (r.orderId !== e.orderId || r.provider !== e.provider || r.paymentReference !== e.paymentReference || r.amountCents !== e.amountCents || r.providerReference && r.providerReference !== e.reference)) throw new DigitalError("REFUND_EVIDENCE_INVALID", 409);
    const eventKey = e.mode === "TEST" ? `refund-proof:${e.provider}:${e.reference}:${e.status}` : `refund-proof:${e.provider}:LIVE:${merchantId}:${e.reference}:${e.status}`;
    const existing = await tx.digitalEvent.findUnique({ where: { externalKey: eventKey } });
    const proof = { ...e }; delete proof.localRefundId;
    if (existing) { if (billingSnapshotHash(existing.details) !== billingSnapshotHash(proof)) throw new DigitalError("EVENT_COLLISION", 409); return { duplicate: true }; }
    await tx.digitalEvent.create({ data: { orderId: e.orderId, externalKey: eventKey, kind: "REFUND_PROVIDER_EVIDENCE", details: proof } });
    if (r?.status === "SUCCEEDED") {
      if (e.status === "FAILED") { await tx.digitalEvent.create({ data: { orderId: e.orderId, kind: "REFUND_CONTRADICTION", details: { refundId: r.id, reason: "TERMINAL_SUCCESS_CHANGED" } } }); await orderState(tx, e.orderId); return { review: true }; }
      return { ignored: true };
    }
    if (e.provider === "STRIPE" && r?.status === "FAILED" && e.status !== "FAILED") {
      if (e.status === "SUCCEEDED") {
        await tx.digitalRefund.update({ where: { id: r.id }, data: { status: "REQUIRES_REVIEW", leaseUntil: null } });
        await tx.digitalEvent.create({ data: { orderId: e.orderId, kind: "REFUND_CONTRADICTION", details: { refundId: r.id, reason: "TERMINAL_FAILURE_CHANGED", actualProviderStatus: e.status } } });
        await orderState(tx, e.orderId); return { review: true };
      }
      return { ignored: true }; // A stale/unknown pending result never revives a terminal failure.
    }
    if (!r) {
      const others = o.refunds.filter(r => reservedStatuses.includes(r.status)).reduce((s, r) => s + r.amountCents, 0);
      const full = e.amountCents === o.totalCents && others === 0;
      r = await tx.digitalRefund.create({ data: { orderId: o.id, provider: e.provider, paymentReference: e.paymentReference, idempotencyKey: e.mode === "TEST" ? `dcn-external:${e.provider}:${e.reference}` : `dcn-external:${e.provider}:LIVE:${merchantId}:${e.reference}`,
        providerReference: e.reference, amountCents: e.amountCents, targets: full ? o.lines.map(l => ({ lineId: l.id, amountCents: l.priceCents })) : [],
        purpose: full ? "RESOLUTION" : "EXTERNAL_REVIEW", allocationStatus: full ? "MATCHED" : "REVIEW" } });
    }
    const already = o.refunds.filter(x => x.id !== r!.id && reservedStatuses.includes(x.status)).reduce((s, x) => s + x.amountCents, 0);
    // An old failed Stripe attempt does not consume the refundable balance of
    // another active reservation. Other providers retain their existing path.
    if ((e.provider !== "STRIPE" || e.status !== "FAILED") && already + e.amountCents > o.totalCents) {
      await tx.digitalRefund.update({ where: { id: r.id }, data: { providerReference: e.reference, status: "REQUIRES_REVIEW", leaseUntil: null } });
      await tx.digitalEvent.create({ data: { orderId: o.id, kind: "REFUND_CONTRADICTION", details: { refundId: r.id, amountCents: e.amountCents, actualProviderStatus: e.status, reason: "EXTERNAL_REFUND_OR_RESERVATION_EXCEEDS_ORIGINAL" } } });
      await orderState(tx, o.id); return { review: true };
    }
    await tx.digitalRefund.update({ where: { id: r.id }, data: { providerReference: e.reference, status: e.status, leaseUntil: null, confirmedAt: e.status === "SUCCEEDED" ? new Date() : null } });
    if(e.status==="PENDING")await reviewDependentDigitalCompletions(tx,o.id,`refund:${e.reference}`);
    if (e.status === "SUCCEEDED") { await prepareDigitalCreditNote(tx, r.id); await orderState(tx, o.id);
      await reviewDependentDigitalCompletions(tx,o.id,`refund:${e.reference}`); }
    return { status: e.status };
  });
}
export async function processDigitalRefund(id: string, supplied?: DigitalFinanceGateway) {
  const mode = requireDigitalEnvironment(); assertDigitalUuid(id);
  const r = await prisma.digitalRefund.findUniqueOrThrow({ where: { id } });
  if (["SUCCEEDED", "FAILED"].includes(r.status)) return;
  const head = await parent(r.orderId);
  if (head.mode !== mode) throw new DigitalError("REFUND_REQUIRES_REVIEW", 409);
  const gateway = supplied ?? digitalFinanceGateway(r.provider, mode);
  if ((gateway.mode ?? "TEST") !== mode) throw new DigitalError("REFUND_REQUIRES_REVIEW", 409);
  if (r.status !== "REQUESTED") {
    if (r.leaseUntil && r.leaseUntil > new Date()) return;
    const evidence = await gateway.recoverRefund(r); if (evidence) await recordDigitalRefundEvidence({ ...evidence, localRefundId: r.id }, gateway.merchantId);
    return; // An unknown result is never a new financial POST, regardless of process restarts.
  }
  const claimed = await prisma.$transaction(async tx => { await lock(tx, head.userId);
    if (await tx.digitalDispute.findFirst({ where: { orderId: r.orderId, status: { not: "WON" } } })) return false;
    return !!(await tx.digitalRefund.updateMany({ where: { id, status: "REQUESTED" }, data: { status: "PENDING", leaseUntil: new Date(Date.now() + 60000) } })).count; });
  if (!claimed) return;
  try { await recordDigitalRefundEvidence({ ...await gateway.refund(r), localRefundId: r.id }, gateway.merchantId); }
  catch { await prisma.digitalRefund.updateMany({ where: { id, status: "PENDING" }, data: { status: "REQUIRES_REVIEW", leaseUntil: null } }); }
}
export async function recordDigitalDisputeEvidence(e: DigitalDisputeEvidence, merchantId: string) {
  const mode = requireDigitalEnvironment(); const head = await parent(e.orderId);
  return prisma.$transaction(async tx => { await lock(tx, head.userId);
    const o = await tx.digitalOrder.findUniqueOrThrow({ where: { id: e.orderId }, include: { attempts: { where: { status: "PAID" } } } });
    if (!e.authenticated || e.mode !== mode || o.mode !== mode || e.merchantId !== merchantId || !merchantId || !e.reference || e.currency !== "EUR"
      || e.amountCents < 1 || e.amountCents > o.totalCents || o.attempts.length !== 1 || o.attempts[0].provider !== e.provider || o.attempts[0].paymentReference !== e.paymentReference) throw new DigitalError("DISPUTE_EVIDENCE_INVALID");
    const previous = await tx.digitalDispute.findUnique({ where: { providerReference: e.reference } });
    if (previous && (previous.orderId !== o.id || previous.provider !== e.provider || previous.paymentReference !== e.paymentReference || previous.amountCents !== e.amountCents)) throw new DigitalError("EVENT_COLLISION", 409);
    const hash = billingSnapshotHash(e);
    if (previous?.evidenceHash === hash) return { duplicate: true };
    const terminalChanged = previous && ["WON", "LOST"].includes(previous.status) && previous.status !== e.status;
    await tx.digitalDispute.upsert({ where: { providerReference: e.reference }, create: { orderId: o.id, provider: e.provider, providerReference: e.reference,
      paymentReference: e.paymentReference, amountCents: e.amountCents, status: e.status, evidenceHash: hash }, update: { status: terminalChanged ? "REQUIRES_REVIEW" : e.status, evidenceHash: hash } });
    await tx.digitalEvent.create({ data: { orderId: o.id, kind: "DISPUTE_PROVIDER_EVIDENCE", details: { ...e, terminalChanged: !!terminalChanged } } });
    await orderState(tx, o.id);
    if(e.status!=="WON"||terminalChanged)await reviewDependentDigitalCompletions(tx,o.id,`dispute:${e.reference}:${hash}`);
    await enqueueDigitalEmail(tx, o.id, "INCIDENT", `dispute:${e.reference}:${hash}`);
    return { status: terminalChanged ? "REQUIRES_REVIEW" : e.status };
  });
}
export async function listDigitalFinance(userId: string, orderId: string, isAdmin = false) {
  requireDigitalEnvironment();
  return prisma.digitalOrder.findFirst({ where: { id: orderId, ...(isAdmin ? {} : { userId }) }, include: { lines: true, attempts: true, fulfillment: true,
    documents: { select: { id: true, kind: true, number: true, snapshotHash: true, status: true } }, refunds: true, disputes: true,
    notifications: { select: { kind: true, status: true, attempts: true, capturedAt: true, sentAt: true, deliveredAt: true } }, events: { orderBy: { createdAt: "desc" }, take: 100 } } });
}
