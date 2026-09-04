import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

import { enqueueOrderNotification } from "@/lib/notifications/service";
import { issueCreditNoteForRefund } from "@/lib/billing/service";
import { paypalCentsFromAmount, paypalRefundEvidence } from "@/lib/payments/paypal-client";
import { paymentStatusAfterRefund, refundableAmount, type RefundProviderEvidence } from "@/lib/payments/refund";
import type { VerifiedPaypalWebhookEvent } from "@/lib/payments/paypal-webhook";
import type { StripeWebhookProcessingResult, VerifiedStripeWebhookEvent } from "@/lib/payments/webhook";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
type Provider = "STRIPE" | "PAYPAL";
type IncidentInput = Readonly<{
  provider: Provider;
  eventId: string;
  eventType: string;
  providerPaymentId: string;
  providerIncidentId: string;
  incidentType: "REVERSAL" | "DISPUTE" | "CHARGEBACK";
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED";
  amountCents?: number;
  currency?: "EUR";
  outcome?: "BUYER_FAVOUR" | "SELLER_FAVOUR" | "REVERSED" | "RESTORED" | "ACCEPTED" | "DENIED" | "OTHER";
  occurredAt: Date;
  livemode: boolean;
}>;

const activeRefundStatuses = ["PROCESSING", "PENDING", "REQUIRES_REVIEW"] as const;
const winningPaymentStatuses = ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
const paypalFinancialEvents = new Set([
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.REFUND.PENDING",
  "PAYMENT.REFUND.FAILED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
]);
const stripeRefundEvents = new Set(["refund.created", "refund.updated", "refund.failed"]);
const stripeIncidentEvents = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
]);
const SHOP_FINANCIAL_REVIEW_CODE = "SHOP_PROVIDER_FINANCIAL_EVENT_REVIEW" as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function bounded(value: unknown, max = 255) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function eventDate(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return new Date(value * 1_000);
  if (typeof value !== "string" || value.length > 80) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function withEventTransaction<T>(operation: (transaction: Transaction) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== "object" || !("code" in error) || (error.code !== "P2034" && error.code !== "P2002")) throw error;
    }
  }
  throw lastError;
}

async function lock(transaction: Transaction, key: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
}

async function duplicate(transaction: Transaction, provider: Provider, eventId: string) {
  return transaction.providerEvent.findUnique({
    where: { provider_providerEventId: { provider, providerEventId: eventId } },
    select: { outcome: true },
  });
}

function result(outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW", duplicateEvent = false): StripeWebhookProcessingResult {
  return { outcome, duplicate: duplicateEvent };
}

async function createReceipt(transaction: Transaction, input: Readonly<{
  provider: Provider;
  eventId: string;
  type: string;
  objectId?: string;
  outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW";
  paymentId?: string;
  refundAttemptId?: string;
  incidentId?: string;
  occurredAt: Date;
  livemode: boolean;
}>) {
  await transaction.providerEvent.create({
    data: {
      provider: input.provider,
      providerEventId: input.eventId,
      type: input.type.slice(0, 160),
      livemode: input.livemode,
      objectId: input.objectId?.slice(0, 255),
      outcome: input.outcome,
      processedAt: input.occurredAt,
      ...(input.paymentId ? { paymentId: input.paymentId } : {}),
      ...(input.refundAttemptId ? { refundAttemptId: input.refundAttemptId } : {}),
      ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    },
  });
  return result(input.outcome);
}

function shopFinancialLifecycleKey(paymentId: string, provider: Provider, eventId: string) {
  const digest = createHash("sha256").update(`${provider}:${eventId}`).digest("hex");
  return `shop-payment:${paymentId}:financial-review:${digest}`;
}

/**
 * Refunds, reversals and disputes are intentionally not automated for Shop
 * payments in Phase 3. A signed provider event still becomes durable evidence
 * and atomically closes fulfillment behind the same order lock used by the
 * Admin PREPARING/SHIPPED transitions.
 */
async function recordShopFinancialReview(
  transaction: Transaction,
  input: Readonly<{
    provider: Provider;
    eventId: string;
    type: string;
    objectId?: string;
    paymentId: string;
    shopOrderId: string;
    occurredAt: Date;
    livemode: boolean;
  }>,
) {
  await lock(transaction, `shop-payments:order:${input.shopOrderId}`);
  const rows = await transaction.$queryRaw<Array<{
    id: string;
    paymentReviewAt: Date | null;
    paymentReviewCode: string | null;
  }>>`
    SELECT "id", "paymentReviewAt", "paymentReviewCode"
    FROM "shop_orders"
    WHERE "id" = ${input.shopOrderId}::uuid
    FOR UPDATE
  `;
  const order = rows[0];
  if (!order) {
    return createReceipt(transaction, {
      provider: input.provider,
      eventId: input.eventId,
      type: input.type,
      objectId: input.objectId,
      outcome: "REQUIRES_REVIEW",
      paymentId: input.paymentId,
      occurredAt: input.occurredAt,
      livemode: input.livemode,
    });
  }
  // Persist the signed receipt before the review mutation. Both writes remain
  // atomic; a later failure rolls the receipt back with the transaction.
  const receipt = await createReceipt(transaction, {
    provider: input.provider,
    eventId: input.eventId,
    type: input.type,
    objectId: input.objectId,
    outcome: "REQUIRES_REVIEW",
    paymentId: input.paymentId,
    occurredAt: input.occurredAt,
    livemode: input.livemode,
  });
  await transaction.shopOrder.update({
    where: { id: input.shopOrderId },
    data: {
      paymentReviewAt: order.paymentReviewAt ?? input.occurredAt,
      paymentReviewCode: order.paymentReviewCode ?? SHOP_FINANCIAL_REVIEW_CODE,
    },
    select: { id: true },
  });
  await transaction.shopOrderLifecycleEvent.upsert({
    where: {
      idempotencyKey: shopFinancialLifecycleKey(input.paymentId, input.provider, input.eventId),
    },
    create: {
      shopOrderId: input.shopOrderId,
      paymentId: input.paymentId,
      type: "SHOP_PAYMENT_REQUIRES_REVIEW",
      idempotencyKey: shopFinancialLifecycleKey(input.paymentId, input.provider, input.eventId),
      metadata: {
        provider: input.provider,
        reviewCode: SHOP_FINANCIAL_REVIEW_CODE,
        category: "PROVIDER_FINANCIAL_EVENT",
      },
      occurredAt: input.occurredAt,
    },
    update: {},
    select: { id: true },
  });
  return receipt;
}

async function recordReview(input: Readonly<{
  provider: Provider;
  eventId: string;
  type: string;
  providerPaymentId?: string;
  objectId?: string;
  occurredAt: Date;
  livemode: boolean;
}>) {
  assertDatabaseConfigured();
  return withEventTransaction(async (transaction) => {
    await lock(transaction, `payments:webhook:event:${input.provider}:${input.eventId}`);
    const seen = await duplicate(transaction, input.provider, input.eventId);
    if (seen) return result(seen.outcome, true);
    const payment = input.providerPaymentId
      ? await transaction.payment.findUnique({
          where: {
            provider_providerPaymentId: { provider: input.provider, providerPaymentId: input.providerPaymentId },
            mode: input.livemode ? "LIVE" : "TEST",
          },
          select: { id: true, orderId: true, shopOrderId: true },
        })
      : null;
    if (payment?.shopOrderId && !payment.orderId) {
      return recordShopFinancialReview(transaction, {
        provider: input.provider,
        eventId: input.eventId,
        type: input.type,
        objectId: input.objectId,
        paymentId: payment.id,
        shopOrderId: payment.shopOrderId,
        occurredAt: input.occurredAt,
        livemode: input.livemode,
      });
    }
    return createReceipt(transaction, {
      provider: input.provider,
      eventId: input.eventId,
      type: input.type,
      objectId: input.objectId,
      outcome: "REQUIRES_REVIEW",
      paymentId: payment?.id,
      occurredAt: input.occurredAt,
      livemode: input.livemode,
    });
  });
}

async function processRefundEvent(input: RefundProviderEvidence & Readonly<{ eventId: string; eventType: string; livemode: boolean }>) {
  assertDatabaseConfigured();
  return withEventTransaction(async (transaction) => {
    await lock(transaction, `payments:webhook:event:${input.provider}:${input.eventId}`);
    const seen = await duplicate(transaction, input.provider, input.eventId);
    if (seen) return result(seen.outcome, true);
    const payment = await transaction.payment.findUnique({
      where: {
        provider_providerPaymentId: { provider: input.provider, providerPaymentId: input.providerPaymentId },
        mode: input.livemode ? "LIVE" : "TEST",
      },
      include: { order: true, invoice: { select: { id: true } } },
    });
    if (payment?.shopOrderId && !payment.orderId) {
      return recordShopFinancialReview(transaction, {
        provider: input.provider,
        eventId: input.eventId,
        type: input.eventType,
        objectId: input.providerRefundId,
        paymentId: payment.id,
        shopOrderId: payment.shopOrderId,
        occurredAt: input.occurredAt,
        livemode: input.livemode,
      });
    }
    if (
      !payment
      || payment.shopOrderId
      || !payment.orderId
      || !payment.order
      || !winningPaymentStatuses.includes(payment.status as typeof winningPaymentStatuses[number])
    ) {
      return createReceipt(transaction, {
        provider: input.provider, eventId: input.eventId, type: input.eventType,
        objectId: input.providerRefundId, outcome: "REQUIRES_REVIEW",
        paymentId: payment?.id, occurredAt: input.occurredAt, livemode: input.livemode,
      });
    }
    await lock(transaction, `payments:order:${payment.order.orderNumber}`);
    if (!payment.invoice && input.status !== "FAILED") {
      return createReceipt(transaction, {
        provider: input.provider, eventId: input.eventId, type: input.eventType,
        objectId: input.providerRefundId, outcome: "REQUIRES_REVIEW",
        paymentId: payment.id, occurredAt: input.occurredAt, livemode: input.livemode,
      });
    }
    let attempt = await transaction.refundAttempt.findUnique({
      where: { provider_providerRefundId: { provider: input.provider, providerRefundId: input.providerRefundId } },
    });
    if (!attempt) {
      const candidates = await transaction.refundAttempt.findMany({
        where: {
          paymentId: payment.id,
          provider: input.provider,
          providerRefundId: null,
          amountCents: input.amountCents,
          status: { in: [...activeRefundStatuses] },
        },
        take: 2,
      });
      if (candidates.length === 1) attempt = candidates[0]!;
    }
    if (!attempt) {
      const reserved = await transaction.refundAttempt.aggregate({
        where: { paymentId: payment.id, status: { in: [...activeRefundStatuses] } },
        _sum: { amountCents: true },
      });
      const available = refundableAmount({
        paidCents: payment.amountCents,
        confirmedRefundedCents: payment.refundedAmountCents,
        reservedRefundCents: reserved._sum.amountCents ?? 0,
      });
      if (input.amountCents > available) {
        return createReceipt(transaction, {
          provider: input.provider, eventId: input.eventId, type: input.eventType,
          objectId: input.providerRefundId, outcome: "REQUIRES_REVIEW",
          paymentId: payment.id, occurredAt: input.occurredAt, livemode: input.livemode,
        });
      }
      attempt = await transaction.refundAttempt.create({
        data: {
          paymentId: payment.id,
          provider: input.provider,
          source: "PROVIDER",
          amountCents: input.amountCents,
          currency: "EUR",
          localIdempotencyKey: `provider-event:${input.provider.toLowerCase()}:${input.eventId}`,
          providerRefundId: input.providerRefundId,
          providerIdempotencyKey: `provider-refund:${input.provider.toLowerCase()}:${input.providerRefundId}`,
          status: "PROCESSING",
          attempts: 0,
        },
      });
      await transaction.orderEvent.create({
        data: {
          orderId: payment.orderId,
          fromStatus: null,
          toStatus: payment.order.status,
          note: "Remboursement fournisseur détecté.",
          visibility: "INTERNAL",
        },
      });
    }
    if (attempt.paymentId !== payment.id || attempt.currency !== input.currency || attempt.amountCents !== input.amountCents) {
      return createReceipt(transaction, {
        provider: input.provider, eventId: input.eventId, type: input.eventType,
        objectId: input.providerRefundId, outcome: "REQUIRES_REVIEW",
        paymentId: payment.id, refundAttemptId: attempt.id, occurredAt: input.occurredAt, livemode: input.livemode,
      });
    }
    const wasSucceeded = attempt.status === "SUCCEEDED";
    if (!wasSucceeded) {
      await transaction.refundAttempt.update({
        where: { id: attempt.id },
        data: {
          providerRefundId: input.providerRefundId,
          status: input.status,
          failureCode: input.status === "FAILED" ? "PROVIDER_REFUND_FAILED" : null,
          confirmedAt: input.status === "SUCCEEDED" ? input.occurredAt : null,
        },
      });
    }
    const confirmed = await transaction.refundAttempt.aggregate({
      where: { paymentId: payment.id, status: "SUCCEEDED" },
      _sum: { amountCents: true },
    });
    const confirmedCents = confirmed._sum.amountCents ?? 0;
    const unresolved = await transaction.refundAttempt.count({
      where: { paymentId: payment.id, status: { in: [...activeRefundStatuses] } },
    });
    const nextPaymentStatus = paymentStatusAfterRefund({
      amountCents: payment.amountCents,
      confirmedRefundedCents: confirmedCents,
      hasUnresolvedRefund: unresolved > 0,
    });
    await transaction.payment.update({
      where: { id: payment.id },
      data: {
        status: nextPaymentStatus,
        refundedAmountCents: confirmedCents,
        refundedAt: confirmedCents > 0 ? input.occurredAt : null,
      },
    });
    const action = input.status === "SUCCEEDED" ? "REFUND_CONFIRMED" : input.status === "FAILED" ? "REFUND_FAILED" : "REFUND_PROVIDER_ACCEPTED";
    if (!wasSucceeded || input.status !== "SUCCEEDED") {
      await transaction.paymentAuditEvent.create({
        data: {
          paymentId: payment.id, refundAttemptId: attempt.id, provider: input.provider,
          action, amountCents: input.amountCents,
          result: input.status === "SUCCEEDED" ? "SUCCEEDED" : input.status === "FAILED" ? "FAILED" : "PENDING",
        },
      });
    }
    if (input.status === "SUCCEEDED" && !wasSucceeded) {
      await issueCreditNoteForRefund(transaction, { refundAttemptId: attempt.id });
      const total = confirmedCents === payment.amountCents;
      await transaction.orderEvent.create({
        data: {
          orderId: payment.orderId, fromStatus: null, toStatus: payment.order.status,
          note: total ? "Remboursement total confirmé." : "Remboursement partiel confirmé.",
          visibility: "INTERNAL",
        },
      });
      await enqueueOrderNotification(transaction, {
        orderId: payment.orderId,
        kind: total ? "CUSTOMER_REFUND_COMPLETED" : "CUSTOMER_PARTIAL_REFUND",
        recipient: payment.order.customerEmail,
        idempotencyKey: `payment:${payment.id}:refund:${attempt.id}:confirmed`,
        resource: {
          type: "ORDER", id: payment.orderId, reference: payment.order.orderNumber,
          refundAmountCents: attempt.amountCents,
        },
      });
    }
    return createReceipt(transaction, {
      provider: input.provider, eventId: input.eventId, type: input.eventType,
      objectId: input.providerRefundId, outcome: "PROCESSED",
      paymentId: payment.id, refundAttemptId: attempt.id, occurredAt: input.occurredAt, livemode: input.livemode,
    });
  });
}

async function processIncident(input: IncidentInput) {
  assertDatabaseConfigured();
  return withEventTransaction(async (transaction) => {
    await lock(transaction, `payments:webhook:event:${input.provider}:${input.eventId}`);
    const seen = await duplicate(transaction, input.provider, input.eventId);
    if (seen) return result(seen.outcome, true);
    const payment = await transaction.payment.findUnique({
      where: {
        provider_providerPaymentId: { provider: input.provider, providerPaymentId: input.providerPaymentId },
        mode: input.livemode ? "LIVE" : "TEST",
      },
      include: { order: true },
    });
    if (payment?.shopOrderId && !payment.orderId) {
      return recordShopFinancialReview(transaction, {
        provider: input.provider,
        eventId: input.eventId,
        type: input.eventType,
        objectId: input.providerIncidentId,
        paymentId: payment.id,
        shopOrderId: payment.shopOrderId,
        occurredAt: input.occurredAt,
        livemode: input.livemode,
      });
    }
    if (
      !payment
      || payment.shopOrderId
      || !payment.orderId
      || !payment.order
      || !winningPaymentStatuses.includes(payment.status as typeof winningPaymentStatuses[number])
    ) {
      return createReceipt(transaction, {
        provider: input.provider, eventId: input.eventId, type: input.eventType,
        objectId: input.providerIncidentId, outcome: "REQUIRES_REVIEW",
        paymentId: payment?.id, occurredAt: input.occurredAt, livemode: input.livemode,
      });
    }
    await lock(transaction, `payments:order:${payment.order.orderNumber}`);
    const existing = await transaction.paymentIncident.findUnique({
      where: {
        provider_type_providerIncidentId: {
          provider: input.provider,
          type: input.incidentType,
          providerIncidentId: input.providerIncidentId,
        },
      },
    });
    if (existing && existing.paymentId !== payment.id) {
      return createReceipt(transaction, {
        provider: input.provider,
        eventId: input.eventId,
        type: input.eventType,
        objectId: input.providerIncidentId,
        outcome: "REQUIRES_REVIEW",
        paymentId: payment.id,
        occurredAt: input.occurredAt,
        livemode: input.livemode,
      });
    }
    const status = existing?.status === "RESOLVED" ? "RESOLVED" : input.status;
    const incident = existing
      ? await transaction.paymentIncident.update({
          where: { id: existing.id },
          data: {
            status,
            ...(input.amountCents ? { amountCents: input.amountCents, currency: input.currency } : {}),
            ...(status === "RESOLVED" ? {
              outcome: existing.outcome ?? input.outcome ?? "OTHER",
              resolvedAt: existing.resolvedAt ?? input.occurredAt,
            } : {}),
            requiresOperatorReview: true,
          },
        })
      : await transaction.paymentIncident.create({
          data: {
            paymentId: payment.id,
            provider: input.provider,
            type: input.incidentType,
            providerIncidentId: input.providerIncidentId,
            status: input.status,
            ...(input.amountCents ? { amountCents: input.amountCents, currency: input.currency } : {}),
            ...(input.status === "RESOLVED" ? { outcome: input.outcome ?? "OTHER", resolvedAt: input.occurredAt } : {}),
            openedAt: input.occurredAt,
            requiresOperatorReview: true,
          },
        });
    await transaction.paymentAuditEvent.create({
      data: {
        paymentId: payment.id, incidentId: incident.id, provider: input.provider,
        action: input.status === "RESOLVED" ? "INCIDENT_RESOLVED" : existing ? "INCIDENT_UPDATED" : "INCIDENT_OPENED",
        amountCents: input.amountCents,
        result: "REQUIRES_REVIEW",
      },
    });
    await transaction.orderEvent.create({
      data: {
        orderId: payment.orderId, fromStatus: null, toStatus: payment.order.status,
        note: "Incident de paiement nécessitant une revue.", visibility: "INTERNAL",
      },
    });
    await enqueueOrderNotification(transaction, {
      orderId: payment.orderId,
      kind: "OWNER_PAYMENT_INCIDENT",
      recipient: process.env.EMAIL_OWNER_RECIPIENT?.trim().toLowerCase() || null,
      idempotencyKey: `payment:${payment.id}:incident:${incident.id}:owner`,
      resource: { type: "ORDER", id: payment.orderId, reference: payment.order.orderNumber },
    });
    return createReceipt(transaction, {
      provider: input.provider, eventId: input.eventId, type: input.eventType,
      objectId: input.providerIncidentId, outcome: "PROCESSED",
      paymentId: payment.id, incidentId: incident.id, occurredAt: input.occurredAt, livemode: input.livemode,
    });
  });
}

export function normalizeStripeRefundEvent(event: VerifiedStripeWebhookEvent): (RefundProviderEvidence & { eventId: string; eventType: string }) | null {
  if (!stripeRefundEvents.has(event.type)) return null;
  const refund = record(event.data.object);
  const paymentIntent = bounded(record(refund?.payment_intent)?.id) ?? bounded(refund?.payment_intent);
  const status = event.type === "refund.failed" || refund?.status === "failed" || refund?.status === "canceled"
    ? "FAILED"
    : refund?.status === "succeeded"
      ? "SUCCEEDED"
      : refund?.status === "pending" || refund?.status === "requires_action"
        ? "PENDING"
        : null;
  const occurredAt = eventDate(event.created);
  if (
    refund?.object !== "refund" || !bounded(refund.id) || !paymentIntent || !status || !occurredAt
    || !Number.isSafeInteger(refund.amount) || Number(refund.amount) <= 0 || refund.currency !== "eur"
  ) return null;
  return {
    provider: "STRIPE", providerRefundId: String(refund.id), providerPaymentId: paymentIntent,
    status, amountCents: Number(refund.amount), currency: "EUR", occurredAt,
    eventId: event.id, eventType: event.type,
  };
}

export function captureIdFromRefundResource(
  resource: Record<string, unknown>,
  environment: "sandbox" | "live" = "sandbox",
) {
  const link = array(resource.links)
    .map(record)
    .find((candidate) => candidate?.rel === "up" && candidate?.method === "GET");
  const href = bounded(link?.href, 2_048);
  if (!href) return null;
  try {
    const url = new URL(href);
    const allowedHosts = environment === "live"
      ? ["api-m.paypal.com", "api.paypal.com"]
      : ["api-m.sandbox.paypal.com", "api.sandbox.paypal.com"];
    if (
      url.protocol !== "https:"
      || !allowedHosts.includes(url.hostname)
      || url.username
      || url.password
    ) return null;
    const match = url.pathname.match(/^\/v2\/payments\/captures\/([^/]+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function stripeFinancialProviderPaymentId(event: VerifiedStripeWebhookEvent) {
  const object = record(event.data.object);
  return bounded(record(object?.payment_intent)?.id) ?? bounded(object?.payment_intent);
}

export function paypalFinancialProviderPaymentId(
  event: VerifiedPaypalWebhookEvent,
  environment: "sandbox" | "live" = "sandbox",
) {
  const resource = record(event.resource);
  if (!resource) return null;
  if (event.event_type === "PAYMENT.CAPTURE.REFUNDED"
    || event.event_type === "PAYMENT.REFUND.PENDING"
    || event.event_type === "PAYMENT.REFUND.FAILED") {
    return captureIdFromRefundResource(resource, environment);
  }
  if (event.event_type === "PAYMENT.CAPTURE.REVERSED") return bounded(resource.id);
  if (event.event_type.startsWith("CUSTOMER.DISPUTE.")) {
    const disputedTransaction = record(array(resource.disputed_transactions)[0]);
    const transactionInfo = record(
      disputedTransaction?.seller_transaction_id
        ? disputedTransaction
        : disputedTransaction?.transaction_info,
    );
    return bounded(transactionInfo?.seller_transaction_id);
  }
  return null;
}

export function normalizePaypalRefundEvent(
  event: VerifiedPaypalWebhookEvent,
  environment: "sandbox" | "live" = "sandbox",
): (RefundProviderEvidence & { eventId: string; eventType: string }) | null {
  if (event.event_type !== "PAYMENT.REFUND.PENDING" && event.event_type !== "PAYMENT.REFUND.FAILED") return null;
  try {
    const evidence = paypalRefundEvidence(event.resource, environment);
    return {
      provider: "PAYPAL", providerRefundId: evidence.providerRefundId,
      providerPaymentId: evidence.captureId,
      status: event.event_type === "PAYMENT.REFUND.FAILED" ? "FAILED" : "PENDING",
      amountCents: evidence.amountCents, currency: "EUR", occurredAt: eventDate(event.create_time) ?? evidence.occurredAt,
      eventId: event.id, eventType: event.event_type,
    };
  } catch {
    return null;
  }
}

export function normalizePaypalIncidentEvent(
  event: VerifiedPaypalWebhookEvent,
  livemode = false,
): IncidentInput | null {
  const resource = record(event.resource);
  const occurredAt = eventDate(event.create_time);
  if (!resource || !occurredAt) return null;
  if (event.event_type === "PAYMENT.CAPTURE.REVERSED") {
    const captureId = bounded(resource.id);
    const amount = record(resource.amount);
    if (!captureId) return null;
    let amountCents: number | undefined;
    try { amountCents = amount?.currency_code === "EUR" ? paypalCentsFromAmount(amount.value) : undefined; } catch { amountCents = undefined; }
    return {
      provider: "PAYPAL", eventId: event.id, eventType: event.event_type,
      providerPaymentId: captureId, providerIncidentId: `reversal:${captureId}`,
      incidentType: "REVERSAL", status: "RESOLVED", outcome: "REVERSED",
      ...(amountCents ? { amountCents, currency: "EUR" } : {}), occurredAt, livemode,
    };
  }
  if (!event.event_type.startsWith("CUSTOMER.DISPUTE.")) return null;
  const providerIncidentId = bounded(resource.dispute_id) ?? bounded(resource.id);
  const transaction = record(array(resource.disputed_transactions)[0]);
  const transactionInfo = record(transaction?.seller_transaction_id ? transaction : transaction?.transaction_info);
  const providerPaymentId = bounded(transactionInfo?.seller_transaction_id);
  const amount = record(resource.dispute_amount);
  if (!providerIncidentId || !providerPaymentId) return null;
  let amountCents: number | undefined;
  try { amountCents = amount?.currency_code === "EUR" ? paypalCentsFromAmount(amount.value) : undefined; } catch { amountCents = undefined; }
  const rawStatus = resource.status;
  const status = event.event_type === "CUSTOMER.DISPUTE.RESOLVED" || rawStatus === "RESOLVED"
    ? "RESOLVED"
    : rawStatus === "UNDER_REVIEW"
      ? "UNDER_REVIEW"
      : "OPEN";
  const outcomeCode = bounded(record(resource.dispute_outcome)?.outcome_code);
  const outcome = outcomeCode === "RESOLVED_BUYER_FAVOUR"
    ? "BUYER_FAVOUR"
    : outcomeCode === "RESOLVED_SELLER_FAVOUR" || outcomeCode === "RESOLVED_WITH_PAYOUT"
      ? "SELLER_FAVOUR"
      : outcomeCode === "ACCEPTED"
        ? "ACCEPTED"
        : outcomeCode === "DENIED"
          ? "DENIED"
          : status === "RESOLVED" ? "OTHER" : undefined;
  return {
    provider: "PAYPAL", eventId: event.id, eventType: event.event_type,
    providerPaymentId, providerIncidentId,
    incidentType: resource.dispute_life_cycle_stage === "CHARGEBACK" ? "CHARGEBACK" : "DISPUTE",
    status, ...(amountCents ? { amountCents, currency: "EUR" } : {}), ...(outcome ? { outcome } : {}), occurredAt, livemode,
  };
}

export function normalizeStripeIncidentEvent(event: VerifiedStripeWebhookEvent): IncidentInput | null {
  if (!stripeIncidentEvents.has(event.type)) return null;
  const dispute = record(event.data.object);
  const providerIncidentId = bounded(dispute?.id);
  const paymentIntent = bounded(record(dispute?.payment_intent)?.id) ?? bounded(dispute?.payment_intent);
  const occurredAt = eventDate(event.created);
  if (dispute?.object !== "dispute" || !providerIncidentId || !paymentIntent || !occurredAt) return null;
  const status = event.type === "charge.dispute.closed" ? "RESOLVED" : event.type === "charge.dispute.created" ? "OPEN" : "UNDER_REVIEW";
  const outcome = status === "RESOLVED"
    ? dispute.status === "won" ? "SELLER_FAVOUR" : dispute.status === "lost" ? "BUYER_FAVOUR" : "OTHER"
    : undefined;
  const amountCents = Number.isSafeInteger(dispute.amount) && Number(dispute.amount) > 0 && dispute.currency === "eur"
    ? Number(dispute.amount) : undefined;
  return {
    provider: "STRIPE", eventId: event.id, eventType: event.type,
    providerPaymentId: paymentIntent, providerIncidentId, incidentType: "DISPUTE",
    status, ...(amountCents ? { amountCents, currency: "EUR" } : {}), ...(outcome ? { outcome } : {}), occurredAt,
    livemode: event.livemode,
  };
}

export function isStripeFinancialEvent(type: string) {
  return stripeRefundEvents.has(type) || stripeIncidentEvents.has(type);
}

export async function processVerifiedStripeFinancialEvent(event: VerifiedStripeWebhookEvent) {
  const refund = normalizeStripeRefundEvent(event);
  if (refund) return processRefundEvent({ ...refund, livemode: event.livemode });
  const incident = normalizeStripeIncidentEvent(event);
  if (incident) return processIncident(incident);
  return recordReview({
    provider: "STRIPE", eventId: event.id, type: event.type,
    providerPaymentId: stripeFinancialProviderPaymentId(event) ?? undefined,
    objectId: bounded(record(event.data.object)?.id) ?? undefined,
    occurredAt: eventDate(event.created) ?? new Date(),
    livemode: event.livemode,
  });
}

export function isPaypalFinancialEvent(type: string) {
  return paypalFinancialEvents.has(type);
}

export async function processVerifiedPaypalFinancialEvent(
  event: VerifiedPaypalWebhookEvent,
  environment: "sandbox" | "live" = "sandbox",
) {
  const livemode = environment === "live";
  const refund = normalizePaypalRefundEvent(event, environment);
  if (refund) return processRefundEvent({ ...refund, livemode });
  const incident = normalizePaypalIncidentEvent(event, livemode);
  if (incident) return processIncident(incident);
  const resource = record(event.resource);
  const captureId = paypalFinancialProviderPaymentId(event, environment);
  return recordReview({
    provider: "PAYPAL", eventId: event.id, type: event.event_type,
    providerPaymentId: captureId ?? undefined,
    objectId: bounded(resource?.id) ?? undefined,
    occurredAt: eventDate(event.create_time) ?? new Date(),
    livemode,
  });
}
