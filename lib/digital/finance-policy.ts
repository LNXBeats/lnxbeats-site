import { DigitalError, assertDigitalUuid, type DigitalMode } from "./domain";
/** A later financial update must never clear an independent delivery/credit incident. */
export const DIGITAL_PERSISTENT_FINANCIAL_INCIDENTS=["PAYMENT_CONTRADICTION","UNMATCHED_CAPTURE_INCIDENT","OVERLAPPING_ACQUISITION_INCIDENT","REFUND_CONTRADICTION",
  "COMPLETION_SOURCE_FINANCIAL_INCIDENT","ACCOUNT_FULFILLMENT_REQUIRES_REVIEW","TERRITORY_FULFILLMENT_REQUIRES_REVIEW",
  "ACQUIRED_MEDIA_REQUIRES_REVIEW","ACQUIRED_RIGHTS_REQUIRES_REVIEW","ACQUIRED_FORMATS_REQUIRES_REVIEW"] as const;
export type DigitalRefundTarget = { lineId: string; amountCents: number };
export type DigitalRefundEvidence = { mode: DigitalMode; authenticated: boolean; merchantId: string; provider: "STRIPE" | "PAYPAL";
  orderId: string; paymentReference: string; reference: string; amountCents: number; currency: string; status: "PENDING" | "SUCCEEDED" | "FAILED"; localRefundId?: string };
export type DigitalDisputeEvidence = { mode: DigitalMode; authenticated: boolean; merchantId: string; provider: "STRIPE" | "PAYPAL";
  orderId: string; paymentReference: string; reference: string; amountCents: number; currency: string; status: "OPEN" | "WON" | "LOST" | "REQUIRES_REVIEW" };
export type DigitalRefundRequest = { id: string; orderId: string; provider: string; paymentReference: string; providerReference: string | null; idempotencyKey: string; amountCents: number };
export interface DigitalFinanceGateway {
  merchantId: string;
  mode?: DigitalMode;
  refund(request: DigitalRefundRequest): Promise<DigitalRefundEvidence>;
  recoverRefund(request: DigitalRefundRequest): Promise<DigitalRefundEvidence | null>;
  readRefund(orderId: string, reference: string): Promise<DigitalRefundEvidence>;
  readChargeRefunds?(orderId: string, chargeReference: string): Promise<DigitalRefundEvidence[]>;
  readDispute(orderId: string, reference: string): Promise<DigitalDisputeEvidence>;
}
export function refundTargets(value: unknown): DigitalRefundTarget[] {
  if (!Array.isArray(value) || !value.length || value.length > 50) throw new DigitalError("INVALID_REFUND");
  const ids = new Set<string>();
  return value.map(v => { if (!v || typeof v !== "object" || Object.keys(v).some(k => !["lineId", "amountCents"].includes(k))
    || typeof v.lineId !== "string" || !Number.isSafeInteger(v.amountCents) || v.amountCents < 1 || ids.has(v.lineId)) throw new DigitalError("INVALID_REFUND");
    assertDigitalUuid(v.lineId); ids.add(v.lineId); return { lineId: v.lineId, amountCents: v.amountCents }; });
}
export function stripeRefundStatus(status: string | null) { return status === "succeeded" ? "SUCCEEDED" : ["failed", "canceled"].includes(status ?? "") ? "FAILED" : "PENDING"; }
export function stripeDisputeStatus(status: string) { return status === "won" ? "WON" : status === "lost" ? "LOST"
  : ["needs_response", "under_review", "warning_needs_response", "warning_under_review"].includes(status) ? "OPEN" : "REQUIRES_REVIEW"; }
export function paypalDisputeStatus(status: string, outcome?: string) {
  if (status !== "RESOLVED") return ["OPEN", "WAITING_FOR_BUYER_RESPONSE", "WAITING_FOR_SELLER_RESPONSE", "UNDER_REVIEW"].includes(status) ? "OPEN" : "REQUIRES_REVIEW";
  return outcome === "RESOLVED_SELLER_FAVOUR" ? "WON" : outcome === "RESOLVED_BUYER_FAVOUR" ? "LOST" : "REQUIRES_REVIEW";
}
