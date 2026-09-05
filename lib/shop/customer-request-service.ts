import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { enqueueShopCustomerRequestNotification } from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { ShopCustomerRequestError, shippingAddressFingerprint } from "@/lib/shop/customer-request-domain";
import {
  createConfiguredShopRefundGateway,
  ShopRefundGatewayError,
  shopRefundPaymentMode,
  type ShopRefundEvidence,
  type ShopRefundGateway,
} from "@/lib/shop/after-sales-service";
import { assertShopAfterSalesEnabled } from "@/lib/shop/after-sales-config";
import type { ShopShippingAddress } from "@/lib/shop/order-domain";
import {
  findShopCancellationBarrier,
  findShopReturnDispositionBarrier,
  findUnresolvedShopShippingIntent,
  hasValidShopCancellationInventoryReservations,
  lockShopOrderForMutation,
  lockShopRefundCapacity,
} from "@/lib/shop/order-coordination";
import {
  hasCompatibleShopRefundSourceInvoice,
  persistShopRefundFinalizationReview,
} from "@/lib/shop/refund-accounting-safety";
import { applyShopCustomerCancellationEvidence } from "@/lib/shop/refund-finalization-service";

type Transaction = Prisma.TransactionClient;
type Actor = Readonly<{ id: string; role: "MEMBER" | "CUSTOMER" | "ADMIN"; status: string; emailVerified: boolean }>;

function assertMember(actor: Actor) {
  if (!actor.id || !["MEMBER", "CUSTOMER"].includes(actor.role) || actor.status !== "ACTIVE" || !actor.emailVerified) throw new ShopCustomerRequestError("ACCESS_DENIED");
}

function assertAdmin(actor: Actor) {
  if (!actor.id || actor.role !== "ADMIN" || actor.status !== "ACTIVE" || !actor.emailVerified) throw new ShopCustomerRequestError("ACCESS_DENIED");
}

function requestNumber(now: Date) {
  return `LNX-REQ-${now.getUTCFullYear()}-${randomBytes(6).toString("hex").toUpperCase()}`;
}

async function transaction<T>(client: PrismaClient, operation: (transaction: Transaction) => Promise<T>) {
  let lastError: unknown;
  for (let retry = 0; retry < 3; retry += 1) {
    try {
      return await client.$transaction(operation, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code !== "P2034" && code !== "P2002") throw error;
    }
  }
  throw lastError;
}

async function lockOrderOrThrow(transactionClient: Transaction, shopOrderId: string) {
  if (!await lockShopOrderForMutation(transactionClient, shopOrderId)) {
    throw new ShopCustomerRequestError("REQUEST_NOT_FOUND");
  }
}

export async function createShopCustomerRequest(
  actor: Actor,
  input: Readonly<{ orderNumber: string; type: "PAID_ORDER_CANCELLATION" | "SHIPPING_ADDRESS_CORRECTION"; reason: string; address: ShopShippingAddress | null }>,
  now = new Date(),
  client: PrismaClient = prisma,
) {
  assertMember(actor);
  if (client === prisma) {
    assertDatabaseConfigured();
    assertShopAfterSalesEnabled();
  }
  return transaction(client, async (transactionClient) => {
    const identity = await transactionClient.shopOrder.findFirst({
      where: { orderNumber: input.orderNumber, userId: actor.id },
      select: { id: true },
    });
    if (!identity) throw new ShopCustomerRequestError("ACCESS_DENIED");
    await lockOrderOrThrow(transactionClient, identity.id);
    const order = await transactionClient.shopOrder.findFirst({
      where: { orderNumber: input.orderNumber, userId: actor.id },
      include: { customerRequests: { where: { type: input.type, status: { in: ["REQUESTED", "APPROVED"] } } } },
    });
    if (!order) throw new ShopCustomerRequestError("ACCESS_DENIED");
    const cancellationBarrier = await transactionClient.refundAttempt.findFirst({
      where: {
        payment: { shopOrderId: order.id },
        shopCustomerRequest: { is: { type: "PAID_ORDER_CANCELLATION", shopOrderId: order.id } },
        status: { in: ["PROCESSING", "PENDING", "SUCCEEDED", "REQUIRES_REVIEW"] },
      },
      select: { id: true },
    });
    if (
      order.status !== "OPEN"
      || order.paymentStatus !== "PAID"
      || order.paymentReviewAt
      || order.fulfillmentStatus === "SHIPPED"
      || cancellationBarrier
      || order.customerRequests.length
      || (input.type === "SHIPPING_ADDRESS_CORRECTION" && (!order.shippingRequired || !input.address))
      || (input.type === "PAID_ORDER_CANCELLATION" && input.address)
    ) throw new ShopCustomerRequestError("ORDER_NOT_ELIGIBLE");
    const previousAddress = order.shippingRequired ? {
      firstName: order.shippingFirstName,
      lastName: order.shippingLastName,
      addressLine1: order.shippingAddressLine1,
      addressLine2: order.shippingAddressLine2,
      postalCode: order.shippingPostalCode,
      city: order.shippingCity,
      countryCode: order.shippingCountryCode,
    } : null;
    const created = await transactionClient.shopOrderCustomerRequest.create({ data: {
      requestNumber: requestNumber(now),
      shopOrderId: order.id,
      userId: actor.id,
      type: input.type,
      reason: input.reason,
      requestedSnapshot: input.address ? { shippingAddress: input.address } : {},
      previousAddressHash: previousAddress ? shippingAddressFingerprint(previousAddress as ShopShippingAddress) : null,
      requestedAt: now,
    } });
    await enqueueShopCustomerRequestNotification(transactionClient, {
      shopOrderId: order.id,
      requestId: created.id,
      requestNumber: created.requestNumber,
      kind: input.type === "PAID_ORDER_CANCELLATION"
        ? "OWNER_SHOP_CANCELLATION_REQUESTED"
        : "OWNER_SHOP_ADDRESS_CORRECTION_REQUESTED",
    });
    return created;
  });
}

async function rejectRequest(transaction: Transaction, actor: Actor, requestNumberValue: string, comment: string, now: Date) {
  const identity = await transaction.shopOrderCustomerRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    select: { shopOrderId: true },
  });
  if (!identity) throw new ShopCustomerRequestError("REQUEST_NOT_FOUND");
  await lockOrderOrThrow(transaction, identity.shopOrderId);
  const request = await transaction.shopOrderCustomerRequest.findUnique({ where: { requestNumber: requestNumberValue } });
  if (!request) throw new ShopCustomerRequestError("REQUEST_NOT_FOUND");
  if (request.status === "REJECTED") return request;
  if (request.status !== "REQUESTED") throw new ShopCustomerRequestError("ORDER_NOT_ELIGIBLE");
  const updated = await transaction.shopOrderCustomerRequest.update({ where: { id: request.id }, data: {
    status: "REJECTED", decidedByUserId: actor.id, decisionComment: comment, decidedAt: now, completedAt: now,
  } });
  await enqueueShopCustomerRequestNotification(transaction, {
    shopOrderId: request.shopOrderId,
    requestId: request.id,
    requestNumber: request.requestNumber,
    kind: request.type === "PAID_ORDER_CANCELLATION"
      ? "CUSTOMER_SHOP_CANCELLATION_REJECTED"
      : "CUSTOMER_SHOP_ADDRESS_CORRECTION_REJECTED",
  });
  return updated;
}

async function approveAddress(transaction: Transaction, actor: Actor, requestNumberValue: string, comment: string, now: Date) {
  const identity = await transaction.shopOrderCustomerRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    select: { shopOrderId: true },
  });
  if (!identity) throw new ShopCustomerRequestError("REQUEST_NOT_FOUND");
  await lockOrderOrThrow(transaction, identity.shopOrderId);
  const request = await transaction.shopOrderCustomerRequest.findUnique({ where: { requestNumber: requestNumberValue }, include: { shopOrder: true } });
  if (!request) throw new ShopCustomerRequestError("REQUEST_NOT_FOUND");
  if (request.status === "COMPLETED") return request;
  if (
    request.type !== "SHIPPING_ADDRESS_CORRECTION"
    || request.status !== "REQUESTED"
    || request.shopOrder.status !== "OPEN"
    || request.shopOrder.paymentStatus !== "PAID"
    || request.shopOrder.paymentReviewAt !== null
    || request.shopOrder.fulfillmentStatus === "SHIPPED"
    || await findShopCancellationBarrier(transaction, request.shopOrderId)
  ) {
    throw new ShopCustomerRequestError("ORDER_NOT_ELIGIBLE");
  }
  const snapshot = request.requestedSnapshot as { shippingAddress?: ShopShippingAddress };
  const address = snapshot.shippingAddress;
  if (!address || address.countryCode !== "FR") throw new ShopCustomerRequestError("ORDER_NOT_ELIGIBLE");
  await transaction.shopOrder.update({ where: { id: request.shopOrderId }, data: {
    shippingFirstName: address.firstName,
    shippingLastName: address.lastName,
    shippingAddressLine1: address.addressLine1,
    shippingAddressLine2: address.addressLine2,
    shippingPostalCode: address.postalCode,
    shippingCity: address.city,
    shippingCountryCode: "FR",
  } });
  const updated = await transaction.shopOrderCustomerRequest.update({ where: { id: request.id }, data: {
    status: "COMPLETED", decidedByUserId: actor.id, decisionComment: comment, decidedAt: now, completedAt: now,
  } });
  await enqueueShopCustomerRequestNotification(transaction, {
    shopOrderId: request.shopOrderId,
    requestId: request.id,
    requestNumber: request.requestNumber,
    kind: "CUSTOMER_SHOP_ADDRESS_CORRECTION_APPROVED",
  });
  return updated;
}

type ReservedCancellation = Readonly<{
  requestId: string; requestNumber: string; shopOrderId: string; paymentId: string; provider: "STRIPE" | "PAYPAL";
  providerPaymentId: string; providerRefundId: string | null; attemptId: string; amountCents: number;
  idempotencyKey: string; status: "PROCESSING" | "PENDING" | "SUCCEEDED" | "FAILED" | "REQUIRES_REVIEW";
  reused: boolean;
}>;

async function reserveCancellationRefund(transaction: Transaction, actor: Actor, requestNumberValue: string, comment: string, now: Date, expectedMode: "TEST" | "LIVE"): Promise<ReservedCancellation> {
  const identity = await transaction.shopOrderCustomerRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    select: { shopOrderId: true },
  });
  if (!identity) throw new ShopCustomerRequestError("REQUEST_NOT_FOUND");
  await lockOrderOrThrow(transaction, identity.shopOrderId);

  const request = await transaction.shopOrderCustomerRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    include: {
      shopOrder: {
        include: {
          items: { include: { reservation: true } },
          payments: { include: { invoice: true } },
        },
      },
      refundAttempt: { include: { payment: { include: { invoice: true } } } },
    },
  });
  if (!request) throw new ShopCustomerRequestError("REQUEST_NOT_FOUND");
  if (request.type !== "PAID_ORDER_CANCELLATION") {
    throw new ShopCustomerRequestError("ORDER_NOT_ELIGIBLE");
  }
  if (request.refundAttempt) {
    const attempt = request.refundAttempt;
    const payment = attempt.payment;
    if (
      payment.mode !== expectedMode
      || payment.provider !== attempt.provider
      || !payment.providerPaymentId
      || !hasCompatibleShopRefundSourceInvoice(payment, request.shopOrderId)
    ) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
    return {
      requestId: request.id,
      requestNumber: request.requestNumber,
      shopOrderId: request.shopOrderId,
      paymentId: payment.id,
      provider: attempt.provider,
      providerPaymentId: payment.providerPaymentId,
      providerRefundId: attempt.providerRefundId,
      attemptId: attempt.id,
      amountCents: attempt.amountCents,
      idempotencyKey: attempt.providerIdempotencyKey,
      status: attempt.status,
      reused: true,
    };
  }
  if (
    request.status !== "REQUESTED"
    || request.shopOrder.status !== "OPEN"
    || request.shopOrder.paymentStatus !== "PAID"
    || request.shopOrder.paymentReviewAt !== null
    || request.shopOrder.fulfillmentStatus === "SHIPPED"
    || request.shopOrder.shippedAt !== null
  ) throw new ShopCustomerRequestError("ORDER_NOT_ELIGIBLE");
  if (
    request.shopOrder.trackingRevision !== 0
    || request.shopOrder.shippingCarrier !== null
    || request.shopOrder.trackingNumber !== null
    || request.shopOrder.trackingUrl !== null
    || request.shopOrder.trackingSource !== null
    || request.shopOrder.trackingRecordedAt !== null
    || await findUnresolvedShopShippingIntent(transaction, request.shopOrderId)
  ) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
  if (
    await findShopReturnDispositionBarrier(transaction, request.shopOrderId)
    || !hasValidShopCancellationInventoryReservations(request.shopOrder.items)
  ) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");

  const candidates = request.shopOrder.payments.filter((row) =>
    row.mode === expectedMode
    && ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"].includes(row.status));
  if (candidates.length !== 1) {
    throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
  }
  await lockShopRefundCapacity(transaction, candidates[0]!.id);
  const winning = await transaction.payment.findUnique({
    where: { id: candidates[0]!.id },
    include: { invoice: true },
  });
  if (
    !winning
    || winning.shopOrderId !== request.shopOrderId
    || winning.mode !== expectedMode
    || !["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"].includes(winning.status)
    || !winning.providerPaymentId
    || winning.currency !== "EUR"
    || winning.amountCents !== request.shopOrder.totalCents
  ) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
  if (!hasCompatibleShopRefundSourceInvoice(winning, request.shopOrderId)) {
    throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
  }
  const active = await transaction.refundAttempt.aggregate({
    where: {
      paymentId: winning.id,
      status: { in: ["PROCESSING", "PENDING", "REQUIRES_REVIEW"] },
    },
    _sum: { amountCents: true },
  });
  const available = winning.amountCents
    - winning.refundedAmountCents
    - (active._sum.amountCents ?? 0);
  if (
    winning.refundedAmountCents !== 0
    || active._sum.amountCents
    || available !== request.shopOrder.totalCents
  ) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
  const providerPaymentId = winning.providerPaymentId;
  const attemptId = randomUUID();
  const idempotencyKey = `shop-customer-request:${request.id}:provider-refund:v1`;
  const attempt = await transaction.refundAttempt.create({ data: {
    id: attemptId,
    paymentId: winning.id,
    provider: winning.provider,
    source: "ADMIN",
    amountCents: winning.amountCents,
    currency: "EUR",
    requestedByUserId: actor.id,
    shopCustomerRequestId: request.id,
    localIdempotencyKey: `shop-customer-request:${request.id}:refund:v1`,
    providerIdempotencyKey: idempotencyKey,
    status: "PROCESSING",
    attempts: 1,
    lastAttemptAt: now,
  } });
  await transaction.payment.update({ where: { id: winning.id }, data: { status: "REFUND_PENDING" } });
  await transaction.shopOrderCustomerRequest.update({ where: { id: request.id }, data: {
    status: "APPROVED", decidedByUserId: actor.id, decisionComment: comment, decidedAt: now,
  } });
  await transaction.paymentAuditEvent.create({
    data: {
      paymentId: winning.id,
      refundAttemptId: attempt.id,
      actorUserId: actor.id,
      actorRole: "ADMIN",
      provider: winning.provider,
      action: "REFUND_REQUESTED",
      amountCents: attempt.amountCents,
      result: "PENDING",
    },
  });
  return {
    requestId: request.id,
    requestNumber: request.requestNumber,
    shopOrderId: request.shopOrderId,
    paymentId: winning.id,
    provider: winning.provider,
    providerPaymentId,
    providerRefundId: null,
    attemptId,
    amountCents: winning.amountCents,
    idempotencyKey,
    status: "PROCESSING",
    reused: false,
  };
}

async function markCancellationAmbiguous(client: PrismaClient, attemptId: string) {
  return transaction(client, async (transactionClient) => {
    const identity = await transactionClient.refundAttempt.findUnique({
      where: { id: attemptId },
      select: { payment: { select: { shopOrderId: true } } },
    });
    if (!identity?.payment.shopOrderId) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
    await lockOrderOrThrow(transactionClient, identity.payment.shopOrderId);
    const attempt = await transactionClient.refundAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
    if (attempt.status === "SUCCEEDED" || attempt.status === "FAILED") return attempt.status;
    await transactionClient.refundAttempt.update({
      where: { id: attempt.id },
      data: { status: "REQUIRES_REVIEW", failureCode: "AMBIGUOUS_PROVIDER_ACCEPTANCE" },
    });
    await transactionClient.payment.update({
      where: { id: attempt.paymentId },
      data: { status: "REFUND_PENDING" },
    });
    const audit = await transactionClient.paymentAuditEvent.findFirst({
      where: { refundAttemptId: attempt.id, action: "REFUND_RECONCILIATION_REQUIRED" },
      select: { id: true },
    });
    if (!audit) {
      await transactionClient.paymentAuditEvent.create({ data: {
        paymentId: attempt.paymentId,
        refundAttemptId: attempt.id,
        provider: attempt.provider,
        action: "REFUND_RECONCILIATION_REQUIRED",
        amountCents: attempt.amountCents,
        result: "REQUIRES_REVIEW",
      } });
    }
    return "REQUIRES_REVIEW" as const;
  });
}

async function markCancellationCertainlyFailed(client: PrismaClient, attemptId: string) {
  return transaction(client, async (transactionClient) => {
    const identity = await transactionClient.refundAttempt.findUnique({
      where: { id: attemptId },
      select: { payment: { select: { shopOrderId: true } } },
    });
    if (!identity?.payment.shopOrderId) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
    await lockOrderOrThrow(transactionClient, identity.payment.shopOrderId);
    const attempt = await transactionClient.refundAttempt.findUnique({
      where: { id: attemptId },
      include: { payment: true },
    });
    if (!attempt) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
    if (attempt.status === "SUCCEEDED" || attempt.status === "FAILED") return attempt.status;
    if (
      attempt.status !== "PROCESSING"
      || attempt.providerRefundId !== null
      || attempt.confirmedAt !== null
    ) {
      await markCancellationReviewInTransaction(transactionClient, attempt, "REFUND_STATUS_CONFLICT");
      return "REQUIRES_REVIEW" as const;
    }
    await lockShopRefundCapacity(transactionClient, attempt.paymentId);
    await transactionClient.refundAttempt.update({
      where: { id: attempt.id },
      data: { status: "FAILED", failureCode: "REFUND_PROVIDER_REJECTED" },
    });
    const confirmed = await transactionClient.refundAttempt.aggregate({
      where: { paymentId: attempt.paymentId, status: "SUCCEEDED" },
      _sum: { amountCents: true },
    });
    const confirmedCents = confirmed._sum.amountCents ?? 0;
    const unresolved = await transactionClient.refundAttempt.count({
      where: {
        paymentId: attempt.paymentId,
        status: { in: ["PROCESSING", "PENDING", "REQUIRES_REVIEW"] },
      },
    });
    await transactionClient.payment.update({
      where: { id: attempt.paymentId },
      data: {
        status: unresolved > 0
          ? "REFUND_PENDING"
          : confirmedCents === 0
            ? "SUCCEEDED"
            : confirmedCents === attempt.payment.amountCents
              ? "REFUNDED"
              : "PARTIALLY_REFUNDED",
        refundedAmountCents: confirmedCents,
      },
    });
    const audit = await transactionClient.paymentAuditEvent.findFirst({
      where: { refundAttemptId: attempt.id, action: "REFUND_FAILED" },
      select: { id: true },
    });
    if (!audit) {
      await transactionClient.paymentAuditEvent.create({ data: {
        paymentId: attempt.paymentId,
        refundAttemptId: attempt.id,
        provider: attempt.provider,
        action: "REFUND_FAILED",
        amountCents: attempt.amountCents,
        result: "FAILED",
      } });
    }
    return "FAILED" as const;
  });
}

async function markCancellationReviewInTransaction(
  transactionClient: Transaction,
  attempt: Readonly<{ id: string; paymentId: string; provider: "STRIPE" | "PAYPAL"; amountCents: number; status: string }>,
  failureCode: string,
) {
  if (attempt.status !== "SUCCEEDED") {
    await transactionClient.refundAttempt.update({
      where: { id: attempt.id },
      data: { status: "REQUIRES_REVIEW", failureCode },
    });
    await transactionClient.payment.update({
      where: { id: attempt.paymentId },
      data: { status: "REFUND_PENDING" },
    });
    const audit = await transactionClient.paymentAuditEvent.findFirst({
      where: { refundAttemptId: attempt.id, action: "REFUND_RECONCILIATION_REQUIRED" },
      select: { id: true },
    });
    if (!audit) await transactionClient.paymentAuditEvent.create({ data: {
      paymentId: attempt.paymentId,
      refundAttemptId: attempt.id,
      provider: attempt.provider,
      action: "REFUND_RECONCILIATION_REQUIRED",
      amountCents: attempt.amountCents,
      result: "REQUIRES_REVIEW",
    } });
  }
}

export async function decideShopCustomerRequest(
  actor: Actor,
  requestNumberValue: string,
  decision: "APPROVE" | "REJECT",
  comment: string,
  gateway?: ShopRefundGateway,
  now = new Date(),
  client: PrismaClient = prisma,
) {
  assertAdmin(actor);
  if (client === prisma) {
    assertDatabaseConfigured();
    assertShopAfterSalesEnabled();
  }
  if (decision === "REJECT") return transaction(client, (transactionClient) => rejectRequest(transactionClient, actor, requestNumberValue, comment, now));
  const kind = await client.shopOrderCustomerRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    select: { type: true, status: true, refundAttempt: { select: { status: true } } },
  });
  if (!kind) throw new ShopCustomerRequestError("REQUEST_NOT_FOUND");
  if (kind.type === "SHIPPING_ADDRESS_CORRECTION") return transaction(client, (transactionClient) => approveAddress(transactionClient, actor, requestNumberValue, comment, now));
  const expectedMode = gateway ? "TEST" as const : shopRefundPaymentMode();
  const activeGateway = gateway ?? createConfiguredShopRefundGateway();
  const reserved = await transaction(client, (transactionClient) => reserveCancellationRefund(transactionClient, actor, requestNumberValue, comment, now, expectedMode));
  if (reserved.reused) {
    if (reserved.status === "SUCCEEDED" || reserved.status === "FAILED") return reserved.status;
    return reserved.status === "REQUIRES_REVIEW" ? "REQUIRES_REVIEW" as const : "PENDING" as const;
  }
  let evidence: ShopRefundEvidence | undefined;
  try {
    evidence = await activeGateway.request({ attemptId: reserved.attemptId, paymentId: reserved.paymentId, provider: reserved.provider, providerPaymentId: reserved.providerPaymentId, amountCents: reserved.amountCents, idempotencyKey: reserved.idempotencyKey });
    return await applyShopCustomerCancellationEvidence(client, reserved.attemptId, evidence);
  } catch (error) {
    if (error instanceof ShopRefundGatewayError && error.code === "AMBIGUOUS") {
      return markCancellationAmbiguous(client, reserved.attemptId);
    }
    if (error instanceof ShopRefundGatewayError && error.code === "FAILED") {
      return markCancellationCertainlyFailed(client, reserved.attemptId);
    }
    if (evidence) {
      return persistShopRefundFinalizationReview(client, reserved.attemptId, evidence);
    }
    throw error;
  }
}

export async function reconcileShopCustomerRequestRefund(
  actor: Actor,
  requestNumberValue: string,
  gateway?: ShopRefundGateway,
  client: PrismaClient = prisma,
) {
  assertAdmin(actor);
  if (client === prisma) {
    assertDatabaseConfigured();
    assertShopAfterSalesEnabled();
  }
  const expectedMode = gateway ? "TEST" as const : shopRefundPaymentMode();
  const request = await client.shopOrderCustomerRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    include: { refundAttempt: { include: { payment: true } } },
  });
  const attempt = request?.refundAttempt;
  if (
    !request
    || request.type !== "PAID_ORDER_CANCELLATION"
    || !attempt?.providerRefundId
    || !attempt.payment.providerPaymentId
    || attempt.payment.mode !== expectedMode
    || attempt.provider !== attempt.payment.provider
  ) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
  const activeGateway = gateway ?? createConfiguredShopRefundGateway();
  let evidence: ShopRefundEvidence | undefined;
  try {
    evidence = await activeGateway.retrieve({
      attemptId: attempt.id,
      paymentId: attempt.paymentId,
      provider: attempt.provider,
      providerPaymentId: attempt.payment.providerPaymentId,
      providerRefundId: attempt.providerRefundId,
      amountCents: attempt.amountCents,
      idempotencyKey: attempt.providerIdempotencyKey,
    });
    return await applyShopCustomerCancellationEvidence(client, attempt.id, evidence);
  } catch (error) {
    if (error instanceof ShopRefundGatewayError && error.code === "AMBIGUOUS") {
      return markCancellationAmbiguous(client, attempt.id);
    }
    if (error instanceof ShopRefundGatewayError && error.code === "FAILED") {
      return markCancellationCertainlyFailed(client, attempt.id);
    }
    if (evidence) {
      return persistShopRefundFinalizationReview(client, attempt.id, evidence);
    }
    throw error;
  }
}

export async function listMemberShopCustomerRequests(userId: string, shopOrderId: string, client: PrismaClient = prisma) {
  return client.shopOrderCustomerRequest.findMany({ where: { userId, shopOrderId }, orderBy: [{ requestedAt: "desc" }, { id: "desc" }] });
}

export async function listAdminShopCustomerRequests(shopOrderId?: string, client: PrismaClient = prisma) {
  return client.shopOrderCustomerRequest.findMany({ where: shopOrderId ? { shopOrderId } : undefined, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], take: 200 });
}
