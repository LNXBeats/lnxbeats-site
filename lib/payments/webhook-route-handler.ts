import "server-only";

import Stripe from "stripe";

import { assertPaymentServerEnvironment, STRIPE_API_VERSION } from "@/lib/payments/config";
import { normalizePaymentMethod } from "@/lib/payments/domain";
import type { PaymentConfiguration } from "@/lib/payments/types";
import { logPaymentEvent } from "@/lib/payments/observability";
import { assertPaymentsRuntimeEnvironment } from "@/lib/payments/runtime";
import { isStripeFinancialEvent, processVerifiedStripeFinancialEvent } from "@/lib/payments/provider-financial-events";
import {
  findProcessedStripeWebhookEvent,
  processVerifiedStripeWebhookEvent,
  type StripePaymentIntentEvidence,
  type StripeWebhookProcessingResult,
  type VerifiedStripeWebhookEvent,
} from "@/lib/payments/webhook";

export const STRIPE_WEBHOOK_MAX_BYTES = 256 * 1024;

type EnabledPaymentConfiguration = Extract<PaymentConfiguration, { enabled: true }>;

export type StripeWebhookRouteDependencies = Readonly<{
  assertQaRuntime(): Promise<void>;
  configuration(): PaymentConfiguration;
  constructEvent(rawBody: Buffer, signature: string, configuration: EnabledPaymentConfiguration): VerifiedStripeWebhookEvent;
  enrichEvent(event: VerifiedStripeWebhookEvent, configuration: EnabledPaymentConfiguration): Promise<VerifiedStripeWebhookEvent>;
  findDuplicateEvent?(eventId: string): Promise<StripeWebhookProcessingResult | null>;
  processEvent(event: VerifiedStripeWebhookEvent): Promise<StripeWebhookProcessingResult>;
}>;

class StripeWebhookRequestError extends Error {
  constructor(readonly status: 400 | 413 | 415) {
    super("The Stripe webhook request is invalid.");
    this.name = "StripeWebhookRequestError";
  }
}

async function readBoundedRawBody(request: Request) {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") throw new StripeWebhookRequestError(415);
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null) {
    const contentLength = Number(lengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) throw new StripeWebhookRequestError(400);
    if (contentLength > STRIPE_WEBHOOK_MAX_BYTES) throw new StripeWebhookRequestError(413);
  }
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > STRIPE_WEBHOOK_MAX_BYTES) {
      await reader.cancel();
      throw new StripeWebhookRequestError(413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

export function constructStripeWebhookEvent(
  rawBody: Buffer,
  signature: string,
  configuration: EnabledPaymentConfiguration,
): VerifiedStripeWebhookEvent {
  const stripe = new Stripe(configuration.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    telemetry: false,
  });
  const event = stripe.webhooks.constructEvent(rawBody, signature, configuration.webhookSecret);
  if (event.api_version !== STRIPE_API_VERSION) {
    throw new Error("The Stripe webhook API version is not supported.");
  }
  return { id: event.id, type: event.type, livemode: event.livemode, created: event.created, data: { object: event.data.object } };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function expandedPaymentIntent(
  value: string | Stripe.PaymentIntent | null,
): Stripe.PaymentIntent | null {
  return value && typeof value === "object" && value.object === "payment_intent"
    ? value
    : null;
}

function expandedPaymentMethod(
  value: string | Stripe.PaymentMethod | null,
): Stripe.PaymentMethod | null {
  return value && typeof value === "object" && value.object === "payment_method"
    ? value
    : null;
}

export function paymentIntentEvidenceFromCheckoutSession(
  session: Stripe.Checkout.Session,
  expectedSessionId: string,
  expectedLivemode = false,
): StripePaymentIntentEvidence {
  const intent = expandedPaymentIntent(session.payment_intent);
  const method = intent ? expandedPaymentMethod(intent.payment_method) : null;
  const paymentId = intent?.metadata.paymentId;
  const orderId = intent?.metadata.orderId;
  const pricingVersion = intent?.metadata.pricingVersion;
  if (
    session.id !== expectedSessionId
    || session.object !== "checkout.session"
    || session.mode !== "payment"
    || session.payment_status !== "paid"
    || session.livemode !== expectedLivemode
    || !intent
    || intent.livemode !== expectedLivemode
    || intent.status !== "succeeded"
    || !Number.isSafeInteger(intent.amount)
    || intent.amount <= 0
    || !intent.currency
    || !paymentId
    || !orderId
    || !pricingVersion
    || !method?.type
  ) {
    throw new Error("Stripe payment evidence is unavailable.");
  }
  return {
    id: intent.id,
    amountCents: intent.amount,
    currency: intent.currency.toUpperCase(),
    livemode: expectedLivemode,
    status: "succeeded",
    paymentId,
    orderId,
    pricingVersion,
    paymentMethod: normalizePaymentMethod(method.type),
  };
}

function successfulCheckoutSessionId(event: VerifiedStripeWebhookEvent, expectedLivemode: boolean) {
  if (event.livemode !== expectedLivemode) return null;
  const session = objectRecord(event.data.object);
  const metadata = objectRecord(session?.metadata);
  const paymentId = typeof metadata?.paymentId === "string" ? metadata.paymentId : "";
  const orderId = typeof metadata?.orderId === "string" ? metadata.orderId : "";
  const pricingVersion = typeof metadata?.pricingVersion === "string" ? metadata.pricingVersion : "";
  const internalId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !session
    || session.object !== "checkout.session"
    || typeof session.id !== "string"
    || session.id.length === 0
    || session.id.length > 255
    || session.livemode !== expectedLivemode
    || !internalId.test(paymentId)
    || !internalId.test(orderId)
    || session.client_reference_id !== orderId
    || !pricingVersion
    || pricingVersion.length > 32
  ) return null;
  const successful = event.type === "checkout.session.async_payment_succeeded"
    || (event.type === "checkout.session.completed" && session.payment_status === "paid");
  return successful ? session.id : null;
}

export async function enrichStripeWebhookEvent(
  event: VerifiedStripeWebhookEvent,
  configuration: EnabledPaymentConfiguration,
) {
  const expectedLivemode = configuration.mode === "live";
  const checkoutId = successfulCheckoutSessionId(event, expectedLivemode);
  if (!checkoutId) return event;
  const stripe = new Stripe(configuration.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
    telemetry: false,
  });
  const session = await stripe.checkout.sessions.retrieve(checkoutId, {
    expand: ["payment_intent.payment_method"],
  });
  return {
    ...event,
    paymentIntentEvidence: paymentIntentEvidenceFromCheckoutSession(session, checkoutId, expectedLivemode),
  };
}

const routeDependencies: StripeWebhookRouteDependencies = {
  assertQaRuntime: async () => {
    await assertPaymentsRuntimeEnvironment();
  },
  configuration: assertPaymentServerEnvironment,
  constructEvent: constructStripeWebhookEvent,
  enrichEvent: enrichStripeWebhookEvent,
  findDuplicateEvent: findProcessedStripeWebhookEvent,
  processEvent: (event) => isStripeFinancialEvent(event.type)
    ? processVerifiedStripeFinancialEvent(event)
    : processVerifiedStripeWebhookEvent(event),
};

function webhookJson(body: object, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function handleStripeWebhookPost(
  request: Request,
  dependencies: StripeWebhookRouteDependencies = routeDependencies,
) {
  try {
    await dependencies.assertQaRuntime();
  } catch {
    return webhookJson({ received: false }, 503);
  }
  let configuration: PaymentConfiguration;
  try {
    configuration = dependencies.configuration();
  } catch {
    return webhookJson({ received: false }, 503);
  }
  if (!configuration.enabled) return webhookJson({ received: false }, 503);

  const signature = request.headers.get("stripe-signature");
  if (!signature || signature.length > 8_192) {
    return webhookJson({ received: false }, 400);
  }

  let rawBody: Buffer;
  try {
    rawBody = await readBoundedRawBody(request);
  } catch (error) {
    return webhookJson({ received: false }, error instanceof StripeWebhookRequestError ? error.status : 400);
  }

  let event: VerifiedStripeWebhookEvent;
  try {
    event = dependencies.constructEvent(rawBody, signature, configuration);
  } catch {
    return webhookJson({ received: false }, 400);
  }
  if (event.livemode !== (configuration.mode === "live")) {
    return webhookJson({ received: false }, 400);
  }

  if (dependencies.findDuplicateEvent) {
    try {
      const duplicate = await dependencies.findDuplicateEvent(event.id);
      if (duplicate) {
        logPaymentEvent("payment.webhook.processed", {
          providerEventId: event.id,
          outcome: duplicate.outcome,
        });
        return webhookJson({
          received: true,
          outcome: duplicate.outcome.toLowerCase(),
          duplicate: true,
        }, 200);
      }
    } catch {
      logPaymentEvent("payment.webhook.failed", { providerEventId: event.id });
      return webhookJson({ received: false }, 500);
    }
  }

  try {
    event = await dependencies.enrichEvent(event, configuration);
  } catch {
    logPaymentEvent("payment.webhook.failed", { providerEventId: event.id });
    return webhookJson({ received: false }, 500);
  }

  try {
    logPaymentEvent("payment.webhook.received", { providerEventId: event.id });
    const result = await dependencies.processEvent(event);
    logPaymentEvent("payment.webhook.processed", {
      providerEventId: event.id,
      outcome: result.outcome,
    });
    return webhookJson({ received: true, outcome: result.outcome.toLowerCase(), duplicate: result.duplicate }, 200);
  } catch {
    logPaymentEvent("payment.webhook.failed", { providerEventId: event.id });
    return webhookJson({ received: false }, 500);
  }
}
