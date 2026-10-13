import "server-only";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "@/lib/payments/config";
import { hostedCheckoutParameters } from "@/lib/payments/stripe-client";
import { createScopedPaypalGateway, paypalCaptureResponseEvidence, paypalCentsFromAmount, type PaypalWebhookHeaders } from "@/lib/payments/paypal-client";
import { DigitalError, checkoutProviderUrl, requireDigitalEnvironment, type DigitalPaymentEvidence } from "./domain";

export type DigitalProviderOrder = { id: string; totalCents: number; userEmail: string; lines: Array<{ title: string; priceCents: number }> };
export type DigitalAttemptRef = { id: string; provider: string; providerReference: string | null; idempotencyKey: string };
export interface DigitalGateway {
  merchantId: string;
  create(order: DigitalProviderOrder, attempt: DigitalAttemptRef): Promise<{ id: string; url: string }>;
  recover(order: DigitalProviderOrder, attempt: DigitalAttemptRef): Promise<{ checkout?: { id: string; url: string }; evidence?: DigitalPaymentEvidence } | null>;
  capture?(order: DigitalProviderOrder, attempt: DigitalAttemptRef): Promise<DigitalPaymentEvidence>;
}
function base() {
  const u = new URL(process.env.AUTH_URL ?? "http://localhost:3000");
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/") throw new DigitalError("INVALID_BASE", 503);
  return u.origin;
}
function stripe() {
  requireDigitalEnvironment();
  const key = process.env.DCN_STRIPE_SECRET_KEY ?? "";
  const merchantId = process.env.DCN_STRIPE_ACCOUNT_ID ?? "";
  if (!/^(sk|rk)_test_[A-Za-z0-9_-]{8,}$/.test(key) || !/^acct_[A-Za-z0-9]+$/.test(merchantId)
    || !/^whsec_[A-Za-z0-9_-]{8,}$/.test(process.env.DCN_STRIPE_WEBHOOK_SECRET ?? "")) throw new DigitalError("STRIPE_TEST_NOT_CONFIGURED", 503);
  return { client: new Stripe(key, { apiVersion: STRIPE_API_VERSION, timeout: 15000, maxNetworkRetries: 0, telemetry: false }), merchantId };
}
export function digitalStripeParameters(order: DigitalProviderOrder, attemptId: string) {
  const metadata = { paymentSource: "DIGITAL_MUSIC", digitalOrderId: order.id, digitalAttemptId: attemptId, mode: "TEST" };
  const existing = hostedCheckoutParameters({ orderId: order.id, paymentId: attemptId, pricingVersion: "DCN-1.0", customerEmail: order.userEmail,
    lineItems: order.lines.map(l => ({ quantity: 1 as const, price_data: { currency: "eur" as const, unit_amount: l.priceCents, product_data: { name: l.title } } })),
    successUrl: `${base()}/musique/confirmation/${order.id}`, cancelUrl: `${base()}/musique/confirmation/${order.id}?annule=1` });
  return { ...existing, client_reference_id: order.id, metadata, payment_intent_data: { metadata } };
}
export function stripeDigitalEvidence(session: Stripe.Checkout.Session, eventId: string, merchantId: string, eventType?: string): DigitalPaymentEvidence {
  const payment = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (session.livemode || session.metadata?.paymentSource !== "DIGITAL_MUSIC" || session.metadata.mode !== "TEST"
    || session.client_reference_id !== session.metadata.digitalOrderId || !Number.isSafeInteger(session.amount_total) || session.currency !== "eur") throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
  return { authenticated: true, mode: "TEST", eventId, orderId: session.metadata.digitalOrderId, provider: "STRIPE", providerReference: session.id,
    paymentReference: payment ?? "", merchantId, amountCents: session.amount_total!, currency: "EUR",
    status: session.status === "complete" && session.payment_status === "paid" ? "PAID" : session.status === "expired" || eventType === "checkout.session.async_payment_failed" ? "FAILED" : "PENDING" };
}
export function createDigitalStripeGateway(): DigitalGateway {
  const { client, merchantId } = stripe();
  const verify = async () => { const a = await client.accounts.retrieve(null); if (a.id !== merchantId || !a.charges_enabled) throw new DigitalError("MERCHANT_MISMATCH", 503); };
  return { merchantId,
    async create(order, attempt) { await verify(); const s = await client.checkout.sessions.create(digitalStripeParameters(order, attempt.id), { idempotencyKey: attempt.idempotencyKey });
      if (s.livemode || !s.url) throw new DigitalError("INVALID_SESSION", 503);
      return { id: s.id, url: checkoutProviderUrl(s.url, "STRIPE") }; },
    async recover(order, attempt) {
      await verify(); let s: Stripe.Checkout.Session | undefined;
      if (attempt.providerReference) s = await client.checkout.sessions.retrieve(attempt.providerReference);
      else { const found = (await client.checkout.sessions.list({ limit: 100 })).data.filter(s => s.metadata?.digitalAttemptId === attempt.id && s.metadata?.digitalOrderId === order.id);
        if (found.length > 1) throw new DigitalError("AMBIGUOUS_PAYMENT", 409); s = found[0]; }
      if (!s) return null;
      if (s.metadata?.digitalAttemptId !== attempt.id) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
      return { ...(s.url ? { checkout: { id: s.id, url: checkoutProviderUrl(s.url, "STRIPE") } } : {}), evidence: stripeDigitalEvidence(s, `stripe-recover:${s.id}:${s.status}:${s.payment_status}`, merchantId) };
    },
  };
}
function paypal() {
  requireDigitalEnvironment();
  const { DCN_PAYPAL_CLIENT_ID: clientId, DCN_PAYPAL_CLIENT_SECRET: clientSecret, DCN_PAYPAL_WEBHOOK_ID: webhookId, DCN_PAYPAL_MERCHANT_ID: merchantId } = process.env;
  if (process.env.DCN_PAYPAL_ENVIRONMENT !== "sandbox" || !clientId || !clientSecret || !webhookId || !merchantId) throw new DigitalError("PAYPAL_SANDBOX_NOT_CONFIGURED", 503);
  return { merchantId, client: createScopedPaypalGateway({ provider: "paypal", enabled: true, configured: true, environment: "sandbox", clientId, clientSecret, webhookId }, fetch, true) };
}
function paypalEvidence(body: unknown, order: DigitalProviderOrder, attempt: DigitalAttemptRef, merchantId: string): DigitalPaymentEvidence {
  const b = body as { id?: string; status?: string; purchase_units?: Array<{ reference_id?: string; custom_id?: string; payee?: { merchant_id?: string }; amount?: { value?: string; currency_code?: string } }> };
  const unit = b.purchase_units?.[0];
  if (b.id !== attempt.providerReference || b.purchase_units?.length !== 1 || unit?.custom_id !== attempt.id || unit.reference_id !== order.id
    || unit.payee?.merchant_id !== merchantId || unit.amount?.currency_code !== "EUR" || paypalCentsFromAmount(unit.amount.value) !== order.totalCents) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
  const capture = paypalCaptureResponseEvidence(body);
  if (!capture.evidenceConsistent || capture.paymentId !== attempt.id || !capture.captureId) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
  return { authenticated: true, mode: "TEST", provider: "PAYPAL", orderId: order.id, providerReference: b.id!, paymentReference: capture.captureId,
    merchantId, amountCents: capture.amountCents!, currency: capture.currency!, status: capture.status === "COMPLETED" ? "PAID" : ["DENIED","DECLINED","FAILED"].includes(capture.status??"") ? "FAILED" : "PENDING", eventId: `paypal-recover:${capture.captureId}:${capture.status}` };
}
export function createDigitalPaypalGateway(): DigitalGateway {
  const { client, merchantId } = paypal();
  const inspect = async (order: DigitalProviderOrder, attempt: DigitalAttemptRef) => {
    if (!attempt.providerReference) return null;
    const body = await client.inspectOrder!(attempt.providerReference) as { id?: string; status?: string; links?: Array<{ rel: string; href: string }>; purchase_units?: Array<{ payee?: { merchant_id?: string }; reference_id?: string; custom_id?: string; payments?: { captures?: unknown[] } }> };
    const unit = body.purchase_units?.[0];
    if (body.id !== attempt.providerReference || unit?.payee?.merchant_id !== merchantId || unit.reference_id !== order.id || unit.custom_id !== attempt.id) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
    return body;
  };
  return { merchantId,
    async create(order, attempt) { const s = await client.createOrder({ orderId: order.id, orderNumber: "DCN-TEST", paymentId: attempt.id,
      amountCents: order.totalCents, currency: "EUR", description: "Musique numérique LNX Beats — test", itemCategory: "DIGITAL_GOODS", payeeMerchantId: merchantId,
      returnUrl: `${base()}/musique/confirmation/${order.id}`, cancelUrl: `${base()}/musique/confirmation/${order.id}?annule=1` }, attempt.idempotencyKey);
      if (!s.approvalUrl) throw new DigitalError("INVALID_SESSION", 503); return { id: s.id, url: checkoutProviderUrl(s.approvalUrl, "PAYPAL") }; },
    async recover(order, attempt) { const body = await inspect(order, attempt); if (!body) return null;
      if (body.purchase_units?.[0]?.payments?.captures?.length) return { evidence: paypalEvidence(body, order, attempt, merchantId) };
      const url = body.links?.find(l => l.rel === "approve" || l.rel === "payer-action")?.href;
      return url ? { checkout: { id: body.id!, url: checkoutProviderUrl(url, "PAYPAL") } } : null; },
    async capture(order, attempt) { const body = await inspect(order, attempt); if (!body || body.status !== "APPROVED") throw new DigitalError("PAYPAL_NOT_APPROVED", 409);
      await client.captureOrder(attempt.providerReference!, `${attempt.idempotencyKey}:capture`);
      return paypalEvidence(await client.inspectOrder!(attempt.providerReference!), order, attempt, merchantId); },
  };
}
export function digitalGateway(provider: string) { if (provider === "STRIPE") return createDigitalStripeGateway(); if (provider === "PAYPAL") return createDigitalPaypalGateway(); throw new DigitalError("INVALID_PROVIDER"); }
export function digitalAvailableProviders() { const result: string[] = []; for (const p of ["STRIPE", "PAYPAL"]) { try { digitalGateway(p); result.push(p); } catch {} } return result; }
export async function verifiedDigitalStripeEvent(raw: string, signature: string) {
  const { client, merchantId } = stripe(); const secret = process.env.DCN_STRIPE_WEBHOOK_SECRET ?? "";
  if (!secret.startsWith("whsec_")) throw new DigitalError("WEBHOOK_NOT_CONFIGURED", 503);
  let event:Stripe.Event;try{event=client.webhooks.constructEvent(raw, signature, secret);}catch{throw new DigitalError("INVALID_WEBHOOK",400);}
  if (event.livemode || event.account) throw new DigitalError("INVALID_WEBHOOK", 400);
  if ((await client.accounts.retrieve(null)).id !== merchantId) throw new DigitalError("MERCHANT_MISMATCH", 503);
  return { event, merchantId };
}
export function verifyDigitalPaypalEvent(raw: string, headers: PaypalWebhookHeaders) { return paypal().client.verifyWebhook(headers, raw); }
