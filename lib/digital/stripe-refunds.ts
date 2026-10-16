import { DigitalError, assertDigitalUuid, type DigitalMode } from "./domain";
import { stripeRefundStatus, type DigitalRefundEvidence } from "./finance-policy";
import type { DigitalInboxPayload } from "./inbox";

export type StripeRefundExpected = {
  orderId: string;
  mode?: DigitalMode;
  attemptId: string;
  paymentReference: string;
  merchantId: string;
  amountCents: number;
};
export interface StripeChargeRefundClient {
  accounts: { retrieve(id: null): Promise<{ id: string }> };
  paymentIntents: { retrieve(id: string, params: { expand: string[] }): Promise<unknown> };
  refunds: { list(params: { charge: string; limit: number; starting_after?: string }): Promise<{ data: unknown[]; has_more: boolean }> };
}
export const STRIPE_CHARGE_REFUND_MAX_ITEMS = 100;
export const STRIPE_CHARGE_REFUND_MAX_PAGES = 4;

function invalid(): never { throw new DigitalError("REFUND_EVIDENCE_INVALID", 409); }
function review(): never { throw new DigitalError("REFUND_REQUIRES_REVIEW", 409); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function reference(value: unknown, prefix: "pi" | "ch" | "re"): string {
  const id = typeof value === "string" ? value : object(value).id;
  if (typeof id !== "string" || id.length > 180 || !new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(id)) invalid();
  return id;
}
function expectedContext(expected: StripeRefundExpected) {
  assertDigitalUuid(expected.orderId); assertDigitalUuid(expected.attemptId);
  if (expected.mode !== undefined && !["TEST", "LIVE"].includes(expected.mode)) invalid();
  reference(expected.paymentReference, "pi");
  if (!expected.merchantId || !Number.isSafeInteger(expected.amountCents) || expected.amountCents < 1) invalid();
}

/** Preserve the existing stored payload shape, including historical ch_ resources.
 * A Charge resource is never a Refund; its embedded list is only a webhook hint.
 */
export function stripeRefundWebhookPayload(eventType: string, value: unknown): DigitalInboxPayload {
  const resource = object(value);
  const paymentReference = resource.payment_intent == null ? undefined : reference(resource.payment_intent, "pi");
  if (eventType === "charge.refunded") {
    const payload: DigitalInboxPayload = { paymentReference, resourceReference: reference(resource.id, "ch") };
    if (resource.refunds != null) {
      const refunds = object(resource.refunds);
      if (!Array.isArray(refunds.data) || refunds.data.length > STRIPE_CHARGE_REFUND_MAX_ITEMS) invalid();
      payload.refundReferences = refunds.data.map(r => reference(object(r).id, "re"));
    }
    return payload;
  }
  if (!["refund.created", "refund.updated", "refund.failed"].includes(eventType)) invalid();
  return { paymentReference, resourceReference: reference(resource.id, "re") };
}

/** Called only with a freshly retrieved Refund from the expected account/mode. */
export function stripeRefundEvidence(value: unknown, expected: StripeRefundExpected): DigitalRefundEvidence {
  expectedContext(expected);
  const refund = object(value), metadata = refund.metadata == null ? {} : object(refund.metadata);
  const id = reference(refund.id, "re");
  if (reference(refund.payment_intent, "pi") !== expected.paymentReference || refund.currency !== "eur"
    || !Number.isSafeInteger(refund.amount) || Number(refund.amount) < 1 || Number(refund.amount) > expected.amountCents
    || !["succeeded", "pending", "requires_action", "failed", "canceled"].includes(String(refund.status))) invalid();
  if (metadata.paymentSource != null && metadata.paymentSource !== "DIGITAL_MUSIC") invalid();
  if (metadata.digitalOrderId != null && metadata.digitalOrderId !== expected.orderId) invalid();
  if (metadata.mode != null && metadata.mode !== (expected.mode ?? "TEST")) invalid();
  if (metadata.digitalAttemptId != null && metadata.digitalAttemptId !== expected.attemptId) invalid();
  if (refund.livemode !== undefined && refund.livemode !== ((expected.mode ?? "TEST") === "LIVE")) invalid();
  let localRefundId: string | undefined;
  if (metadata.digitalRefundId != null || metadata.paymentSource === "DIGITAL_MUSIC") {
    if (metadata.paymentSource !== "DIGITAL_MUSIC" || metadata.digitalOrderId !== expected.orderId
      || typeof metadata.digitalRefundId !== "string") invalid();
    try { assertDigitalUuid(metadata.digitalRefundId); } catch { invalid(); }
    localRefundId = metadata.digitalRefundId;
  }
  return { mode: expected.mode ?? "TEST", authenticated: true, provider: "STRIPE", merchantId: expected.merchantId,
    orderId: expected.orderId, reference: id, paymentReference: expected.paymentReference,
    amountCents: Number(refund.amount), currency: "EUR", status: stripeRefundStatus(String(refund.status)),
    ...(localRefundId ? { localRefundId } : {}) };
}

/** No financial POST. Verify the account/PaymentIntent/Charge, then enumerate all
 * fresh Refunds with bounded pagination before applying any financial evidence.
 * Missing, empty or truncated webhook lists do not change this read-only path.
 */
export async function readStripeChargeRefunds(client: StripeChargeRefundClient, expected: StripeRefundExpected, chargeReference: string): Promise<DigitalRefundEvidence[]> {
  expectedContext(expected); reference(chargeReference, "ch");
  if ((await client.accounts.retrieve(null)).id !== expected.merchantId) invalid();
  const intent = object(await client.paymentIntents.retrieve(expected.paymentReference, { expand: ["latest_charge"] }));
  const metadata = object(intent.metadata);
  if (intent.id !== expected.paymentReference || intent.livemode !== ((expected.mode ?? "TEST") === "LIVE") || intent.status !== "succeeded"
    || intent.currency !== "eur" || intent.amount_received !== expected.amountCents || intent.on_behalf_of || intent.transfer_data
    || metadata.paymentSource !== "DIGITAL_MUSIC" || metadata.mode !== (expected.mode ?? "TEST") || metadata.digitalOrderId !== expected.orderId || metadata.digitalAttemptId !== expected.attemptId) invalid();
  const charge = object(intent.latest_charge);
  if (reference(charge.id, "ch") !== chargeReference || reference(charge.payment_intent, "pi") !== expected.paymentReference
    || charge.livemode !== ((expected.mode ?? "TEST") === "LIVE") || charge.currency !== "eur" || charge.amount !== expected.amountCents
    || charge.on_behalf_of || charge.transfer_data
    || charge.amount_captured !== expected.amountCents || charge.paid !== true || charge.captured !== true
    || !Number.isSafeInteger(charge.amount_refunded) || Number(charge.amount_refunded) < 0 || Number(charge.amount_refunded) > expected.amountCents) invalid();
  const evidence: DigitalRefundEvidence[] = [], ids = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < STRIPE_CHARGE_REFUND_MAX_PAGES; pageNumber++) {
    const page = await client.refunds.list({ charge: chargeReference, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    if (!Array.isArray(page.data) || typeof page.has_more !== "boolean" || !page.data.length) review();
    for (const value of page.data) {
      const refund = object(value), item = stripeRefundEvidence(refund, expected);
      if (reference(refund.charge, "ch") !== chargeReference || ids.has(item.reference)) invalid();
      ids.add(item.reference); evidence.push(item);
      if (evidence.length > STRIPE_CHARGE_REFUND_MAX_ITEMS) review();
    }
    if (!page.has_more) {
      const succeeded = evidence.filter(r => r.status === "SUCCEEDED").reduce((n, r) => n + r.amountCents, 0);
      const pending = evidence.filter(r => r.status === "PENDING").reduce((n, r) => n + r.amountCents, 0);
      if (succeeded > Number(charge.amount_refunded) || Number(charge.amount_refunded) > succeeded + pending || succeeded + pending > expected.amountCents) invalid();
      return evidence.sort((a, b) => a.reference.localeCompare(b.reference));
    }
    if (evidence.length >= STRIPE_CHARGE_REFUND_MAX_ITEMS) review();
    cursor = evidence[evidence.length - 1].reference;
  }
  return review();
}
