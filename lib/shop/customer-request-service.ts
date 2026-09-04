import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { issueCreditNoteForRefund } from "@/lib/billing/service";
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

async function locked<T>(client: PrismaClient, key: string, operation: (transaction: Transaction) => Promise<T>) {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
    return operation(transaction);
  });
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
  return locked(client, `shop-customer-request:${actor.id}:${input.orderNumber}:${input.type}`, async (transaction) => {
    const order = await transaction.shopOrder.findFirst({
      where: { orderNumber: input.orderNumber, userId: actor.id },
      include: { customerRequests: { where: { type: input.type, status: { in: ["REQUESTED", "APPROVED"] } } } },
    });
    if (!order) throw new ShopCustomerRequestError("ACCESS_DENIED");
    if (
      order.status !== "OPEN"
      || order.paymentStatus !== "PAID"
      || order.paymentReviewAt
      || order.fulfillmentStatus === "SHIPPED"
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
    const created = await transaction.shopOrderCustomerRequest.create({ data: {
      requestNumber: requestNumber(now),
      shopOrderId: order.id,
      userId: actor.id,
      type: input.type,
      reason: input.reason,
      requestedSnapshot: input.address ? { shippingAddress: input.address } : {},
      previousAddressHash: previousAddress ? shippingAddressFingerprint(previousAddress as ShopShippingAddress) : null,
      requestedAt: now,
    } });
    await enqueueShopCustomerRequestNotification(transaction, {
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
  const request = await transaction.shopOrderCustomerRequest.findUnique({ where: { requestNumber: requestNumberValue }, include: { shopOrder: true } });
  if (!request) throw new ShopCustomerRequestError("REQUEST_NOT_FOUND");
  if (request.status === "COMPLETED") return request;
  if (request.type !== "SHIPPING_ADDRESS_CORRECTION" || request.status !== "REQUESTED" || request.shopOrder.fulfillmentStatus === "SHIPPED") {
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
  providerPaymentId: string; attemptId: string; amountCents: number; idempotencyKey: string;
}>;

async function reserveCancellationRefund(transaction: Transaction, actor: Actor, requestNumberValue: string, comment: string, now: Date, expectedMode: "TEST" | "LIVE"): Promise<ReservedCancellation> {
  const request = await transaction.shopOrderCustomerRequest.findUnique({ where: { requestNumber: requestNumberValue }, include: { shopOrder: { include: { items: { include: { reservation: true } }, payments: true } }, refundAttempt: true } });
  if (!request) throw new ShopCustomerRequestError("REQUEST_NOT_FOUND");
  if (request.type !== "PAID_ORDER_CANCELLATION" || !["REQUESTED", "APPROVED"].includes(request.status) || request.shopOrder.fulfillmentStatus === "SHIPPED") {
    throw new ShopCustomerRequestError("ORDER_NOT_ELIGIBLE");
  }
  const payment = request.shopOrder.payments.filter((row) => row.mode === expectedMode && row.status === "SUCCEEDED");
  if (payment.length !== 1 || !payment[0]!.providerPaymentId || payment[0]!.refundedAmountCents !== 0 || request.refundAttempt) {
    throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
  }
  const winning = payment[0]!;
  const providerPaymentId = winning.providerPaymentId;
  if (!providerPaymentId) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
  const attemptId = randomUUID();
  const idempotencyKey = `shop-customer-request:${request.id}:provider-refund:v1`;
  await transaction.refundAttempt.create({ data: {
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
  return { requestId: request.id, requestNumber: request.requestNumber, shopOrderId: request.shopOrderId, paymentId: winning.id, provider: winning.provider, providerPaymentId, attemptId, amountCents: winning.amountCents, idempotencyKey };
}

async function applyCancellationEvidence(client: PrismaClient, reserved: ReservedCancellation, evidence: ShopRefundEvidence) {
  return locked(client, `shop-customer-request-refund:${reserved.requestId}`, async (transaction) => {
    const mismatch = evidence.provider !== reserved.provider || evidence.providerPaymentId !== reserved.providerPaymentId || evidence.amountCents !== reserved.amountCents || evidence.currency !== "EUR";
    if (mismatch) {
      await transaction.refundAttempt.update({ where: { id: reserved.attemptId }, data: { status: "REQUIRES_REVIEW", failureCode: "REFUND_EVIDENCE_MISMATCH" } });
      return "REQUIRES_REVIEW" as const;
    }
    if (evidence.status !== "SUCCEEDED") {
      await transaction.refundAttempt.update({ where: { id: reserved.attemptId }, data: { providerRefundId: evidence.providerRefundId, status: evidence.status, failureCode: evidence.status === "FAILED" ? "PROVIDER_REFUND_FAILED" : null } });
      await transaction.payment.update({ where: { id: reserved.paymentId }, data: { status: evidence.status === "FAILED" ? "SUCCEEDED" : "REFUND_PENDING" } });
      return evidence.status;
    }
    const request = await transaction.shopOrderCustomerRequest.findUniqueOrThrow({ where: { id: reserved.requestId }, include: { shopOrder: { include: { items: { include: { reservation: true } } } } } });
    await transaction.refundAttempt.update({ where: { id: reserved.attemptId }, data: { providerRefundId: evidence.providerRefundId, status: "SUCCEEDED", confirmedAt: evidence.occurredAt } });
    await transaction.payment.update({ where: { id: reserved.paymentId }, data: { status: "REFUNDED", refundedAmountCents: reserved.amountCents, refundedAt: evidence.occurredAt } });
    for (const item of request.shopOrder.items) {
      if (!item.inventoryTracked || item.reservation?.status !== "CONFIRMED") continue;
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shop-product:${item.productId}`})) IS NULL AS locked`;
      const key = `shop-customer-request:${request.id}:product:${item.productId}:restock:v1`;
      if (await transaction.productStockAdjustment.findUnique({ where: { idempotencyKey: key } })) continue;
      const product = await transaction.product.findUniqueOrThrow({ where: { id: item.productId }, select: { stock: true } });
      if (product.stock === null) throw new ShopCustomerRequestError("REFUND_REQUIRES_REVIEW");
      await transaction.product.update({ where: { id: item.productId }, data: { stock: product.stock + item.quantity, lockVersion: { increment: 1 } } });
      await transaction.productStockAdjustment.create({ data: {
        productId: item.productId,
        delta: item.quantity,
        stockBefore: product.stock,
        stockAfter: product.stock + item.quantity,
        reason: `Annulation Admin ${request.requestNumber}`,
        actorAdminId: request.decidedByUserId,
        shopCustomerRequestId: request.id,
        idempotencyKey: key,
      } });
    }
    await transaction.shopOrder.update({ where: { id: request.shopOrderId }, data: { status: "CANCELLED", paymentStatus: "CANCELLED", fulfillmentStatus: "CANCELLED", cancelledAt: evidence.occurredAt } });
    await issueCreditNoteForRefund(transaction, { refundAttemptId: reserved.attemptId, reasonCode: "SELLER_ERROR", reasonText: `Annulation ${request.requestNumber}` });
    await transaction.shopOrderCustomerRequest.update({ where: { id: request.id }, data: { status: "COMPLETED", completedAt: evidence.occurredAt } });
    await enqueueShopCustomerRequestNotification(transaction, { shopOrderId: request.shopOrderId, requestId: request.id, requestNumber: request.requestNumber, kind: "CUSTOMER_SHOP_CANCELLATION_APPROVED" });
    return "SUCCEEDED" as const;
  });
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
  if (decision === "REJECT") return locked(client, `shop-customer-request:${requestNumberValue}`, (transaction) => rejectRequest(transaction, actor, requestNumberValue, comment, now));
  const kind = await client.shopOrderCustomerRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    select: { type: true, status: true, refundAttempt: { select: { status: true } } },
  });
  if (!kind) throw new ShopCustomerRequestError("REQUEST_NOT_FOUND");
  if (kind.type === "SHIPPING_ADDRESS_CORRECTION") return locked(client, `shop-customer-request:${requestNumberValue}`, (transaction) => approveAddress(transaction, actor, requestNumberValue, comment, now));
  if (kind.status === "COMPLETED" && kind.refundAttempt?.status === "SUCCEEDED") return "SUCCEEDED" as const;
  if (kind.refundAttempt) {
    return kind.refundAttempt.status === "FAILED" ? "FAILED" as const : "REQUIRES_REVIEW" as const;
  }
  const expectedMode = gateway ? "TEST" as const : shopRefundPaymentMode();
  const activeGateway = gateway ?? createConfiguredShopRefundGateway();
  const reserved = await locked(client, `shop-customer-request:${requestNumberValue}`, (transaction) => reserveCancellationRefund(transaction, actor, requestNumberValue, comment, now, expectedMode));
  try {
    const evidence = await activeGateway.request({ attemptId: reserved.attemptId, paymentId: reserved.paymentId, provider: reserved.provider, providerPaymentId: reserved.providerPaymentId, amountCents: reserved.amountCents, idempotencyKey: reserved.idempotencyKey });
    return applyCancellationEvidence(client, reserved, evidence);
  } catch (error) {
    if (error instanceof ShopRefundGatewayError && error.code === "AMBIGUOUS") {
      await client.refundAttempt.update({ where: { id: reserved.attemptId }, data: { status: "REQUIRES_REVIEW", failureCode: "AMBIGUOUS_PROVIDER_ACCEPTANCE" } });
      return "REQUIRES_REVIEW" as const;
    }
    if (error instanceof ShopRefundGatewayError && error.code === "FAILED") {
      await locked(client, `shop-customer-request-refund:${reserved.requestId}`, async (transaction) => {
        await transaction.refundAttempt.update({
          where: { id: reserved.attemptId },
          data: { status: "FAILED", failureCode: "REFUND_PROVIDER_REJECTED" },
        });
        await transaction.payment.update({ where: { id: reserved.paymentId }, data: { status: "SUCCEEDED" } });
      });
      return "FAILED" as const;
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
