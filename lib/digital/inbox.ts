import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DigitalError, requireDigitalEnvironment, type DigitalMode } from "./domain";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { reconcileDigitalOrder } from "./commerce";
import { recordDigitalDisputeEvidence, recordDigitalRefundEvidence } from "./finance";
import { digitalFinanceGateway } from "./finance-providers";
import type { DigitalFinanceGateway } from "./finance-policy";
import { digitalGateway, type DigitalGateway } from "./providers";
export type DigitalInboxPayload = { providerReference?: string; paymentReference?: string; attemptId?: string; resourceReference?: string; refundReferences?: string[]; mode?: DigitalMode; merchantId?: string };
export const DIGITAL_STRIPE_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired", "refund.created", "refund.updated", "refund.failed", "charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"];
export const DIGITAL_PAYPAL_EVENTS = ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DECLINED", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED", "PAYMENT.REFUND.PENDING", "PAYMENT.REFUND.COMPLETED", "PAYMENT.REFUND.FAILED", "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"];
/** The route verifies signatures first, then persists before acknowledgement. */
export async function receiveDigitalEvent(input: { provider: string; eventId: string; eventType: string; orderId?: string; bodyHash: string; payload: DigitalInboxPayload; verifiedMode?: DigitalMode; merchantId?: string }) {
  const mode = requireDigitalEnvironment();
  if ((input.verifiedMode ?? "TEST") !== mode || input.payload.mode !== undefined && input.payload.mode !== mode
    || mode === "LIVE" && (!input.orderId || !input.merchantId || input.merchantId.length > 255)) throw new DigitalError("INVALID_WEBHOOK", 400);
  // Old TEST receipt payload hashes stay byte-for-byte compatible. LIVE carries
  // the context established by the signature-verifying route, never the browser.
  const payload = mode === "LIVE" ? { ...input.payload, mode, merchantId: input.merchantId } : input.payload;
  if (!["STRIPE", "PAYPAL"].includes(input.provider) || !input.eventId || input.eventId.length > 180 || !/^[a-f0-9]{64}$/.test(input.bodyHash) || input.payload.refundReferences && input.payload.refundReferences.length > 100) throw new DigitalError("INVALID_WEBHOOK");
  return prisma.$transaction(async tx => {
    if (mode === "LIVE") {
      const order = await tx.digitalOrder.findUnique({ where: { id: input.orderId! }, select: { mode: true } });
      if (order?.mode !== mode) throw new DigitalError("INVALID_WEBHOOK", 400);
    }
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-inbox:${input.provider}:${input.eventId}`})) IS NULL AS locked`;
    const previous = await tx.digitalInbox.findUnique({ where: { provider_eventId: { provider: input.provider, eventId: input.eventId } } });
    if (previous) { if (previous.bodyHash !== input.bodyHash || previous.eventType !== input.eventType || billingSnapshotHash(previous.payload) !== billingSnapshotHash(payload)) throw new DigitalError("EVENT_COLLISION", 409); return { received: true, duplicate: true }; }
    await tx.digitalInbox.create({ data: { provider: input.provider, eventId: input.eventId, eventType: input.eventType, orderId: input.orderId, bodyHash: input.bodyHash, payload: payload as Prisma.InputJsonValue } });
    return { received: true, queued: true };
  });
}
async function resolveOrder(row: { orderId: string | null; provider: string; payload: unknown }) {
  const p = row.payload as DigitalInboxPayload;
  const mode = requireDigitalEnvironment();
  if ((p.mode ?? "TEST") !== mode || mode === "LIVE" && !p.merchantId) throw new DigitalError("UNMATCHED_DIGITAL_EVENT", 409);
  const a = p.attemptId ? await prisma.digitalPaymentAttempt.findUnique({ where: { id: p.attemptId } }) : p.providerReference ? await prisma.digitalPaymentAttempt.findUnique({ where: { providerReference: p.providerReference } }) : p.paymentReference ? await prisma.digitalPaymentAttempt.findUnique({ where: { paymentReference: p.paymentReference } }) : null;
  if (!a || a.provider !== row.provider || row.orderId && a.orderId !== row.orderId) throw new DigitalError("UNMATCHED_DIGITAL_EVENT", 409);
  const order = await prisma.digitalOrder.findUnique({ where: { id: a.orderId }, select: { mode: true } });
  if (order?.mode !== mode) throw new DigitalError("UNMATCHED_DIGITAL_EVENT", 409);
  if (p.providerReference && !a.providerReference) await prisma.digitalPaymentAttempt.updateMany({ where: { id: a.id, providerReference: null, status: { in: ["CREATING", "UNKNOWN"] } }, data: { providerReference: p.providerReference } });
  else if (p.providerReference && a.providerReference !== p.providerReference) throw new DigitalError("PAYMENT_REQUIRES_REVIEW");
  return { orderId: a.orderId, mode, merchantId: p.merchantId };
}
function assertInboxGateway(gateway: DigitalGateway | DigitalFinanceGateway, context: { mode: DigitalMode; merchantId?: string }) {
  if ((gateway.mode ?? "TEST") !== context.mode || context.merchantId && gateway.merchantId !== context.merchantId) throw new DigitalError("MERCHANT_MISMATCH", 409);
}
export async function processDigitalInbox(limit = 25, supplied?: { payment?: DigitalGateway; finance?: DigitalFinanceGateway }) {
  const mode = requireDigitalEnvironment(); const result = { processed: 0, retry: 0, review: 0 };
  const rows = await prisma.digitalInbox.findMany({ where: { ...(mode === "LIVE" ? { order: { mode: "LIVE" }, payload: { path: ["mode"], equals: "LIVE" } } : { AND: [{ OR: [{ order: { mode: "TEST" } }, { orderId: null }] }] }), availableAt: { lte: new Date() }, OR: [{ status: { in: ["PENDING", "RETRY"] } }, { status: "PROCESSING", leaseUntil: { lte: new Date() } }] }, orderBy: { createdAt: "asc" }, take: Math.min(limit, 25) });
  for (const row of rows) {
    if (row.attempts >= 8) { await prisma.digitalInbox.updateMany({ where: { id: row.id, status: { in: ["PENDING", "RETRY", "PROCESSING"] } }, data: { status: "REQUIRES_REVIEW", leaseUntil: null, leaseToken: null } }); result.review++; continue; }
    const token = randomUUID();
    const claim = await prisma.digitalInbox.updateMany({ where: { id: row.id, attempts: row.attempts, OR: [{ status: { in: ["PENDING", "RETRY"] } }, { status: "PROCESSING", leaseUntil: { lte: new Date() } }] }, data: { status: "PROCESSING", attempts: { increment: 1 }, leaseToken: token, leaseUntil: new Date(Date.now() + 120000) } });
    if (!claim.count) continue;
    try {
      const context = await resolveOrder(row), { orderId } = context, p = row.payload as DigitalInboxPayload;
      if (row.provider === "STRIPE" && row.eventType === "charge.refunded") {
        const g = supplied?.finance ?? digitalFinanceGateway(row.provider, mode); assertInboxGateway(g, context);
        // Also handles already-persisted historical payloads. Never send ch_ to
        // readRefund, and never assume an embedded list is complete/current.
        if (!p.resourceReference || !/^ch_[A-Za-z0-9]+$/.test(p.resourceReference) || !g.readChargeRefunds) throw new DigitalError("REFUND_REQUIRES_REVIEW");
        const evidence = await g.readChargeRefunds(orderId, p.resourceReference);
        if (!evidence.length || evidence.length > 100) throw new DigitalError("REFUND_REQUIRES_REVIEW");
        for (const e of evidence) await recordDigitalRefundEvidence(e, g.merchantId);
      } else if (/refund/i.test(row.eventType)) {
        const g = supplied?.finance ?? digitalFinanceGateway(row.provider, mode), refs = p.refundReferences ?? (p.resourceReference ? [p.resourceReference] : []); assertInboxGateway(g, context);
        if (!refs.length) throw new DigitalError("REFUND_REQUIRES_REVIEW");
        for (const ref of refs) {
          if (row.provider === "STRIPE" && !/^re_[A-Za-z0-9]+$/.test(ref)) throw new DigitalError("REFUND_EVIDENCE_INVALID");
          await recordDigitalRefundEvidence(await g.readRefund(orderId, ref), g.merchantId);
        }
      } else if (/dispute|reversed/i.test(row.eventType)) {
        const g = supplied?.finance ?? digitalFinanceGateway(row.provider, mode); assertInboxGateway(g, context);
        if (!p.resourceReference) throw new DigitalError("DISPUTE_REQUIRES_REVIEW");
        await recordDigitalDisputeEvidence(await g.readDispute(orderId, p.resourceReference), g.merchantId);
      } else {
        if (row.provider === "PAYPAL" && row.eventType === "PAYMENT.CAPTURE.DECLINED" && !p.resourceReference) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
        const g = supplied?.payment ?? digitalGateway(row.provider, mode); assertInboxGateway(g, context);
        await reconcileDigitalOrder(orderId, g, row.provider === "PAYPAL" && row.eventType === "PAYMENT.CAPTURE.DECLINED" ? p.resourceReference : undefined);
        const a = await prisma.digitalPaymentAttempt.findFirst({ where: { orderId }, orderBy: { createdAt: "desc" } });
        if (!a || ["UNKNOWN", "CREATING", "CAPTURING"].includes(a.status)) throw new DigitalError("PAYMENT_REQUIRES_REVIEW");
      }
      result.processed += (await prisma.digitalInbox.updateMany({ where: { id: row.id, leaseToken: token, status: "PROCESSING" }, data: { orderId, status: "PROCESSED", leaseToken: null, leaseUntil: null, errorCode: null } })).count;
    } catch (e) {
      const review = row.attempts + 1 >= 8;
      await prisma.digitalInbox.updateMany({ where: { id: row.id, leaseToken: token, status: "PROCESSING" }, data: { status: review ? "REQUIRES_REVIEW" : "RETRY", errorCode: e instanceof DigitalError ? e.code : "PROVIDER_READ_FAILED", availableAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** row.attempts)), leaseToken: null, leaseUntil: null } });
      if (review) result.review++; else result.retry++;
    }
  }
  return result;
}
