import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { publicationLicenseOffer, publicationLicenseTerms } from "@/data/rights-offer";
import { issueInvoiceForPayment } from "@/lib/billing/service";
import { enqueueRightsNotification } from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { licenseExpiresAt, withdrawalEndsAt } from "@/lib/rights/license-calendar";
import { assertRightsProviderEvent } from "@/lib/rights/payment-domain";
import { isPublicationLicenseV3CanonicalSource } from "@/lib/rights/templates";
import type { ReservedRightsPaymentAttempt, RightsPaymentResult, RightsProviderEvent } from "@/lib/rights/payment-types";
import type { HostedCheckoutSession } from "@/lib/payments/stripe-client";

type Transaction = Prisma.TransactionClient;
type Provider = "STRIPE" | "PAYPAL";
type Mode = "TEST" | "LIVE";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_NUMBER = /^LNX-LIC-[0-9]{4}-[0-9]{6,}$/;
const paidStatuses = ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

export class RightsPaymentError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "RightsPaymentError";
  }
}

async function lock(transaction: Transaction, key: string) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rights-payment:${key}`}, 0))`;
}

async function transaction<T>(client: PrismaClient, operation: (tx: Transaction) => Promise<T>) {
  return client.$transaction(operation, { isolationLevel: "ReadCommitted", timeout: 15_000 });
}

function checkoutKey(provider: Provider, paymentId: string) {
  return `rights:${paymentId}:${provider.toLowerCase()}:checkout`;
}

async function eligibleRequest(tx: Transaction, actorId: string, requestNumber: string) {
  const request = await tx.rightsRequest.findFirst({
    where: { requestNumber, userId: actorId },
    select: {
      id: true, requestNumber: true, orderId: true, userId: true, type: true, status: true,
      requestedPriceCents: true, currency: true, pricingVersion: true, workTitle: true,
      order: {
        select: {
          orderNumber: true, status: true, deliveredAt: true, totalCents: true, currency: true,
          payments: { where: { status: { in: [...paidStatuses] } }, select: { status: true, amountCents: true, currency: true, refundedAmountCents: true } },
          assets: { where: { role: "DELIVERY", asset: { type: "AUDIO" } }, select: { assetId: true }, take: 1 },
        },
      },
      documents: {
        where: { kind: "CONTRACT", status: "ADMIN_VALIDATED" },
        orderBy: { documentVersion: "desc" }, take: 1,
        select: {
          id: true, contractNumber: true, templateVersion: true, documentHashSha256: true,
          template: { select: { status: true, sourceMarkup: true, approvedAt: true, approvedByAdminId: true, legalReviewReference: true } },
          acceptances: { where: { kind: "CLIENT" }, orderBy: { acceptedAt: "desc" }, take: 1, select: { acceptedAt: true, templateVersion: true, documentHashSha256: true, acceptedByUserId: true } },
        },
      },
      paymentWinner: { select: { paymentId: true } },
      license: { select: { id: true } },
    },
  });
  if (!request) throw new RightsPaymentError(404, "RIGHTS_REQUEST_NOT_FOUND");
  const offer = publicationLicenseOffer.PUBLICATION_LICENSE;
  const sourcePayment = request.order.payments.find((payment) => payment.refundedAmountCents === 0 && payment.amountCents === request.order.totalCents && payment.currency === request.order.currency);
  const document = request.documents[0];
  const acceptance = document?.acceptances[0];
  if (
    request.type !== "PUBLICATION_LICENSE"
    || request.status !== "READY_FOR_PAYMENT"
    || request.requestedPriceCents !== offer.priceCents
    || request.currency !== offer.currency
    || request.pricingVersion !== offer.pricingVersion
    || request.order.status !== "DELIVERED"
    || !request.order.deliveredAt
    || !request.order.assets[0]
    || !request.workTitle.trim()
    || !sourcePayment
    || request.paymentWinner
    || request.license
    || !document
    || document.templateVersion !== offer.contractTemplateVersion
    || document.template.status !== "APPROVED"
    || !isPublicationLicenseV3CanonicalSource(document.template.sourceMarkup)
    || !document.template.approvedAt
    || !document.template.approvedByAdminId
    || !document.template.legalReviewReference
    || !acceptance
    || acceptance.acceptedByUserId !== actorId
    || acceptance.templateVersion !== document.templateVersion
    || acceptance.documentHashSha256 !== document.documentHashSha256
  ) throw new RightsPaymentError(409, "RIGHTS_REQUEST_NOT_PAYABLE");
  return { request, document, acceptance };
}

async function receipt(tx: Transaction, event: RightsProviderEvent, outcome: "PROCESSED" | "IGNORED" | "REQUIRES_REVIEW") {
  await tx.providerEvent.create({
    data: {
      provider: event.provider,
      providerEventId: event.eventId,
      type: event.type.slice(0, 160),
      livemode: event.livemode,
      objectId: (event.providerPaymentId ?? event.providerCheckoutId ?? event.paymentId).slice(0, 255),
      outcome,
      paymentId: event.paymentId,
      processedAt: event.occurredAt,
    },
  });
}

async function nextLicenseNumber(tx: Transaction, at: Date) {
  const rows = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('lnx_rights_license_activation_number_seq')::bigint AS value`;
  const value = rows[0]?.value;
  if (typeof value !== "bigint") throw new Error("RIGHTS_LICENSE_SEQUENCE_FAILURE");
  return `LIC-LNX-${at.getUTCFullYear()}-${value.toString().padStart(6, "0")}`;
}

async function finalizeSuccess(tx: Transaction, paymentId: string, event: RightsProviderEvent) {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true, rightsRequestId: true, orderId: true, shopOrderId: true, provider: true, mode: true,
      status: true, amountCents: true, currency: true, pricingVersion: true, providerCheckoutId: true,
      providerPaymentId: true, paidAt: true,
      rightsRequest: {
        select: {
          id: true, requestNumber: true, orderId: true, userId: true, status: true, type: true,
          requestedPriceCents: true, currency: true, pricingVersion: true, workTitle: true,
          owner: { select: { email: true } },
          order: { select: { status: true, deliveredAt: true, assets: { where: { role: "DELIVERY", asset: { type: "AUDIO" } }, take: 1, select: { assetId: true } } } },
          documents: {
            where: { kind: "CONTRACT", status: { in: ["ADMIN_VALIDATED", "ACTIVE"] } }, orderBy: { documentVersion: "desc" }, take: 1,
            select: { id: true, contractNumber: true, templateVersion: true, documentHashSha256: true, template: { select: { status: true, sourceMarkup: true } }, acceptances: { where: { kind: "CLIENT" }, take: 1, select: { acceptedAt: true, acceptedByUserId: true, documentHashSha256: true, templateVersion: true } } },
          },
        },
      },
    },
  });
  const request = payment?.rightsRequest;
  const offer = publicationLicenseOffer.PUBLICATION_LICENSE;
  const document = request?.documents[0];
  const acceptance = document?.acceptances[0];
  if (
    !payment || !request || payment.orderId || payment.shopOrderId
    || payment.provider !== event.provider
    || payment.mode !== (event.livemode ? "LIVE" : "TEST")
    || payment.amountCents !== offer.priceCents || payment.currency !== offer.currency
    || payment.pricingVersion !== offer.pricingVersion
    || !["READY_FOR_PAYMENT", "PAID_WAITING_WITHDRAWAL_PERIOD", "ACTIVE", "REQUIRES_REVIEW"].includes(request.status)
    || request.type !== "PUBLICATION_LICENSE" || request.requestedPriceCents !== offer.priceCents
    || request.order.status !== "DELIVERED" || !request.order.deliveredAt || !request.order.assets[0]
    || !document || document.templateVersion !== offer.contractTemplateVersion || document.template.status !== "APPROVED"
    || !isPublicationLicenseV3CanonicalSource(document.template.sourceMarkup)
    || !acceptance || acceptance.acceptedByUserId !== request.userId
    || acceptance.documentHashSha256 !== document.documentHashSha256
    || acceptance.templateVersion !== document.templateVersion
  ) throw new Error("RIGHTS_FINALIZATION_PRECONDITION_FAILED");

  const existingWinner = await tx.rightsPaymentWinner.findUnique({ where: { rightsRequestId: request.id } });
  if (existingWinner && existingWinner.paymentId !== payment.id) return { otherWinner: existingWinner.paymentId } as const;

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: "SUCCEEDED",
      paidAt: payment.paidAt ?? event.occurredAt,
      providerCheckoutId: event.providerCheckoutId ?? payment.providerCheckoutId,
      providerPaymentId: event.providerPaymentId ?? payment.providerPaymentId,
      paymentMethod: event.paymentMethod ?? (event.provider === "PAYPAL" ? "PAYPAL" : undefined),
      failureCode: null,
    },
  });
  await tx.rightsPaymentWinner.upsert({
    where: { rightsRequestId: request.id },
    update: {},
    create: { rightsRequestId: request.id, paymentId: payment.id, selectedAt: event.occurredAt },
  });
  await tx.payment.updateMany({
    where: { rightsRequestId: request.id, id: { not: payment.id }, status: { in: ["CREATED", "PENDING"] } },
    data: { status: "CANCELED", canceledAt: event.occurredAt, failureCode: "RIGHTS_PAID_BY_OTHER_PROVIDER" },
  });
  const { invoice } = await issueInvoiceForPayment(tx, payment.id);
  const paidAt = payment.paidAt ?? event.occurredAt;
  const withdrawalEnd = withdrawalEndsAt(paidAt);
  let license = await tx.rightsLicense.findUnique({ where: { rightsRequestId: request.id } });
  if (!license) {
    license = await tx.rightsLicense.create({
      data: {
        licenseNumber: await nextLicenseNumber(tx, paidAt),
        rightsRequestId: request.id,
        paymentId: payment.id,
        invoiceId: invoice.id,
        contractDocumentId: document.id,
        status: "PAID_WAITING_WITHDRAWAL_PERIOD",
        contractVersion: document.templateVersion,
        termsVersion: publicationLicenseTerms.version,
        termsHashSha256: document.documentHashSha256,
        acceptedAt: acceptance.acceptedAt,
        paidAt,
        withdrawalEndsAt: withdrawalEnd,
      },
    });
  }
  await tx.rightsRequest.update({ where: { id: request.id }, data: { status: "PAID_WAITING_WITHDRAWAL_PERIOD" } });
  await tx.rightsRequestEvent.upsert({
    where: { idempotencyKey: `rights:${request.id}:payment:${payment.id}:confirmed` }, update: {},
    create: { rightsRequestId: request.id, type: "PAYMENT_CONFIRMED", idempotencyKey: `rights:${request.id}:payment:${payment.id}:confirmed`, note: "Paiement confirmé ; licence sans effet pendant le délai de rétractation." },
  });
  await enqueueRightsNotification(tx, {
    rightsRequestId: request.id, kind: "CUSTOMER_RIGHTS_PAYMENT_CONFIRMED", recipient: request.owner.email,
    idempotencyKey: `rights:${request.id}:payment-confirmed:client`, invoiceNumber: invoice.invoiceNumber,
    contractNumber: document.contractNumber, licenseNumber: license.licenseNumber, withdrawalEndsAt: withdrawalEnd,
  });
  await enqueueRightsNotification(tx, {
    rightsRequestId: request.id, kind: "OWNER_RIGHTS_PAYMENT_CONFIRMED", recipient: process.env.EMAIL_OWNER_RECIPIENT?.trim().toLowerCase() || null,
    idempotencyKey: `rights:${request.id}:payment-confirmed:owner`, invoiceNumber: invoice.invoiceNumber,
    contractNumber: document.contractNumber, licenseNumber: license.licenseNumber, withdrawalEndsAt: withdrawalEnd,
  });
  return { license, invoice } as const;
}

export function createRightsPaymentRepository(client: PrismaClient = prisma, expectedMode?: Mode) {
  return {
    async reserveAttempt(actorId: string, requestNumber: string, provider: Provider, mode: Mode): Promise<ReservedRightsPaymentAttempt> {
      assertDatabaseConfigured();
      if (!UUID.test(actorId) || !REQUEST_NUMBER.test(requestNumber) || (expectedMode && mode !== expectedMode)) throw new RightsPaymentError(400, "RIGHTS_REQUEST_NOT_PAYABLE");
      return transaction(client, async (tx) => {
        const identity = await tx.rightsRequest.findFirst({ where: { requestNumber, userId: actorId }, select: { id: true } });
        if (!identity) throw new RightsPaymentError(404, "RIGHTS_REQUEST_NOT_FOUND");
        await lock(tx, `request:${identity.id}`);
        const { request } = await eligibleRequest(tx, actorId, requestNumber);
        const active = await tx.payment.findFirst({
          where: { rightsRequestId: request.id, provider, status: { in: ["CREATED", "PENDING"] } },
          orderBy: { createdAt: "desc" },
        });
        if (active && (active.mode !== mode || active.amountCents !== 15_000 || active.currency !== "EUR" || active.pricingVersion !== publicationLicenseOffer.PUBLICATION_LICENSE.pricingVersion)) {
          throw new RightsPaymentError(409, "RIGHTS_PAYMENT_SNAPSHOT_CONFLICT");
        }
        const paymentId = active?.id ?? randomUUID();
        const idempotencyKey = active?.idempotencyKey ?? checkoutKey(provider, paymentId);
        if (!active) await tx.payment.create({ data: {
          id: paymentId, rightsRequestId: request.id, provider, mode, status: "CREATED",
          amountCents: 15_000, currency: "EUR", pricingVersion: publicationLicenseOffer.PUBLICATION_LICENSE.pricingVersion,
          idempotencyKey,
        } });
        return {
          rightsRequestId: request.id, requestNumber: request.requestNumber, orderId: request.orderId,
          orderNumber: request.order.orderNumber, workTitle: request.workTitle, paymentId, provider, mode,
          idempotencyKey, ...(active?.providerCheckoutId ? { providerCheckoutId: active.providerCheckoutId } : {}),
          amountCents: 15_000, currency: "EUR", pricingVersion: publicationLicenseOffer.PUBLICATION_LICENSE.pricingVersion,
        };
      });
    },

    async recordSession(paymentId: string, provider: Provider, session: HostedCheckoutSession) {
      assertDatabaseConfigured();
      return transaction(client, async (tx) => {
        await lock(tx, `payment:${paymentId}`);
        const payment = await tx.payment.findUnique({ where: { id: paymentId } });
        if (!payment?.rightsRequestId || payment.provider !== provider) throw new RightsPaymentError(409, "RIGHTS_PAYMENT_SESSION_CONFLICT");
        if (payment.providerCheckoutId && payment.providerCheckoutId !== session.id) throw new RightsPaymentError(409, "RIGHTS_PAYMENT_SESSION_CONFLICT");
        if (["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)) return;
        if (!["CREATED", "PENDING"].includes(payment.status)) throw new RightsPaymentError(409, "RIGHTS_PAYMENT_SESSION_CONFLICT");
        await tx.payment.update({ where: { id: payment.id }, data: { status: "PENDING", providerCheckoutId: session.id, ...(session.paymentIntentId ? { providerPaymentId: session.paymentIntentId } : {}) } });
      });
    },

    async reservePaypalCapture(actorId: string, requestNumber: string, providerOrderId: string, mode: Mode) {
      assertDatabaseConfigured();
      if (!providerOrderId || providerOrderId.length > 255 || (expectedMode && expectedMode !== mode)) throw new RightsPaymentError(400, "RIGHTS_REQUEST_NOT_PAYABLE");
      return transaction(client, async (tx) => {
        const identity = await tx.rightsRequest.findFirst({ where: { requestNumber, userId: actorId }, select: { id: true } });
        if (!identity) throw new RightsPaymentError(404, "RIGHTS_REQUEST_NOT_FOUND");
        await lock(tx, `request:${identity.id}`);
        const { request } = await eligibleRequest(tx, actorId, requestNumber);
        const payment = await tx.payment.findFirst({ where: { rightsRequestId: request.id, provider: "PAYPAL", mode, providerCheckoutId: providerOrderId, status: { in: ["CREATED", "PENDING"] } } });
        if (!payment) throw new RightsPaymentError(409, "RIGHTS_REQUEST_NOT_PAYABLE");
        return { paymentId: payment.id, providerOrderId, captureIdempotencyKey: `rights:${payment.id}:paypal:capture`, amountCents: 15_000 as const, currency: "EUR" as const };
      });
    },

    async reconcile(event: RightsProviderEvent): Promise<RightsPaymentResult> {
      assertDatabaseConfigured();
      const mode: Mode = event.livemode ? "LIVE" : "TEST";
      const mismatch = assertRightsProviderEvent(event, expectedMode ?? mode);
      try {
        return await transaction(client, async (tx) => {
          await lock(tx, `event:${event.provider}:${event.eventId}`);
          const duplicate = await tx.providerEvent.findUnique({ where: { provider_providerEventId: { provider: event.provider, providerEventId: event.eventId } } });
          if (duplicate) return { outcome: duplicate.outcome, duplicate: true, paid: false, waitingWithdrawal: false };
          await lock(tx, `payment:${event.paymentId}`);
          const payment = await tx.payment.findUnique({ where: { id: event.paymentId }, select: { id: true, rightsRequestId: true, provider: true, mode: true, status: true, providerCheckoutId: true, providerPaymentId: true } });
          if (!payment?.rightsRequestId || payment.provider !== event.provider || payment.mode !== mode || mismatch) {
            if (payment?.rightsRequestId) await tx.payment.update({ where: { id: payment.id }, data: { status: "REQUIRES_REVIEW", failureCode: mismatch ?? "RIGHTS_PROVIDER_PAYMENT_MISMATCH" } });
            if (payment) await receipt(tx, event, "REQUIRES_REVIEW");
            return { outcome: "REQUIRES_REVIEW", duplicate: false, paid: false, waitingWithdrawal: false, reviewCode: mismatch ?? "RIGHTS_PROVIDER_PAYMENT_MISMATCH" };
          }
          await lock(tx, `request:${payment.rightsRequestId}`);
          if (event.status === "APPROVED" || event.status === "PENDING") {
            await tx.payment.update({ where: { id: payment.id }, data: { status: "PENDING", providerCheckoutId: event.providerCheckoutId ?? payment.providerCheckoutId, providerPaymentId: event.providerPaymentId ?? payment.providerPaymentId } });
            await receipt(tx, event, "PROCESSED");
            return { outcome: "PROCESSED", duplicate: false, paid: false, waitingWithdrawal: false };
          }
          if (event.status === "FAILED") {
            if (![...paidStatuses].includes(payment.status as never)) await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failedAt: event.occurredAt, failureCode: "RIGHTS_PROVIDER_DECLINED" } });
            await receipt(tx, event, "PROCESSED");
            return { outcome: "PROCESSED", duplicate: false, paid: false, waitingWithdrawal: false };
          }
          const finalized = await finalizeSuccess(tx, payment.id, event);
          if ("otherWinner" in finalized) {
            await tx.payment.update({ where: { id: payment.id }, data: { status: "REQUIRES_REVIEW", providerPaymentId: event.providerPaymentId, paidAt: event.occurredAt, failureCode: "RIGHTS_OTHER_PAYMENT_ALREADY_WON" } });
            await receipt(tx, event, "REQUIRES_REVIEW");
            return { outcome: "REQUIRES_REVIEW", duplicate: false, paid: false, waitingWithdrawal: false, winningPaymentId: finalized.otherWinner, reviewCode: "RIGHTS_OTHER_PAYMENT_ALREADY_WON" };
          }
          await receipt(tx, event, "PROCESSED");
          return { outcome: "PROCESSED", duplicate: false, paid: true, waitingWithdrawal: true, winningPaymentId: payment.id };
        });
      } catch (error) {
        if (event.status !== "SUCCEEDED") throw error;
        return transaction(client, async (tx) => {
          await lock(tx, `event:${event.provider}:${event.eventId}`);
          const duplicate = await tx.providerEvent.findUnique({ where: { provider_providerEventId: { provider: event.provider, providerEventId: event.eventId } } });
          if (!duplicate) {
            const payment = await tx.payment.findUnique({ where: { id: event.paymentId } });
            if (payment?.rightsRequestId) {
              await lock(tx, `request:${payment.rightsRequestId}`);
              await tx.payment.update({ where: { id: payment.id }, data: { status: "REQUIRES_REVIEW", paidAt: event.occurredAt, providerCheckoutId: event.providerCheckoutId ?? payment.providerCheckoutId, providerPaymentId: event.providerPaymentId ?? payment.providerPaymentId, failureCode: "RIGHTS_LOCAL_FINALIZATION_FAILED" } });
              await tx.rightsRequest.update({ where: { id: payment.rightsRequestId }, data: { status: "REQUIRES_REVIEW" } });
              await tx.rightsRequestEvent.upsert({ where: { idempotencyKey: `rights:${payment.rightsRequestId}:payment:${payment.id}:review` }, update: {}, create: { rightsRequestId: payment.rightsRequestId, type: "PAYMENT_REQUIRES_REVIEW", idempotencyKey: `rights:${payment.rightsRequestId}:payment:${payment.id}:review`, note: "Preuve financière conservée ; finalisation locale à reprendre sans nouvel encaissement." } });
              await receipt(tx, event, "REQUIRES_REVIEW");
            }
          }
          return { outcome: "REQUIRES_REVIEW", duplicate: Boolean(duplicate), paid: false, waitingWithdrawal: false, reviewCode: "RIGHTS_LOCAL_FINALIZATION_FAILED" };
        });
      }
    },
  };
}

export async function activateDueRightsLicenses(now = new Date(), client: PrismaClient = prisma) {
  assertDatabaseConfigured();
  const candidates = await client.rightsLicense.findMany({ where: { status: "PAID_WAITING_WITHDRAWAL_PERIOD", withdrawalEndsAt: { lte: now } }, select: { id: true } });
  let activated = 0;
  for (const candidate of candidates) {
    const changed = await transaction(client, async (tx) => {
      const identity = await tx.rightsLicense.findUnique({ where: { id: candidate.id }, select: { rightsRequestId: true } });
      if (!identity) return false;
      await lock(tx, `request:${identity.rightsRequestId}`);
      const license = await tx.rightsLicense.findUnique({
        where: { id: candidate.id },
        include: {
          payment: { include: { refundAttempts: { where: { rightsWithdrawalId: { not: null }, status: { in: ["PROCESSING", "PENDING", "REQUIRES_REVIEW", "SUCCEEDED"] } }, select: { id: true }, take: 1 } } },
          request: { include: { owner: true, withdrawalRequest: { select: { status: true } } } },
          invoice: true,
          contractDocument: { include: { template: true, acceptances: { where: { kind: "CLIENT" }, orderBy: { acceptedAt: "desc" }, take: 1 } } },
        },
      });
      if (!license || license.status !== "PAID_WAITING_WITHDRAWAL_PERIOD" || license.withdrawalEndsAt > now) return false;
      if (license.payment.status === "REFUNDED" || license.payment.refundedAmountCents > 0 || license.request.status === "WITHDRAWN" || license.request.withdrawalRequest?.status === "COMPLETED") {
        await tx.rightsLicense.update({ where: { id: license.id }, data: { status: "WITHDRAWN", terminatedAt: now, terminationReason: "WITHDRAWAL_BEFORE_EFFECTIVE_DATE" } });
        return false;
      }
      const blockingWithdrawal = license.request.withdrawalRequest && license.request.withdrawalRequest.status !== "REJECTED";
      const contractAcceptance = license.contractDocument.acceptances[0];
      if (
        license.payment.status !== "SUCCEEDED"
        || license.payment.refundedAmountCents !== 0
        || license.payment.refundAttempts.length > 0
        || license.request.status !== "PAID_WAITING_WITHDRAWAL_PERIOD"
        || blockingWithdrawal
        || license.contractDocument.status !== "ADMIN_VALIDATED"
        || !license.contractDocument.retentionUntil
        || license.contractDocument.template.status !== "APPROVED"
        || !contractAcceptance
        || contractAcceptance.documentHashSha256 !== license.contractDocument.documentHashSha256
        || contractAcceptance.templateVersion !== license.contractDocument.templateVersion
      ) {
        await tx.rightsLicense.update({ where: { id: license.id }, data: { status: "REQUIRES_REVIEW" } });
        await tx.rightsRequest.update({ where: { id: license.rightsRequestId }, data: { status: "REQUIRES_REVIEW" } });
        return false;
      }
      const effectiveAt = license.withdrawalEndsAt;
      const expiresAt = licenseExpiresAt(effectiveAt);
      await tx.rightsLicense.update({ where: { id: license.id }, data: { status: "ACTIVE", effectiveAt, expiresAt, activatedAt: now } });
      await tx.rightsRequest.update({ where: { id: license.rightsRequestId }, data: { status: "ACTIVE" } });
      await tx.contractDocument.update({ where: { id: license.contractDocumentId }, data: { status: "ACTIVE", activatedAt: now } });
      await tx.rightsRequestEvent.upsert({ where: { idempotencyKey: `rights:${license.rightsRequestId}:license:${license.id}:active` }, update: {}, create: { rightsRequestId: license.rightsRequestId, type: "LICENSE_ACTIVATED", idempotencyKey: `rights:${license.rightsRequestId}:license:${license.id}:active`, note: "Licence activée après expiration complète du délai de rétractation." } });
      await enqueueRightsNotification(tx, { rightsRequestId: license.rightsRequestId, kind: "CUSTOMER_RIGHTS_LICENSE_ACTIVE", recipient: license.request.owner.email, idempotencyKey: `rights:${license.rightsRequestId}:license-active:client`, invoiceNumber: license.invoice.invoiceNumber, contractNumber: license.contractDocument.contractNumber, licenseNumber: license.licenseNumber, withdrawalEndsAt: license.withdrawalEndsAt, effectiveAt, expiresAt });
      return true;
    });
    if (changed) activated += 1;
  }
  return { scanned: candidates.length, activated };
}

/**
 * Completes only the local accounting/licence side from evidence that was
 * already persisted after a provider success. It deliberately performs no
 * Stripe or PayPal call and cannot reserve a new Payment.
 */
export async function resumeRightsPaymentFinalization(paymentId: string, client: PrismaClient = prisma) {
  assertDatabaseConfigured();
  if (!UUID.test(paymentId)) throw new RightsPaymentError(400, "RIGHTS_PAYMENT_RECONCILIATION_INVALID");
  return transaction(client, async (tx) => {
    await lock(tx, `payment:${paymentId}`);
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true, rightsRequestId: true, provider: true, mode: true, status: true,
        amountCents: true, currency: true, paidAt: true, providerCheckoutId: true,
        providerPaymentId: true, paymentMethod: true, failureCode: true,
      },
    });
    if (
      !payment?.rightsRequestId
      || payment.status !== "REQUIRES_REVIEW"
      || payment.failureCode !== "RIGHTS_LOCAL_FINALIZATION_FAILED"
      || !payment.paidAt
      || !payment.providerPaymentId
      || payment.amountCents !== publicationLicenseOffer.PUBLICATION_LICENSE.priceCents
      || payment.currency !== publicationLicenseOffer.PUBLICATION_LICENSE.currency
    ) throw new RightsPaymentError(409, "RIGHTS_PAYMENT_RECONCILIATION_INVALID");
    await lock(tx, `request:${payment.rightsRequestId}`);
    const proof = await tx.providerEvent.findFirst({
      where: { paymentId: payment.id, provider: payment.provider, outcome: "REQUIRES_REVIEW" },
      orderBy: { processedAt: "desc" },
    });
    if (!proof) throw new RightsPaymentError(409, "RIGHTS_PAYMENT_RECONCILIATION_PROOF_MISSING");
    const finalized = await finalizeSuccess(tx, payment.id, {
      eventId: proof.providerEventId,
      type: "RIGHTS.LOCAL.FINALIZATION.RECONCILIATION",
      provider: payment.provider,
      livemode: payment.mode === "LIVE",
      paymentId: payment.id,
      ...(payment.providerCheckoutId ? { providerCheckoutId: payment.providerCheckoutId } : {}),
      providerPaymentId: payment.providerPaymentId,
      amountCents: payment.amountCents,
      currency: payment.currency,
      status: "SUCCEEDED",
      occurredAt: payment.paidAt,
      ...(payment.paymentMethod ? { paymentMethod: payment.paymentMethod } : {}),
      evidenceConsistent: true,
    });
    if ("otherWinner" in finalized) throw new RightsPaymentError(409, "RIGHTS_OTHER_PAYMENT_ALREADY_WON");
    await tx.providerEvent.update({ where: { id: proof.id }, data: { outcome: "PROCESSED" } });
    return { outcome: "PROCESSED" as const, paymentId: payment.id, rightsRequestId: payment.rightsRequestId };
  });
}

export const rightsPaymentRepository = createRightsPaymentRepository();
