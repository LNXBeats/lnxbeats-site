import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { issueCreditNoteForRefund } from "@/lib/billing/service";
import { enqueueRightsNotification } from "@/lib/notifications/service";
import type { OrderActor } from "@/lib/orders/domain";
import {
  assertLiveRefundMutationAllowed,
  createRefundProviderGateway,
  type RefundProviderEvidence,
  type RefundProviderGateway,
  type RefundRuntimePolicy,
} from "@/lib/payments/refund";
import { assertPaymentsRuntimeEnvironment } from "@/lib/payments/runtime";
import { evaluateLiveRefundProductionPolicy } from "@/lib/payments/live-refund-policy";
import { parsePaymentsConfiguration } from "@/lib/payments/config";
import { paypalRefundApplicationReference } from "@/lib/payments/paypal-client";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
type Mode = "TEST" | "LIVE";

export const RIGHTS_WITHDRAWAL_DECLARATION = "Je demande la rétractation de la licence de publication identifiée, avant sa prise d’effet, et son remboursement total de 150,00 € sur le moyen de paiement d’origine.";

const requestPattern = /^LNX-LIC-[0-9]{4}-[0-9]{6,}$/;
const withdrawalPattern = /^LNX-RET-LIC-[0-9]{4}-[A-F0-9]{12}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RightsWithdrawalError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "RightsWithdrawalError";
  }
}

function member(actor: OrderActor) {
  if (!actor.id || !["MEMBER", "CUSTOMER"].includes(actor.role) || actor.status !== "ACTIVE" || !actor.emailVerified) {
    throw new RightsWithdrawalError(403, "RIGHTS_WITHDRAWAL_ACCESS_DENIED");
  }
}

function admin(actor: OrderActor) {
  if (!actor.id || actor.role !== "ADMIN" || actor.status !== "ACTIVE" || !actor.emailVerified) {
    throw new RightsWithdrawalError(403, "RIGHTS_WITHDRAWAL_ACCESS_DENIED");
  }
}

async function lock(tx: Transaction, rightsRequestId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rights-payment:request:${rightsRequestId}`}, 0))`;
}

function tx<T>(client: PrismaClient, operation: (transaction: Transaction) => Promise<T>) {
  return client.$transaction(operation, { isolationLevel: "ReadCommitted", timeout: 15_000 });
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function requestNumber(now: Date) {
  return `LNX-RET-LIC-${now.getUTCFullYear()}-${randomBytes(6).toString("hex").toUpperCase()}`;
}

function reason(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new RightsWithdrawalError(400, "RIGHTS_WITHDRAWAL_INVALID");
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 1000 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new RightsWithdrawalError(400, "RIGHTS_WITHDRAWAL_INVALID");
  }
  return normalized;
}

function evidenceMatches(attempt: { id: string; paymentId: string; provider: "STRIPE" | "PAYPAL"; providerPaymentId: string | null; amountCents: number; currency: string; providerRefundId: string | null; providerIdempotencyKey: string }, evidence: RefundProviderEvidence) {
  if (
    !attempt.providerPaymentId
    || evidence.provider !== attempt.provider
    || evidence.providerPaymentId !== attempt.providerPaymentId
    || evidence.amountCents !== attempt.amountCents
    || evidence.currency !== attempt.currency
    || (attempt.providerRefundId && attempt.providerRefundId !== evidence.providerRefundId)
  ) return false;
  if (attempt.provider === "STRIPE") {
    return evidence.applicationEvidence?.kind === "STRIPE_METADATA"
      && evidence.applicationEvidence.present
      && evidence.applicationEvidence.paymentId === attempt.paymentId
      && evidence.applicationEvidence.refundAttemptId === attempt.id;
  }
  return evidence.applicationEvidence?.kind === "PAYPAL_INVOICE_REFERENCE"
    && evidence.applicationEvidence.present
    && evidence.applicationEvidence.value === paypalRefundApplicationReference(attempt.providerIdempotencyKey);
}

export function createRightsWithdrawalRepository(client: PrismaClient = prisma, expectedMode?: Mode) {
  return {
    async submit(actor: OrderActor, requestNumberValue: string, inputReason: unknown, now = new Date()) {
      member(actor);
      if (!requestPattern.test(requestNumberValue)) throw new RightsWithdrawalError(404, "RIGHTS_WITHDRAWAL_NOT_FOUND");
      return tx(client, async (transaction) => {
        const identity = await transaction.rightsRequest.findFirst({ where: { requestNumber: requestNumberValue, userId: actor.id }, select: { id: true } });
        if (!identity) throw new RightsWithdrawalError(404, "RIGHTS_WITHDRAWAL_NOT_FOUND");
        await lock(transaction, identity.id);
        const request = await transaction.rightsRequest.findUnique({
          where: { id: identity.id },
          select: {
            id: true, requestNumber: true, userId: true, status: true, type: true, workTitle: true,
            order: { select: { orderNumber: true } },
            paymentWinner: { select: { payment: { select: { id: true, status: true, mode: true, amountCents: true, currency: true, provider: true, refundedAmountCents: true, paidAt: true, invoice: { select: { id: true, documentType: true, totalCents: true, currency: true } } } } } },
            license: { select: { id: true, status: true, withdrawalEndsAt: true, contractDocumentId: true, licenseNumber: true, contractDocument: { select: { contractNumber: true } } } },
            withdrawalRequest: { select: { id: true, requestNumber: true, status: true } },
          },
        });
        const payment = request?.paymentWinner?.payment;
        const license = request?.license;
        const invoice = payment?.invoice;
        if (
          !request || request.userId !== actor.id || request.type !== "PUBLICATION_LICENSE"
          || request.status !== "PAID_WAITING_WITHDRAWAL_PERIOD"
          || !payment || payment.status !== "SUCCEEDED" || payment.amountCents !== 15_000 || payment.currency !== "EUR" || payment.refundedAmountCents !== 0 || !payment.paidAt
          || (expectedMode && payment.mode !== expectedMode)
          || !invoice || invoice.documentType !== "RIGHTS" || invoice.totalCents !== 15_000 || invoice.currency !== "EUR"
          || !license || license.status !== "PAID_WAITING_WITHDRAWAL_PERIOD" || now > license.withdrawalEndsAt
        ) throw new RightsWithdrawalError(409, "RIGHTS_WITHDRAWAL_NOT_ELIGIBLE");
        if (request.withdrawalRequest) return request.withdrawalRequest;
        const number = requestNumber(now);
        const snapshot = {
          requestNumber: number,
          rightsRequestNumber: request.requestNumber,
          sourceOrderNumber: request.order.orderNumber,
          workTitle: request.workTitle,
          licenseNumber: license.licenseNumber,
          paymentId: payment.id,
          invoiceId: invoice.id,
          contractDocumentId: license.contractDocumentId,
          paidAt: payment.paidAt.toISOString(),
          withdrawalDeadline: license.withdrawalEndsAt.toISOString(),
          amountCents: 15_000,
          currency: "EUR",
          declaration: RIGHTS_WITHDRAWAL_DECLARATION,
        } satisfies Prisma.InputJsonObject;
        const withdrawal = await transaction.rightsWithdrawalRequest.create({ data: {
          requestNumber: number,
          rightsRequestId: request.id,
          paymentId: payment.id,
          invoiceId: invoice.id,
          contractDocumentId: license.contractDocumentId,
          requestedByUserId: actor.id,
          requestedAt: now,
          withdrawalDeadline: license.withdrawalEndsAt,
          reason: reason(inputReason),
          declarationText: RIGHTS_WITHDRAWAL_DECLARATION,
          evidenceSnapshot: snapshot,
          evidenceHashSha256: hash(snapshot),
        } });
        await transaction.rightsLicense.update({ where: { id: license.id }, data: { status: "WITHDRAWAL_REQUESTED" } });
        await transaction.rightsRequest.update({ where: { id: request.id }, data: { status: "WITHDRAWAL_REQUESTED" } });
        await transaction.rightsRequestEvent.create({ data: {
          rightsRequestId: request.id, type: "WITHDRAWAL_RECORDED",
          idempotencyKey: `rights:${request.id}:withdrawal:${withdrawal.id}:recorded`,
          actorUserId: actor.id,
          note: "Rétractation reçue dans le délai ; activation de la licence bloquée.",
        } });
        await enqueueRightsNotification(transaction, {
          rightsRequestId: request.id, kind: "CUSTOMER_RIGHTS_WITHDRAWAL_RECORDED", recipient: actor.email,
          idempotencyKey: `rights:${request.id}:withdrawal:${withdrawal.id}:client`, invoiceNumber: undefined,
          contractNumber: license.contractDocument.contractNumber, licenseNumber: license.licenseNumber, withdrawalEndsAt: license.withdrawalEndsAt,
          withdrawalRequestNumber: withdrawal.requestNumber,
        });
        await enqueueRightsNotification(transaction, {
          rightsRequestId: request.id, kind: "OWNER_RIGHTS_WITHDRAWAL_REQUESTED", recipient: process.env.EMAIL_OWNER_RECIPIENT?.trim().toLowerCase() || null,
          idempotencyKey: `rights:${request.id}:withdrawal:${withdrawal.id}:owner`, invoiceNumber: undefined,
          contractNumber: license.contractDocument.contractNumber, licenseNumber: license.licenseNumber, withdrawalEndsAt: license.withdrawalEndsAt,
          withdrawalRequestNumber: withdrawal.requestNumber,
        });
        return withdrawal;
      });
    },

    async reserveRefund(actor: OrderActor, withdrawalNumber: string, now = new Date()) {
      admin(actor);
      if (!withdrawalPattern.test(withdrawalNumber)) throw new RightsWithdrawalError(404, "RIGHTS_WITHDRAWAL_NOT_FOUND");
      return tx(client, async (transaction) => {
        const identity = await transaction.rightsWithdrawalRequest.findUnique({ where: { requestNumber: withdrawalNumber }, select: { id: true, rightsRequestId: true } });
        if (!identity) throw new RightsWithdrawalError(404, "RIGHTS_WITHDRAWAL_NOT_FOUND");
        await lock(transaction, identity.rightsRequestId);
        const withdrawal = await transaction.rightsWithdrawalRequest.findUnique({
          where: { id: identity.id },
          include: { payment: { include: { invoice: true } }, request: { include: { license: true } }, refundAttempt: true },
        });
        if (!withdrawal) throw new RightsWithdrawalError(404, "RIGHTS_WITHDRAWAL_NOT_FOUND");
        if (withdrawal.refundAttempt) return { ...withdrawal.refundAttempt, reused: true as const };
        if (
          withdrawal.status !== "REQUESTED" || withdrawal.requestedAt > withdrawal.withdrawalDeadline
          || withdrawal.payment.rightsRequestId !== withdrawal.rightsRequestId
          || withdrawal.payment.status !== "SUCCEEDED" || withdrawal.payment.amountCents !== 15_000
          || withdrawal.payment.currency !== "EUR" || withdrawal.payment.refundedAmountCents !== 0
          || (expectedMode && withdrawal.payment.mode !== expectedMode)
          || withdrawal.payment.invoice?.id !== withdrawal.invoiceId || withdrawal.payment.invoice.documentType !== "RIGHTS"
          || withdrawal.request.license?.status !== "WITHDRAWAL_REQUESTED"
        ) throw new RightsWithdrawalError(409, "RIGHTS_WITHDRAWAL_REQUIRES_REVIEW");
        const attemptId = randomUUID();
        const attempt = await transaction.refundAttempt.create({ data: {
          id: attemptId,
          paymentId: withdrawal.paymentId,
          provider: withdrawal.payment.provider,
          source: "ADMIN",
          amountCents: 15_000,
          currency: "EUR",
          requestedByUserId: actor.id,
          rightsWithdrawalId: withdrawal.id,
          localIdempotencyKey: `rights-withdrawal:${withdrawal.id}:refund`,
          providerIdempotencyKey: `rights-withdrawal:${withdrawal.payment.provider.toLowerCase()}:${attemptId}`,
          status: "PROCESSING",
          attempts: 1,
          lastAttemptAt: now,
        } });
        await transaction.rightsWithdrawalRequest.update({ where: { id: withdrawal.id }, data: { status: "REFUND_PENDING", reviewedAt: now, reviewedByUserId: actor.id } });
        await transaction.payment.update({ where: { id: withdrawal.paymentId }, data: { status: "REFUND_PENDING" } });
        await transaction.rightsRequestEvent.create({ data: {
          rightsRequestId: withdrawal.rightsRequestId, type: "WITHDRAWAL_APPROVED",
          idempotencyKey: `rights:${withdrawal.rightsRequestId}:withdrawal:${withdrawal.id}:approved`, actorUserId: actor.id,
          note: "Rétractation validée ; remboursement total de 150,00 € réservé sur le paiement d’origine.",
        } });
        await transaction.paymentAuditEvent.create({ data: {
          paymentId: withdrawal.paymentId, refundAttemptId: attempt.id, actorUserId: actor.id, actorRole: "ADMIN",
          provider: withdrawal.payment.provider, action: "REFUND_REQUESTED", amountCents: 15_000, result: "PENDING",
        } });
        return { ...attempt, reused: false as const };
      });
    },

    async reject(actor: OrderActor, withdrawalNumber: string, inputReason: unknown, now = new Date()) {
      admin(actor);
      if (!withdrawalPattern.test(withdrawalNumber)) throw new RightsWithdrawalError(404, "RIGHTS_WITHDRAWAL_NOT_FOUND");
      const rejectionReason = reason(inputReason);
      if (!rejectionReason) throw new RightsWithdrawalError(400, "RIGHTS_WITHDRAWAL_INVALID");
      return tx(client, async (transaction) => {
        const identity = await transaction.rightsWithdrawalRequest.findUnique({ where: { requestNumber: withdrawalNumber }, select: { id: true, rightsRequestId: true } });
        if (!identity) throw new RightsWithdrawalError(404, "RIGHTS_WITHDRAWAL_NOT_FOUND");
        await lock(transaction, identity.rightsRequestId);
        const withdrawal = await transaction.rightsWithdrawalRequest.findUnique({ where: { id: identity.id }, include: { refundAttempt: true, request: { include: { license: true } } } });
        if (!withdrawal?.request.license || withdrawal.status !== "REQUESTED" || withdrawal.refundAttempt) {
          throw new RightsWithdrawalError(409, "RIGHTS_WITHDRAWAL_REQUIRES_REVIEW");
        }
        await transaction.rightsWithdrawalRequest.update({ where: { id: withdrawal.id }, data: { status: "REJECTED", reviewedAt: now, reviewedByUserId: actor.id, rejectionReason, completedAt: now } });
        await transaction.rightsLicense.update({ where: { id: withdrawal.request.license.id }, data: { status: "PAID_WAITING_WITHDRAWAL_PERIOD" } });
        await transaction.rightsRequest.update({ where: { id: withdrawal.rightsRequestId }, data: { status: "PAID_WAITING_WITHDRAWAL_PERIOD" } });
        await transaction.rightsRequestEvent.create({ data: {
          rightsRequestId: withdrawal.rightsRequestId, type: "WITHDRAWAL_REJECTED",
          idempotencyKey: `rights:${withdrawal.rightsRequestId}:withdrawal:${withdrawal.id}:rejected`, actorUserId: actor.id,
          note: "Demande de rétractation refusée avec motif humain ; aucun remboursement créé.",
        } });
        return { id: withdrawal.id, status: "REJECTED" as const };
      });
    },

    async applyEvidence(attemptId: string, evidence: RefundProviderEvidence, externalTransaction?: Transaction) {
      if (!uuid.test(attemptId)) throw new RightsWithdrawalError(400, "RIGHTS_WITHDRAWAL_INVALID");
      const operation = async (transaction: Transaction) => {
        const identity = await transaction.refundAttempt.findUnique({ where: { id: attemptId }, select: { rightsWithdrawal: { select: { rightsRequestId: true } } } });
        if (!identity?.rightsWithdrawal) throw new RightsWithdrawalError(404, "RIGHTS_WITHDRAWAL_NOT_FOUND");
        await lock(transaction, identity.rightsWithdrawal.rightsRequestId);
        const attempt = await transaction.refundAttempt.findUnique({
          where: { id: attemptId },
          include: { payment: true, rightsWithdrawal: { include: { request: { include: { license: true, owner: { select: { email: true } } } }, invoice: true, contractDocument: true } } },
        });
        const withdrawal = attempt?.rightsWithdrawal;
        const license = withdrawal?.request.license;
        if (!attempt || !withdrawal || !license || attempt.payment.rightsRequestId !== withdrawal.rightsRequestId || (expectedMode && attempt.payment.mode !== expectedMode)) {
          throw new RightsWithdrawalError(409, "RIGHTS_WITHDRAWAL_REQUIRES_REVIEW");
        }
        if (attempt.status === "SUCCEEDED" && withdrawal.status === "COMPLETED") return { status: "SUCCEEDED" as const, confirmed: true };
        if (!evidenceMatches({ ...attempt, providerPaymentId: attempt.payment.providerPaymentId }, evidence)) {
          await transaction.refundAttempt.update({ where: { id: attempt.id }, data: { status: "REQUIRES_REVIEW", failureCode: "RIGHTS_REFUND_EVIDENCE_MISMATCH" } });
          await transaction.rightsWithdrawalRequest.update({ where: { id: withdrawal.id }, data: { status: "REQUIRES_REVIEW" } });
          await transaction.rightsLicense.update({ where: { id: license.id }, data: { status: "REQUIRES_REVIEW" } });
          await transaction.rightsRequest.update({ where: { id: withdrawal.rightsRequestId }, data: { status: "REQUIRES_REVIEW" } });
          return { status: "REQUIRES_REVIEW" as const, confirmed: false };
        }
        if (evidence.status !== "SUCCEEDED") {
          const status = evidence.status === "PENDING" ? "PENDING" : "REQUIRES_REVIEW";
          await transaction.refundAttempt.update({ where: { id: attempt.id }, data: { providerRefundId: evidence.providerRefundId, status, failureCode: status === "REQUIRES_REVIEW" ? "RIGHTS_REFUND_PROVIDER_FAILED_REVIEW" : null } });
          if (status === "REQUIRES_REVIEW") {
            await transaction.rightsWithdrawalRequest.update({ where: { id: withdrawal.id }, data: { status: "REQUIRES_REVIEW" } });
            await transaction.rightsLicense.update({ where: { id: license.id }, data: { status: "REQUIRES_REVIEW" } });
            await transaction.rightsRequest.update({ where: { id: withdrawal.rightsRequestId }, data: { status: "REQUIRES_REVIEW" } });
          }
          return { status, confirmed: false };
        }
        // Provider events can expose second-level timestamps while the local
        // request uses millisecond precision. The business completion must
        // never predate the immutable withdrawal request.
        const confirmedAt = new Date(Math.max(evidence.occurredAt.getTime(), withdrawal.requestedAt.getTime()));
        await transaction.refundAttempt.update({ where: { id: attempt.id }, data: { providerRefundId: evidence.providerRefundId, status: "SUCCEEDED", confirmedAt, failureCode: null } });
        await transaction.payment.update({ where: { id: attempt.paymentId }, data: { status: "REFUNDED", refundedAmountCents: 15_000, refundedAt: confirmedAt } });
        const { creditNote } = await issueCreditNoteForRefund(transaction, {
          refundAttemptId: attempt.id,
          reasonCode: "WITHDRAWAL",
          reasonText: "Rétractation de la licence de publication avant sa prise d’effet.",
          issuedAt: confirmedAt,
        });
        await transaction.rightsWithdrawalRequest.update({ where: { id: withdrawal.id }, data: { status: "COMPLETED", completedAt: confirmedAt } });
        await transaction.rightsLicense.update({ where: { id: license.id }, data: { status: "WITHDRAWN", terminatedAt: confirmedAt, terminationReason: "Rétractation exercée avant prise d’effet." } });
        await transaction.rightsRequest.update({ where: { id: withdrawal.rightsRequestId }, data: { status: "WITHDRAWN" } });
        await transaction.rightsRequestEvent.create({ data: {
          rightsRequestId: withdrawal.rightsRequestId, type: "WITHDRAWAL_REFUNDED",
          idempotencyKey: `rights:${withdrawal.rightsRequestId}:withdrawal:${withdrawal.id}:refunded`,
          note: "Rétractation terminée ; remboursement et avoir confirmés, licence sans prise d’effet.",
        } });
        await transaction.paymentAuditEvent.create({ data: {
          paymentId: attempt.paymentId, refundAttemptId: attempt.id, provider: attempt.provider,
          action: "REFUND_CONFIRMED", amountCents: 15_000, result: "SUCCEEDED",
        } });
        await enqueueRightsNotification(transaction, {
          rightsRequestId: withdrawal.rightsRequestId, kind: "CUSTOMER_RIGHTS_WITHDRAWAL_REFUNDED", recipient: withdrawal.request.owner.email,
          idempotencyKey: `rights:${withdrawal.rightsRequestId}:withdrawal:${withdrawal.id}:refunded:client`,
          invoiceNumber: withdrawal.invoice.invoiceNumber, contractNumber: withdrawal.contractDocument.contractNumber,
          licenseNumber: license.licenseNumber, withdrawalEndsAt: withdrawal.withdrawalDeadline,
          withdrawalRequestNumber: withdrawal.requestNumber, refundAmountCents: 15_000, creditNoteNumber: creditNote.creditNoteNumber,
        });
        return { status: "SUCCEEDED" as const, confirmed: true, creditNoteNumber: creditNote.creditNoteNumber };
      };
      return externalTransaction ? operation(externalTransaction) : tx(client, operation);
    },

    async getAttempt(attemptId: string) {
      const attempt = await client.refundAttempt.findUnique({ where: { id: attemptId }, include: { payment: true, rightsWithdrawal: true } });
      if (!attempt?.rightsWithdrawal || (expectedMode && attempt.payment.mode !== expectedMode)) throw new RightsWithdrawalError(404, "RIGHTS_WITHDRAWAL_NOT_FOUND");
      return attempt;
    },
  };
}

export type RightsWithdrawalDependencies = Readonly<{
  repository: ReturnType<typeof createRightsWithdrawalRepository>;
  gateway(provider: "STRIPE" | "PAYPAL"): RefundProviderGateway;
  assertRuntime(): Promise<RefundRuntimePolicy>;
}>;

function defaults(): RightsWithdrawalDependencies {
  assertDatabaseConfigured();
  const configuration = parsePaymentsConfiguration();
  const mode: Mode = configuration.deploymentEnvironment === "production" ? "LIVE" : "TEST";
  const livePolicy = evaluateLiveRefundProductionPolicy(process.env, configuration);
  return {
    repository: createRightsWithdrawalRepository(prisma, mode),
    gateway: (provider) => createRefundProviderGateway(provider),
    assertRuntime: async () => {
      const runtime = await assertPaymentsRuntimeEnvironment();
      return { mode: runtime.deploymentEnvironment === "production" ? "LIVE" : "TEST", liveRefundsEnabled: runtime.liveRefundsEnabled, liveRefundsArmed: runtime.deploymentEnvironment !== "production" || livePolicy.armed };
    },
  };
}

export function submitRightsWithdrawal(actor: OrderActor, requestNumberValue: string, inputReason?: unknown, now = new Date(), repository = createRightsWithdrawalRepository()) {
  return repository.submit(actor, requestNumberValue, inputReason, now);
}

export async function refundRightsWithdrawal(actor: OrderActor, withdrawalNumber: string, dependencies?: RightsWithdrawalDependencies) {
  admin(actor);
  const resolved = dependencies ?? defaults();
  // This is a separately authorized refund of an existing Rights payment.
  // The new-sales gate must not block withdrawal processing or reconciliation.
  const runtime = await resolved.assertRuntime();
  assertLiveRefundMutationAllowed(runtime);
  const attempt = await resolved.repository.reserveRefund(actor, withdrawalNumber);
  if (attempt.status === "SUCCEEDED") return { attemptId: attempt.id, status: "SUCCEEDED" as const };
  if (attempt.reused && !attempt.providerRefundId) return { attemptId: attempt.id, status: "PENDING" as const, confirmed: false };
  if (attempt.providerRefundId) {
    const evidence = await resolved.gateway(attempt.provider).retrieve(attempt.providerRefundId);
    return { attemptId: attempt.id, ...(await resolved.repository.applyEvidence(attempt.id, evidence)) };
  }
  const payment = await resolved.repository.getAttempt(attempt.id);
  const evidence = await resolved.gateway(attempt.provider).request({
    paymentId: attempt.paymentId,
    attemptId: attempt.id,
    providerPaymentId: payment.payment.providerPaymentId!,
    amountCents: 15_000,
    idempotencyKey: attempt.providerIdempotencyKey,
  });
  return { attemptId: attempt.id, ...(await resolved.repository.applyEvidence(attempt.id, evidence)) };
}
