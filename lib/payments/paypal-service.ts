import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import type { OrderActor } from "@/lib/orders/domain";
import { validateOrderPaymentSnapshot } from "@/lib/payments/domain";
import {
  createPaypalGateway,
  PaypalClientError,
  type PaypalCaptureEvidence,
  type PaypalCreateOrderRequest,
  type PaypalGateway,
} from "@/lib/payments/paypal-client";
import {
  createPaymentDatabaseCheckoutRepository,
  inLockedPaymentTransaction,
  lockPaymentTransaction,
  paidPaymentStatuses,
  paymentReturnUrls,
  PaymentServiceError,
  type PaymentCheckoutRepository,
  type ReservedCheckoutAttempt,
} from "@/lib/payments/service";
import { logPaymentEvent } from "@/lib/payments/observability";
import { assertPaymentsRuntimeEnvironment } from "@/lib/payments/runtime";
import { enqueuePaymentConfirmedNotifications } from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

const payableOrderNumber = /^LNX-[0-9]{4}-[0-9]{6}$/;
const internalId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Transaction = Prisma.TransactionClient;

function currentOrderPaymentSnapshot(order: {
  coverIncluded: boolean;
  priorityProcessing: boolean;
  basePriceCents: number;
  coverPriceCents: number;
  priorityPriceCents: number;
  totalCents: number;
  currency: string;
  pricingVersion: string;
}) {
  return {
    coverIncluded: order.coverIncluded,
    priorityProcessing: order.priorityProcessing,
    basePriceCents: order.basePriceCents,
    coverPriceCents: order.coverPriceCents,
    priorityPriceCents: order.priorityPriceCents,
    totalCents: order.totalCents,
    currency: order.currency,
    pricingVersion: order.pricingVersion,
  };
}

export type PaypalCheckoutResult = Readonly<{ approvalUrl: string }>;

export type PaypalCheckoutDependencies = Readonly<{
  repository: PaymentCheckoutRepository;
  gateway: PaypalGateway;
  baseUrl: string;
}>;

export type ReservedPaypalCapture = Readonly<{
  paymentId: string;
  orderId: string;
  orderNumber: string;
  providerOrderId: string;
  captureIdempotencyKey: string;
  amountCents: number;
  currency: "EUR";
  pricingVersion: string;
}>;

export type PaypalReconciliationEvent = Readonly<{
  eventId: string;
  type:
    | "PAYPAL.CAPTURE.RESPONSE"
    | "CHECKOUT.ORDER.APPROVED"
    | "PAYMENT.CAPTURE.PENDING"
    | "PAYMENT.CAPTURE.COMPLETED"
    | "PAYMENT.CAPTURE.DECLINED";
  occurredAt: Date;
  paymentId?: string;
  providerOrderId: string;
  captureId?: string;
  amountCents?: number;
  currency?: "EUR";
  status: "APPROVED" | "PENDING" | "COMPLETED" | "DECLINED";
}>;

export type PaypalReconciliationResult = Readonly<{
  outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW";
  duplicate: boolean;
  orderConfirmed: boolean;
}>;

export interface PaypalCaptureRepository {
  reserveCapture(actorId: string, orderNumber: string, providerOrderId: string): Promise<ReservedPaypalCapture>;
  reconcile(event: PaypalReconciliationEvent): Promise<PaypalReconciliationResult>;
  recordUnmatched(
    eventId: string,
    type: string,
    objectId?: string,
    outcome?: "IGNORED" | "REQUIRES_REVIEW",
  ): Promise<PaypalReconciliationResult>;
}

export type PaypalCaptureDependencies = Readonly<{
  repository: PaypalCaptureRepository;
  gateway: PaypalGateway;
}>;

function paypalReturnUrls(orderNumber: string, environment: Record<string, string | undefined>) {
  const urls = paymentReturnUrls(orderNumber, environment);
  const success = new URL(urls.successUrl);
  success.search = "?paiement=paypal-retour";
  const cancel = new URL(urls.cancelUrl);
  cancel.search = "?paiement=paypal-annule";
  return { returnUrl: success.toString(), cancelUrl: cancel.toString() } as const;
}

function createOrderRequest(
  attempt: ReservedCheckoutAttempt,
  baseUrl: string,
): PaypalCreateOrderRequest {
  const pricing = validateOrderPaymentSnapshot(attempt.snapshot);
  if (!pricing.ok) throw new PaymentServiceError(409, "ORDER_NOT_PAYABLE");
  const urls = paypalReturnUrls(attempt.orderNumber, { APP_CANONICAL_URL: baseUrl });
  return {
    orderId: attempt.orderId,
    orderNumber: attempt.orderNumber,
    paymentId: attempt.paymentId,
    amountCents: pricing.amountCents,
    currency: pricing.currency,
    description: "Création musicale personnalisée LNX Beats",
    returnUrl: urls.returnUrl,
    cancelUrl: urls.cancelUrl,
  };
}

async function defaultCheckoutDependencies(orderNumber: string): Promise<PaypalCheckoutDependencies> {
  await assertPaymentsRuntimeEnvironment();
  const urls = paymentReturnUrls(orderNumber);
  return {
    repository: createPaymentDatabaseCheckoutRepository(prisma, "PAYPAL"),
    gateway: createPaypalGateway(),
    baseUrl: new URL(urls.successUrl).origin,
  };
}

export async function createPaypalOrderForOrder(
  actor: OrderActor,
  orderNumber: string,
  dependencies?: PaypalCheckoutDependencies,
): Promise<PaypalCheckoutResult> {
  if (actor.status !== "ACTIVE" || actor.emailVerified !== true) {
    throw new PaymentServiceError(403, "PAYMENT_ACCESS_DENIED");
  }
  if (!payableOrderNumber.test(orderNumber)) {
    throw new PaymentServiceError(400, "INVALID_ORDER_NUMBER");
  }
  try {
    const resolved = dependencies ?? await defaultCheckoutDependencies(orderNumber);
    await resolved.repository.enforceRateLimit(actor.id);
    const attempt = await resolved.repository.reserveAttempt(actor.id, orderNumber);
    const request = createOrderRequest(attempt, resolved.baseUrl);
    const providerOrder = attempt.providerCheckoutId
      ? await resolved.gateway.retrieveOrder(attempt.providerCheckoutId)
      : await resolved.gateway.createOrder(request, attempt.idempotencyKey);
    const approvalUrl = providerOrder.approvalUrl
      ?? `${request.returnUrl}&token=${encodeURIComponent(providerOrder.id)}`;
    await resolved.repository.recordSession(attempt.paymentId, {
      id: providerOrder.id,
      url: approvalUrl,
    });
    logPaymentEvent("payment.session.created", {
      paymentId: attempt.paymentId,
      orderId: attempt.orderId,
    });
    return { approvalUrl };
  } catch (error) {
    if (error instanceof PaymentServiceError) throw error;
    if (error instanceof PaypalClientError) {
      logPaymentEvent("payment.session.failed");
    }
    throw new PaymentServiceError(503, "PAYMENT_UNAVAILABLE");
  }
}

function duplicateReceipt(transaction: Transaction, eventId: string) {
  return transaction.providerEvent.findUnique({
    where: { provider_providerEventId: { provider: "PAYPAL", providerEventId: eventId } },
    select: { outcome: true },
  });
}

async function createReceipt(
  transaction: Transaction,
  input: Readonly<{
    eventId: string;
    type: string;
    objectId?: string;
    outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW";
    paymentId?: string;
    occurredAt?: Date;
  }>,
): Promise<PaypalReconciliationResult> {
  await transaction.providerEvent.create({
    data: {
      provider: "PAYPAL",
      providerEventId: input.eventId,
      type: input.type.slice(0, 160),
      livemode: false,
      objectId: input.objectId?.slice(0, 255),
      outcome: input.outcome,
      processedAt: input.occurredAt ?? new Date(),
      ...(input.paymentId ? { paymentId: input.paymentId } : {}),
    },
    select: { id: true },
  });
  return { outcome: input.outcome, duplicate: false, orderConfirmed: false };
}

export function createPaymentDatabasePaypalCaptureRepository(
  client: PrismaClient,
): PaypalCaptureRepository {
  return {
    async reserveCapture(actorId, orderNumber, providerOrderId) {
      assertDatabaseConfigured();
      if (!internalId.test(actorId) || !payableOrderNumber.test(orderNumber) || !providerOrderId || providerOrderId.length > 255) {
        throw new PaymentServiceError(400, "ORDER_NOT_PAYABLE");
      }
      return inLockedPaymentTransaction(client, async (transaction) => {
        await lockPaymentTransaction(transaction, `payments:order:${orderNumber}`);
        const order = await transaction.order.findFirst({
          where: { orderNumber, userId: actorId },
          select: { id: true, status: true },
        });
        if (!order) throw new PaymentServiceError(404, "ORDER_NOT_PAYABLE");
        const succeeded = await transaction.payment.findFirst({
          where: { orderId: order.id, status: { in: [...paidPaymentStatuses] } },
          select: { id: true },
        });
        if (succeeded) throw new PaymentServiceError(409, "PAYMENT_ALREADY_COMPLETED");
        if (order.status !== "AWAITING_PAYMENT") {
          throw new PaymentServiceError(404, "ORDER_NOT_PAYABLE");
        }
        const payment = await transaction.payment.findFirst({
          where: {
            orderId: order.id,
            provider: "PAYPAL",
            providerCheckoutId: providerOrderId,
            status: { in: ["CREATED", "PENDING"] },
          },
          select: {
            id: true,
            orderId: true,
            providerCheckoutId: true,
            amountCents: true,
            currency: true,
            pricingVersion: true,
          },
        });
        if (!payment?.providerCheckoutId || payment.currency !== "EUR") {
          throw new PaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
        }
        return {
          paymentId: payment.id,
          orderId: payment.orderId,
          orderNumber,
          providerOrderId: payment.providerCheckoutId,
          captureIdempotencyKey: `paypal-capture:${payment.id}`,
          amountCents: payment.amountCents,
          currency: "EUR",
          pricingVersion: payment.pricingVersion,
        };
      });
    },

    async reconcile(event) {
      assertDatabaseConfigured();
      if (
        !event.eventId
        || event.eventId.length > 255
        || (event.paymentId !== undefined && !internalId.test(event.paymentId))
        || !event.providerOrderId
        || event.providerOrderId.length > 255
      ) throw new PaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");

      return inLockedPaymentTransaction(client, async (transaction) => {
        await lockPaymentTransaction(transaction, `payments:webhook:event:${event.eventId}`);
        const duplicate = await duplicateReceipt(transaction, event.eventId);
        if (duplicate) {
          return { outcome: duplicate.outcome, duplicate: true, orderConfirmed: false };
        }
        if (event.paymentId) {
          await lockPaymentTransaction(transaction, `payments:attempt:${event.paymentId}`);
        }
        const owner = event.paymentId
          ? await transaction.payment.findUnique({
              where: { id: event.paymentId },
              select: { id: true, order: { select: { orderNumber: true } } },
            })
          : await transaction.payment.findUnique({
              where: {
                provider_providerCheckoutId: {
                  provider: "PAYPAL",
                  providerCheckoutId: event.providerOrderId,
                },
              },
              select: { id: true, order: { select: { orderNumber: true } } },
            });
        if (!owner) {
          return createReceipt(transaction, {
            eventId: event.eventId,
            type: event.type,
            objectId: event.captureId ?? event.providerOrderId,
            outcome: "REQUIRES_REVIEW",
            occurredAt: event.occurredAt,
          });
        }
        if (!event.paymentId) {
          await lockPaymentTransaction(transaction, `payments:attempt:${owner.id}`);
        }
        await lockPaymentTransaction(transaction, `payments:order:${owner.order.orderNumber}`);
        const payment = await transaction.payment.findUnique({
          where: { id: owner.id },
          select: {
            id: true,
            orderId: true,
            provider: true,
            mode: true,
            status: true,
            amountCents: true,
            currency: true,
            pricingVersion: true,
            providerCheckoutId: true,
            providerPaymentId: true,
            order: {
              select: {
                status: true,
                coverIncluded: true,
                priorityProcessing: true,
                basePriceCents: true,
                coverPriceCents: true,
                priorityPriceCents: true,
                totalCents: true,
                currency: true,
                pricingVersion: true,
              },
            },
          },
        });
        const currentPricing = payment
          ? validateOrderPaymentSnapshot(currentOrderPaymentSnapshot(payment.order))
          : null;
        const mismatch = !payment
          || payment.provider !== "PAYPAL"
          || payment.mode !== "TEST"
          || (event.paymentId !== undefined && payment.id !== event.paymentId)
          || payment.providerCheckoutId !== event.providerOrderId
          || (event.captureId && payment.providerPaymentId && payment.providerPaymentId !== event.captureId)
          || (event.amountCents !== undefined && payment.amountCents !== event.amountCents)
          || (event.currency !== undefined && payment.currency !== event.currency)
          || !currentPricing?.ok
          || payment.amountCents !== currentPricing.amountCents
          || payment.currency !== currentPricing.currency
          || payment.pricingVersion !== currentPricing.pricingVersion;
        if (!payment || mismatch) {
          if (payment && !paidPaymentStatuses.includes(payment.status as typeof paidPaymentStatuses[number])) {
            await transaction.payment.update({
              where: { id: payment.id },
              data: {
                ...(payment.status === "CREATED" || payment.status === "PENDING"
                  ? { status: "REQUIRES_REVIEW" as const }
                  : {}),
                failureCode: "WEBHOOK_PAYPAL_RECONCILIATION_MISMATCH",
              },
              select: { id: true },
            });
          }
          return createReceipt(transaction, {
            eventId: event.eventId,
            type: event.type,
            objectId: event.captureId ?? event.providerOrderId,
            outcome: "REQUIRES_REVIEW",
            paymentId: payment?.id,
            occurredAt: event.occurredAt,
          });
        }

        if (event.status === "APPROVED" || event.status === "PENDING") {
          if (["CREATED", "PENDING"].includes(payment.status)) {
            await transaction.payment.update({
              where: { id: payment.id },
              data: {
                status: "PENDING",
                ...(event.captureId ? { providerPaymentId: event.captureId } : {}),
              },
              select: { id: true },
            });
          }
          return createReceipt(transaction, {
            eventId: event.eventId,
            type: event.type,
            objectId: event.captureId ?? event.providerOrderId,
            outcome: "PROCESSED",
            paymentId: payment.id,
            occurredAt: event.occurredAt,
          });
        }

        if (event.status === "DECLINED") {
          if (["CREATED", "PENDING"].includes(payment.status)) {
            await transaction.payment.update({
              where: { id: payment.id },
              data: {
                status: "FAILED",
                failedAt: event.occurredAt,
                failureCode: "PAYPAL_CAPTURE_DECLINED",
                ...(event.captureId ? { providerPaymentId: event.captureId } : {}),
              },
              select: { id: true },
            });
          }
          return createReceipt(transaction, {
            eventId: event.eventId,
            type: event.type,
            objectId: event.captureId ?? event.providerOrderId,
            outcome: "PROCESSED",
            paymentId: payment.id,
            occurredAt: event.occurredAt,
          });
        }

        const otherSuccessful = await transaction.payment.findFirst({
          where: {
            orderId: payment.orderId,
            id: { not: payment.id },
            status: { in: [...paidPaymentStatuses] },
          },
          select: { id: true },
        });
        if (otherSuccessful) {
          await transaction.payment.update({
            where: { id: payment.id },
            data: {
              status: "REQUIRES_REVIEW",
              failureCode: "PAYPAL_ORDER_ALREADY_PAID",
              ...(event.captureId ? { providerPaymentId: event.captureId } : {}),
            },
            select: { id: true },
          });
          return createReceipt(transaction, {
            eventId: event.eventId,
            type: event.type,
            objectId: event.captureId ?? event.providerOrderId,
            outcome: "REQUIRES_REVIEW",
            paymentId: payment.id,
            occurredAt: event.occurredAt,
          });
        }

        if (payment.status === "SUCCEEDED") {
          return createReceipt(transaction, {
            eventId: event.eventId,
            type: event.type,
            objectId: event.captureId ?? event.providerOrderId,
            outcome: "PROCESSED",
            paymentId: payment.id,
            occurredAt: event.occurredAt,
          });
        }
        if (payment.status !== "CREATED" && payment.status !== "PENDING") {
          await transaction.payment.update({
            where: { id: payment.id },
            data: { failureCode: "WEBHOOK_PAYPAL_TERMINAL_CAPTURE" },
            select: { id: true },
          });
          return createReceipt(transaction, {
            eventId: event.eventId,
            type: event.type,
            objectId: event.captureId ?? event.providerOrderId,
            outcome: "REQUIRES_REVIEW",
            paymentId: payment.id,
            occurredAt: event.occurredAt,
          });
        }
        if (payment.order.status !== "AWAITING_PAYMENT" || !event.captureId) {
          await transaction.payment.update({
            where: { id: payment.id },
            data: { status: "REQUIRES_REVIEW", failureCode: "PAYPAL_ORDER_STATUS_MISMATCH" },
            select: { id: true },
          });
          return createReceipt(transaction, {
            eventId: event.eventId,
            type: event.type,
            objectId: event.captureId ?? event.providerOrderId,
            outcome: "REQUIRES_REVIEW",
            paymentId: payment.id,
            occurredAt: event.occurredAt,
          });
        }

        await transaction.payment.update({
          where: { id: payment.id },
          data: {
            status: "SUCCEEDED",
            providerPaymentId: event.captureId,
            paymentMethod: "PAYPAL",
            paidAt: event.occurredAt,
            failureCode: null,
          },
          select: { id: true },
        });
        await transaction.payment.updateMany({
          where: {
            orderId: payment.orderId,
            id: { not: payment.id },
            OR: [
              { status: { in: ["CREATED", "PENDING"] } },
              { status: "FAILED", failureCode: "STRIPE_PAYMENT_ATTEMPT_FAILED" },
            ],
          },
          data: {
            status: "CANCELED",
            canceledAt: event.occurredAt,
            failureCode: "ORDER_PAID_BY_OTHER_PROVIDER",
          },
        });
        const confirmed = await transaction.order.updateMany({
          where: { id: payment.orderId, status: "AWAITING_PAYMENT" },
          data: { status: "PAYMENT_CONFIRMED" },
        });
        if (confirmed.count !== 1) throw new Error("The Order changed while its PayPal payment was confirmed.");
        await transaction.orderEvent.create({
          data: {
            orderId: payment.orderId,
            fromStatus: "AWAITING_PAYMENT",
            toStatus: "PAYMENT_CONFIRMED",
            note: "Paiement confirmé par PayPal.",
            visibility: "CLIENT",
          },
          select: { id: true },
        });
        await enqueuePaymentConfirmedNotifications(transaction, payment.orderId);
        const receipt = await createReceipt(transaction, {
          eventId: event.eventId,
          type: event.type,
          objectId: event.captureId,
          outcome: "PROCESSED",
          paymentId: payment.id,
          occurredAt: event.occurredAt,
        });
        return { ...receipt, orderConfirmed: true };
      });
    },

    async recordUnmatched(eventId, type, objectId, outcome = "REQUIRES_REVIEW") {
      assertDatabaseConfigured();
      if (!eventId || eventId.length > 255 || !type || type.length > 160) {
        throw new PaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
      }
      return inLockedPaymentTransaction(client, async (transaction) => {
        await lockPaymentTransaction(transaction, `payments:webhook:event:${eventId}`);
        const duplicate = await duplicateReceipt(transaction, eventId);
        if (duplicate) return { outcome: duplicate.outcome, duplicate: true, orderConfirmed: false };
        return createReceipt(transaction, {
          eventId,
          type,
          objectId,
          outcome,
        });
      });
    },
  };
}

export const paymentDatabasePaypalCaptureRepository = createPaymentDatabasePaypalCaptureRepository(prisma);

export async function capturePaypalOrderForOrder(
  actor: OrderActor,
  orderNumber: string,
  providerOrderId: string,
  dependencies?: PaypalCaptureDependencies,
) {
  if (actor.status !== "ACTIVE" || actor.emailVerified !== true) {
    throw new PaymentServiceError(403, "PAYMENT_ACCESS_DENIED");
  }
  if (!payableOrderNumber.test(orderNumber) || !providerOrderId || providerOrderId.length > 255) {
    throw new PaymentServiceError(400, "INVALID_ORDER_NUMBER");
  }
  try {
    const resolved = dependencies ?? await (async () => {
      await assertPaymentsRuntimeEnvironment();
      return {
        repository: paymentDatabasePaypalCaptureRepository,
        gateway: createPaypalGateway(),
      };
    })();
    // This locked preflight runs before any provider call. If Stripe already
    // won, PayPal capture is never attempted.
    const reserved = await resolved.repository.reserveCapture(actor.id, orderNumber, providerOrderId);
    const capture: PaypalCaptureEvidence = await resolved.gateway.captureOrder(
      reserved.providerOrderId,
      reserved.captureIdempotencyKey,
    );
    if (
      capture.paymentId !== reserved.paymentId
      || capture.providerOrderId !== reserved.providerOrderId
      || capture.amountCents !== reserved.amountCents
      || capture.currency !== reserved.currency
    ) throw new PaymentServiceError(409, "PAYMENT_SNAPSHOT_CONFLICT");
    const result = await resolved.repository.reconcile({
      eventId: `paypal-capture-response:${capture.captureId}`,
      type: "PAYPAL.CAPTURE.RESPONSE",
      occurredAt: capture.occurredAt,
      paymentId: capture.paymentId,
      providerOrderId: capture.providerOrderId,
      captureId: capture.captureId,
      amountCents: capture.amountCents,
      currency: capture.currency,
      status: capture.status,
    });
    return { confirmed: result.orderConfirmed, pending: capture.status === "PENDING" } as const;
  } catch (error) {
    if (error instanceof PaymentServiceError) throw error;
    throw new PaymentServiceError(503, "PAYMENT_UNAVAILABLE");
  }
}
