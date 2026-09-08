import "server-only";

import { prisma } from "@/lib/prisma";
import type { VerifiedPaypalWebhookEvent } from "@/lib/payments/paypal-webhook";
import type { VerifiedStripeWebhookEvent } from "@/lib/payments/webhook";
import { createRightsPaymentRepository } from "@/lib/rights/payment-repository";
import type { RightsProviderEvent } from "@/lib/rights/payment-types";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown, max = 255) { return typeof value === "string" && value.length > 0 && value.length <= max ? value : null; }

export function isRightsStripeWebhookEvent(event: VerifiedStripeWebhookEvent) {
  return record(record(event.data.object)?.metadata)?.paymentSource === "RIGHTS_REQUEST";
}

export async function processVerifiedRightsStripeWebhookEvent(event: VerifiedStripeWebhookEvent) {
  const session = record(event.data.object);
  const metadata = record(session?.metadata);
  const paymentId = string(metadata?.paymentId);
  const rightsRequestId = string(metadata?.rightsRequestId);
  const pricingVersion = string(metadata?.pricingVersion, 32);
  const checkoutId = string(session?.id);
  const currency = string(session?.currency, 3)?.toUpperCase();
  const amount = session?.amount_total;
  const occurredAt = new Date(event.created * 1000);
  const evidence = event.paymentIntentEvidence;
  if (!paymentId || !rightsRequestId || !checkoutId || !pricingVersion || !currency || !Number.isSafeInteger(amount) || Number.isNaN(occurredAt.getTime())) {
    return { outcome: "REQUIRES_REVIEW" as const, duplicate: false };
  }
  const successful = event.type === "checkout.session.async_payment_succeeded" || (event.type === "checkout.session.completed" && session?.payment_status === "paid");
  const failed = event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired";
  const pending = event.type === "checkout.session.completed" && session?.payment_status !== "paid";
  const repository = createRightsPaymentRepository(undefined, event.livemode ? "LIVE" : "TEST");
  const providerEvent: RightsProviderEvent = {
    eventId: event.id, type: event.type, provider: "STRIPE", livemode: event.livemode,
    paymentId, providerCheckoutId: checkoutId,
    ...(evidence ? { providerPaymentId: evidence.id, paymentMethod: evidence.paymentMethod } : {}),
    amountCents: amount as number, currency,
    status: successful ? "SUCCEEDED" : failed ? "FAILED" : pending ? "PENDING" : "PENDING",
    occurredAt,
    evidenceConsistent: !successful || Boolean(
      evidence && evidence.paymentSource === "RIGHTS_REQUEST"
      && evidence.rightsRequestId === rightsRequestId
      && evidence.paymentId === paymentId
      && evidence.pricingVersion === pricingVersion
      && evidence.amountCents === amount
      && evidence.currency === currency
      && evidence.livemode === event.livemode
    ),
  };
  const result = await repository.reconcile(providerEvent);
  return { outcome: result.outcome, duplicate: result.duplicate };
}

export function normalizeRightsPaypalWebhookEvidence(event: VerifiedPaypalWebhookEvent) {
  const resource = record(event.resource);
  const units = Array.isArray(resource?.purchase_units) ? resource?.purchase_units : [];
  const unit = record(units[0]);
  const related = record(record(resource?.supplementary_data)?.related_ids);
  const capture = event.event_type.startsWith("PAYMENT.CAPTURE.");
  const amount = record(capture ? resource?.amount : unit?.amount);
  return {
    resource,
    paymentId: string(unit?.custom_id) ?? string(resource?.custom_id),
    rightsRequestId: string(unit?.reference_id),
    providerOrderId: capture ? string(related?.order_id) : string(resource?.id),
    captureId: capture ? string(resource?.id) : undefined,
    amountValue: string(amount?.value),
    currency: string(amount?.currency_code, 3)?.toUpperCase(),
  };
}

function cents(value: string | null) {
  if (!value || !/^[0-9]+\.[0-9]{2}$/.test(value)) return undefined;
  const [euros, decimals] = value.split(".");
  const result = Number(euros) * 100 + Number(decimals);
  return Number.isSafeInteger(result) ? result : undefined;
}

export async function isRightsPaypalWebhookEvent(event: VerifiedPaypalWebhookEvent) {
  const ids = normalizeRightsPaypalWebhookEvidence(event);
  if (ids.rightsRequestId) {
    const request = await prisma.rightsRequest.findUnique({ where: { id: ids.rightsRequestId }, select: { id: true } });
    if (request) return true;
  }
  if (ids.paymentId) {
    const payment = await prisma.payment.findUnique({ where: { id: ids.paymentId }, select: { rightsRequestId: true } });
    if (payment?.rightsRequestId) return true;
  }
  if (ids.providerOrderId) {
    const payment = await prisma.payment.findFirst({ where: { provider: "PAYPAL", OR: [{ providerCheckoutId: ids.providerOrderId }, { providerPaymentId: ids.providerOrderId }] }, select: { rightsRequestId: true } });
    if (payment?.rightsRequestId) return true;
  }
  return false;
}

export async function processVerifiedRightsPaypalWebhookEvent(event: VerifiedPaypalWebhookEvent, environment: "sandbox" | "live") {
  const ids = normalizeRightsPaypalWebhookEvidence(event);
  let paymentId = ids.paymentId;
  if (!paymentId && ids.providerOrderId) {
    paymentId = (await prisma.payment.findFirst({ where: { provider: "PAYPAL", OR: [{ providerCheckoutId: ids.providerOrderId }, { providerPaymentId: ids.providerOrderId }] }, select: { id: true } }))?.id ?? null;
  }
  if (!paymentId || !ids.providerOrderId) return { outcome: "REQUIRES_REVIEW" as const, duplicate: false, paid: false, waitingWithdrawal: false };
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { rightsRequestId: true, providerCheckoutId: true, providerPaymentId: true },
  });
  const evidenceConsistent = Boolean(
    payment?.rightsRequestId
    && (!ids.rightsRequestId || ids.rightsRequestId === payment.rightsRequestId)
    && (!payment.providerCheckoutId || payment.providerCheckoutId === ids.providerOrderId)
    && (!payment.providerPaymentId || !ids.captureId || payment.providerPaymentId === ids.captureId),
  );
  const status = event.event_type === "PAYMENT.CAPTURE.COMPLETED"
    ? "SUCCEEDED" : event.event_type === "PAYMENT.CAPTURE.DECLINED"
      ? "FAILED" : event.event_type === "CHECKOUT.ORDER.APPROVED"
        ? "APPROVED" : "PENDING";
  return createRightsPaymentRepository(undefined, environment === "live" ? "LIVE" : "TEST").reconcile({
    eventId: event.id, type: event.event_type, provider: "PAYPAL", livemode: environment === "live",
    paymentId, providerCheckoutId: ids.providerOrderId,
    ...(ids.captureId ? { providerPaymentId: ids.captureId } : {}),
    ...(cents(ids.amountValue) !== undefined ? { amountCents: cents(ids.amountValue) } : {}),
    ...(ids.currency ? { currency: ids.currency } : {}),
    status, occurredAt: new Date(event.create_time), paymentMethod: "PAYPAL",
    evidenceConsistent,
  });
}
