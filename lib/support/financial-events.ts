import "server-only";
import type { VerifiedStripeWebhookEvent, StripeWebhookProcessingResult } from "@/lib/payments/webhook";
import { prisma } from "@/lib/prisma";
import { supportPaymentReconciled, type CheckoutReviewEvidence, type FinancialReviewSnapshot } from "@/lib/admin/financial-event-policy";
import { readFinancialCheckout } from "@/lib/admin/financial-event-stripe";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function isSupportFinancialEvent(event: VerifiedStripeWebhookEvent) {
  return ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)
    && object(object(event.data.object).metadata).purpose === "SUPPORT_LNX_BEATS";
}
export function signedSupportMatches(event: VerifiedStripeWebhookEvent, proof: CheckoutReviewEvidence | null) {
  if (!proof || event.account || !isSupportFinancialEvent(event)) return false;
  const s = object(event.data.object), metadata = object(s.metadata), intent = typeof s.payment_intent === "string" ? s.payment_intent : object(s.payment_intent).id;
  return s.object === "checkout.session" && s.id === proof.sessionId && s.livemode === event.livemode
    && event.livemode === proof.livemode && s.status === proof.status && s.payment_status === proof.paymentStatus
    && s.amount_total === proof.amountCents && s.currency === proof.currency && intent === proof.paymentIntentId
    && metadata.contributionId === proof.contributionId && s.client_reference_id === proof.clientReferenceId
    && !["orderId", "shopOrderId", "rightsRequestId", "paymentId"].some(k => !!metadata[k]);
}
export interface SupportFinancialRepository {
  reconcile(event: VerifiedStripeWebhookEvent, proof: CheckoutReviewEvidence | null): Promise<StripeWebhookProcessingResult>;
}
export const supportFinancialRepository: SupportFinancialRepository = {
  async reconcile(event, proof) {
    const session = object(event.data.object);
    if (!/^evt_[A-Za-z0-9_]{1,200}$/.test(event.id) || typeof session.id !== "string" || session.id.length > 255) throw new Error("Invalid support receipt.");
    const sessionId = session.id;
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`financial-support:${event.id}`})) IS NULL AS locked`;
      const prior = await tx.providerEvent.findUnique({ where: { provider_providerEventId: { provider: "STRIPE", providerEventId: event.id } }, select: { outcome: true } });
      // Historical REVIEW receipts are immutable. They require an explicit Admin audit.
      if (prior) return { outcome: prior.outcome, duplicate: true };
      if (proof?.contributionId && uuid.test(proof.contributionId)) {
        await tx.$queryRaw`SELECT id FROM support_contributions WHERE id=${proof.contributionId}::uuid FOR UPDATE`;
      }
      const candidates = await tx.supportContribution.findMany({ where: { OR: [
        { providerReference: sessionId },
        ...(proof?.contributionId && uuid.test(proof.contributionId) ? [{ id: proof.contributionId }] : []),
        ...(proof?.paymentIntentId ? [{ paymentReference: proof.paymentIntentId }] : []),
      ] }, select: { id: true, provider: true, providerReference: true, mode: true, status: true,
        amountCents: true, currency: true, paymentReference: true, refundReference: true } });
      const matchingPayments = await tx.payment.count({ where: { OR: [{ providerCheckoutId: sessionId },
        ...(proof?.paymentIntentId ? [{ providerPaymentId: proof.paymentIntentId }] : [])] } });
      const row: FinancialReviewSnapshot = { provider: "STRIPE", type: event.type, objectId: sessionId,
        livemode: event.livemode, outcome: "REQUIRES_REVIEW", reviewed: false, paymentId: null,
        refundAttemptId: null, incidentId: null, matchingPayments, supportCandidates: candidates.length, support: candidates[0] ?? null };
      const reconciled = signedSupportMatches(event, proof) && supportPaymentReconciled(row, proof);
      const outcome = reconciled ? "PROCESSED" : "REQUIRES_REVIEW";
      await tx.providerEvent.create({ data: { provider: "STRIPE", providerEventId: event.id, type: event.type,
        objectId: sessionId, livemode: event.livemode, outcome, processedAt: new Date() } });
      if (reconciled && proof) await tx.supportContributionEvent.create({ data: {
        contributionId: candidates[0].id, eventKey: `financial:stripe:${event.id}`, type: "SUPPORT_PAYMENT_RECONCILED",
        evidence: { eventId: event.id, sessionId: proof.sessionId, paymentIntentId: proof.paymentIntentId,
          amountCents: proof.amountCents, currency: proof.currency, checkedAt: new Date().toISOString() },
      } });
      return { outcome, duplicate: false };
    });
  },
};
/** Fresh provider reads outside PostgreSQL transactions. No capture, fulfillment or notification. */
export async function processVerifiedSupportFinancialEvent(event: VerifiedStripeWebhookEvent,
  repository: SupportFinancialRepository = supportFinancialRepository,
  readProof = readFinancialCheckout) {
  const session = object(event.data.object);
  const proof = typeof session.id === "string" && ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)
    ? await readProof(session.id, event.livemode) : null;
  return repository.reconcile(event, proof);
}
