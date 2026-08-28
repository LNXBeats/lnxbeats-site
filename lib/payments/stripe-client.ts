import "server-only";

import Stripe from "stripe";

import {
  assertPaymentServerEnvironment,
  parsePaymentsConfiguration,
  STRIPE_API_VERSION,
} from "@/lib/payments/config";
import type { ServerCheckoutLineItem } from "@/lib/payments/types";

type HostedCheckoutSource =
  | Readonly<{
    paymentSource?: "MUSIC_ORDER";
    orderId: string;
    shopOrderId?: never;
    orderNumber?: never;
  }>
  | Readonly<{
    paymentSource: "SHOP_ORDER";
    shopOrderId: string;
    orderNumber: string;
    orderId?: never;
  }>;

export type HostedCheckoutRequest = Readonly<{
  paymentId: string;
  pricingVersion: string;
  lineItems: readonly ServerCheckoutLineItem[];
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}> & HostedCheckoutSource;

export type HostedCheckoutSession = Readonly<{
  id: string;
  url: string;
  expiresAt?: number;
  paymentIntentId?: string;
}>;

export interface StripeCheckoutGateway {
  createHostedCheckout(
    request: HostedCheckoutRequest,
    idempotencyKey: string,
  ): Promise<HostedCheckoutSession>;
  retrieveHostedCheckout(checkoutId: string): Promise<HostedCheckoutSession>;
}

export interface StripeCheckoutLifecycleGateway {
  expireHostedCheckout(checkoutId: string, idempotencyKey: string): Promise<{ id: string; status: "expired" }>;
}

export type StripeRefundEvidence = Readonly<{
  providerRefundId: string;
  paymentIntentId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  amountCents: number;
  currency: "EUR";
  occurredAt: Date;
}>;

export interface StripeRefundGateway {
  refundPaymentIntent(
    paymentIntentId: string,
    amountCents: number,
    idempotencyKey: string,
    metadata: Readonly<{ paymentId: string; refundAttemptId: string }>,
  ): Promise<StripeRefundEvidence>;
  retrieveRefund(providerRefundId: string): Promise<StripeRefundEvidence>;
}

export class StripeCheckoutClientError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "INVALID_RESPONSE") {
    super("Stripe Checkout is unavailable.");
    this.name = "StripeCheckoutClientError";
  }
}

export class StripeRefundClientError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "INVALID_RESPONSE" | "INVALID_REQUEST" | "AUTHENTICATION" | "CONFLICT" | "RATE_LIMITED") {
    super("Stripe Refund is unavailable.");
    this.name = "StripeRefundClientError";
  }
}

function stripeRefundEvidence(refund: Stripe.Refund): StripeRefundEvidence {
  const paymentIntentId = typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : refund.payment_intent?.id;
  const status = refund.status;
  if (
    !refund.id
    || !paymentIntentId
    || !Number.isSafeInteger(refund.amount)
    || refund.amount <= 0
    || refund.currency !== "eur"
    || !status
  ) throw new StripeRefundClientError("INVALID_RESPONSE");
  const normalizedStatus = status === "succeeded"
    ? "SUCCEEDED"
    : status === "pending" || status === "requires_action"
      ? "PENDING"
      : status === "failed" || status === "canceled"
        ? "FAILED"
        : null;
  if (!normalizedStatus) throw new StripeRefundClientError("INVALID_RESPONSE");
  return {
    providerRefundId: refund.id,
    paymentIntentId,
    status: normalizedStatus,
    amountCents: refund.amount,
    currency: "EUR",
    occurredAt: new Date(refund.created * 1_000),
  };
}

function stripeRefundFailure(error: unknown) {
  const candidate = error && typeof error === "object" ? error as { statusCode?: unknown; code?: unknown } : {};
  const status = typeof candidate.statusCode === "number" ? candidate.statusCode : null;
  const code = status === 400 || status === 402 || status === 422
    ? "INVALID_REQUEST"
    : status === 401 || status === 403
      ? "AUTHENTICATION"
      : status === 409
        ? "CONFLICT"
        : status === 429
          ? "RATE_LIMITED"
          : "UNAVAILABLE";
  return new StripeRefundClientError(code);
}

export function hostedCheckoutParameters(
  request: HostedCheckoutRequest,
): Stripe.Checkout.SessionCreateParams {
  const shopCheckout = request.paymentSource === "SHOP_ORDER";
  const sourceId = shopCheckout ? request.shopOrderId : request.orderId;
  const metadata: Stripe.MetadataParam = shopCheckout
    ? {
      paymentSource: "SHOP_ORDER",
      paymentId: request.paymentId,
      shopOrderId: request.shopOrderId,
      orderNumber: request.orderNumber,
      pricingVersion: request.pricingVersion,
    }
    : {
      paymentId: request.paymentId,
      orderId: request.orderId,
      pricingVersion: request.pricingVersion,
    };
  return {
    mode: "payment",
    adaptive_pricing: { enabled: false },
    allow_promotion_codes: false,
    automatic_tax: { enabled: false },
    billing_address_collection: "auto",
    invoice_creation: { enabled: false },
    line_items: request.lineItems.map((lineItem) => ({
      quantity: 1,
      price_data: {
        currency: lineItem.price_data.currency,
        unit_amount: lineItem.price_data.unit_amount,
        product_data: { name: lineItem.price_data.product_data.name },
      },
    })),
    client_reference_id: sourceId,
    metadata,
    payment_intent_data: {
      metadata,
    },
    customer_email: request.customerEmail,
    locale: "fr",
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
  };
}

function paymentIntentId(
  paymentIntent: string | Stripe.PaymentIntent | null,
) {
  if (typeof paymentIntent === "string") return paymentIntent;
  return paymentIntent?.id;
}

function hostedCheckoutSession(
  session: Stripe.Checkout.Session,
  expectedLivemode: boolean,
): HostedCheckoutSession {
  if (
    !session.id
    || !session.url
    || session.status !== "open"
    || !Number.isSafeInteger(session.expires_at)
    || session.livemode !== expectedLivemode
    || session.expires_at <= 0
    || session.expires_at * 1_000 <= Date.now()
  ) {
    throw new StripeCheckoutClientError("INVALID_RESPONSE");
  }
  try {
    if (new URL(session.url).protocol !== "https:") {
      throw new Error("Checkout URL must use HTTPS.");
    }
  } catch {
    throw new StripeCheckoutClientError("INVALID_RESPONSE");
  }
  const intentId = paymentIntentId(session.payment_intent);
  return {
    id: session.id,
    url: session.url,
    expiresAt: session.expires_at,
    ...(intentId ? { paymentIntentId: intentId } : {}),
  };
}

export function createStripeCheckoutGateway(): StripeCheckoutGateway {
  let configuration;
  try {
    configuration = assertPaymentServerEnvironment();
  } catch {
    throw new StripeCheckoutClientError("UNAVAILABLE");
  }

  const stripe = new Stripe(configuration.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
    telemetry: false,
  });
  const expectedLivemode = configuration.mode === "live";

  return {
    async createHostedCheckout(request, idempotencyKey) {
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create(
          hostedCheckoutParameters(request),
          { idempotencyKey },
        );
      } catch {
        throw new StripeCheckoutClientError("UNAVAILABLE");
      }

      return hostedCheckoutSession(session, expectedLivemode);
    },
    async retrieveHostedCheckout(checkoutId) {
      try {
        return hostedCheckoutSession(await stripe.checkout.sessions.retrieve(checkoutId), expectedLivemode);
      } catch (error) {
        if (error instanceof StripeCheckoutClientError) throw error;
        throw new StripeCheckoutClientError("UNAVAILABLE");
      }
    },
  };
}

export function createStripeCheckoutLifecycleGateway(): StripeCheckoutLifecycleGateway {
  let configuration;
  try {
    configuration = assertPaymentServerEnvironment();
  } catch {
    throw new StripeCheckoutClientError("UNAVAILABLE");
  }
  const stripe = new Stripe(configuration.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
    telemetry: false,
  });
  const expectedLivemode = configuration.mode === "live";
  return {
    async expireHostedCheckout(checkoutId, idempotencyKey) {
      try {
        const session = await stripe.checkout.sessions.expire(checkoutId, {}, { idempotencyKey });
        if (session.id !== checkoutId || session.livemode !== expectedLivemode || session.status !== "expired") {
          throw new StripeCheckoutClientError("INVALID_RESPONSE");
        }
        return { id: session.id, status: "expired" };
      } catch (error) {
        if (error instanceof StripeCheckoutClientError) throw error;
        throw new StripeCheckoutClientError("UNAVAILABLE");
      }
    },
  };
}

export function createStripeRefundGateway(): StripeRefundGateway {
  let configuration;
  let liveRefundsEnabled = false;
  try {
    configuration = assertPaymentServerEnvironment();
    liveRefundsEnabled = parsePaymentsConfiguration().liveRefundsEnabled;
  } catch {
    throw new StripeRefundClientError("UNAVAILABLE");
  }
  const stripe = new Stripe(configuration.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
    telemetry: false,
  });
  return {
    async refundPaymentIntent(paymentIntentId, amountCents, idempotencyKey, metadata) {
      if (configuration.mode === "live" && !liveRefundsEnabled) {
        throw new StripeRefundClientError("UNAVAILABLE");
      }
      try {
        return stripeRefundEvidence(await stripe.refunds.create({
          payment_intent: paymentIntentId,
          amount: amountCents,
          metadata: {
            paymentId: metadata.paymentId,
            refundAttemptId: metadata.refundAttemptId,
          },
        }, { idempotencyKey }));
      } catch (error) {
        if (error instanceof StripeRefundClientError) throw error;
        throw stripeRefundFailure(error);
      }
    },
    async retrieveRefund(providerRefundId) {
      try {
        return stripeRefundEvidence(await stripe.refunds.retrieve(providerRefundId));
      } catch (error) {
        if (error instanceof StripeRefundClientError) throw error;
        throw stripeRefundFailure(error);
      }
    },
  };
}
