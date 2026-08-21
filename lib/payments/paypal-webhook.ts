import "server-only";

import { paypalCentsFromAmount } from "@/lib/payments/paypal-client";
import {
  paymentDatabasePaypalCaptureRepository,
  type PaypalCaptureRepository,
  type PaypalReconciliationEvent,
} from "@/lib/payments/paypal-service";

export const PAYPAL_WEBHOOK_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DECLINED",
] as const;

type PaypalWebhookEventType = (typeof PAYPAL_WEBHOOK_EVENTS)[number];

export type VerifiedPaypalWebhookEvent = Readonly<{
  id: string;
  event_type: string;
  create_time: string;
  resource: unknown;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function boundedString(value: unknown, max = 255) {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

function occurredAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSupported(type: string): type is PaypalWebhookEventType {
  return PAYPAL_WEBHOOK_EVENTS.includes(type as PaypalWebhookEventType);
}

function normalizedOrderApproved(
  event: VerifiedPaypalWebhookEvent,
): PaypalReconciliationEvent | null {
  const resource = record(event.resource);
  const purchaseUnit = record(array(resource?.purchase_units)[0]);
  const amount = record(purchaseUnit?.amount);
  const paymentId = boundedString(purchaseUnit?.custom_id);
  const providerOrderId = boundedString(resource?.id);
  const date = occurredAt(event.create_time);
  if (
    !providerOrderId
    || !paymentId
    || !date
    || resource?.status !== "APPROVED"
    || amount?.currency_code !== "EUR"
  ) return null;
  let amountCents: number;
  try {
    amountCents = paypalCentsFromAmount(amount.value);
  } catch {
    return null;
  }
  return {
    eventId: event.id,
    type: "CHECKOUT.ORDER.APPROVED",
    occurredAt: date,
    paymentId,
    providerOrderId,
    amountCents,
    currency: "EUR",
    status: "APPROVED",
  };
}

function normalizedCapture(
  event: VerifiedPaypalWebhookEvent,
): PaypalReconciliationEvent | null {
  const resource = record(event.resource);
  const amount = record(resource?.amount);
  const supplementary = record(resource?.supplementary_data);
  const relatedIds = record(supplementary?.related_ids);
  const paymentId = boundedString(resource?.custom_id);
  const providerOrderId = boundedString(relatedIds?.order_id);
  const captureId = boundedString(resource?.id);
  const date = occurredAt(event.create_time);
  if (
    !providerOrderId
    || !captureId
    || !date
    || amount?.currency_code !== "EUR"
  ) return null;
  let amountCents: number;
  try {
    amountCents = paypalCentsFromAmount(amount.value);
  } catch {
    return null;
  }
  const status = event.event_type === "PAYMENT.CAPTURE.COMPLETED"
    ? "COMPLETED"
    : event.event_type === "PAYMENT.CAPTURE.PENDING"
      ? "PENDING"
      : "DECLINED";
  if (resource?.status !== status) return null;
  return {
    eventId: event.id,
    type: event.event_type as Exclude<PaypalReconciliationEvent["type"], "PAYPAL.CAPTURE.RESPONSE" | "CHECKOUT.ORDER.APPROVED">,
    occurredAt: date,
    ...(paymentId ? { paymentId } : {}),
    providerOrderId,
    captureId,
    amountCents,
    currency: "EUR",
    status,
  };
}

export function normalizePaypalWebhookEvent(
  event: VerifiedPaypalWebhookEvent,
): PaypalReconciliationEvent | null {
  if (!isSupported(event.event_type)) return null;
  return event.event_type === "CHECKOUT.ORDER.APPROVED"
    ? normalizedOrderApproved(event)
    : normalizedCapture(event);
}

export async function processVerifiedPaypalWebhookEvent(
  event: VerifiedPaypalWebhookEvent,
  repository: PaypalCaptureRepository = paymentDatabasePaypalCaptureRepository,
) {
  if (!isSupported(event.event_type)) {
    return repository.recordUnmatched(
      event.id,
      event.event_type,
      boundedString(record(event.resource)?.id) ?? undefined,
      "IGNORED",
    );
  }
  const normalized = normalizePaypalWebhookEvent(event);
  if (!normalized) {
    return repository.recordUnmatched(
      event.id,
      event.event_type,
      boundedString(record(event.resource)?.id) ?? undefined,
      "REQUIRES_REVIEW",
    );
  }
  return repository.reconcile(normalized);
}
