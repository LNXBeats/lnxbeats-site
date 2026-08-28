import "server-only";

import {
  assertPaypalReconciliationServerEnvironment,
  assertPaypalServerEnvironment,
  parsePaymentsConfiguration,
} from "@/lib/payments/config";
import type { PaypalPaymentConfiguration } from "@/lib/payments/types";

const PAYPAL_API_ORIGINS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;
const PAYPAL_RESPONSE_MAX_BYTES = 1024 * 1024;

type EnabledPaypalConfiguration = Extract<PaypalPaymentConfiguration, { enabled: true }>;
type Fetch = typeof fetch;

type PaypalCreateOrderSource =
  | Readonly<{
    paymentSource?: "MUSIC_ORDER";
    orderId: string;
    shopOrderId?: never;
  }>
  | Readonly<{
    paymentSource: "SHOP_ORDER";
    shopOrderId: string;
    orderId?: never;
  }>;

export type PaypalCreateOrderRequest = Readonly<{
  orderNumber: string;
  paymentId: string;
  amountCents: number;
  currency: "EUR";
  description: string;
  returnUrl: string;
  cancelUrl: string;
}> & PaypalCreateOrderSource;

export type PaypalOrderSession = Readonly<{
  id: string;
  status: "CREATED" | "PAYER_ACTION_REQUIRED" | "APPROVED";
  approvalUrl?: string;
}>;

export type PaypalCaptureEvidence = Readonly<{
  providerOrderId: string;
  captureId: string;
  status: "COMPLETED" | "PENDING";
  paymentId: string;
  amountCents: number;
  currency: "EUR";
  occurredAt: Date;
}>;

/**
 * Evidence returned by the one and only PayPal capture request.
 *
 * A financially successful provider response must not disappear merely because
 * its amount/currency/custom id is inconsistent with our immutable snapshot.
 * The Shop flow persists that response for manual review; the historical music
 * flow keeps applying the stricter `PaypalCaptureEvidence` contract below.
 */
export type PaypalCaptureResponseEvidence = Readonly<{
  providerOrderId: string;
  captureId?: string;
  status: "COMPLETED" | "PENDING";
  paymentId?: string;
  amountCents?: number;
  currency?: string;
  occurredAt: Date;
  evidenceConsistent?: boolean;
}>;

export type PaypalRefundEvidence = Readonly<{
  providerRefundId: string;
  captureId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  amountCents: number;
  currency: "EUR";
  occurredAt: Date;
}>;

export type PaypalWebhookHeaders = Readonly<{
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSignature: string;
}>;

export interface PaypalGateway {
  createOrder(request: PaypalCreateOrderRequest, idempotencyKey: string): Promise<PaypalOrderSession>;
  retrieveOrder(providerOrderId: string): Promise<PaypalOrderSession>;
  captureOrder(providerOrderId: string, idempotencyKey: string): Promise<PaypalCaptureResponseEvidence>;
  verifyWebhook(headers: PaypalWebhookHeaders, webhookEventBody: string): Promise<boolean>;
}

export interface PaypalRefundGateway {
  refundCapture(captureId: string, amountCents: number, idempotencyKey: string): Promise<PaypalRefundEvidence>;
  retrieveRefund(providerRefundId: string): Promise<PaypalRefundEvidence>;
}

export class PaypalClientError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "INVALID_RESPONSE" | "NOT_APPROVED" | "INVALID_REQUEST" | "AUTHENTICATION" | "CONFLICT" | "RATE_LIMITED") {
    super("PayPal is unavailable.");
    this.name = "PaypalClientError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value: unknown, max = 255) {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

export function paypalAmountFromCents(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new PaypalClientError("INVALID_RESPONSE");
  }
  return `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, "0")}`;
}

export function paypalCentsFromAmount(value: unknown) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,8})\.[0-9]{2}$/.test(value)) {
    throw new PaypalClientError("INVALID_RESPONSE");
  }
  const [euros, cents] = value.split(".");
  const amount = Number(euros) * 100 + Number(cents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new PaypalClientError("INVALID_RESPONSE");
  }
  return amount;
}

export function paypalCreateOrderBody(request: PaypalCreateOrderRequest) {
  const sourceId = request.paymentSource === "SHOP_ORDER"
    ? request.shopOrderId
    : request.orderId;
  return {
    intent: "CAPTURE",
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
          brand_name: "LNX Beats",
          locale: "fr-FR",
          landing_page: "LOGIN",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: request.returnUrl,
          cancel_url: request.cancelUrl,
        },
      },
    },
    purchase_units: [{
      reference_id: sourceId,
      custom_id: request.paymentId,
      invoice_id: `${request.orderNumber}:${request.paymentId}`,
      description: request.description,
      amount: {
        currency_code: request.currency,
        value: paypalAmountFromCents(request.amountCents),
      },
    }],
  } as const;
}

function paypalApprovalUrl(value: unknown, environment: "sandbox" | "live") {
  const raw = nonEmptyString(value, 2_048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:"
      || url.hostname !== (environment === "live" ? "www.paypal.com" : "www.sandbox.paypal.com")
      || url.username
      || url.password
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function paypalOrderSession(
  value: unknown,
  environment: "sandbox" | "live" = "sandbox",
): PaypalOrderSession {
  const body = record(value);
  const id = nonEmptyString(body?.id);
  const status = body?.status;
  if (
    !id
    || (status !== "CREATED" && status !== "PAYER_ACTION_REQUIRED" && status !== "APPROVED")
  ) throw new PaypalClientError("INVALID_RESPONSE");
  const approval = array(body?.links)
    .map(record)
    .find((link) => link?.rel === "payer-action" || link?.rel === "approve");
  const approvalUrl = paypalApprovalUrl(approval?.href, environment);
  if (status !== "APPROVED" && !approvalUrl) {
    throw new PaypalClientError("INVALID_RESPONSE");
  }
  return { id, status, ...(approvalUrl ? { approvalUrl } : {}) };
}

export function paypalCaptureResponseEvidence(value: unknown): PaypalCaptureResponseEvidence {
  const body = record(value);
  const providerOrderId = nonEmptyString(body?.id);
  const orderStatus = body?.status;
  const purchaseUnit = record(array(body?.purchase_units)[0]);
  const paymentId = nonEmptyString(purchaseUnit?.custom_id);
  const payments = record(purchaseUnit?.payments);
  const capture = record(array(payments?.captures)[0]);
  const captureId = nonEmptyString(capture?.id);
  const captureStatus = capture?.status;
  const amount = record(capture?.amount);
  const currency = nonEmptyString(amount?.currency_code, 3)?.toUpperCase();
  const updateTime = nonEmptyString(capture?.update_time, 80);
  const ambiguousCompletedOrder = !captureId && orderStatus === "COMPLETED";
  if (
    !providerOrderId
    || (!ambiguousCompletedOrder && !captureId)
    || (!ambiguousCompletedOrder && captureStatus !== "COMPLETED" && captureStatus !== "PENDING")
  ) throw new PaypalClientError("INVALID_RESPONSE");
  const parsedOccurredAt = updateTime ? new Date(updateTime) : null;
  const occurredAt = parsedOccurredAt && !Number.isNaN(parsedOccurredAt.getTime())
    ? parsedOccurredAt
    : new Date();
  let amountCents: number | undefined;
  try {
    amountCents = paypalCentsFromAmount(amount?.value);
  } catch {
    amountCents = undefined;
  }
  const evidenceConsistent = (
    (orderStatus === "COMPLETED" || orderStatus === "APPROVED")
    && captureId !== null
    && paymentId !== null
    && amountCents !== undefined
    && currency === "EUR"
    && capture?.final_capture === true
    && parsedOccurredAt !== null
    && !Number.isNaN(parsedOccurredAt.getTime())
  );
  return {
    providerOrderId,
    ...(captureId ? { captureId } : {}),
    status: ambiguousCompletedOrder ? "COMPLETED" : captureStatus as "COMPLETED" | "PENDING",
    ...(paymentId ? { paymentId } : {}),
    ...(amountCents !== undefined ? { amountCents } : {}),
    ...(currency ? { currency } : {}),
    occurredAt,
    evidenceConsistent,
  };
}

export function paypalCaptureEvidence(value: unknown): PaypalCaptureEvidence {
  const evidence = paypalCaptureResponseEvidence(value);
  if (
    evidence.evidenceConsistent !== true
    || !evidence.captureId
    || !evidence.paymentId
    || evidence.amountCents === undefined
    || evidence.currency !== "EUR"
  ) throw new PaypalClientError("INVALID_RESPONSE");
  return {
    providerOrderId: evidence.providerOrderId,
    captureId: evidence.captureId,
    status: evidence.status,
    paymentId: evidence.paymentId,
    amountCents: evidence.amountCents,
    currency: "EUR",
    occurredAt: evidence.occurredAt,
  };
}

function paypalCaptureIdFromLinks(value: unknown, environment: "sandbox" | "live") {
  const link = array(value)
    .map(record)
    .find((candidate) => candidate?.rel === "up" && candidate?.method === "GET");
  const href = nonEmptyString(link?.href, 2_048);
  if (!href) return null;
  try {
    const url = new URL(href);
    if (
      url.protocol !== "https:"
      || !(environment === "live"
        ? ["api-m.paypal.com", "api.paypal.com"]
        : ["api-m.sandbox.paypal.com", "api.sandbox.paypal.com"]).includes(url.hostname)
      || url.username
      || url.password
    ) return null;
    const match = url.pathname.match(/^\/v2\/payments\/captures\/([^/]+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function paypalRefundEvidence(
  value: unknown,
  environment: "sandbox" | "live" = "sandbox",
): PaypalRefundEvidence {
  const body = record(value);
  const providerRefundId = nonEmptyString(body?.id);
  const amount = record(body?.amount);
  const status = body?.status;
  const captureId = paypalCaptureIdFromLinks(body?.links, environment);
  const updateTime = nonEmptyString(body?.update_time, 80) ?? nonEmptyString(body?.create_time, 80);
  if (
    !providerRefundId
    || !captureId
    || !updateTime
    || amount?.currency_code !== "EUR"
    || !["PENDING", "COMPLETED", "FAILED", "CANCELLED"].includes(String(status))
  ) throw new PaypalClientError("INVALID_RESPONSE");
  const occurredAt = new Date(updateTime);
  if (Number.isNaN(occurredAt.getTime())) throw new PaypalClientError("INVALID_RESPONSE");
  return {
    providerRefundId,
    captureId,
    status: status === "COMPLETED" ? "SUCCEEDED" : status === "PENDING" ? "PENDING" : "FAILED",
    amountCents: paypalCentsFromAmount(amount.value),
    currency: "EUR",
    occurredAt,
  };
}

async function boundedJson(response: Response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > PAYPAL_RESPONSE_MAX_BYTES) {
    throw new PaypalClientError("INVALID_RESPONSE");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > PAYPAL_RESPONSE_MAX_BYTES) {
    throw new PaypalClientError("INVALID_RESPONSE");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PaypalClientError("INVALID_RESPONSE");
  }
}

function createPaypalGatewayWithConfiguration(
  configuration: EnabledPaypalConfiguration,
  fetchImplementation: Fetch,
  liveRefundsEnabled = false,
): PaypalGateway & PaypalRefundGateway {
  const apiOrigin = PAYPAL_API_ORIGINS[configuration.environment];
  async function accessToken() {
    let response: Response;
    try {
      response = await fetchImplementation(`${apiOrigin}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Basic ${Buffer.from(`${configuration.clientId}:${configuration.clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaypalClientError("UNAVAILABLE");
    }
    if (!response.ok) throw new PaypalClientError("UNAVAILABLE");
    const body = record(await boundedJson(response));
    const token = nonEmptyString(body?.access_token, 4_096);
    if (!token || body?.token_type !== "Bearer") throw new PaypalClientError("INVALID_RESPONSE");
    return token;
  }

  async function api(path: string, init: RequestInit, idempotencyKey?: string) {
    const token = await accessToken();
    let response: Response;
    try {
      response = await fetchImplementation(`${apiOrigin}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(idempotencyKey ? { "PayPal-Request-Id": idempotencyKey } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaypalClientError("UNAVAILABLE");
    }
    if (!response.ok) {
      const code = response.status === 400
        ? "INVALID_REQUEST"
        : response.status === 401 || response.status === 403
          ? "AUTHENTICATION"
          : response.status === 409
            ? "CONFLICT"
            : response.status === 422
              ? "NOT_APPROVED"
              : response.status === 429
                ? "RATE_LIMITED"
                : "UNAVAILABLE";
      throw new PaypalClientError(code);
    }
    return boundedJson(response);
  }

  return {
    async createOrder(request, idempotencyKey) {
      return paypalOrderSession(await api("/v2/checkout/orders", {
        method: "POST",
        body: JSON.stringify(paypalCreateOrderBody(request)),
      }, idempotencyKey), configuration.environment);
    },
    async retrieveOrder(providerOrderId) {
      return paypalOrderSession(await api(
        `/v2/checkout/orders/${encodeURIComponent(providerOrderId)}`,
        { method: "GET" },
      ), configuration.environment);
    },
    async captureOrder(providerOrderId, idempotencyKey) {
      return paypalCaptureResponseEvidence(await api(
        `/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`,
        {
          method: "POST",
          // PayPal defaults to return=minimal. The Shop reconciliation needs
          // the capture id, immutable custom_id, amount, currency and final
          // capture marker in the same authenticated response.
          headers: { prefer: "return=representation" },
          body: "{}",
        },
        idempotencyKey,
      ));
    },
    async refundCapture(captureId, amountCents, idempotencyKey) {
      if (configuration.environment === "live" && !liveRefundsEnabled) {
        throw new PaypalClientError("UNAVAILABLE");
      }
      return paypalRefundEvidence(await api(
        `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
        {
          method: "POST",
          headers: { prefer: "return=representation" },
          body: JSON.stringify({
            amount: { currency_code: "EUR", value: paypalAmountFromCents(amountCents) },
          }),
        },
        idempotencyKey,
      ), configuration.environment);
    },
    async retrieveRefund(providerRefundId) {
      return paypalRefundEvidence(await api(
        `/v2/payments/refunds/${encodeURIComponent(providerRefundId)}`,
        { method: "GET" },
      ), configuration.environment);
    },
    async verifyWebhook(headers, webhookEventBody) {
      const result = record(await api("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        // Preserve the exact signed event bytes inside the official postback
        // envelope. PayPal warns that parsing then re-serializing the event can
        // invalidate signature verification.
        body: `{${[
          `"transmission_id":${JSON.stringify(headers.transmissionId)}`,
          `"transmission_time":${JSON.stringify(headers.transmissionTime)}`,
          `"cert_url":${JSON.stringify(headers.certUrl)}`,
          `"auth_algo":${JSON.stringify(headers.authAlgo)}`,
          `"transmission_sig":${JSON.stringify(headers.transmissionSignature)}`,
          `"webhook_id":${JSON.stringify(configuration.webhookId)}`,
          `"webhook_event":${webhookEventBody}`,
        ].join(",")}}`,
      }));
      return result?.verification_status === "SUCCESS";
    },
  };
}

export function createPaypalGateway(
  fetchImplementation: Fetch = fetch,
): PaypalGateway & PaypalRefundGateway {
  let configuration: EnabledPaypalConfiguration;
  let liveRefundsEnabled = false;
  try {
    configuration = assertPaypalServerEnvironment();
    liveRefundsEnabled = parsePaymentsConfiguration().liveRefundsEnabled;
  } catch {
    throw new PaypalClientError("UNAVAILABLE");
  }
  return createPaypalGatewayWithConfiguration(configuration, fetchImplementation, liveRefundsEnabled);
}

/** Provider verification/reconciliation remains available for historical
 * attempts even when checkout feature flags are closed. */
export function createPaypalReconciliationGateway(
  fetchImplementation: Fetch = fetch,
): PaypalGateway {
  try {
    const configuration = assertPaypalReconciliationServerEnvironment().paypal;
    return createPaypalGatewayWithConfiguration(configuration, fetchImplementation);
  } catch {
    throw new PaypalClientError("UNAVAILABLE");
  }
}

export function createTestPaypalGateway(
  configuration: EnabledPaypalConfiguration,
  fetchImplementation: Fetch,
) {
  return createPaypalGatewayWithConfiguration(configuration, fetchImplementation);
}
