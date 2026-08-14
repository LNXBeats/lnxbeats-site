import "server-only";

import Stripe from "stripe";

import {
  assertPaymentServerEnvironment,
  STRIPE_API_VERSION,
} from "@/lib/payments/config";
import type { ServerCheckoutLineItem } from "@/lib/payments/types";

export type HostedCheckoutRequest = Readonly<{
  orderId: string;
  paymentId: string;
  pricingVersion: string;
  lineItems: readonly ServerCheckoutLineItem[];
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}>;

export type HostedCheckoutSession = Readonly<{
  id: string;
  url: string;
  expiresAt: number;
  paymentIntentId?: string;
}>;

export interface StripeCheckoutGateway {
  createHostedCheckout(
    request: HostedCheckoutRequest,
    idempotencyKey: string,
  ): Promise<HostedCheckoutSession>;
  retrieveHostedCheckout(checkoutId: string): Promise<HostedCheckoutSession>;
}

export class StripeCheckoutClientError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "INVALID_RESPONSE") {
    super("Stripe Checkout is unavailable.");
    this.name = "StripeCheckoutClientError";
  }
}

export function hostedCheckoutParameters(
  request: HostedCheckoutRequest,
): Stripe.Checkout.SessionCreateParams {
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
    client_reference_id: request.orderId,
    metadata: {
      paymentId: request.paymentId,
      orderId: request.orderId,
      pricingVersion: request.pricingVersion,
    },
    payment_intent_data: {
      metadata: {
        paymentId: request.paymentId,
        orderId: request.orderId,
        pricingVersion: request.pricingVersion,
      },
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

function hostedCheckoutSession(session: Stripe.Checkout.Session): HostedCheckoutSession {
  if (
    !session.id
    || !session.url
    || session.status !== "open"
    || !Number.isSafeInteger(session.expires_at)
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

      return hostedCheckoutSession(session);
    },
    async retrieveHostedCheckout(checkoutId) {
      try {
        return hostedCheckoutSession(await stripe.checkout.sessions.retrieve(checkoutId));
      } catch (error) {
        if (error instanceof StripeCheckoutClientError) throw error;
        throw new StripeCheckoutClientError("UNAVAILABLE");
      }
    },
  };
}
