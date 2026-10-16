import "server-only";
import { prisma } from "@/lib/prisma";
import { paypalRefundApplicationReference, paypalCentsFromAmount, type PaypalRefundEvidence } from "@/lib/payments/paypal-client";
import { DigitalError, requireDigitalEnvironment, type DigitalMode } from "./domain";
import { digitalStripeClient, digitalPaypalClient, assertDigitalProviderRequest, assertDigitalRefundOperation } from "./providers";
import { stripeDisputeStatus, paypalDisputeStatus, type DigitalFinanceGateway, type DigitalRefundEvidence } from "./finance-policy";
import { readStripeChargeRefunds, stripeRefundEvidence } from "./stripe-refunds";
async function paid(orderId: string, provider: string, mode: DigitalMode) {
  const o = await prisma.digitalOrder.findUniqueOrThrow({ where: { id: orderId }, include: { attempts: { where: { status: "PAID" } } } });
  if (o.mode !== mode || o.attempts.length !== 1 || o.attempts[0].provider !== provider || !o.attempts[0].paymentReference || !o.attempts[0].providerReference) throw new DigitalError("PAYMENT_REQUIRES_REVIEW");
  return { order: o, attempt: o.attempts[0] };
}
function stripeGateway(mode: DigitalMode): DigitalFinanceGateway {
  const { client, merchantId, configuration } = digitalStripeClient(mode);
  async function verify(orderId: string) {
    const p = await paid(orderId, "STRIPE", mode); assertDigitalProviderRequest(mode);
    const account = await client.accounts.retrieve(null);
    if (account.id !== merchantId) throw new DigitalError("MERCHANT_MISMATCH");
    const intent = await client.paymentIntents.retrieve(p.attempt.paymentReference!);
    if (intent.livemode !== (mode === "LIVE") || intent.metadata.mode !== mode || intent.id !== p.attempt.paymentReference || intent.currency !== "eur" || intent.amount_received !== p.order.totalCents
      || intent.metadata.paymentSource !== "DIGITAL_MUSIC" || intent.metadata.digitalOrderId !== orderId || intent.metadata.digitalAttemptId !== p.attempt.id) throw new DigitalError("PAYMENT_REQUIRES_REVIEW");
    return p;
  }
  async function read(orderId: string, reference: string): Promise<DigitalRefundEvidence> {
    if (!/^re_[A-Za-z0-9]+$/.test(reference)) throw new DigitalError("REFUND_EVIDENCE_INVALID", 409);
    const p = await verify(orderId), r = await client.refunds.retrieve(reference);
    const pi = typeof r.payment_intent === "string" ? r.payment_intent : r.payment_intent?.id;
    if (pi !== p.attempt.paymentReference || r.currency !== "eur") throw new DigitalError("REFUND_EVIDENCE_INVALID");
    if (r.id !== reference) throw new DigitalError("REFUND_EVIDENCE_INVALID", 409);
    return stripeRefundEvidence(r, { orderId, mode, attemptId: p.attempt.id, paymentReference: p.attempt.paymentReference!, merchantId, amountCents: p.order.totalCents });
  }
  return { merchantId, mode, async refund(r) {
    assertDigitalRefundOperation(mode, configuration);
    const p = await verify(r.orderId);
    if (p.attempt.paymentReference !== r.paymentReference) throw new DigitalError("REFUND_EVIDENCE_INVALID");
    assertDigitalRefundOperation(mode, configuration);
    const created = await client.refunds.create({ payment_intent: r.paymentReference, amount: r.amountCents,
      metadata: { paymentSource: "DIGITAL_MUSIC", mode, digitalOrderId: r.orderId, digitalAttemptId: p.attempt.id, digitalRefundId: r.id } }, { idempotencyKey: r.idempotencyKey });
    return read(r.orderId, created.id);
  }, async recoverRefund(r) {
    await verify(r.orderId);
    if (r.providerReference) return read(r.orderId, r.providerReference);
    const found = (await client.refunds.list({ payment_intent: r.paymentReference, limit: 100 })).data.filter(x => x.metadata?.digitalRefundId === r.id);
    if (found.length > 1) throw new DigitalError("AMBIGUOUS_REFUND");
    return found[0] ? read(r.orderId, found[0].id) : null;
  }, readRefund: read, async readChargeRefunds(orderId, chargeReference) {
    const p = await paid(orderId, "STRIPE", mode); assertDigitalProviderRequest(mode);
    return readStripeChargeRefunds(client, { orderId, mode, attemptId: p.attempt.id, paymentReference: p.attempt.paymentReference!, merchantId, amountCents: p.order.totalCents }, chargeReference);
  }, async readDispute(orderId, reference) {
    const p = await verify(orderId), d = await client.disputes.retrieve(reference);
    const pi = typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id;
    if (d.livemode !== (mode === "LIVE") || pi !== p.attempt.paymentReference || d.currency !== "eur") throw new DigitalError("DISPUTE_EVIDENCE_INVALID");
    return { mode, authenticated: true, provider: "STRIPE", merchantId, orderId, reference: d.id, paymentReference: pi,
      amountCents: d.amount, currency: "EUR", status: stripeDisputeStatus(d.status) };
  } };
}
function paypalGateway(mode: DigitalMode): DigitalFinanceGateway {
  const { client, merchantId, configuration } = digitalPaypalClient(mode);
  async function verify(orderId: string) {
    const p = await paid(orderId, "PAYPAL", mode); assertDigitalProviderRequest(mode);
    const body = await client.inspectOrder!(p.attempt.providerReference!) as {
      id?: string; purchase_units?: Array<{ custom_id?: string; reference_id?: string; payee?: { merchant_id?: string }; amount?: { currency_code?: string; value?: string };
        payments?: { captures?: Array<{ id?: string; amount?: { currency_code?: string; value?: string } }>; refunds?: Array<{ id?: string }> } }> };
    const u = body.purchase_units?.[0], c = u?.payments?.captures?.find(c => c.id === p.attempt.paymentReference);
    if (body.id !== p.attempt.providerReference || body.purchase_units?.length !== 1 || u?.payee?.merchant_id !== merchantId || u.reference_id !== orderId || u.custom_id !== p.attempt.id
      || c?.amount?.currency_code !== "EUR" || paypalCentsFromAmount(c.amount.value) !== p.order.totalCents) throw new DigitalError("PAYMENT_REQUIRES_REVIEW");
    return { ...p, body };
  }
  function evidence(orderId: string, paymentReference: string, r: PaypalRefundEvidence): DigitalRefundEvidence {
    if (r.captureId !== paymentReference || r.currency !== "EUR") throw new DigitalError("REFUND_EVIDENCE_INVALID");
    return { mode, authenticated: true, provider: "PAYPAL", merchantId, orderId, reference: r.providerRefundId,
      paymentReference, amountCents: r.amountCents, currency: r.currency, status: r.status };
  }
  async function read(orderId: string, reference: string) { const p = await verify(orderId); return evidence(orderId, p.attempt.paymentReference!, await client.retrieveRefund(reference)); }
  return { merchantId, mode, async refund(r) { assertDigitalRefundOperation(mode, configuration); const p = await verify(r.orderId);
    if (p.attempt.paymentReference !== r.paymentReference) throw new DigitalError("REFUND_EVIDENCE_INVALID");
    assertDigitalRefundOperation(mode, configuration);
    const created = await client.refundCapture(r.paymentReference, r.amountCents, r.idempotencyKey);
    return read(r.orderId, created.providerRefundId);
  }, async recoverRefund(r) {
    const p = await verify(r.orderId); if (r.providerReference) return read(r.orderId, r.providerReference);
    const ids = p.body.purchase_units?.[0]?.payments?.refunds?.map(x => x.id).filter((x): x is string => !!x) ?? [];
    if (ids.length > 100) throw new DigitalError("AMBIGUOUS_REFUND");
    const found: PaypalRefundEvidence[] = [];
    for (const id of ids) { const refund = await client.retrieveRefund(id); if (refund.applicationReference === paypalRefundApplicationReference(r.idempotencyKey)) found.push(refund); }
    if (found.length > 1) throw new DigitalError("AMBIGUOUS_REFUND");
    return found[0] ? evidence(r.orderId, p.attempt.paymentReference!, found[0]) : null;
  }, readRefund: read, async readDispute(orderId, reference) {
    const p = await verify(orderId);
    if (reference.startsWith("reversal:")) {
      const c = await client.inspectCapture!(p.attempt.paymentReference!) as { id?: string; status?: string; amount?: { value?: string; currency_code?: string } };
      if (c.id !== reference.slice(9) || c.id !== p.attempt.paymentReference || c.status !== "REVERSED" || c.amount?.currency_code !== "EUR" || paypalCentsFromAmount(c.amount.value) !== p.order.totalCents) throw new DigitalError("DISPUTE_REQUIRES_REVIEW");
      return { mode, authenticated: true, provider: "PAYPAL", merchantId, orderId, reference, paymentReference: c.id, amountCents: p.order.totalCents, currency: "EUR", status: "LOST" };
    }
    const d = await client.inspectDispute!(reference) as { dispute_id?: string; status?: string; dispute_amount?: { value?: string; currency_code?: string };
      disputed_transactions?: Array<{ seller_transaction_id?: string }>; dispute_outcome?: { outcome_code?: string } };
    if (d.dispute_id !== reference || d.disputed_transactions?.length !== 1 || d.disputed_transactions[0].seller_transaction_id !== p.attempt.paymentReference || d.dispute_amount?.currency_code !== "EUR") throw new DigitalError("DISPUTE_EVIDENCE_INVALID");
    return { mode, authenticated: true, provider: "PAYPAL", merchantId, orderId, reference, paymentReference: p.attempt.paymentReference!,
      amountCents: paypalCentsFromAmount(d.dispute_amount.value), currency: "EUR", status: paypalDisputeStatus(d.status ?? "", d.dispute_outcome?.outcome_code) };
  } };
}
export function digitalFinanceGateway(provider: string, requestedMode?: DigitalMode): DigitalFinanceGateway {
  const mode = requireDigitalEnvironment(); assertDigitalProviderRequest(mode);
  if (requestedMode !== undefined && requestedMode !== mode) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
  if (provider === "STRIPE") return stripeGateway(mode); if (provider === "PAYPAL") return paypalGateway(mode); throw new DigitalError("INVALID_PROVIDER");
}
