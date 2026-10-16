import "server-only";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "@/lib/payments/config";
import { evaluateLiveRefundProductionPolicy } from "@/lib/payments/live-refund-policy";
import type { PaymentsConfiguration, StripePaymentConfiguration, PaypalPaymentConfiguration } from "@/lib/payments/types";
import { hostedCheckoutParameters } from "@/lib/payments/stripe-client";
import { createScopedPaypalGateway, type PaypalWebhookHeaders } from "@/lib/payments/paypal-client";
import { DigitalError, checkoutProviderUrl, requireDigitalEnvironment, type DigitalPaymentEvidence, type DigitalMode } from "./domain";
import { digitalProviderRequestsAllowed, digitalNewSalesAllowed } from "./runtime-policy";
import { digitalPaypalOrderEvidence } from "./paypal-evidence";
import {assertDigitalProviderBilling,digitalProviderBilling,digitalPaypalProviderBilling,type DigitalExpectedBilling} from "./france-provider-billing";

export type DigitalProviderOrder = { id: string; mode?: DigitalMode; totalCents: number; userEmail: string; lines: Array<{ title: string; priceCents: number }>; expectedBilling?:DigitalExpectedBilling };
export type DigitalAttemptRef = { id: string; provider: string; providerReference: string | null; idempotencyKey: string };
export interface DigitalGateway {
  merchantId: string;
  mode?: DigitalMode;
  create(order: DigitalProviderOrder, attempt: DigitalAttemptRef): Promise<{ id: string; url: string }>;
  recover(order: DigitalProviderOrder, attempt: DigitalAttemptRef): Promise<{ checkout?: { id: string; url: string }; evidence?: DigitalPaymentEvidence } | null>;
  capture?(order: DigitalProviderOrder, attempt: DigitalAttemptRef): Promise<DigitalPaymentEvidence>;
}
function base(mode: DigitalMode = "TEST") {
  const u = new URL(process.env.AUTH_URL ?? "http://localhost:3000");
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/" || mode === "LIVE" && u.origin !== "https://www.lnxbeats.fr") throw new DigitalError("INVALID_BASE", 503);
  return u.origin;
}
export function assertDigitalProviderRequest(mode: DigitalMode, newSale = false) {
  if (!digitalProviderRequestsAllowed(mode)) throw new DigitalError(mode === "TEST" ? "EXTERNAL_QA_AUTHORIZATION_REQUIRED" : "PAYMENT_REQUIRES_REVIEW", 503);
  if (newSale && !digitalNewSalesAllowed(mode)) throw new DigitalError("NEW_DIGITAL_PAYMENTS_CLOSED", 503);
}
function scopedMode(mode?: DigitalMode) {
  const current = requireDigitalEnvironment();
  if (mode !== undefined && mode !== current) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
  return current;
}
function orderMode(order: DigitalProviderOrder, expected: DigitalMode) {
  // Omission is only backwards-compatible with TEST callers, never LIVE.
  if ((order.mode ?? "TEST") !== expected) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
}
type ScopedConfiguration = Extract<StripePaymentConfiguration | PaypalPaymentConfiguration, { enabled: true }>;
function refundConfiguration(configuration: ScopedConfiguration): PaymentsConfiguration {
  return { enabled: process.env.PAYMENTS_ENABLED === "true", deploymentEnvironment: "production", liveRefundsEnabled: process.env.LIVE_REFUNDS_ENABLED === "true",
    stripe: configuration.provider === "stripe" ? configuration : { provider: "stripe", enabled: false, configured: false, mode: "disabled", apiVersion: STRIPE_API_VERSION },
    paypal: configuration.provider === "paypal" ? configuration : { provider: "paypal", enabled: false, configured: false, environment: "disabled" } };
}
function liveRefundArmed(configuration: ScopedConfiguration) {
  return evaluateLiveRefundProductionPolicy(process.env, refundConfiguration(configuration)).armed;
}
/** Reuse the existing operational LIVE refund authorization, not a new blanket
 * prohibition and not the sales switch. Admin, amount and idempotence remain upstream. */
export function assertDigitalRefundOperation(mode: DigitalMode, configuration: ScopedConfiguration) {
  assertDigitalProviderRequest(mode);
  if(configuration.provider==="stripe"?configuration.mode!==(mode==="LIVE"?"live":"test")
    :configuration.environment!==(mode==="LIVE"?"live":"sandbox"))throw new DigitalError("PAYMENT_REQUIRES_REVIEW",409);
  if (mode === "LIVE" && !liveRefundArmed(configuration)) throw new DigitalError("LIVE_REFUNDS_NOT_ARMED", 503);
}
function stripe(requestedMode?: DigitalMode) {
  const mode = scopedMode(requestedMode);
  const key = process.env.DCN_STRIPE_SECRET_KEY ?? "";
  const merchantId = process.env.DCN_STRIPE_ACCOUNT_ID ?? "";
  const credentialMode = mode === "LIVE" ? "live" : "test";
  if (!new RegExp(`^(sk|rk)_${credentialMode}_[A-Za-z0-9_-]{8,}$`).test(key) || !/^acct_[A-Za-z0-9]+$/.test(merchantId)
    || !/^whsec_[A-Za-z0-9_-]{8,}$/.test(process.env.DCN_STRIPE_WEBHOOK_SECRET ?? "")) throw new DigitalError("STRIPE_TEST_NOT_CONFIGURED", 503);
  const configuration: Extract<StripePaymentConfiguration, { enabled: true }> = { provider: "stripe", enabled: true, configured: true,
    mode: credentialMode, apiVersion: STRIPE_API_VERSION, secretKey: key, webhookSecret: process.env.DCN_STRIPE_WEBHOOK_SECRET! };
  return { client: new Stripe(key, { apiVersion: STRIPE_API_VERSION, timeout: 15000, maxNetworkRetries: 0, telemetry: false }), merchantId, mode, configuration };
}
export function digitalStripeParameters(order: DigitalProviderOrder, attemptId: string) {
  const mode = order.mode ?? "TEST";
  if (!["TEST", "LIVE"].includes(mode)) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
  const metadata = { paymentSource: "DIGITAL_MUSIC", digitalOrderId: order.id, digitalAttemptId: attemptId, mode };
  const existing = hostedCheckoutParameters({ orderId: order.id, paymentId: attemptId, pricingVersion: "DCN-1.0", customerEmail: order.userEmail,
    lineItems: order.lines.map(l => ({ quantity: 1 as const, price_data: { currency: "eur" as const, unit_amount: l.priceCents, product_data: { name: l.title } } })),
    successUrl: `${base(mode)}/musique/confirmation/${order.id}`, cancelUrl: `${base(mode)}/musique/confirmation/${order.id}?annule=1` });
  return { ...existing, client_reference_id: order.id, metadata, payment_intent_data: { metadata } };
}
export function stripeDigitalEvidence(session: Stripe.Checkout.Session, eventId: string, merchantId: string, eventType?: string, mode: DigitalMode = "TEST"): DigitalPaymentEvidence {
  const payment = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!["TEST", "LIVE"].includes(mode) || session.livemode !== (mode === "LIVE") || session.metadata?.paymentSource !== "DIGITAL_MUSIC" || session.metadata.mode !== mode
    || session.client_reference_id !== session.metadata.digitalOrderId || !Number.isSafeInteger(session.amount_total) || session.currency !== "eur") throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
  return { authenticated: true, mode, eventId, orderId: session.metadata.digitalOrderId, provider: "STRIPE", providerReference: session.id,
    paymentReference: payment ?? "", merchantId, amountCents: session.amount_total!, currency: "EUR",
    status: session.status === "complete" && session.payment_status === "paid" ? "PAID" : session.status === "expired" || eventType === "checkout.session.async_payment_failed" ? "FAILED" : "PENDING",
    ...(digitalProviderBilling(session.customer_details?.address)?{billing:digitalProviderBilling(session.customer_details?.address)}:{}) };
}
export function createDigitalStripeGateway(requestedMode?: DigitalMode): DigitalGateway {
  const { client, merchantId, mode } = stripe(requestedMode);
  const verify = async (sale = false) => { assertDigitalProviderRequest(mode, sale); const a = await client.accounts.retrieve(null); if (a.id !== merchantId || sale && !a.charges_enabled) throw new DigitalError("MERCHANT_MISMATCH", 503); };
  return { merchantId, mode,
    async create(order, attempt) { orderMode(order, mode); await verify(true); assertDigitalProviderRequest(mode, true);
      const s = await client.checkout.sessions.create(digitalStripeParameters(order, attempt.id), { idempotencyKey: attempt.idempotencyKey });
      if (s.livemode !== (mode === "LIVE") || !s.url) throw new DigitalError("INVALID_SESSION", 503);
      return { id: s.id, url: checkoutProviderUrl(s.url, "STRIPE", mode) }; },
    async recover(order, attempt) {
      orderMode(order, mode); await verify(); let s: Stripe.Checkout.Session | undefined;
      if (attempt.providerReference) s = await client.checkout.sessions.retrieve(attempt.providerReference);
      else { const found = (await client.checkout.sessions.list({ limit: 100 })).data.filter(s => s.metadata?.digitalAttemptId === attempt.id && s.metadata?.digitalOrderId === order.id);
        if (found.length > 1) throw new DigitalError("AMBIGUOUS_PAYMENT", 409); s = found[0]; }
      if (!s) return null;
      if (s.metadata?.digitalAttemptId !== attempt.id) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
      const evidence = stripeDigitalEvidence(s, `stripe-recover:${s.id}:${s.status}:${s.payment_status}`, merchantId, undefined, mode);
      if (s.status === "complete" && s.payment_status !== "paid" && s.payment_intent) {
        const pi = await client.paymentIntents.retrieve(typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent.id);
        if (pi.livemode !== (mode === "LIVE") || pi.metadata.mode !== mode || pi.metadata.paymentSource !== "DIGITAL_MUSIC" || pi.metadata.digitalAttemptId !== attempt.id || pi.metadata.digitalOrderId !== order.id || pi.currency !== "eur" || pi.amount !== order.totalCents) throw new DigitalError("PAYMENT_REQUIRES_REVIEW");
        if (["canceled", "requires_payment_method"].includes(pi.status)) { evidence.status = "FAILED"; evidence.eventId += `:${pi.status}`; }
      }
      return { ...(s.url ? { checkout: { id: s.id, url: checkoutProviderUrl(s.url, "STRIPE", mode) } } : {}), evidence };
    },
  };
}
function paypal(requestedMode?: DigitalMode) {
  const mode = scopedMode(requestedMode);
  const { DCN_PAYPAL_CLIENT_ID: clientId, DCN_PAYPAL_CLIENT_SECRET: clientSecret, DCN_PAYPAL_WEBHOOK_ID: webhookId, DCN_PAYPAL_MERCHANT_ID: merchantId } = process.env;
  const environment = mode === "LIVE" ? "live" : "sandbox";
  if (process.env.DCN_PAYPAL_ENVIRONMENT !== environment || !clientId || !clientSecret || !webhookId || !merchantId) throw new DigitalError("PAYPAL_SANDBOX_NOT_CONFIGURED", 503);
  const configuration: Extract<PaypalPaymentConfiguration, { enabled: true }> = { provider: "paypal", enabled: true, configured: true, environment, clientId, clientSecret, webhookId };
  return { merchantId, mode, configuration, client: createScopedPaypalGateway(configuration, fetch, mode === "LIVE" && liveRefundArmed(configuration)) };
}
// Scoped server-only clients; credentials remain inside the existing factories.
export const digitalStripeClient = stripe;
export const digitalPaypalClient = paypal;
export function createDigitalPaypalGateway(requestedMode?: DigitalMode): DigitalGateway {
  const { client, merchantId, mode } = paypal(requestedMode);
  const inspect = async (order: DigitalProviderOrder, attempt: DigitalAttemptRef) => {
    orderMode(order, mode); assertDigitalProviderRequest(mode);
    if (!attempt.providerReference) return null;
    const body = await client.inspectOrder!(attempt.providerReference) as { id?: string; status?: string; payer?:{address?:unknown}; links?: Array<{ rel: string; href: string }>; purchase_units?: Array<{ payee?: { merchant_id?: string }; reference_id?: string; custom_id?: string; payments?: { captures?: unknown[] } }> };
    const unit = body.purchase_units?.[0];
    if (body.id !== attempt.providerReference || unit?.payee?.merchant_id !== merchantId || unit.reference_id !== order.id || unit.custom_id !== attempt.id) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
    return body;
  };
  return { merchantId, mode,
    async create(order, attempt) { orderMode(order, mode); assertDigitalProviderRequest(mode, true);
      const s = await client.createOrder({ orderId: order.id, orderNumber: `DCN-${mode}`, paymentId: attempt.id,
      amountCents: order.totalCents, currency: "EUR", description: mode === "TEST" ? "Musique numérique LNX Beats — test" : "Musique numérique LNX Beats", itemCategory: "DIGITAL_GOODS", payeeMerchantId: merchantId,
      returnUrl: `${base(mode)}/musique/confirmation/${order.id}`, cancelUrl: `${base(mode)}/musique/confirmation/${order.id}?annule=1` }, attempt.idempotencyKey);
      if (!s.approvalUrl) throw new DigitalError("INVALID_SESSION", 503); return { id: s.id, url: checkoutProviderUrl(s.approvalUrl, "PAYPAL", mode) }; },
    async recover(order, attempt) { const body = await inspect(order, attempt); if (!body) return null;
      if (body.purchase_units?.[0]?.payments?.captures?.length) return { evidence: digitalPaypalOrderEvidence(body, order, attempt, merchantId, mode) };
      const url = body.links?.find(l => l.rel === "approve" || l.rel === "payer-action")?.href;
      return url ? { checkout: { id: body.id!, url: checkoutProviderUrl(url, "PAYPAL", mode) } } : null; },
    async capture(order, attempt) { const body = await inspect(order, attempt); if (!body || body.status !== "APPROVED") throw new DigitalError("PAYPAL_NOT_APPROVED", 409);
      assertDigitalProviderBilling(order.expectedBilling,digitalPaypalProviderBilling(body));
      assertDigitalProviderRequest(mode, true);
      await client.captureOrder(attempt.providerReference!, `${attempt.idempotencyKey}:capture`);
      return digitalPaypalOrderEvidence(await client.inspectOrder!(attempt.providerReference!), order, attempt, merchantId, mode); },
  };
}
export function digitalGateway(provider: string, mode?: DigitalMode) { if (provider === "STRIPE") return createDigitalStripeGateway(mode); if (provider === "PAYPAL") return createDigitalPaypalGateway(mode); throw new DigitalError("INVALID_PROVIDER"); }
export function digitalAvailableProviders() { const result: string[] = []; for (const p of ["STRIPE", "PAYPAL"]) { try { digitalGateway(p); result.push(p); } catch {} } return result; }
export async function verifiedDigitalStripeEvent(raw: string, signature: string) {
  const { client, merchantId, mode } = stripe(); const secret = process.env.DCN_STRIPE_WEBHOOK_SECRET ?? "";
  if (!secret.startsWith("whsec_")) throw new DigitalError("WEBHOOK_NOT_CONFIGURED", 503);
  let event:Stripe.Event;try{event=client.webhooks.constructEvent(raw, signature, secret);}catch{throw new DigitalError("INVALID_WEBHOOK",400);}
  if (event.livemode !== (mode === "LIVE") || event.account) throw new DigitalError("INVALID_WEBHOOK", 400);
  assertDigitalProviderRequest(mode);
  if ((await client.accounts.retrieve(null)).id !== merchantId) throw new DigitalError("MERCHANT_MISMATCH", 503);
  return { event, merchantId, mode };
}
export function verifyDigitalPaypalEvent(raw: string, headers: PaypalWebhookHeaders) {
  const mode = requireDigitalEnvironment(); assertDigitalProviderRequest(mode);
  return paypal(mode).client.verifyWebhook(headers, raw);
}
