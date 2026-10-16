import "server-only";
import { prisma } from "@/lib/prisma";
import type { VerifiedStripeWebhookEvent, StripeWebhookProcessingResult } from "@/lib/payments/webhook";
import type { VerifiedPaypalWebhookEvent } from "@/lib/payments/paypal-webhook";
import { paypalCentsFromAmount } from "@/lib/payments/paypal-client";
import { DIGITAL_PAYPAL_EVENTS, DIGITAL_STRIPE_EVENTS, receiveDigitalEvent } from "./inbox";
import { stripeRefundWebhookPayload } from "./stripe-refunds";
import { digitalRuntimeMode, type DigitalEnvironment, type DigitalMode } from "./runtime-policy";

type Provider = "STRIPE" | "PAYPAL";
type References = { checkout?: string; payment?: string };
export type DigitalWebhookOwner = { id: string; orderId: string; provider: string; providerReference: string | null; paymentReference: string | null;
  order: { id: string; mode: string; totalCents: number } };
export interface DigitalWebhookOwnershipRepository {
  attempts(provider: Provider, mode: DigitalMode, references: References): Promise<DigitalWebhookOwner[]>;
  legacyConflict(provider: Provider, mode: DigitalMode, references: References): Promise<boolean>;
}
const repository: DigitalWebhookOwnershipRepository = {
  attempts(provider, mode, ref) { return prisma.digitalPaymentAttempt.findMany({ where: { provider, order: { mode }, OR: [
    ...(ref.checkout ? [{ providerReference: ref.checkout }] : []), ...(ref.payment ? [{ paymentReference: ref.payment }] : []),
  ] }, take: 2, select: { id: true, orderId: true, provider: true, providerReference: true, paymentReference: true, order: { select: { id: true, mode: true, totalCents: true } } } }); },
  async legacyConflict(provider, mode, ref) { return !!await prisma.payment.findFirst({ where: { provider, mode, OR: [
    ...(ref.checkout ? [{ providerCheckoutId: ref.checkout }] : []), ...(ref.payment ? [{ providerPaymentId: ref.payment }] : []),
  ] }, select: { id: true } }); },
};
type Dependencies = { repository?: DigitalWebhookOwnershipRepository; receive?: typeof receiveDigitalEvent; env?: DigitalEnvironment };
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 255 ? v : undefined;
const reference = (v: unknown) => text(typeof v === "string" ? v : object(v)?.id);
function metadataMatches(v: unknown, owner: DigitalWebhookOwner, mode: DigitalMode) {
  if (v === undefined || v === null) return true;
  const m = object(v); if (!m) return false;
  if (["paymentId", "orderId", "shopOrderId", "rightsRequestId", "pricingVersion", "purpose"].some(k => m[k] !== undefined && m[k] !== "")) return false;
  return (m.paymentSource === undefined || m.paymentSource === "DIGITAL_MUSIC") && (m.mode === undefined || m.mode === mode)
    && (m.digitalOrderId === undefined || m.digitalOrderId === owner.orderId) && (m.digitalAttemptId === undefined || m.digitalAttemptId === owner.id);
}
async function ownerOf(provider: Provider, mode: DigitalMode, ref: References, db: DigitalWebhookOwnershipRepository) {
  if (!ref.checkout && !ref.payment) return null;
  const rows = await db.attempts(provider, mode, ref); if (rows.length !== 1) return null;
  const row = rows[0];
  if (row.provider !== provider || row.order.mode !== mode || row.order.id !== row.orderId
    || !Number.isSafeInteger(row.order.totalCents) || row.order.totalCents < 1
    || ref.checkout && row.providerReference !== ref.checkout
    || ref.payment && row.paymentReference && row.paymentReference !== ref.payment
    || !ref.checkout && row.paymentReference !== ref.payment || await db.legacyConflict(provider, mode, ref)) return null;
  return row;
}
async function persist(input: Parameters<typeof receiveDigitalEvent>[0], receive: typeof receiveDigitalEvent): Promise<StripeWebhookProcessingResult> {
  const result = await receive(input); // Rejection propagates: NEVER ACK a non-persisted event.
  if (result.received !== true || !("queued" in result && result.queued || "duplicate" in result && result.duplicate)) throw new Error("DCN_DURABLE_HANDOFF_FAILED");
  return { outcome: "PROCESSED", duplicate: "duplicate" in result && result.duplicate === true };
}

/** Invoke ONLY after the existing endpoint's authentic signature/mode checks.
 * This is a durable handoff to the SAME DCN inbox, not an ignore shortcut or a
 * fulfillment/payment engine. Unknown/contradictory events remain legacy review.
 */
export async function handoffVerifiedDigitalStripeEvent(event: VerifiedStripeWebhookEvent, bodyHash: string, dependencies: Dependencies = {}) {
  const env = dependencies.env ?? process.env, mode = digitalRuntimeMode(env);
  if (!mode || event.livemode !== (mode === "LIVE") || event.account || !env.DCN_STRIPE_WEBHOOK_SECRET
    || !/^acct_[A-Za-z0-9]+$/.test(env.DCN_STRIPE_ACCOUNT_ID ?? "") || !/^[a-f0-9]{64}$/.test(bodyHash)) return null;
  if (!DIGITAL_STRIPE_EVENTS.includes(event.type)) return null;
  const value = object(event.data.object); if (!value || !text(value.id)||value.livemode !== undefined && value.livemode !== event.livemode) return null;
  const checkout = event.type.startsWith("checkout.session.");
  if (checkout && (value.object !== "checkout.session"||value.livemode!==event.livemode)) return null;
  if(!checkout&&value.object!==(event.type.startsWith("refund.")?"refund":event.type.startsWith("charge.dispute.")?"dispute":"charge"))return null;
  const pi = reference(value.payment_intent), ref: References = { ...(checkout ? { checkout: text(value.id) } : {}), payment: pi };
  const owner = await ownerOf("STRIPE", mode, ref, dependencies.repository ?? repository);
  if (!owner || !metadataMatches(value.metadata, owner, mode) || !metadataMatches(object(value.payment_intent)?.metadata, owner, mode)) return null;
  const amount = checkout ? value.amount_total : value.amount;
  if (value.currency !== "eur" || !Number.isSafeInteger(amount) || Number(amount) <= 0 || (checkout ? amount !== owner.order.totalCents : Number(amount) > owner.order.totalCents)) return null;
  // Same payload constructor/shape as the dedicated authenticated route.
  const payload = checkout ? { providerReference: String(value.id), attemptId: owner.id }
    : /refund/i.test(event.type) ? stripeRefundWebhookPayload(event.type, value) : { paymentReference: pi, resourceReference: String(value.id) };
  return persist({ provider: "STRIPE", eventId: event.id, eventType: event.type, orderId: owner.orderId, bodyHash, payload,
    verifiedMode: mode, merchantId: env.DCN_STRIPE_ACCOUNT_ID }, dependencies.receive ?? receiveDigitalEvent);
}

function paypalRefundCapture(value: Record<string, unknown>, mode: DigitalMode) {
  const related = object(object(value.supplementary_data)?.related_ids), capture = text(related?.capture_id); if (capture) return capture;
  const links = Array.isArray(value.links) ? value.links : [], up = links.map(object).find(link => link?.rel === "up" && link.method === "GET");
  try {
    const url = new URL(String(up?.href)), hosts = mode === "LIVE" ? ["api-m.paypal.com", "api.paypal.com"] : ["api-m.sandbox.paypal.com", "api.sandbox.paypal.com"];
    if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash) return undefined;
    return url.pathname.match(/^\/v2\/payments\/captures\/([A-Za-z0-9_-]{1,255})$/)?.[1];
  } catch { return undefined; }
}
export async function handoffVerifiedDigitalPaypalEvent(event: Pick<VerifiedPaypalWebhookEvent,"id"|"event_type"|"resource">, environment: "sandbox" | "live", bodyHash: string, dependencies: Dependencies = {}) {
  const env = dependencies.env ?? process.env, mode = digitalRuntimeMode(env);
  if (!mode || environment !== (mode === "LIVE" ? "live" : "sandbox") || !env.DCN_PAYPAL_WEBHOOK_ID || !env.DCN_PAYPAL_MERCHANT_ID || !/^[a-f0-9]{64}$/.test(bodyHash)) return null;
  const approved = event.event_type === "CHECKOUT.ORDER.APPROVED";
  if (!approved && !DIGITAL_PAYPAL_EVENTS.includes(event.event_type)) return null;
  const value = object(event.resource); if (!value||!text(value.id)&&!text(value.dispute_id)) return null;
  const refund = /refund/i.test(event.event_type), dispute = /dispute/i.test(event.event_type), reversed = event.event_type.endsWith("REVERSED");
  const units = Array.isArray(value.purchase_units) ? value.purchase_units : [], unit = object(units[0]);
  const related = object(object(value.supplementary_data)?.related_ids), transactions = Array.isArray(value.disputed_transactions) ? value.disputed_transactions : [];
  if (approved && units.length !== 1 || dispute && transactions.length !== 1) return null;
  if(related?.order_id!==undefined&&!text(related.order_id))return null;
  if(!approved&&!refund&&!dispute&&!reversed&&value.status!==event.event_type.split(".").at(-1))return null;
  const transaction = object(transactions[0]), capture = text(related?.capture_id) ?? text(transaction?.seller_transaction_id) ?? (reversed ? text(value.id) : undefined);
  const ref: References = { checkout: approved ? text(value.id) : text(related?.order_id),
    payment: refund ? paypalRefundCapture(value, mode) : dispute ? capture ?? text(object(transaction?.transaction_info)?.seller_transaction_id) : approved ? undefined : text(value.id) };
  if ((refund || dispute) && !ref.payment) return null;
  const owner = await ownerOf("PAYPAL", mode, ref, dependencies.repository ?? repository); if (!owner) return null;
  const custom = approved ? unit?.custom_id : value.custom_id, order = approved ? unit?.reference_id : undefined;
  if (custom !== undefined && custom !== owner.id || order !== undefined && order !== owner.orderId) return null;
  const merchant = object(approved ? unit?.payee : value.payee)?.merchant_id;
  if (merchant !== undefined && merchant !== env.DCN_PAYPAL_MERCHANT_ID) return null;
  const amount = object(approved ? unit?.amount : dispute ? value.dispute_amount : value.amount);
  try { const cents = paypalCentsFromAmount(amount?.value); if (amount?.currency_code !== "EUR" || cents < 1 || (refund || dispute ? cents > owner.order.totalCents : cents !== owner.order.totalCents)) return null; }
  catch { return null; }
  const payload = { ...(related?.order_id ? { providerReference: String(related.order_id) } : {}), ...(capture ? { paymentReference: capture } : {}), attemptId: owner.id,
    ...(value.id || value.dispute_id ? { resourceReference: reversed ? `reversal:${value.id}` : String(value.dispute_id ?? value.id) } : {}) };
  return persist({ provider: "PAYPAL", eventId: event.id, eventType: event.event_type, orderId: owner.orderId, bodyHash, payload,
    verifiedMode: mode, merchantId: env.DCN_PAYPAL_MERCHANT_ID }, dependencies.receive ?? receiveDigitalEvent);
}
