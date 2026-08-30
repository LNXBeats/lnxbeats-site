import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { issueCreditNoteForRefund } from "@/lib/billing/service";
import { enqueueShopAfterSalesNotification } from "@/lib/notifications/service";
import { assertShopAfterSalesQaEnabled } from "@/lib/shop/after-sales-config";
import {
  assertTransition,
  calculateShopReturnRefund,
  ShopAfterSalesError,
  type ShopReturnInspectionCondition,
  type ShopReturnRestockDecision,
  type ShopReturnType,
} from "@/lib/shop/after-sales-domain";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;

export type ShopAfterSalesActor = Readonly<{
  id: string;
  role: "MEMBER" | "CUSTOMER" | "ADMIN";
  status: "ACTIVE" | string;
  emailVerified: boolean;
}>;

type ServiceDependencies = Readonly<{
  client?: PrismaClient;
  assertEnabled?: () => void;
}>;

const activeRefundStatuses = ["PROCESSING", "PENDING", "REQUIRES_REVIEW"] as const;
const winningPaymentStatuses = ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

function dependencies(input: ServiceDependencies = {}) {
  if (!input.client) assertDatabaseConfigured();
  return {
    client: input.client ?? prisma,
    assertEnabled: input.assertEnabled ?? assertShopAfterSalesQaEnabled,
  };
}

function assertMember(actor: ShopAfterSalesActor) {
  if (!actor.id || actor.status !== "ACTIVE" || actor.emailVerified !== true || !["MEMBER", "CUSTOMER", "ADMIN"].includes(actor.role)) {
    throw new ShopAfterSalesError(403, "ACCESS_DENIED");
  }
}

function assertAdmin(actor: ShopAfterSalesActor) {
  if (!actor.id || actor.role !== "ADMIN" || actor.status !== "ACTIVE" || actor.emailVerified !== true) {
    throw new ShopAfterSalesError(403, "ACCESS_DENIED");
  }
}

async function transaction<T>(client: PrismaClient, operation: (tx: Transaction) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
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

async function lock(tx: Transaction, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS locked`;
}

function requestNumber(now: Date) {
  return `LNX-SAV-${now.getUTCFullYear()}-${randomBytes(6).toString("hex").toUpperCase()}`;
}

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

const detailInclude = {
  shopOrder: {
    include: {
      user: { select: { id: true, email: true, displayName: true, firstName: true, lastName: true } },
      invoices: { take: 1, orderBy: { issuedAt: "desc" as const } },
      payments: {
        where: { status: { in: [...winningPaymentStatuses] } },
        orderBy: [{ paidAt: "desc" as const }, { createdAt: "desc" as const }],
      },
    },
  },
  items: { orderBy: { productTitle: "asc" as const } },
  auditEvents: { orderBy: [{ occurredAt: "asc" as const }, { id: "asc" as const }] },
  refundAttempt: true,
  creditNote: { include: { invoice: { select: { invoiceNumber: true } } } },
  stockAdjustments: { orderBy: { createdAt: "asc" as const } },
  withdrawalRequest: { select: { requestNumber: true, status: true, eligibilityReview: true } },
} satisfies Prisma.ShopReturnRequestInclude;

export async function createMemberShopReturn(
  actor: ShopAfterSalesActor,
  input: Readonly<{
    orderNumber: string;
    type: ShopReturnType;
    comment: string | null;
    quantities: ReadonlyMap<string, number>;
  }>,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  assertMember(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return transaction(client, async (tx) => {
    await lock(tx, `shop-after-sales:create:${actor.id}:${input.orderNumber}`);
    const order = await tx.shopOrder.findFirst({
      where: { orderNumber: input.orderNumber, userId: actor.id },
      select: {
        id: true,
        userId: true,
        status: true,
        paymentStatus: true,
        paymentReviewAt: true,
        items: {
          orderBy: { position: "asc" },
          select: { productId: true, productTitle: true, unitPriceCents: true, quantity: true, currency: true },
        },
      },
    });
    if (!order) throw new ShopAfterSalesError(404, "ORDER_NOT_ELIGIBLE");
    if (order.status !== "OPEN" || order.paymentStatus !== "PAID" || order.paymentReviewAt) {
      throw new ShopAfterSalesError(409, "ORDER_NOT_ELIGIBLE");
    }
    const lines = [];
    for (const [productId, quantity] of input.quantities) {
      const item = order.items.find((candidate) => candidate.productId === productId);
      if (!item || quantity < 1 || quantity > item.quantity || item.currency !== "EUR") {
        throw new ShopAfterSalesError(409, "QUANTITY_EXCEEDED");
      }
      lines.push({ item, quantity });
    }
    if (!lines.length) throw new ShopAfterSalesError(400, "INVALID_REQUEST");
    for (const line of lines) await lock(tx, `shop-after-sales:line:${order.id}:${line.item.productId}`);
    const alreadyRequested = await tx.shopReturnItem.groupBy({
      by: ["productId"],
      where: {
        shopOrderId: order.id,
        request: { status: { notIn: ["REJECTED", "CANCELLED"] } },
      },
      _sum: { requestedQuantity: true },
    });
    for (const line of lines) {
      const used = alreadyRequested.find((entry) => entry.productId === line.item.productId)?._sum.requestedQuantity ?? 0;
      if (used + line.quantity > line.item.quantity) throw new ShopAfterSalesError(409, "QUANTITY_EXCEEDED");
    }
    const created = await tx.shopReturnRequest.create({
      data: {
        requestNumber: requestNumber(now),
        shopOrderId: order.id,
        userId: actor.id,
        type: input.type,
        customerComment: input.comment,
        requestedAt: now,
        items: {
          create: lines.map(({ item, quantity }) => ({
            orderItem: {
              connect: {
                shopOrderId_productId: { shopOrderId: order.id, productId: item.productId },
              },
            },
            productTitle: item.productTitle,
            unitPriceCents: item.unitPriceCents,
            currency: "EUR",
            requestedQuantity: quantity,
          })),
        },
      },
      select: { id: true, requestNumber: true },
    });
    await tx.shopReturnAuditEvent.create({
      data: {
        shopReturnRequestId: created.id,
        actorUserId: actor.id,
        action: "REQUEST_CREATED",
        idempotencyKey: `shop-return:${created.id}:requested:v1`,
        metadata: json({ type: input.type, lineCount: lines.length }),
      },
    });
    await enqueueShopAfterSalesNotification(tx, {
      shopOrderId: order.id,
      requestId: created.id,
      requestNumber: created.requestNumber,
      kind: "OWNER_SHOP_RETURN_REQUESTED",
    });
    return created;
  });
}

export async function cancelMemberShopReturn(
  actor: ShopAfterSalesActor,
  requestNumberValue: string,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  assertMember(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return transaction(client, async (tx) => {
    await lock(tx, `shop-after-sales:${requestNumberValue}`);
    const request = await tx.shopReturnRequest.findFirst({ where: { requestNumber: requestNumberValue, userId: actor.id } });
    if (!request) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    if (request.status === "CANCELLED") return request;
    assertTransition(request.status, "CANCELLED");
    const updated = await tx.shopReturnRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    await tx.shopReturnAuditEvent.create({
      data: {
        shopReturnRequestId: request.id,
        actorUserId: actor.id,
        action: "REQUEST_CANCELLED",
        idempotencyKey: `shop-return:${request.id}:cancelled:v1`,
      },
    });
    return updated;
  });
}

export async function startShopReturnReview(
  actor: ShopAfterSalesActor,
  requestNumberValue: string,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  assertAdmin(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return transaction(client, async (tx) => {
    await lock(tx, `shop-after-sales:${requestNumberValue}`);
    const request = await tx.shopReturnRequest.findUnique({ where: { requestNumber: requestNumberValue } });
    if (!request) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    if (request.status === "UNDER_REVIEW") return request;
    assertTransition(request.status, "UNDER_REVIEW");
    const updated = await tx.shopReturnRequest.update({
      where: { id: request.id },
      data: { status: "UNDER_REVIEW", reviewedAt: now, reviewedByUserId: actor.id },
    });
    await tx.shopReturnAuditEvent.create({ data: {
      shopReturnRequestId: request.id, actorUserId: actor.id, action: "REVIEW_STARTED",
      idempotencyKey: `shop-return:${request.id}:review-started:v1`,
    } });
    return updated;
  });
}

export async function decideShopReturn(
  actor: ShopAfterSalesActor,
  input: Readonly<{
    requestNumber: string;
    decision: "APPROVE" | "REJECT";
    authorizedQuantities: ReadonlyMap<string, number>;
    physicalReturnRequired: boolean;
    returnCostDecision: "CUSTOMER" | "MERCHANT" | "MANUAL_REVIEW";
    instructions: string | null;
    comment: string | null;
  }>,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  assertAdmin(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return transaction(client, async (tx) => {
    await lock(tx, `shop-after-sales:${input.requestNumber}`);
    const request = await tx.shopReturnRequest.findUnique({
      where: { requestNumber: input.requestNumber },
      include: { items: true },
    });
    if (!request) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    if (input.decision === "REJECT") {
      if (request.status === "REJECTED") return request;
      assertTransition(request.status, "REJECTED");
      const updated = await tx.shopReturnRequest.update({
        where: { id: request.id },
        data: { status: "REJECTED", adminComment: input.comment, reviewedAt: now, reviewedByUserId: actor.id },
        include: { items: true },
      });
      await tx.shopReturnAuditEvent.create({ data: {
        shopReturnRequestId: request.id, actorUserId: actor.id, action: "REQUEST_REJECTED",
        idempotencyKey: `shop-return:${request.id}:rejected:v1`,
      } });
      await enqueueShopAfterSalesNotification(tx, {
        shopOrderId: request.shopOrderId, requestId: request.id, requestNumber: request.requestNumber,
        kind: "CUSTOMER_SHOP_RETURN_REJECTED",
      });
      return updated;
    }
    const target = input.physicalReturnRequired ? "AWAITING_RETURN" : "APPROVED";
    assertTransition(request.status, target);
    if (input.physicalReturnRequired && !input.instructions) throw new ShopAfterSalesError(400, "INVALID_REQUEST");
    for (const item of request.items) {
      const quantity = input.authorizedQuantities.get(item.productId);
      if (!Number.isSafeInteger(quantity) || Number(quantity) < 0 || Number(quantity) > item.requestedQuantity) {
        throw new ShopAfterSalesError(409, "QUANTITY_EXCEEDED");
      }
      await tx.shopReturnItem.update({
        where: { id: item.id },
        data: {
          authorizedQuantity: Number(quantity),
          refundableQuantity: input.physicalReturnRequired ? 0 : Number(quantity),
        },
      });
    }
    if (![...input.authorizedQuantities.values()].some((value) => value > 0)) {
      throw new ShopAfterSalesError(400, "INVALID_REQUEST");
    }
    const updated = await tx.shopReturnRequest.update({
      where: { id: request.id },
      data: {
        status: target,
        adminComment: input.comment,
        reviewedAt: now,
        reviewedByUserId: actor.id,
        authorizedAt: now,
        physicalReturnRequired: input.physicalReturnRequired,
        returnCostDecision: input.returnCostDecision,
        returnInstructions: input.instructions,
      },
      include: { items: true },
    });
    await tx.shopReturnAuditEvent.create({ data: {
      shopReturnRequestId: request.id, actorUserId: actor.id, action: "REQUEST_APPROVED",
      idempotencyKey: `shop-return:${request.id}:approved:v1`,
      metadata: json({ physicalReturnRequired: input.physicalReturnRequired, returnCostDecision: input.returnCostDecision }),
    } });
    await enqueueShopAfterSalesNotification(tx, {
      shopOrderId: request.shopOrderId, requestId: request.id, requestNumber: request.requestNumber,
      kind: "CUSTOMER_SHOP_RETURN_APPROVED",
    });
    return updated;
  });
}

export async function markShopReturnReceived(
  actor: ShopAfterSalesActor,
  requestNumberValue: string,
  receivedQuantities: ReadonlyMap<string, number>,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  assertAdmin(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return transaction(client, async (tx) => {
    await lock(tx, `shop-after-sales:${requestNumberValue}`);
    const request = await tx.shopReturnRequest.findUnique({ where: { requestNumber: requestNumberValue }, include: { items: true } });
    if (!request) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    if (request.status === "RETURN_RECEIVED") return request;
    assertTransition(request.status, "RETURN_RECEIVED");
    let totalReceived = 0;
    for (const item of request.items) {
      const quantity = receivedQuantities.get(item.productId);
      if (!Number.isSafeInteger(quantity) || Number(quantity) < 0 || Number(quantity) > item.authorizedQuantity) {
        throw new ShopAfterSalesError(409, "QUANTITY_EXCEEDED");
      }
      totalReceived += Number(quantity);
      await tx.shopReturnItem.update({ where: { id: item.id }, data: { receivedQuantity: Number(quantity) } });
    }
    if (totalReceived < 1) throw new ShopAfterSalesError(409, "QUANTITY_REQUIRED");
    const updated = await tx.shopReturnRequest.update({ where: { id: request.id }, data: { status: "RETURN_RECEIVED", receivedAt: now } });
    await tx.shopReturnAuditEvent.create({ data: {
      shopReturnRequestId: request.id, actorUserId: actor.id, action: "RETURN_RECEIVED",
      idempotencyKey: `shop-return:${request.id}:received:v1`,
    } });
    await enqueueShopAfterSalesNotification(tx, {
      shopOrderId: request.shopOrderId, requestId: request.id, requestNumber: request.requestNumber,
      kind: "CUSTOMER_SHOP_RETURN_RECEIVED",
    });
    return updated;
  });
}

export async function inspectShopReturn(
  actor: ShopAfterSalesActor,
  input: Readonly<{
    requestNumber: string;
    lines: ReadonlyMap<string, Readonly<{
      condition: ShopReturnInspectionCondition;
      decision: ShopReturnRestockDecision;
      restockableQuantity: number;
      refundableQuantity: number;
      comment: string | null;
    }>>;
  }>,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  assertAdmin(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return transaction(client, async (tx) => {
    await lock(tx, `shop-after-sales:${input.requestNumber}`);
    const request = await tx.shopReturnRequest.findUnique({ where: { requestNumber: input.requestNumber }, include: { items: true } });
    if (!request) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    assertTransition(request.status, "INSPECTED");
    for (const item of request.items) {
      const line = input.lines.get(item.productId);
      if (!line) throw new ShopAfterSalesError(400, "INVALID_REQUEST");
      if (
        !Number.isSafeInteger(line.refundableQuantity)
        || line.refundableQuantity < 0
        || line.refundableQuantity > item.receivedQuantity
        || !Number.isSafeInteger(line.restockableQuantity)
        || line.restockableQuantity < 0
        || line.restockableQuantity > item.receivedQuantity
        || (line.decision === "NOT_RESTOCKABLE" && line.restockableQuantity !== 0)
        || (line.decision === "RESTOCKABLE" && line.restockableQuantity < 1)
      ) throw new ShopAfterSalesError(409, "QUANTITY_EXCEEDED");
      await tx.shopReturnItem.update({ where: { id: item.id }, data: {
        inspectionCondition: line.condition,
        inspectionComment: line.comment,
        refundableQuantity: line.refundableQuantity,
        restockDecision: line.decision,
        restockableQuantity: line.restockableQuantity,
      } });
    }
    const updated = await tx.shopReturnRequest.update({ where: { id: request.id }, data: { status: "INSPECTED", inspectedAt: now } });
    await tx.shopReturnAuditEvent.create({ data: {
      shopReturnRequestId: request.id, actorUserId: actor.id, action: "INSPECTION_RECORDED",
      idempotencyKey: `shop-return:${request.id}:inspected:v1`,
    } });
    return updated;
  });
}

export type ShopRefundEvidence = Readonly<{
  provider: "STRIPE" | "PAYPAL";
  providerRefundId: string;
  providerPaymentId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  amountCents: number;
  currency: "EUR";
  occurredAt: Date;
}>;

export interface ShopRefundGateway {
  request(input: Readonly<{
    attemptId: string;
    paymentId: string;
    provider: "STRIPE" | "PAYPAL";
    providerPaymentId: string;
    amountCents: number;
    idempotencyKey: string;
  }>): Promise<ShopRefundEvidence>;
  retrieve(input: Readonly<{
    attemptId: string;
    provider: "STRIPE" | "PAYPAL";
    providerPaymentId: string;
    providerRefundId: string | null;
    amountCents: number;
    idempotencyKey: string;
  }>): Promise<ShopRefundEvidence>;
}

export class ShopRefundGatewayError extends Error {
  constructor(readonly code: "FAILED" | "AMBIGUOUS") {
    super(code);
    this.name = "ShopRefundGatewayError";
  }
}

export function createFakeShopRefundGateway(
  behavior: "SUCCEEDED" | "PENDING" | "FAILED" | "AMBIGUOUS" = "SUCCEEDED",
): ShopRefundGateway {
  const evidence = (input: {
    attemptId: string; provider: "STRIPE" | "PAYPAL"; providerPaymentId: string; amountCents: number;
  }, status: "PENDING" | "SUCCEEDED" | "FAILED"): ShopRefundEvidence => ({
    provider: input.provider,
    providerRefundId: `fake_${input.provider.toLowerCase()}_refund_${input.attemptId}`,
    providerPaymentId: input.providerPaymentId,
    status,
    amountCents: input.amountCents,
    currency: "EUR",
    occurredAt: new Date(),
  });
  return {
    async request(input) {
      if (behavior === "AMBIGUOUS") throw new ShopRefundGatewayError("AMBIGUOUS");
      return evidence(input, behavior);
    },
    async retrieve(input) {
      return evidence(input, behavior === "PENDING" || behavior === "AMBIGUOUS" ? "SUCCEEDED" : behavior);
    },
  };
}

type ReservedShopRefund = Readonly<{
  attemptId: string;
  paymentId: string;
  provider: "STRIPE" | "PAYPAL";
  providerPaymentId: string;
  providerRefundId: string | null;
  providerIdempotencyKey: string;
  amountCents: number;
  status: "PROCESSING" | "PENDING" | "SUCCEEDED" | "FAILED" | "REQUIRES_REVIEW";
  reused: boolean;
}>;

async function reserveShopRefund(
  tx: Transaction,
  actor: ShopAfterSalesActor,
  requestNumberValue: string,
  shippingDecision: "NONE" | "FULL",
  now: Date,
): Promise<ReservedShopRefund> {
  await lock(tx, `shop-after-sales:${requestNumberValue}`);
  const request = await tx.shopReturnRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    include: { items: true, refundAttempt: true, shopOrder: { include: { invoices: { take: 1, orderBy: { issuedAt: "desc" } } } } },
  });
  if (!request) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
  if (request.refundAttempt) {
    const payment = await tx.payment.findUnique({ where: { id: request.refundAttempt.paymentId } });
    if (!payment?.providerPaymentId) throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
    return {
      attemptId: request.refundAttempt.id,
      paymentId: payment.id,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      providerRefundId: request.refundAttempt.providerRefundId,
      providerIdempotencyKey: request.refundAttempt.providerIdempotencyKey,
      amountCents: request.refundAttempt.amountCents,
      status: request.refundAttempt.status,
      reused: true,
    };
  }
  if (!request.shopOrder.invoices[0]) throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
  if (request.status !== "APPROVED" && request.status !== "INSPECTED") {
    throw new ShopAfterSalesError(409, "INVALID_TRANSITION");
  }
  if (request.physicalReturnRequired === true && request.status !== "INSPECTED") {
    throw new ShopAfterSalesError(409, "INVALID_TRANSITION");
  }
  const lines = request.items.map((item) => ({
    unitPriceCents: item.unitPriceCents,
    refundableQuantity: item.refundableQuantity,
  }));
  const amounts = calculateShopReturnRefund({ lines, shippingCents: request.shopOrder.shippingCents, shippingDecision });
  const paymentRows = await tx.payment.findMany({
    where: { shopOrderId: request.shopOrderId, status: { in: [...winningPaymentStatuses] }, mode: "TEST" },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
  });
  if (paymentRows.length !== 1 || !paymentRows[0]!.providerPaymentId || paymentRows[0]!.currency !== "EUR") {
    throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
  }
  const payment = paymentRows[0]!;
  await lock(tx, `shop-after-sales:payment:${payment.id}`);
  const active = await tx.refundAttempt.aggregate({
    where: { paymentId: payment.id, status: { in: [...activeRefundStatuses] } },
    _sum: { amountCents: true },
  });
  const available = payment.amountCents - payment.refundedAmountCents - (active._sum.amountCents ?? 0);
  if (amounts.totalRefundCents > available) throw new ShopAfterSalesError(409, "REFUND_EXCEEDED");
  const attemptId = randomUUID();
  const attempt = await tx.refundAttempt.create({
    data: {
      id: attemptId,
      paymentId: payment.id,
      provider: payment.provider,
      source: "ADMIN",
      amountCents: amounts.totalRefundCents,
      currency: "EUR",
      requestedByUserId: actor.id,
      shopReturnRequestId: request.id,
      localIdempotencyKey: `shop-return:${request.id}:refund:v1`,
      providerIdempotencyKey: `shop-return:${request.id}:provider-refund:v1`,
      status: "PROCESSING",
      attempts: 1,
      lastAttemptAt: now,
    },
  });
  for (const item of request.items) {
    await tx.shopReturnItem.update({ where: { id: item.id }, data: { refundQuantity: item.refundableQuantity } });
  }
  await tx.shopReturnRequest.update({
    where: { id: request.id },
    data: {
      status: "REFUND_PENDING",
      refundStatus: "PENDING",
      itemsRefundCents: amounts.itemsRefundCents,
      shippingRefundCents: amounts.shippingRefundCents,
      totalRefundCents: amounts.totalRefundCents,
      refundRequestedAt: now,
    },
  });
  await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUND_PENDING" } });
  await tx.paymentAuditEvent.create({ data: {
    paymentId: payment.id, refundAttemptId: attempt.id, actorUserId: actor.id, actorRole: "ADMIN",
    provider: payment.provider, action: "REFUND_REQUESTED", amountCents: attempt.amountCents, result: "PENDING",
  } });
  await tx.shopReturnAuditEvent.create({ data: {
    shopReturnRequestId: request.id, actorUserId: actor.id, action: "REFUND_REQUESTED",
    idempotencyKey: `shop-return:${request.id}:refund-requested:v1`,
    metadata: json({ ...amounts, shippingDecision }),
  } });
  return {
    attemptId: attempt.id,
    paymentId: payment.id,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId!,
    providerRefundId: null,
    providerIdempotencyKey: attempt.providerIdempotencyKey,
    amountCents: attempt.amountCents,
    status: attempt.status,
    reused: false,
  };
}

async function applyShopRefundEvidence(
  client: PrismaClient,
  attemptId: string,
  evidence: ShopRefundEvidence,
) {
  return transaction(client, async (tx) => {
    await lock(tx, `shop-after-sales:refund:${attemptId}`);
    const attempt = await tx.refundAttempt.findUnique({
      where: { id: attemptId },
      include: { payment: true, shopReturnRequest: { include: { shopOrder: true } } },
    });
    if (!attempt?.shopReturnRequest || !attempt.payment.shopOrderId) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    const request = attempt.shopReturnRequest;
    const mismatch = evidence.provider !== attempt.provider
      || evidence.providerPaymentId !== attempt.payment.providerPaymentId
      || evidence.amountCents !== attempt.amountCents
      || evidence.currency !== attempt.currency
      || (attempt.providerRefundId !== null && attempt.providerRefundId !== evidence.providerRefundId);
    if (mismatch) {
      await tx.refundAttempt.update({ where: { id: attempt.id }, data: { status: "REQUIRES_REVIEW", failureCode: "REFUND_EVIDENCE_MISMATCH" } });
      await tx.shopReturnRequest.update({ where: { id: request.id }, data: { refundStatus: "REQUIRES_REVIEW" } });
      await tx.shopReturnAuditEvent.create({ data: {
        shopReturnRequestId: request.id, action: "REFUND_REQUIRES_REVIEW",
        idempotencyKey: `shop-return:${request.id}:refund-review:evidence:v1`,
      } });
      return { status: "REQUIRES_REVIEW" as const, confirmed: false };
    }
    if (attempt.status === "SUCCEEDED") return { status: "SUCCEEDED" as const, confirmed: true };
    await tx.refundAttempt.update({ where: { id: attempt.id }, data: {
      providerRefundId: evidence.providerRefundId,
      status: evidence.status,
      failureCode: evidence.status === "FAILED" ? "FAKE_PROVIDER_REFUND_FAILED" : null,
      confirmedAt: evidence.status === "SUCCEEDED" ? evidence.occurredAt : null,
    } });
    const confirmed = await tx.refundAttempt.aggregate({
      where: { paymentId: attempt.paymentId, status: "SUCCEEDED" },
      _sum: { amountCents: true },
    });
    const confirmedCents = confirmed._sum.amountCents ?? 0;
    const unresolved = await tx.refundAttempt.count({
      where: { paymentId: attempt.paymentId, status: { in: [...activeRefundStatuses] } },
    });
    const paymentStatus = unresolved > 0
      ? "REFUND_PENDING"
      : confirmedCents === 0
        ? "SUCCEEDED"
        : confirmedCents === attempt.payment.amountCents
          ? "REFUNDED"
          : "PARTIALLY_REFUNDED";
    await tx.payment.update({ where: { id: attempt.paymentId }, data: {
      status: paymentStatus,
      refundedAmountCents: confirmedCents,
      refundedAt: confirmedCents > 0 ? evidence.occurredAt : null,
    } });
    await tx.paymentAuditEvent.create({ data: {
      paymentId: attempt.paymentId, refundAttemptId: attempt.id, provider: attempt.provider,
      action: evidence.status === "SUCCEEDED" ? "REFUND_CONFIRMED" : evidence.status === "FAILED" ? "REFUND_FAILED" : "REFUND_PROVIDER_ACCEPTED",
      amountCents: attempt.amountCents,
      result: evidence.status === "SUCCEEDED" ? "SUCCEEDED" : evidence.status === "FAILED" ? "FAILED" : "PENDING",
    } });
    if (evidence.status === "SUCCEEDED") {
      await tx.shopReturnRequest.update({ where: { id: request.id }, data: {
        status: "REFUNDED", refundStatus: "SUCCEEDED", refundedAt: evidence.occurredAt,
      } });
      const { creditNote } = await issueCreditNoteForRefund(tx, {
        refundAttemptId: attempt.id,
        shopReturnRequestId: request.id,
        reasonCode: request.type === "WITHDRAWAL" ? "WITHDRAWAL"
          : request.type === "NON_CONFORMING" ? "NON_CONFORMITY"
            : request.type === "DAMAGED" ? "DAMAGED_PRODUCT" : "OTHER_REVIEWED",
        reasonText: `Dossier SAV ${request.requestNumber}`,
      });
      await tx.shopReturnAuditEvent.create({ data: {
        shopReturnRequestId: request.id, action: "REFUND_CONFIRMED",
        idempotencyKey: `shop-return:${request.id}:refund-confirmed:v1`,
        metadata: json({ amountCents: attempt.amountCents, providerRefundId: evidence.providerRefundId }),
      } });
      await enqueueShopAfterSalesNotification(tx, {
        shopOrderId: request.shopOrderId, requestId: request.id, requestNumber: request.requestNumber,
        kind: "CUSTOMER_SHOP_REFUND_CONFIRMED", refundAmountCents: attempt.amountCents,
        creditNoteNumber: creditNote.creditNoteNumber,
      });
    } else if (evidence.status === "FAILED") {
      await tx.shopReturnRequest.update({ where: { id: request.id }, data: { refundStatus: "FAILED" } });
      await tx.shopReturnAuditEvent.create({ data: {
        shopReturnRequestId: request.id, action: "REFUND_FAILED",
        idempotencyKey: `shop-return:${request.id}:refund-failed:v1`,
      } });
    }
    return { status: evidence.status, confirmed: evidence.status === "SUCCEEDED" } as const;
  });
}

async function markAmbiguousRefund(client: PrismaClient, attemptId: string) {
  return transaction(client, async (tx) => {
    await lock(tx, `shop-after-sales:refund:${attemptId}`);
    const attempt = await tx.refundAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt?.shopReturnRequestId || attempt.status === "SUCCEEDED") return;
    await tx.refundAttempt.update({ where: { id: attempt.id }, data: { status: "REQUIRES_REVIEW", failureCode: "AMBIGUOUS_PROVIDER_ACCEPTANCE" } });
    await tx.shopReturnRequest.update({ where: { id: attempt.shopReturnRequestId }, data: { refundStatus: "REQUIRES_REVIEW" } });
    await tx.shopReturnAuditEvent.upsert({
      where: { idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-review:ambiguous:v1` },
      update: {},
      create: {
        shopReturnRequestId: attempt.shopReturnRequestId, action: "REFUND_REQUIRES_REVIEW",
        idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-review:ambiguous:v1`,
      },
    });
  });
}

export async function requestShopReturnRefund(
  actor: ShopAfterSalesActor,
  requestNumberValue: string,
  shippingDecision: "NONE" | "FULL",
  gateway: ShopRefundGateway = createFakeShopRefundGateway(),
  now = new Date(),
  options: ServiceDependencies = {},
) {
  assertAdmin(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  const reserved = await transaction(client, (tx) => reserveShopRefund(tx, actor, requestNumberValue, shippingDecision, now));
  if (reserved.status === "SUCCEEDED" || reserved.status === "FAILED") return { attemptId: reserved.attemptId, status: reserved.status } as const;
  try {
    const evidence = reserved.providerRefundId
      ? await gateway.retrieve({
          attemptId: reserved.attemptId, provider: reserved.provider, providerPaymentId: reserved.providerPaymentId,
          providerRefundId: reserved.providerRefundId, amountCents: reserved.amountCents, idempotencyKey: reserved.providerIdempotencyKey,
        })
      : await gateway.request({
          attemptId: reserved.attemptId, paymentId: reserved.paymentId, provider: reserved.provider,
          providerPaymentId: reserved.providerPaymentId, amountCents: reserved.amountCents, idempotencyKey: reserved.providerIdempotencyKey,
        });
    const result = await applyShopRefundEvidence(client, reserved.attemptId, evidence);
    return { attemptId: reserved.attemptId, status: result.status } as const;
  } catch (error) {
    if (error instanceof ShopRefundGatewayError && error.code === "AMBIGUOUS") {
      await markAmbiguousRefund(client, reserved.attemptId);
      return { attemptId: reserved.attemptId, status: "REQUIRES_REVIEW" as const };
    }
    throw error;
  }
}

export async function reconcileShopReturnRefund(
  actor: ShopAfterSalesActor,
  requestNumberValue: string,
  gateway: ShopRefundGateway,
  options: ServiceDependencies = {},
) {
  assertAdmin(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  const request = await client.shopReturnRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    include: { refundAttempt: { include: { payment: true } } },
  });
  const attempt = request?.refundAttempt;
  if (!request || !attempt?.payment.providerPaymentId) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
  const evidence = await gateway.retrieve({
    attemptId: attempt.id,
    provider: attempt.provider,
    providerPaymentId: attempt.payment.providerPaymentId,
    providerRefundId: attempt.providerRefundId,
    amountCents: attempt.amountCents,
    idempotencyKey: attempt.providerIdempotencyKey,
  });
  return applyShopRefundEvidence(client, attempt.id, evidence);
}

export async function restockShopReturn(
  actor: ShopAfterSalesActor,
  requestNumberValue: string,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  assertAdmin(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return transaction(client, async (tx) => {
    await lock(tx, `shop-after-sales:${requestNumberValue}`);
    const request = await tx.shopReturnRequest.findUnique({ where: { requestNumber: requestNumberValue }, include: { items: true } });
    if (!request) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    if (!["INSPECTED", "REFUND_PENDING", "REFUNDED"].includes(request.status)) {
      throw new ShopAfterSalesError(409, "RESTOCK_NOT_ALLOWED");
    }
    let changed = 0;
    for (const item of request.items) {
      if (item.restockDecision !== "RESTOCKABLE" || item.restockableQuantity < 1) continue;
      const remaining = item.restockableQuantity - item.restockedQuantity;
      if (remaining <= 0) continue;
      await lock(tx, `shop-product:${item.productId}`);
      const key = `shop-return:${request.id}:product:${item.productId}:restock:v1`;
      const existing = await tx.productStockAdjustment.findUnique({ where: { idempotencyKey: key } });
      if (existing) continue;
      const product = await tx.product.findUnique({ where: { id: item.productId }, select: { id: true, trackInventory: true, stock: true } });
      if (!product?.trackInventory || product.stock === null) throw new ShopAfterSalesError(409, "RESTOCK_NOT_ALLOWED");
      const stockAfter = product.stock + remaining;
      await tx.product.update({ where: { id: product.id }, data: { stock: stockAfter, lockVersion: { increment: 1 } } });
      await tx.productStockAdjustment.create({ data: {
        productId: product.id,
        delta: remaining,
        stockBefore: product.stock,
        stockAfter,
        reason: `Restock audité du dossier SAV ${request.requestNumber}`,
        actorAdminId: actor.id,
        shopReturnRequestId: request.id,
        idempotencyKey: key,
        createdAt: now,
      } });
      await tx.shopReturnItem.update({ where: { id: item.id }, data: { restockedQuantity: item.restockableQuantity } });
      changed += remaining;
    }
    if (changed > 0) {
      await tx.shopReturnAuditEvent.upsert({
        where: { idempotencyKey: `shop-return:${request.id}:restocked:v1` },
        update: {},
        create: {
          shopReturnRequestId: request.id, actorUserId: actor.id, action: "RESTOCK_COMPLETED",
          idempotencyKey: `shop-return:${request.id}:restocked:v1`, metadata: json({ quantity: changed }),
        },
      });
    }
    return { restockedQuantity: changed } as const;
  });
}

export async function closeShopReturn(
  actor: ShopAfterSalesActor,
  requestNumberValue: string,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  assertAdmin(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return transaction(client, async (tx) => {
    await lock(tx, `shop-after-sales:${requestNumberValue}`);
    const request = await tx.shopReturnRequest.findUnique({ where: { requestNumber: requestNumberValue } });
    if (!request) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    if (request.status === "CLOSED") return request;
    assertTransition(request.status, "CLOSED");
    const updated = await tx.shopReturnRequest.update({ where: { id: request.id }, data: { status: "CLOSED", closedAt: now } });
    await tx.shopReturnAuditEvent.create({ data: {
      shopReturnRequestId: request.id, actorUserId: actor.id, action: "REQUEST_CLOSED",
      idempotencyKey: `shop-return:${request.id}:closed:v1`,
    } });
    return updated;
  });
}

export async function listMemberShopReturns(userId: string, options: ServiceDependencies = {}) {
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return client.shopReturnRequest.findMany({
    where: { userId },
    orderBy: [{ requestedAt: "desc" }, { requestNumber: "desc" }],
    include: { items: { orderBy: { productTitle: "asc" } }, creditNote: true },
  });
}

export async function listShopReturnsForOrder(userId: string, shopOrderId: string, options: ServiceDependencies = {}) {
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return client.shopReturnRequest.findMany({
    where: { userId, shopOrderId },
    orderBy: [{ requestedAt: "desc" }, { requestNumber: "desc" }],
    include: { items: { orderBy: { productTitle: "asc" } }, creditNote: true },
  });
}

export async function getMemberShopReturn(userId: string, requestNumberValue: string, options: ServiceDependencies = {}) {
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return client.shopReturnRequest.findFirst({ where: { requestNumber: requestNumberValue, userId }, include: detailInclude });
}

export async function listAdminShopReturns(options: ServiceDependencies = {}) {
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return client.shopReturnRequest.findMany({
    orderBy: [{ requestedAt: "desc" }, { requestNumber: "desc" }],
    include: {
      shopOrder: { include: { user: { select: { email: true, displayName: true } } } },
      items: true,
      refundAttempt: true,
      creditNote: true,
    },
    take: 200,
  });
}

export async function getAdminShopReturn(requestNumberValue: string, options: ServiceDependencies = {}) {
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  return client.shopReturnRequest.findUnique({ where: { requestNumber: requestNumberValue }, include: detailInclude });
}
