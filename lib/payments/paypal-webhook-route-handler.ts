import "server-only";

import { createPaypalReconciliationGateway, type PaypalGateway, type PaypalWebhookHeaders } from "@/lib/payments/paypal-client";
import {
  processVerifiedPaypalWebhookEvent,
  type VerifiedPaypalWebhookEvent,
} from "@/lib/payments/paypal-webhook";
import { logPaymentEvent } from "@/lib/payments/observability";
import { assertPaypalWebhookRuntimeEnvironment } from "@/lib/payments/runtime";
import { isPaypalFinancialEvent, processVerifiedPaypalFinancialEvent } from "@/lib/payments/provider-financial-events";
import type { PaymentsConfiguration } from "@/lib/payments/types";
import type { PaypalReconciliationConfiguration } from "@/lib/payments/config";
import { processVerifiedPaypalWebhookEventByPaymentSource } from "@/lib/shop/payment-webhooks";

export const PAYPAL_WEBHOOK_MAX_BYTES = 256 * 1024;

export type PaypalWebhookRouteDependencies = Readonly<{
  assertRuntime(): Promise<PaymentsConfiguration | PaypalReconciliationConfiguration | void>;
  gateway(): PaypalGateway;
  processEvent(event: VerifiedPaypalWebhookEvent): ReturnType<typeof processVerifiedPaypalWebhookEvent>;
}>;

const dependencies: PaypalWebhookRouteDependencies = {
  assertRuntime: assertPaypalWebhookRuntimeEnvironment,
  gateway: createPaypalReconciliationGateway,
  processEvent: async (event) => {
    const configuration = await assertPaypalWebhookRuntimeEnvironment();
    const environment = configuration.paypal.environment;
    if (isPaypalFinancialEvent(event.event_type)) {
      return { ...(await processVerifiedPaypalFinancialEvent(event, environment)), orderConfirmed: false };
    }
    const result = await processVerifiedPaypalWebhookEventByPaymentSource(event, environment);
    return "orderConfirmed" in result
      ? result
      : {
        outcome: result.outcome,
        duplicate: result.duplicate,
        orderConfirmed: result.shopOrderPaid,
      };
  },
};

class PaypalWebhookRequestError extends Error {
  constructor(readonly status: 400 | 413 | 415) {
    super("The PayPal webhook request is invalid.");
    this.name = "PaypalWebhookRequestError";
  }
}

function json(body: object, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function rawBody(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new PaypalWebhookRequestError(415);
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length < 0) throw new PaypalWebhookRequestError(400);
    if (length > PAYPAL_WEBHOOK_MAX_BYTES) throw new PaypalWebhookRequestError(413);
  }
  if (!request.body) throw new PaypalWebhookRequestError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PAYPAL_WEBHOOK_MAX_BYTES) {
      await reader.cancel();
      throw new PaypalWebhookRequestError(413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

function requiredHeader(headers: Headers, name: string, max: number) {
  const value = headers.get(name)?.trim();
  if (!value || value.length > max) throw new PaypalWebhookRequestError(400);
  return value;
}

export function paypalWebhookHeaders(
  headers: Headers,
  environment: "sandbox" | "live" = "sandbox",
): PaypalWebhookHeaders {
  const transmissionId = requiredHeader(headers, "paypal-transmission-id", 255);
  const transmissionTime = requiredHeader(headers, "paypal-transmission-time", 80);
  const certUrl = requiredHeader(headers, "paypal-cert-url", 2_048);
  const authAlgo = requiredHeader(headers, "paypal-auth-algo", 80);
  const transmissionSignature = requiredHeader(headers, "paypal-transmission-sig", 8_192);
  let certificate: URL;
  try {
    certificate = new URL(certUrl);
  } catch {
    throw new PaypalWebhookRequestError(400);
  }
  if (
    certificate.protocol !== "https:"
    || !(environment === "live"
      ? ["api-m.paypal.com", "api.paypal.com"]
      : ["api-m.sandbox.paypal.com", "api.sandbox.paypal.com"]).includes(certificate.hostname)
    || !certificate.pathname.startsWith("/v1/notifications/certs/")
    || certificate.username
    || certificate.password
    || authAlgo !== "SHA256withRSA"
  ) throw new PaypalWebhookRequestError(400);
  const sentAt = new Date(transmissionTime);
  if (Number.isNaN(sentAt.getTime()) || sentAt.getTime() > Date.now() + 5 * 60_000) {
    throw new PaypalWebhookRequestError(400);
  }
  return { transmissionId, transmissionTime, certUrl, authAlgo, transmissionSignature };
}

function parsedEvent(body: Buffer): VerifiedPaypalWebhookEvent {
  let value: unknown;
  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    throw new PaypalWebhookRequestError(400);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PaypalWebhookRequestError(400);
  }
  const event = value as Record<string, unknown>;
  if (
    typeof event.id !== "string"
    || event.id.length === 0
    || event.id.length > 255
    || typeof event.event_type !== "string"
    || event.event_type.length === 0
    || event.event_type.length > 160
    || typeof event.create_time !== "string"
    || event.create_time.length > 80
    || !("resource" in event)
  ) throw new PaypalWebhookRequestError(400);
  return {
    id: event.id,
    event_type: event.event_type,
    create_time: event.create_time,
    resource: event.resource,
  };
}

export async function handlePaypalWebhookPost(
  request: Request,
  routeDependencies: PaypalWebhookRouteDependencies = dependencies,
) {
  let runtimeConfiguration: PaymentsConfiguration | PaypalReconciliationConfiguration | void;
  try {
    runtimeConfiguration = await routeDependencies.assertRuntime();
  } catch {
    return json({ received: false }, 503);
  }
  let headers: PaypalWebhookHeaders;
  let body: Buffer;
  let event: VerifiedPaypalWebhookEvent;
  try {
    const environment = runtimeConfiguration?.paypal.enabled
      ? runtimeConfiguration.paypal.environment
      : "sandbox";
    headers = paypalWebhookHeaders(request.headers, environment);
    body = await rawBody(request);
    event = parsedEvent(body);
  } catch (error) {
    return json({ received: false }, error instanceof PaypalWebhookRequestError ? error.status : 400);
  }
  let gateway: PaypalGateway;
  try {
    gateway = routeDependencies.gateway();
    const verified = await gateway.verifyWebhook(headers, body.toString("utf8"));
    if (!verified) return json({ received: false }, 400);
  } catch {
    return json({ received: false }, 500);
  }
  try {
    logPaymentEvent("payment.webhook.received", { providerEventId: event.id });
    const result = await routeDependencies.processEvent(event);
    logPaymentEvent("payment.webhook.processed", {
      providerEventId: event.id,
      outcome: result.outcome,
    });
    return json({
      received: true,
      outcome: result.outcome.toLowerCase(),
      duplicate: result.duplicate,
    }, 200);
  } catch {
    logPaymentEvent("payment.webhook.failed", { providerEventId: event.id });
    return json({ received: false }, 500);
  }
}
