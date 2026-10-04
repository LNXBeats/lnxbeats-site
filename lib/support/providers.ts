import "server-only";

import Stripe from "stripe";
import { createHash } from "node:crypto";
import { STRIPE_API_VERSION } from "@/lib/payments/config";
import { createTestPaypalGateway, paypalCaptureResponseEvidence, type PaypalWebhookHeaders } from "@/lib/payments/paypal-client";
import { requireSupportEnabled, requireSupportTestEnvironment, SupportError } from "@/lib/support/config";

export type SupportProvider = "STRIPE" | "PAYPAL";
export type SupportSnapshot = { id: string; amountCents: number; provider: string; providerReference: string | null; paymentReference: string | null };
export type SupportRecovery = {
  checkout?: { id: string; url: string };
  evidence?: SupportEvidence;
  refund?: { id: string; status: string };
};
export type SupportEvidence = {
  contributionId: string; provider: SupportProvider; providerReference: string;
  paymentReference: string; amountCents: number; currency: string;
  status: "SUCCEEDED" | "PENDING" | "FAILED";
};

function stripeClient() {
  requireSupportTestEnvironment();
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (process.env.STRIPE_MODE !== "test" || !/^(sk|rk)_test_[a-zA-Z0-9_-]{8,}$/.test(key)) throw new SupportError("DISABLED");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 0, timeout: 15000 });
}

function paypalClient() {
  requireSupportTestEnvironment();
  const { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret, SUPPORT_PAYPAL_WEBHOOK_ID: webhookId } = process.env;
  if (process.env.PAYPAL_ENVIRONMENT !== "sandbox" || !clientId || !clientSecret || !webhookId) throw new SupportError("DISABLED");
  // Reuse the existing official PayPal transport, bounded response parser,
  // request-id handling and postback verification; never arm its live path.
  return createTestPaypalGateway({ provider: "paypal", enabled: true, configured: true, environment: "sandbox", clientId, clientSecret, webhookId }, fetch);
}

export function supportCheckoutParameters(value: SupportSnapshot, base: string): Stripe.Checkout.SessionCreateParams {
  const metadata = { purpose: "SUPPORT_LNX_BEATS", contributionId: value.id };
  return {
    mode: "payment", client_reference_id: value.id, metadata,
    integration_identifier: `lnx-support-${[...createHash("sha256").update(value.id).digest().subarray(0, 8)].map((byte) => String.fromCharCode(97 + byte % 26)).join("")}`,
    payment_intent_data: { metadata },
    adaptive_pricing: { enabled: false }, automatic_tax: { enabled: false },
    invoice_creation: { enabled: false }, allow_promotion_codes: false,
    line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: value.amountCents,
      product_data: { name: "Soutien libre LNX Beats — sans contrepartie" } } }],
    success_url: `${base}/soutenir/confirmation/${value.id}`,
    cancel_url: `${base}/soutenir/confirmation/${value.id}?annule=1`,
  };
}

export function validateSupportCheckoutUrl(raw: string, provider: SupportProvider) {
  const url = new URL(raw);
  const host = provider === "STRIPE" ? "checkout.stripe.com" : "www.sandbox.paypal.com";
  if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password) throw new SupportError("UNAVAILABLE");
  return raw;
}

export async function createProviderCheckout(value: SupportSnapshot, base: string, key: string) {
  requireSupportEnabled();
  if (value.provider === "STRIPE") {
    const session = await stripeClient().checkout.sessions.create(supportCheckoutParameters(value, base), { idempotencyKey: key });
    if (session.livemode || !session.url) throw new SupportError("UNAVAILABLE");
    return { id: session.id, url: validateSupportCheckoutUrl(session.url, "STRIPE") };
  }
  const session = await paypalClient().createOrder({
    // The adapter calls this field orderId, but emits only reference_id. This
    // UUID belongs exclusively to SupportContribution, never the Order model.
    orderId: value.id, orderNumber: "SUPPORT_LNX_BEATS", paymentId: value.id,
    amountCents: value.amountCents, currency: "EUR", description: "SUPPORT_LNX_BEATS — Soutien libre sans contrepartie",
    returnUrl: `${base}/soutenir/confirmation/${value.id}`,
    cancelUrl: `${base}/soutenir/confirmation/${value.id}?annule=1`,
  }, key);
  if (!session.approvalUrl) throw new SupportError("UNAVAILABLE");
  return { id: session.id, url: validateSupportCheckoutUrl(session.approvalUrl, "PAYPAL") };
}

export async function captureProviderSupport(value: SupportSnapshot, key: string): Promise<SupportEvidence> {
  requireSupportTestEnvironment();
  if (value.provider !== "PAYPAL" || !value.providerReference) throw new SupportError("INVALID");
  const capture = await paypalClient().captureOrder(value.providerReference, key);
  if (capture.evidenceConsistent !== true || !capture.captureId || capture.paymentId !== value.id || capture.providerOrderId !== value.providerReference
    || capture.amountCents !== value.amountCents || capture.currency !== "EUR") throw new SupportError("CONFLICT");
  return { contributionId: value.id, provider: "PAYPAL", providerReference: value.providerReference,
    paymentReference: capture.captureId, amountCents: value.amountCents, currency: "EUR",
    status: capture.status === "COMPLETED" ? "SUCCEEDED" : "PENDING" };
}

export async function refundProviderSupport(value: SupportSnapshot, key: string) {
  requireSupportTestEnvironment();
  if (!value.paymentReference) throw new SupportError("CONFLICT");
  if (value.provider === "STRIPE") {
    const refund = await stripeClient().refunds.create({ payment_intent: value.paymentReference,
      amount: value.amountCents, metadata: { purpose: "SUPPORT_LNX_BEATS", contributionId: value.id } }, { idempotencyKey: key });
    if (refund.amount !== value.amountCents || refund.currency !== "eur" || refund.payment_intent !== value.paymentReference) throw new SupportError("CONFLICT");
    return { id: refund.id, status: refund.status === "succeeded" ? "REFUNDED" : refund.status === "failed" || refund.status === "canceled" ? "REQUIRES_REVIEW" : "REFUND_PENDING" };
  }
  const refund = await paypalClient().refundCapture(value.paymentReference, value.amountCents, key);
  if (refund.amountCents !== value.amountCents || refund.currency !== "EUR" || refund.captureId !== value.paymentReference) throw new SupportError("CONFLICT");
  return { id: refund.providerRefundId, status: refund.status === "SUCCEEDED" ? "REFUNDED" : refund.status === "FAILED" ? "REQUIRES_REVIEW" : "REFUND_PENDING" };
}

export async function retrieveSupportRefund(value: SupportSnapshot & { refundReference: string }) {
  if (value.provider === "STRIPE") {
    const refund = await stripeClient().refunds.retrieve(value.refundReference);
    if (refund.amount !== value.amountCents || refund.currency !== "eur" || refund.payment_intent !== value.paymentReference) throw new SupportError("CONFLICT");
    return refund.status === "succeeded" ? "REFUNDED" : refund.status === "failed" || refund.status === "canceled" ? "REQUIRES_REVIEW" : "REFUND_PENDING";
  }
  const refund = await paypalClient().retrieveRefund(value.refundReference);
  if (refund.amountCents !== value.amountCents || refund.currency !== "EUR" || refund.captureId !== value.paymentReference) throw new SupportError("CONFLICT");
  return refund.status === "SUCCEEDED" ? "REFUNDED" : refund.status === "FAILED" ? "REQUIRES_REVIEW" : "REFUND_PENDING";
}

export function verifySupportStripeWebhook(raw: string, signature: string) {
  const secret = process.env.SUPPORT_STRIPE_WEBHOOK_SECRET ?? "";
  if (!secret.startsWith("whsec_")) throw new SupportError("DISABLED");
  const event = stripeClient().webhooks.constructEvent(raw, signature, secret);
  if (event.livemode || event.account) throw new SupportError("INVALID");
  return event;
}

export function verifySupportPaypalWebhook(raw: string, headers: PaypalWebhookHeaders) {
  return paypalClient().verifyWebhook(headers, raw);
}

/** GET-only recovery. Unknown is not failed, and never licenses a new POST.
 * PayPal exposes no order lookup by request-id: without an order reference
 * recovery stays unknown until a verified webhook/admin-provided reference.
 */
export async function recoverProviderSupport(value: SupportSnapshot & { refundReference?: string | null }, operation: string): Promise<SupportRecovery | null> {
  requireSupportTestEnvironment();
  if (value.provider === "STRIPE") {
    const client = stripeClient();
    if (operation === "REFUND") {
      if (!value.paymentReference) return null;
      const refunds = await client.refunds.list({ payment_intent: value.paymentReference, limit: 100 });
      const matches = refunds.data.filter(r => r.metadata?.contributionId === value.id && r.metadata?.purpose === "SUPPORT_LNX_BEATS");
      if (matches.length !== 1 || matches[0].amount !== value.amountCents || matches[0].currency !== "eur") return null;
      const refund = matches[0];
      return { refund: { id: refund.id, status: refund.status === "succeeded" ? "REFUNDED" : refund.status === "failed" || refund.status === "canceled" ? "REQUIRES_REVIEW" : "REFUND_PENDING" } };
    }
    let session: Stripe.Checkout.Session | undefined;
    if (value.providerReference) session = await client.checkout.sessions.retrieve(value.providerReference);
    else {
      // Bounded scan, only the opaque contribution metadata is retained.
      let after: string | undefined;
      for (let page = 0; page < 10; page++) {
        const list = await client.checkout.sessions.list({ limit: 100, ...(after ? { starting_after: after } : {}) });
        session = list.data.find(s => s.metadata?.contributionId === value.id && s.client_reference_id === value.id);
        if (session || !list.has_more) break;
        after = list.data.at(-1)?.id;
      }
    }
    if (!session || session.livemode || session.metadata?.purpose !== "SUPPORT_LNX_BEATS") return null;
    const evidence = stripeSupportEvidence({ type: session.status === "expired" ? "checkout.session.expired" : "checkout.session.completed", livemode: false, data: { object: session } } as Stripe.Event);
    if (!evidence || evidence.contributionId !== value.id || evidence.amountCents !== value.amountCents) throw new SupportError("CONFLICT");
    return { ...(session.url ? { checkout: { id: session.id, url: validateSupportCheckoutUrl(session.url, "STRIPE") } } : {}), evidence };
  }
  if (operation === "REFUND") {
    if (!value.refundReference) return null;
    return { refund: { id: value.refundReference, status: await retrieveSupportRefund({ ...value, refundReference: value.refundReference }) } };
  }
  if (!value.providerReference) return null;
  const body = await paypalClient().inspectOrder!(value.providerReference) as {
    id?: string; status?: string; purchase_units?: Array<{ custom_id?: string; reference_id?: string; amount?: { currency_code?: string; value?: string }; payments?: { captures?: unknown[] } }>;
    links?: Array<{ rel?: string; href?: string }>;
  };
  const unit = body.purchase_units?.[0];
  if (body.id !== value.providerReference || body.purchase_units?.length !== 1 || unit?.custom_id !== value.id
    || unit?.reference_id !== value.id || unit?.amount?.currency_code !== "EUR"
    || unit?.amount?.value !== (value.amountCents / 100).toFixed(2)) throw new SupportError("CONFLICT");
  if (unit.payments?.captures?.length) {
    const capture = paypalCaptureResponseEvidence(body);
    if (!capture.evidenceConsistent || !capture.captureId || capture.paymentId !== value.id || capture.amountCents !== value.amountCents) throw new SupportError("CONFLICT");
    return { evidence: { contributionId: value.id, provider: "PAYPAL", providerReference: value.providerReference,
      paymentReference: capture.captureId, amountCents: value.amountCents, currency: "EUR", status: capture.status === "COMPLETED" ? "SUCCEEDED" : "PENDING" } };
  }
  const url = body.links?.find(l => l.rel === "approve" || l.rel === "payer-action")?.href;
  return operation === "CHECKOUT" && url ? { checkout: { id: value.providerReference, url: validateSupportCheckoutUrl(url, "PAYPAL") } } : null;
}

export function stripeSupportEvidence(event: Stripe.Event): SupportEvidence | null {
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"].includes(event.type)) return null;
  const session = event.data.object as Stripe.Checkout.Session;
  if (event.livemode || session.livemode || session.metadata?.purpose !== "SUPPORT_LNX_BEATS") return null;
  const contributionId = session.metadata.contributionId;
  const paymentReference = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!contributionId || session.client_reference_id !== contributionId || !Number.isSafeInteger(session.amount_total)
    || session.currency !== "eur") throw new SupportError("INVALID");
  const paid = session.payment_status === "paid";
  if (paid && !paymentReference) throw new SupportError("INVALID");
  return { contributionId, provider: "STRIPE", providerReference: session.id, paymentReference: paymentReference ?? "",
    amountCents: session.amount_total!, currency: "EUR", status: paid ? "SUCCEEDED"
      : ["checkout.session.async_payment_failed", "checkout.session.expired"].includes(event.type) ? "FAILED" : "PENDING" };
}
