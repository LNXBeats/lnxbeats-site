import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import type { OrderActor } from "@/lib/orders/domain";
import { enqueueOrderNotification } from "@/lib/notifications/service";
import { issueCreditNoteForRefund } from "@/lib/billing/service";
import {
  createPaypalGateway,
  PaypalClientError,
  type PaypalGateway,
  type PaypalRefundGateway,
} from "@/lib/payments/paypal-client";
import {
  createStripeRefundGateway,
  StripeRefundClientError,
  type StripeRefundGateway,
} from "@/lib/payments/stripe-client";
import { assertPaymentsRuntimeEnvironment } from "@/lib/payments/runtime";
import { parsePaymentsConfiguration } from "@/lib/payments/config";
import { evaluateLiveRefundProductionPolicy } from "@/lib/payments/live-refund-policy";
import type { PersistedPaymentMode } from "@/lib/payments/types";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

const internalId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const orderNumberPattern = /^LNX-[0-9]{4}-[0-9]{6}$/;
const activeRefundStatuses = ["PROCESSING", "PENDING", "REQUIRES_REVIEW"] as const;
const winningPaymentStatuses = ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
export const LIVE_REFUND_CONFIRMATION = "CONFIRM_LIVE_FINANCIAL_REFUND" as const;
export const LIVE_REFUND_RECONCILIATION_CONFIRMATION = "CONFIRM_LIVE_REFUND_RECONCILIATION" as const;
type Transaction = Prisma.TransactionClient;

export type RefundProviderEvidence = Readonly<{
  provider: "STRIPE" | "PAYPAL";
  providerRefundId: string;
  providerPaymentId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  amountCents: number;
  currency: "EUR";
  occurredAt: Date;
  applicationEvidence?: Readonly<{
    kind: "STRIPE_METADATA";
    present: boolean;
    paymentId: string | null;
    refundAttemptId: string | null;
  }> | Readonly<{
    kind: "PAYPAL_INVOICE_REFERENCE";
    present: boolean;
    value: string | null;
  }>;
}>;

export interface RefundProviderGateway {
  request(input: Readonly<{
    paymentId: string;
    attemptId: string;
    providerPaymentId: string;
    amountCents: number;
    idempotencyKey: string;
  }>): Promise<RefundProviderEvidence>;
  retrieve(providerRefundId: string): Promise<RefundProviderEvidence>;
}

export class RefundServiceError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 503,
    readonly code:
      | "REFUND_ACCESS_DENIED"
      | "INVALID_REFUND_REQUEST"
      | "PAYMENT_NOT_REFUNDABLE"
      | "REFUND_AMOUNT_EXCEEDS_AVAILABLE"
      | "REFUND_ALREADY_PROCESSING"
      | "REFUND_REQUIRES_REVIEW"
      | "REFUND_SOURCE_INVOICE_REQUIRED"
      | "LIVE_REFUNDS_DISABLED"
      | "REFUND_PROVIDER_UNAVAILABLE",
  ) {
    super("Le remboursement ne peut pas être traité.");
    this.name = "RefundServiceError";
  }
}

export function assertRefundSourceInvoice(invoice: { id: string } | null | undefined) {
  if (!invoice) throw new RefundServiceError(409, "REFUND_SOURCE_INVOICE_REQUIRED");
}

export type RefundRuntimePolicy = Readonly<{
  mode: PersistedPaymentMode;
  liveRefundsEnabled: boolean;
  liveRefundsArmed?: boolean;
}>;

export function assertLiveRefundMutationAllowed(policy: RefundRuntimePolicy) {
  if (policy.mode === "LIVE" && (!policy.liveRefundsEnabled || policy.liveRefundsArmed !== true)) {
    throw new RefundServiceError(403, "LIVE_REFUNDS_DISABLED");
  }
}

export function parseRefundAmountToCents(value: unknown) {
  if (typeof value !== "string") throw new RefundServiceError(400, "INVALID_REFUND_REQUEST");
  const normalized = value.trim().replace(",", ".");
  const match = normalized.match(/^([0-9]{1,7})(?:\.([0-9]{1,2}))?$/);
  if (!match) throw new RefundServiceError(400, "INVALID_REFUND_REQUEST");
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new RefundServiceError(400, "INVALID_REFUND_REQUEST");
  }
  return cents;
}

export function paymentStatusAfterRefund(input: {
  amountCents: number;
  confirmedRefundedCents: number;
  hasUnresolvedRefund: boolean;
}) {
  if (
    !Number.isSafeInteger(input.amountCents)
    || !Number.isSafeInteger(input.confirmedRefundedCents)
    || input.amountCents <= 0
    || input.confirmedRefundedCents < 0
    || input.confirmedRefundedCents > input.amountCents
  ) throw new RefundServiceError(409, "REFUND_REQUIRES_REVIEW");
  if (input.hasUnresolvedRefund) return "REFUND_PENDING" as const;
  if (input.confirmedRefundedCents === 0) return "SUCCEEDED" as const;
  if (input.confirmedRefundedCents === input.amountCents) return "REFUNDED" as const;
  return "PARTIALLY_REFUNDED" as const;
}

export function refundableAmount(input: {
  paidCents: number;
  confirmedRefundedCents: number;
  reservedRefundCents: number;
}) {
  const value = input.paidCents - input.confirmedRefundedCents - input.reservedRefundCents;
  if (
    !Number.isSafeInteger(value)
    || input.paidCents <= 0
    || input.confirmedRefundedCents < 0
    || input.reservedRefundCents < 0
    || value < 0
  ) throw new RefundServiceError(409, "REFUND_REQUIRES_REVIEW");
  return value;
}

function assertAdmin(actor: OrderActor) {
  if (actor.role !== "ADMIN" || actor.status !== "ACTIVE" || actor.emailVerified !== true) {
    throw new RefundServiceError(403, "REFUND_ACCESS_DENIED");
  }
}

async function inPaymentTransaction<T>(
  client: PrismaClient,
  operation: (transaction: Transaction) => Promise<T>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== "object" || !("code" in error) || (error.code !== "P2034" && error.code !== "P2002")) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function lock(transaction: Transaction, key: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
}

export type ReservedRefund = Readonly<{
  id: string;
  paymentId: string;
  provider: "STRIPE" | "PAYPAL";
  providerPaymentId: string;
  amountCents: number;
  currency: "EUR";
  providerIdempotencyKey: string;
  providerRefundId: string | null;
  status: "PROCESSING" | "PENDING" | "SUCCEEDED" | "FAILED" | "REQUIRES_REVIEW";
  mode: PersistedPaymentMode;
  reused: boolean;
}>;

function reservedRefund(attempt: {
  id: string;
  paymentId: string;
  provider: "STRIPE" | "PAYPAL";
  amountCents: number;
  currency: string;
  providerIdempotencyKey: string;
  providerRefundId: string | null;
  status: "PROCESSING" | "PENDING" | "SUCCEEDED" | "FAILED" | "REQUIRES_REVIEW";
  payment: { providerPaymentId: string | null; mode: PersistedPaymentMode };
}, reused: boolean): ReservedRefund {
  if (attempt.currency !== "EUR" || !attempt.payment.providerPaymentId) {
    throw new RefundServiceError(409, "REFUND_REQUIRES_REVIEW");
  }
  return {
    id: attempt.id,
    paymentId: attempt.paymentId,
    provider: attempt.provider,
    providerPaymentId: attempt.payment.providerPaymentId,
    amountCents: attempt.amountCents,
    currency: "EUR",
    providerIdempotencyKey: attempt.providerIdempotencyKey,
    providerRefundId: attempt.providerRefundId,
    status: attempt.status,
    mode: attempt.payment.mode,
    reused,
  };
}

export function createRefundDatabaseRepository(
  client: PrismaClient,
  expectedMode: PersistedPaymentMode = "TEST",
  liveRefundsArmed = false,
) {
  return {
    async reserve(input: Readonly<{
      actor: OrderActor;
      orderNumber: string;
      kind: "FULL" | "PARTIAL";
      amountCents?: number;
      localIdempotencyKey: string;
      liveConfirmation?: string;
    }>): Promise<ReservedRefund> {
      assertAdmin(input.actor);
      assertLiveRefundMutationAllowed({ mode: expectedMode, liveRefundsEnabled: liveRefundsArmed, liveRefundsArmed });
      if (
        !orderNumberPattern.test(input.orderNumber)
        || !/^refund-request:[0-9a-f-]{36}$/i.test(input.localIdempotencyKey)
        || (input.kind === "PARTIAL" && (!Number.isSafeInteger(input.amountCents) || Number(input.amountCents) <= 0))
      ) throw new RefundServiceError(400, "INVALID_REFUND_REQUEST");
      return inPaymentTransaction(client, async (transaction) => {
        await lock(transaction, `payments:order:${input.orderNumber}`);
        const existing = await transaction.refundAttempt.findUnique({
          where: { localIdempotencyKey: input.localIdempotencyKey },
          include: {
            payment: {
              select: {
                orderId: true,
                shopOrderId: true,
                providerPaymentId: true,
                mode: true,
                invoice: { select: { id: true } },
                order: { select: { orderNumber: true } },
              },
            },
          },
        });
        if (existing) {
          if (
            existing.requestedByUserId !== input.actor.id
            || existing.payment.shopOrderId !== null
            || !existing.payment.orderId
            || !existing.payment.order
            || existing.payment.order.orderNumber !== input.orderNumber
            || existing.payment.mode !== expectedMode
          ) {
            throw new RefundServiceError(409, "REFUND_REQUIRES_REVIEW");
          }
          if (existing.payment.mode === "LIVE" && input.liveConfirmation !== LIVE_REFUND_CONFIRMATION) {
            throw new RefundServiceError(400, "INVALID_REFUND_REQUEST");
          }
          assertRefundSourceInvoice(existing.payment.invoice);
          return reservedRefund(existing, true);
        }
        const order = await transaction.order.findUnique({
          where: { orderNumber: input.orderNumber },
          select: {
            id: true,
            status: true,
            payments: {
              where: { status: { in: [...winningPaymentStatuses] }, mode: expectedMode },
              select: {
                id: true, provider: true, status: true, amountCents: true, currency: true,
                refundedAmountCents: true, providerPaymentId: true, mode: true,
                invoice: { select: { id: true } },
              },
            },
          },
        });
        if (!order || order.payments.length !== 1) {
          throw new RefundServiceError(404, "PAYMENT_NOT_REFUNDABLE");
        }
        const payment = order.payments[0]!;
        if (payment.currency !== "EUR" || !payment.providerPaymentId || payment.status === "REFUNDED") {
          throw new RefundServiceError(409, "PAYMENT_NOT_REFUNDABLE");
        }
        if (payment.mode === "LIVE" && input.liveConfirmation !== LIVE_REFUND_CONFIRMATION) {
          throw new RefundServiceError(400, "INVALID_REFUND_REQUEST");
        }
        // A Commander refund must be capable of producing its immutable credit
        // note. Check this deterministic accounting precondition before a
        // RefundAttempt is reserved and before any provider can be reached.
        assertRefundSourceInvoice(payment.invoice);
        await lock(transaction, `payments:attempt:${payment.id}`);
        const reserved = await transaction.refundAttempt.aggregate({
          where: { paymentId: payment.id, status: { in: [...activeRefundStatuses] } },
          _sum: { amountCents: true },
        });
        const available = refundableAmount({
          paidCents: payment.amountCents,
          confirmedRefundedCents: payment.refundedAmountCents,
          reservedRefundCents: reserved._sum.amountCents ?? 0,
        });
        const amountCents = input.kind === "FULL" ? available : Number(input.amountCents);
        if (amountCents <= 0) throw new RefundServiceError(409, "PAYMENT_NOT_REFUNDABLE");
        if (amountCents > available) throw new RefundServiceError(409, "REFUND_AMOUNT_EXCEEDS_AVAILABLE");
        const attemptId = randomUUID();
        const attempt = await transaction.refundAttempt.create({
          data: {
            id: attemptId,
            paymentId: payment.id,
            provider: payment.provider,
            source: "ADMIN",
            amountCents,
            currency: "EUR",
            requestedByUserId: input.actor.id,
            localIdempotencyKey: input.localIdempotencyKey,
            providerIdempotencyKey: `refund:${payment.provider.toLowerCase()}:${attemptId}`,
            status: "PROCESSING",
          },
          include: { payment: { select: { providerPaymentId: true, mode: true } } },
        });
        await transaction.payment.update({
          where: { id: payment.id },
          data: { status: "REFUND_PENDING" },
          select: { id: true },
        });
        await transaction.orderEvent.create({
          data: {
            orderId: order.id,
            fromStatus: null,
            toStatus: order.status,
            note: "Remboursement en attente.",
            visibility: "INTERNAL",
            actorUserId: input.actor.id,
          },
          select: { id: true },
        });
        await transaction.paymentAuditEvent.create({
          data: {
            paymentId: payment.id,
            refundAttemptId: attempt.id,
            actorUserId: input.actor.id,
            actorRole: "ADMIN",
            provider: payment.provider,
            action: "REFUND_REQUESTED",
            amountCents,
            result: "PENDING",
          },
          select: { id: true },
        });
        return reservedRefund(attempt, false);
      });
    },

    async claim(attemptId: string) {
      if (!internalId.test(attemptId)) throw new RefundServiceError(400, "INVALID_REFUND_REQUEST");
      assertLiveRefundMutationAllowed({ mode: expectedMode, liveRefundsEnabled: liveRefundsArmed, liveRefundsArmed });
      return inPaymentTransaction(client, async (transaction) => {
        await lock(transaction, `payments:refund:${attemptId}`);
        const attempt = await transaction.refundAttempt.findUnique({
          where: { id: attemptId },
          include: { payment: { select: { mode: true } } },
        });
        if (
          !attempt
          || attempt.payment.mode !== expectedMode
          || !["PROCESSING", "REQUIRES_REVIEW"].includes(attempt.status)
          || attempt.providerRefundId
        ) return false;
        const leaseBoundary = new Date(Date.now() - 60_000);
        if (attempt.lastAttemptAt && attempt.lastAttemptAt > leaseBoundary) return false;
        const updated = await transaction.refundAttempt.updateMany({
          where: { id: attempt.id, updatedAt: attempt.updatedAt },
          data: {
            status: "PROCESSING",
            failureCode: null,
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        });
        return updated.count === 1;
      });
    },

    async applyEvidence(attemptId: string, evidence: RefundProviderEvidence) {
      if (!internalId.test(attemptId)) throw new RefundServiceError(400, "INVALID_REFUND_REQUEST");
      return inPaymentTransaction(client, async (transaction) => {
        await lock(transaction, `payments:refund:${attemptId}`);
        const attempt = await transaction.refundAttempt.findUnique({
          where: { id: attemptId },
          include: { payment: { include: { order: true } } },
        });
        if (
          !attempt
          || attempt.payment.shopOrderId !== null
          || !attempt.payment.orderId
          || !attempt.payment.order
        ) throw new RefundServiceError(404, "PAYMENT_NOT_REFUNDABLE");
        if (attempt.payment.mode !== expectedMode) throw new RefundServiceError(409, "REFUND_REQUIRES_REVIEW");
        await lock(transaction, `payments:order:${attempt.payment.order.orderNumber}`);
        const mismatch = evidence.provider !== attempt.provider
          || evidence.providerPaymentId !== attempt.payment.providerPaymentId
          || evidence.amountCents !== attempt.amountCents
          || evidence.currency !== attempt.currency
          || (attempt.providerRefundId !== null && attempt.providerRefundId !== evidence.providerRefundId);
        if (mismatch) {
          await transaction.refundAttempt.update({
            where: { id: attempt.id },
            data: { status: "REQUIRES_REVIEW", failureCode: "REFUND_EVIDENCE_MISMATCH" },
          });
          await transaction.paymentAuditEvent.create({
            data: {
              paymentId: attempt.paymentId, refundAttemptId: attempt.id,
              provider: attempt.provider, action: "REFUND_RECONCILIATION_REQUIRED",
              amountCents: attempt.amountCents, result: "REQUIRES_REVIEW",
            },
          });
          return { status: "REQUIRES_REVIEW", confirmed: false } as const;
        }
        if (attempt.status === "SUCCEEDED") {
          return { status: "SUCCEEDED", confirmed: true } as const;
        }
        const nextStatus = evidence.status;
        await transaction.refundAttempt.update({
          where: { id: attempt.id },
          data: {
            providerRefundId: evidence.providerRefundId,
            status: nextStatus,
            failureCode: nextStatus === "FAILED" ? "PROVIDER_REFUND_FAILED" : null,
            confirmedAt: nextStatus === "SUCCEEDED" ? evidence.occurredAt : null,
          },
        });
        const confirmed = await transaction.refundAttempt.aggregate({
          where: { paymentId: attempt.paymentId, status: "SUCCEEDED" },
          _sum: { amountCents: true },
        });
        const confirmedCents = confirmed._sum.amountCents ?? 0;
        const unresolved = await transaction.refundAttempt.count({
          where: { paymentId: attempt.paymentId, status: { in: [...activeRefundStatuses] } },
        });
        const paymentStatus = paymentStatusAfterRefund({
          amountCents: attempt.payment.amountCents,
          confirmedRefundedCents: confirmedCents,
          hasUnresolvedRefund: unresolved > 0,
        });
        await transaction.payment.update({
          where: { id: attempt.paymentId },
          data: {
            status: paymentStatus,
            refundedAmountCents: confirmedCents,
            refundedAt: confirmedCents > 0 ? evidence.occurredAt : null,
          },
        });
        const action = nextStatus === "SUCCEEDED"
          ? "REFUND_CONFIRMED"
          : nextStatus === "FAILED"
            ? "REFUND_FAILED"
            : "REFUND_PROVIDER_ACCEPTED";
        await transaction.paymentAuditEvent.create({
          data: {
            paymentId: attempt.paymentId,
            refundAttemptId: attempt.id,
            provider: attempt.provider,
            action,
            amountCents: attempt.amountCents,
            result: nextStatus === "SUCCEEDED" ? "SUCCEEDED" : nextStatus === "FAILED" ? "FAILED" : "PENDING",
          },
        });
        if (nextStatus === "SUCCEEDED") {
          await issueCreditNoteForRefund(transaction, { refundAttemptId: attempt.id });
          const total = confirmedCents === attempt.payment.amountCents;
          await transaction.orderEvent.create({
            data: {
              orderId: attempt.payment.orderId,
              fromStatus: null,
              toStatus: attempt.payment.order.status,
              note: total ? "Remboursement total confirmé." : "Remboursement partiel confirmé.",
              visibility: "INTERNAL",
            },
          });
          await enqueueOrderNotification(transaction, {
            orderId: attempt.payment.orderId,
            kind: total ? "CUSTOMER_REFUND_COMPLETED" : "CUSTOMER_PARTIAL_REFUND",
            recipient: attempt.payment.order.customerEmail,
            idempotencyKey: `payment:${attempt.paymentId}:refund:${attempt.id}:confirmed`,
            resource: {
              type: "ORDER",
              id: attempt.payment.orderId,
              reference: attempt.payment.order.orderNumber,
              refundAmountCents: attempt.amountCents,
            },
          });
        }
        return { status: nextStatus, confirmed: nextStatus === "SUCCEEDED" } as const;
      });
    },

    async markProviderFailure(attemptId: string, failure: Readonly<{ code: string; review: boolean }>) {
      return inPaymentTransaction(client, async (transaction) => {
        await lock(transaction, `payments:refund:${attemptId}`);
        const attempt = await transaction.refundAttempt.findUnique({
          where: { id: attemptId },
          include: { payment: true },
        });
        if (!attempt || attempt.status === "SUCCEEDED") return;
        if (attempt.payment.mode !== expectedMode) throw new RefundServiceError(409, "REFUND_REQUIRES_REVIEW");
        const status = failure.review ? "REQUIRES_REVIEW" : "FAILED";
        await transaction.refundAttempt.update({
          where: { id: attempt.id },
          data: { status, failureCode: failure.code.slice(0, 120) },
        });
        const unresolved = await transaction.refundAttempt.count({
          where: { paymentId: attempt.paymentId, status: { in: [...activeRefundStatuses] } },
        });
        const paymentStatus = paymentStatusAfterRefund({
          amountCents: attempt.payment.amountCents,
          confirmedRefundedCents: attempt.payment.refundedAmountCents,
          hasUnresolvedRefund: unresolved > 0,
        });
        await transaction.payment.update({ where: { id: attempt.paymentId }, data: { status: paymentStatus } });
        await transaction.paymentAuditEvent.create({
          data: {
            paymentId: attempt.paymentId, refundAttemptId: attempt.id,
            provider: attempt.provider,
            action: failure.review ? "REFUND_RECONCILIATION_REQUIRED" : "REFUND_FAILED",
            amountCents: attempt.amountCents,
            result: failure.review ? "REQUIRES_REVIEW" : "FAILED",
          },
        });
      });
    },

    async get(attemptId: string): Promise<ReservedRefund> {
      const attempt = await client.refundAttempt.findUnique({
        where: { id: attemptId },
        include: { payment: { select: { providerPaymentId: true, mode: true } } },
      });
      if (!attempt || attempt.payment.mode !== expectedMode) throw new RefundServiceError(404, "PAYMENT_NOT_REFUNDABLE");
      return reservedRefund(attempt, true);
    },

    async recordReconciliation(
      attemptId: string,
      actor: OrderActor,
      status: "PROCESSING" | "PENDING" | "SUCCEEDED" | "FAILED" | "REQUIRES_REVIEW",
    ) {
      assertAdmin(actor);
      const attempt = await client.refundAttempt.findUnique({
        where: { id: attemptId },
        select: { id: true, paymentId: true, provider: true, amountCents: true, payment: { select: { mode: true } } },
      });
      if (!attempt || attempt.payment.mode !== expectedMode) throw new RefundServiceError(404, "PAYMENT_NOT_REFUNDABLE");
      await client.paymentAuditEvent.create({
        data: {
          paymentId: attempt.paymentId,
          refundAttemptId: attempt.id,
          actorUserId: actor.id,
          actorRole: "ADMIN",
          provider: attempt.provider,
          action: "RECONCILIATION_CHECKED",
          amountCents: attempt.amountCents,
          result: status === "SUCCEEDED"
            ? "SUCCEEDED"
            : status === "FAILED"
              ? "FAILED"
              : status === "REQUIRES_REVIEW"
                ? "REQUIRES_REVIEW"
                : "PENDING",
        },
        select: { id: true },
      });
    },
  };
}

export function createRefundProviderGateway(
  provider: "STRIPE" | "PAYPAL",
  dependencies?: Readonly<{ stripe?: StripeRefundGateway; paypal?: PaypalGateway & PaypalRefundGateway }>,
): RefundProviderGateway {
  if (provider === "STRIPE") {
    const gateway = dependencies?.stripe ?? createStripeRefundGateway();
    return {
      async request(input) {
        const evidence = await gateway.refundPaymentIntent(
          input.providerPaymentId,
          input.amountCents,
          input.idempotencyKey,
          { paymentId: input.paymentId, refundAttemptId: input.attemptId },
        );
        return {
          provider,
          ...evidence,
          providerPaymentId: evidence.paymentIntentId,
          applicationEvidence: {
            kind: "STRIPE_METADATA" as const,
            present: evidence.applicationMetadata?.present === true,
            paymentId: evidence.applicationMetadata?.paymentId ?? null,
            refundAttemptId: evidence.applicationMetadata?.refundAttemptId ?? null,
          },
        };
      },
      async retrieve(providerRefundId) {
        const evidence = await gateway.retrieveRefund(providerRefundId);
        return {
          provider,
          ...evidence,
          providerPaymentId: evidence.paymentIntentId,
          applicationEvidence: {
            kind: "STRIPE_METADATA" as const,
            present: evidence.applicationMetadata?.present === true,
            paymentId: evidence.applicationMetadata?.paymentId ?? null,
            refundAttemptId: evidence.applicationMetadata?.refundAttemptId ?? null,
          },
        };
      },
    };
  }
  const gateway = dependencies?.paypal ?? createPaypalGateway();
  return {
    async request(input) {
      const evidence = await gateway.refundCapture(input.providerPaymentId, input.amountCents, input.idempotencyKey);
      return {
        provider,
        ...evidence,
        providerPaymentId: evidence.captureId,
        applicationEvidence: {
          kind: "PAYPAL_INVOICE_REFERENCE" as const,
          present: evidence.applicationReferencePresent === true
            || typeof evidence.applicationReference === "string",
          value: evidence.applicationReference ?? null,
        },
      };
    },
    async retrieve(providerRefundId) {
      const evidence = await gateway.retrieveRefund(providerRefundId);
      return {
        provider,
        ...evidence,
        providerPaymentId: evidence.captureId,
        applicationEvidence: {
          kind: "PAYPAL_INVOICE_REFERENCE" as const,
          present: evidence.applicationReferencePresent === true
            || typeof evidence.applicationReference === "string",
          value: evidence.applicationReference ?? null,
        },
      };
    },
  };
}

function providerFailure(error: unknown) {
  if (error instanceof StripeRefundClientError || error instanceof PaypalClientError) {
    if (["INVALID_REQUEST", "NOT_APPROVED"].includes(error.code)) {
      return { code: "REFUND_PROVIDER_REJECTED", review: false } as const;
    }
    if (error.code === "INVALID_RESPONSE") {
      return { code: "REFUND_PROVIDER_INVALID_RESPONSE", review: true } as const;
    }
    if (error.code === "AUTHENTICATION") {
      return { code: "REFUND_PROVIDER_AUTHENTICATION", review: true } as const;
    }
    if (error.code === "CONFLICT") {
      return { code: "REFUND_PROVIDER_CONFLICT", review: true } as const;
    }
    return { code: "REFUND_PROVIDER_UNAVAILABLE", review: true } as const;
  }
  return { code: "REFUND_PROVIDER_UNAVAILABLE", review: true } as const;
}

export type RefundDependencies = Readonly<{
  repository: ReturnType<typeof createRefundDatabaseRepository>;
  gateway(provider: "STRIPE" | "PAYPAL"): RefundProviderGateway;
  assertRuntime(): Promise<RefundRuntimePolicy>;
}>;

function defaultDependencies(): RefundDependencies {
  assertDatabaseConfigured();
  const configuration = parsePaymentsConfiguration();
  const expectedMode = configuration.deploymentEnvironment === "production" ? "LIVE" : "TEST";
  const liveRefundPolicy = evaluateLiveRefundProductionPolicy(process.env, configuration);
  return {
    repository: createRefundDatabaseRepository(prisma, expectedMode, liveRefundPolicy.armed),
    gateway: (provider) => createRefundProviderGateway(provider),
    assertRuntime: async () => {
      const runtime = await assertPaymentsRuntimeEnvironment();
      return {
        mode: runtime.deploymentEnvironment === "production" ? "LIVE" : "TEST",
        liveRefundsEnabled: runtime.liveRefundsEnabled,
        liveRefundsArmed: runtime.deploymentEnvironment !== "production"
          || evaluateLiveRefundProductionPolicy(process.env, runtime).armed,
      };
    },
  };
}

export async function requestRefundForOrder(
  actor: OrderActor,
  input: Readonly<{
    orderNumber: string;
    kind: "FULL" | "PARTIAL";
    amountCents?: number;
    requestToken: string;
    liveConfirmation?: string;
  }>,
  dependencies: RefundDependencies = defaultDependencies(),
) {
  assertAdmin(actor);
  const runtime = await dependencies.assertRuntime();
  assertLiveRefundMutationAllowed(runtime);
  const localIdempotencyKey = `refund-request:${input.requestToken}`;
  const attempt = await dependencies.repository.reserve({
    actor,
    orderNumber: input.orderNumber,
    kind: input.kind,
    amountCents: input.amountCents,
    localIdempotencyKey,
    ...(input.liveConfirmation ? { liveConfirmation: input.liveConfirmation } : {}),
  });
  if (attempt.status === "SUCCEEDED") return { attemptId: attempt.id, status: attempt.status } as const;
  if (attempt.reused && !attempt.providerRefundId) {
    return {
      attemptId: attempt.id,
      status: attempt.status === "REQUIRES_REVIEW" ? "REQUIRES_REVIEW" as const : "PENDING" as const,
    };
  }
  const gateway = dependencies.gateway(attempt.provider);
  try {
    let evidence: RefundProviderEvidence;
    if (attempt.providerRefundId) {
      evidence = await gateway.retrieve(attempt.providerRefundId);
    } else {
      const claimed = await dependencies.repository.claim(attempt.id);
      if (!claimed) return { attemptId: attempt.id, status: "PENDING" as const };
      evidence = await gateway.request({
        paymentId: attempt.paymentId,
        attemptId: attempt.id,
        providerPaymentId: attempt.providerPaymentId,
        amountCents: attempt.amountCents,
        idempotencyKey: attempt.providerIdempotencyKey,
      });
    }
    const result = await dependencies.repository.applyEvidence(attempt.id, evidence);
    return { attemptId: attempt.id, status: result.status } as const;
  } catch (error) {
    const failure = providerFailure(error);
    await dependencies.repository.markProviderFailure(attempt.id, failure);
    throw new RefundServiceError(
      failure.review ? 503 : 409,
      failure.review ? "REFUND_PROVIDER_UNAVAILABLE" : "PAYMENT_NOT_REFUNDABLE",
    );
  }
}

export async function reconcileRefundAttemptForAdmin(
  actor: OrderActor,
  attemptId: string,
  dependencies: RefundDependencies = defaultDependencies(),
  liveConfirmation?: string,
) {
  assertAdmin(actor);
  const runtime = await dependencies.assertRuntime();
  assertLiveRefundMutationAllowed(runtime);
  const attempt = await dependencies.repository.get(attemptId);
  if (attempt.mode === "LIVE" && liveConfirmation !== LIVE_REFUND_RECONCILIATION_CONFIRMATION) {
    throw new RefundServiceError(400, "INVALID_REFUND_REQUEST");
  }
  if (attempt.status === "SUCCEEDED" || attempt.status === "FAILED") {
    await dependencies.repository.recordReconciliation(attempt.id, actor, attempt.status);
    return { status: attempt.status } as const;
  }
  if (!attempt.providerRefundId) {
    await dependencies.repository.recordReconciliation(attempt.id, actor, "REQUIRES_REVIEW");
    return { status: "REQUIRES_REVIEW" as const, confirmed: false };
  }
  const gateway = dependencies.gateway(attempt.provider);
  let result: Awaited<ReturnType<RefundDependencies["repository"]["applyEvidence"]>>;
  try {
    const evidence = await gateway.retrieve(attempt.providerRefundId);
    result = await dependencies.repository.applyEvidence(attempt.id, evidence);
  } catch (error) {
    if (error instanceof RefundServiceError) throw error;
    const failure = providerFailure(error);
    await dependencies.repository.markProviderFailure(attempt.id, failure);
    throw new RefundServiceError(503, "REFUND_PROVIDER_UNAVAILABLE");
  }
  await dependencies.repository.recordReconciliation(attempt.id, actor, result.status);
  return result;
}

export function newRefundRequestToken() {
  return randomUUID();
}
