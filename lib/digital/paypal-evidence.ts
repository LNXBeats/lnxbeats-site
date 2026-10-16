import "server-only";
import { paypalCaptureResponseEvidence, paypalCentsFromAmount } from "@/lib/payments/paypal-client";
import { DigitalError, type DigitalPaymentEvidence, type DigitalMode } from "./domain";
import {digitalPaypalProviderBilling} from "./france-provider-billing";

type Order = { id: string; mode?: DigitalMode; totalCents: number };
type Attempt = { id: string; providerReference: string | null };
type PaypalOrder = { id?: string; status?: string; payer?:{address?:unknown}; purchase_units?: Array<{
  reference_id?: string; custom_id?: string; payee?: { merchant_id?: string };
  amount?: { value?: string; currency_code?: string }; payments?: { captures?: Array<{
    id?: string; status?: string; custom_id?: string; payee?: { merchant_id?: string };
    amount?: { value?: string; currency_code?: string };
    supplementary_data?: { related_ids?: { order_id?: string } };
  }> };
}> };
export function digitalPaypalDeclinedReference(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(value)) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
}
/** Called only with the authenticated, freshly retrieved Orders v2 response. */
export function digitalPaypalOrderEvidence(body: unknown, order: Order, attempt: Attempt, merchantId: string, mode: DigitalMode = "TEST"): DigitalPaymentEvidence {
  const b = body as PaypalOrder;
  const unit = b?.purchase_units?.[0];
  if (!["TEST", "LIVE"].includes(mode) || (order.mode ?? "TEST") !== mode || !b || b.id !== attempt.providerReference || b.purchase_units?.length !== 1 || unit?.custom_id !== attempt.id
    || unit.reference_id !== order.id || !merchantId || unit.payee?.merchant_id !== merchantId
    || unit.amount?.currency_code !== "EUR" || paypalCentsFromAmount(unit.amount.value) !== order.totalCents) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
  const captures = unit.payments?.captures;
  if (captures !== undefined && !Array.isArray(captures)) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
  if (captures?.some(c => c?.status === "DECLINED")) {
    const capture = captures[0];
    if (captures.length !== 1 || !["APPROVED", "COMPLETED"].includes(b.status ?? "")
      || capture.status !== "DECLINED" || capture.amount?.currency_code !== "EUR"
      || paypalCentsFromAmount(capture.amount.value) !== order.totalCents
      || capture.custom_id !== undefined && capture.custom_id !== attempt.id
      || capture.payee?.merchant_id !== undefined && capture.payee.merchant_id !== merchantId
      || capture.supplementary_data?.related_ids?.order_id !== undefined && capture.supplementary_data.related_ids.order_id !== b.id) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
    digitalPaypalDeclinedReference(capture.id);
    if (capture.id === b.id) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
    return { authenticated: true, mode, provider: "PAYPAL", orderId: order.id, providerReference: b.id!,
      paymentReference: capture.id, merchantId, amountCents: order.totalCents, currency: "EUR", status: "FAILED",
      eventId: `paypal-recover:${capture.id}:DECLINED` };
  }
  // Keep the historical shared successful/pending parser unchanged. The failure
  // mapping is scoped to DCN rather than widening other PayPal payment domains.
  const capture = paypalCaptureResponseEvidence(body);
  if (!capture.evidenceConsistent || capture.paymentId !== attempt.id || !capture.captureId) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
  return { authenticated: true, mode, provider: "PAYPAL", orderId: order.id, providerReference: b.id!, paymentReference: capture.captureId,
    merchantId, amountCents: capture.amountCents!, currency: capture.currency!, status: capture.status === "COMPLETED" ? "PAID" : "PENDING",
    eventId: `paypal-recover:${capture.captureId}:${capture.status}`,
    ...(digitalPaypalProviderBilling(body)?{billing:digitalPaypalProviderBilling(body)}:{}) };
}
export function isDigitalPaypalDeclinedEvidence(evidence: DigitalPaymentEvidence) {
  return evidence.provider === "PAYPAL" && evidence.status === "FAILED" && Boolean(evidence.paymentReference)
    && evidence.eventId === `paypal-recover:${evidence.paymentReference}:DECLINED`;
}
export function assertDigitalPaypalDeclinedRecovery(paymentReference: string, evidence?: DigitalPaymentEvidence) {
  digitalPaypalDeclinedReference(paymentReference);
  if (!evidence || !isDigitalPaypalDeclinedEvidence(evidence) || evidence.paymentReference !== paymentReference) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
}
