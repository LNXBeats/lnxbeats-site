import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { issueCreditNoteForRefund } from "@/lib/billing/service";
import { enqueueShopAfterSalesNotification } from "@/lib/notifications/service";
import { createRefundProviderGateway, type RefundProviderEvidence } from "@/lib/payments/refund";
import {
  resolveDeferredShopRefundProviderEvents,
  type ShopRefundApplicationCorrelation,
} from "@/lib/payments/provider-refund-receipt";
import { paypalRefundApplicationReference, PaypalClientError } from "@/lib/payments/paypal-client";
import { StripeRefundClientError } from "@/lib/payments/stripe-client";
import {
  assertShopAfterSalesEnabled,
  assertShopRefundExecutionEnabled,
} from "@/lib/shop/after-sales-config";
import {
  assertTransition,
  calculateShopReturnRefund,
  ShopAfterSalesError,
  type ShopReturnInspectionCondition,
  type ShopReturnRestockDecision,
  type ShopReturnType,
} from "@/lib/shop/after-sales-domain";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { shopProductionReadinessQaEnabled } from "@/lib/shop/production-readiness-config";
import { savEvidencePurgeDueAt } from "@/lib/shop/readiness-domain";
import {
  hasCompatibleShopRefundSourceInvoice,
  persistShopRefundFinalizationReview,
} from "@/lib/shop/refund-accounting-safety";
import { lockShopRefundAttemptForMutation } from "@/lib/shop/refund-coordination";
import {
  findShopCancellationBarrier,
  lockShopOrderForMutation,
  lockShopProductStockForMutation,
  lockShopRefundCapacity,
} from "@/lib/shop/order-coordination";

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
  immediateRefund?: boolean;
  immediateShippingDecision?: "NONE" | "FULL";
  refundGateway?: ShopRefundGateway;
  beforeCommitForTesting?: (transaction: Transaction) => Promise<void>;
}>;

const activeRefundStatuses = ["PROCESSING", "PENDING", "REQUIRES_REVIEW"] as const;
const winningPaymentStatuses = ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

function dependencies(input: ServiceDependencies = {}) {
  if (!input.client) assertDatabaseConfigured();
  return {
    client: input.client ?? prisma,
    assertEnabled: input.assertEnabled ?? assertShopAfterSalesEnabled,
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
  evidence: { orderBy: [{ uploadedAt: "asc" as const }, { id: "asc" as const }] },
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
    const identity = await tx.shopOrder.findFirst({
      where: { orderNumber: input.orderNumber, userId: actor.id },
      select: { id: true },
    });
    if (!identity || !await lockShopOrderForMutation(tx, identity.id)) {
      throw new ShopAfterSalesError(404, "ORDER_NOT_ELIGIBLE");
    }
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
    if (
      order.status !== "OPEN"
      || order.paymentStatus !== "PAID"
      || order.paymentReviewAt
      || await findShopCancellationBarrier(tx, order.id)
    ) {
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
    await options.beforeCommitForTesting?.(tx);
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
  const result = await transaction(client, async (tx) => {
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
  const immediateRefund = options.immediateRefund ?? shopProductionReadinessQaEnabled();
  if (input.decision === "APPROVE" && !input.physicalReturnRequired && immediateRefund) {
    const policy = await client.shopReturnRequest.findUnique({
      where: { requestNumber: input.requestNumber },
      select: { type: true, shopOrder: { select: { items: { select: { quantity: true } } } } },
    });
    const automaticShippingDecision = policy?.type === "DEFECTIVE"
      && policy.shopOrder.items.reduce((sum, item) => sum + item.quantity, 0) === 1
      ? "FULL" as const
      : "NONE" as const;
    await requestShopReturnRefund(
      actor,
      input.requestNumber,
      options.immediateShippingDecision ?? automaticShippingDecision,
      options.refundGateway ?? createFakeShopRefundGateway("SUCCEEDED"),
      now,
      { client, assertEnabled },
    );
  }
  return result;
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
    const identity = await tx.shopReturnRequest.findUnique({
      where: { requestNumber: input.requestNumber },
      select: { shopOrderId: true },
    });
    if (!identity || !await lockShopOrderForMutation(tx, identity.shopOrderId)) {
      throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    }
    const request = await tx.shopReturnRequest.findUnique({ where: { requestNumber: input.requestNumber }, include: { items: true } });
    if (!request) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    if (await findShopCancellationBarrier(tx, request.shopOrderId)) {
      throw new ShopAfterSalesError(409, "RESTOCK_NOT_ALLOWED");
    }
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
    await options.beforeCommitForTesting?.(tx);
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
  applicationCorrelation: ShopRefundApplicationCorrelation;
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
    paymentId: string;
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
    applicationCorrelation: "MATCH",
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

export function shopRefundPaymentMode(environment: NodeJS.ProcessEnv = process.env) {
  return assertShopRefundExecutionEnabled(environment) === "payments" ? "LIVE" as const : "TEST" as const;
}

export function createConfiguredShopRefundGateway(
  environment: NodeJS.ProcessEnv = process.env,
): ShopRefundGateway {
  const mode = assertShopRefundExecutionEnabled(environment);
  if (mode === "fake") return createFakeShopRefundGateway();
  const correlatedEvidence = (
    evidence: RefundProviderEvidence,
    expected: Readonly<{
      attemptId: string;
      paymentId: string;
      provider: "STRIPE" | "PAYPAL";
      idempotencyKey: string;
    }>,
  ): ShopRefundEvidence => {
    const application = evidence.applicationEvidence;
    const applicationCorrelation: ShopRefundApplicationCorrelation = expected.provider === "STRIPE"
      ? !application
          || application.kind !== "STRIPE_METADATA"
          || !application.present
        ? "MISSING"
        : application.paymentId === expected.paymentId
            && application.refundAttemptId === expected.attemptId
          ? "MATCH"
          : "MISMATCH"
      : !application
          || application.kind !== "PAYPAL_INVOICE_REFERENCE"
          || !application.present
        ? "MISSING"
        : application.value === paypalRefundApplicationReference(expected.idempotencyKey)
          ? "MATCH"
          : "MISMATCH";
    return { ...evidence, applicationCorrelation };
  };
  return {
    async request(input) {
      try {
        const evidence = await createRefundProviderGateway(input.provider).request({
          paymentId: input.paymentId,
          attemptId: input.attemptId,
          providerPaymentId: input.providerPaymentId,
          amountCents: input.amountCents,
          idempotencyKey: input.idempotencyKey,
        });
        return correlatedEvidence(evidence, input);
      } catch (error) {
        if (
          (error instanceof StripeRefundClientError && error.code === "INVALID_REQUEST")
          || (error instanceof PaypalClientError && ["INVALID_REQUEST", "NOT_APPROVED"].includes(error.code))
        ) throw new ShopRefundGatewayError("FAILED");
        throw new ShopRefundGatewayError("AMBIGUOUS");
      }
    },
    async retrieve(input) {
      if (!input.providerRefundId) throw new ShopRefundGatewayError("AMBIGUOUS");
      try {
        const evidence = await createRefundProviderGateway(input.provider).retrieve(input.providerRefundId);
        return correlatedEvidence(evidence, input);
      } catch {
        throw new ShopRefundGatewayError("AMBIGUOUS");
      }
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
  expectedMode: "TEST" | "LIVE",
): Promise<ReservedShopRefund> {
  await lock(tx, `shop-after-sales:${requestNumberValue}`);
  const identity = await tx.shopReturnRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    select: { shopOrderId: true },
  });
  if (!identity || !await lockShopOrderForMutation(tx, identity.shopOrderId)) {
    throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
  }
  const request = await tx.shopReturnRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    include: { items: true, refundAttempt: true, shopOrder: { include: { items: { select: { quantity: true } } } } },
  });
  if (!request) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
  const currentOrder = await tx.shopOrder.findUnique({
    where: { id: request.shopOrderId },
    select: { status: true, paymentStatus: true, paymentReviewAt: true },
  });
  if (
    !currentOrder
    || currentOrder.status !== "OPEN"
    || currentOrder.paymentStatus !== "PAID"
    || currentOrder.paymentReviewAt !== null
    || await findShopCancellationBarrier(tx, request.shopOrderId)
  ) {
    throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
  }
  if (request.refundAttempt) {
    const payment = await tx.payment.findUnique({
      where: { id: request.refundAttempt.paymentId },
      include: { invoice: true },
    });
    if (
      !payment?.providerPaymentId
      || payment.mode !== expectedMode
      || payment.provider !== request.refundAttempt.provider
      || !hasCompatibleShopRefundSourceInvoice(payment, request.shopOrderId)
    ) throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
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
  if (request.status !== "APPROVED" && request.status !== "INSPECTED") {
    throw new ShopAfterSalesError(409, "INVALID_TRANSITION");
  }
  if (request.physicalReturnRequired === true && request.status !== "INSPECTED") {
    throw new ShopAfterSalesError(409, "INVALID_TRANSITION");
  }
  if (shippingDecision === "FULL" && (
    request.type !== "DEFECTIVE"
    || request.shopOrder.items.reduce((sum, item) => sum + item.quantity, 0) !== 1
  )) throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
  const lines = request.items.map((item) => ({
    unitPriceCents: item.unitPriceCents,
    refundableQuantity: item.refundableQuantity,
  }));
  const amounts = calculateShopReturnRefund({ lines, shippingCents: request.shopOrder.shippingCents, shippingDecision });
  const paymentRows = await tx.payment.findMany({
    where: { shopOrderId: request.shopOrderId, status: { in: [...winningPaymentStatuses] }, mode: expectedMode },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    include: { invoice: true },
  });
  if (paymentRows.length !== 1 || !paymentRows[0]!.providerPaymentId || paymentRows[0]!.currency !== "EUR") {
    throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
  }
  const payment = paymentRows[0]!;
  if (!hasCompatibleShopRefundSourceInvoice(payment, request.shopOrderId)) {
    throw new ShopAfterSalesError(409, "REFUND_REQUIRES_REVIEW");
  }
  await lockShopRefundCapacity(tx, payment.id);
  const currentPayment = await tx.payment.findUniqueOrThrow({
    where: { id: payment.id },
    select: { amountCents: true, refundedAmountCents: true },
  });
  const active = await tx.refundAttempt.aggregate({
    where: { paymentId: payment.id, status: { in: [...activeRefundStatuses] } },
    _sum: { amountCents: true },
  });
  const available = currentPayment.amountCents
    - currentPayment.refundedAmountCents
    - (active._sum.amountCents ?? 0);
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

export async function applyShopReturnRefundEvidenceInTransaction(
  tx: Transaction,
  attemptId: string,
  evidence: ShopRefundEvidence,
) {
  const identity = await tx.refundAttempt.findUnique({
    where: { id: attemptId },
    select: { payment: { select: { shopOrderId: true } } },
  });
  if (!identity?.payment.shopOrderId) {
    throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
  }
  if (!await lockShopOrderForMutation(tx, identity.payment.shopOrderId)) {
    throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
  }
  await lockShopRefundAttemptForMutation(tx, attemptId);
  const attempt = await tx.refundAttempt.findUnique({
    where: { id: attemptId },
    include: { payment: true, shopReturnRequest: { include: { shopOrder: true } } },
  });
  if (!attempt?.shopReturnRequest || !attempt.payment.shopOrderId) {
    throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
  }
  await lockShopRefundCapacity(tx, attempt.paymentId);
  const request = attempt.shopReturnRequest;

  const providerEvidenceMatches = Boolean(
    evidence.providerRefundId.trim()
    && evidence.providerPaymentId.trim()
    && Number.isSafeInteger(evidence.amountCents)
    && evidence.amountCents > 0
    && !Number.isNaN(evidence.occurredAt.getTime())
    && evidence.provider === attempt.provider
    && evidence.providerPaymentId === attempt.payment.providerPaymentId
    && evidence.amountCents === attempt.amountCents
    && evidence.currency === attempt.currency
    && (attempt.providerRefundId === null || attempt.providerRefundId === evidence.providerRefundId)
  );

  const paymentAuditOnce = async (
    action: "REFUND_PROVIDER_ACCEPTED" | "REFUND_CONFIRMED" | "REFUND_FAILED" | "REFUND_RECONCILIATION_REQUIRED",
    result: "PENDING" | "SUCCEEDED" | "FAILED" | "REQUIRES_REVIEW",
  ) => {
    const existing = await tx.paymentAuditEvent.findFirst({
      where: { refundAttemptId: attempt.id, action },
      select: { id: true },
    });
    if (!existing) await tx.paymentAuditEvent.create({ data: {
      paymentId: attempt.paymentId,
      refundAttemptId: attempt.id,
      provider: attempt.provider,
      action,
      amountCents: attempt.amountCents,
      result,
    } });
  };
  const requireReview = async (failureCode: string) => {
    if (attempt.status !== "SUCCEEDED") {
      const recoverableReviewCode = attempt.failureCode === "AMBIGUOUS_PROVIDER_ACCEPTANCE"
        || attempt.failureCode === "PROVIDER_EVENT_CORRELATION_DEFERRED"
        || attempt.failureCode === "PROVIDER_FAILED_LOCAL_FINALIZATION_FAILED"
        || attempt.failureCode === "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED"
        || attempt.failureCode === "REFUND_APPLICATION_CORRELATION_REQUIRED";
      const nonRecoverableReviewCode = attempt.status === "REQUIRES_REVIEW"
        && attempt.failureCode !== null
        && !recoverableReviewCode;
      const durableFailureCode = nonRecoverableReviewCode
        ? attempt.failureCode!
        : attempt.confirmedAt
        && (
          attempt.failureCode === "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED"
          || attempt.failureCode === "PROVIDER_EVENT_CORRELATION_DEFERRED"
        )
        ? attempt.failureCode
        : failureCode;
      await tx.refundAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "REQUIRES_REVIEW",
          failureCode: durableFailureCode,
          ...(providerEvidenceMatches ? {
            providerRefundId: evidence.providerRefundId,
            ...(evidence.status === "SUCCEEDED" ? { confirmedAt: evidence.occurredAt } : {}),
          } : {}),
        },
      });
      await tx.payment.update({
        where: { id: attempt.paymentId },
        data: { status: "REFUND_PENDING" },
      });
      await tx.shopReturnRequest.update({
        where: { id: request.id },
        data: { refundStatus: "REQUIRES_REVIEW" },
      });
    }
    await paymentAuditOnce("REFUND_RECONCILIATION_REQUIRED", "REQUIRES_REVIEW");
    await tx.shopReturnAuditEvent.upsert({
      where: { idempotencyKey: `shop-return:${request.id}:refund-review:${failureCode.toLowerCase()}:v1` },
      update: {},
      create: {
        shopReturnRequestId: request.id,
        action: "REFUND_REQUIRES_REVIEW",
        idempotencyKey: `shop-return:${request.id}:refund-review:${failureCode.toLowerCase()}:v1`,
      },
    });
    return { status: "REQUIRES_REVIEW" as const, confirmed: false };
  };

  if (evidence.applicationCorrelation !== "MATCH" || !providerEvidenceMatches) {
    return requireReview(
      providerEvidenceMatches
        ? "REFUND_APPLICATION_CORRELATION_REQUIRED"
        : "REFUND_EVIDENCE_MISMATCH",
    );
  }
  const finalizationPreconditionFailed = attempt.source !== "ADMIN"
    || attempt.requestedByUserId === null
    || attempt.shopCustomerRequestId !== null
    || attempt.shopReturnRequestId !== request.id
    || request.shopOrderId !== attempt.payment.shopOrderId
    || request.shopOrder.paymentReviewAt !== null
    || !["REFUND_PENDING", "REFUNDED", "CLOSED"].includes(request.status)
    || !["PENDING", "REQUIRES_REVIEW", "SUCCEEDED", "FAILED"].includes(request.refundStatus)
    || request.reviewedByUserId === null
    || request.authorizedAt === null
    || request.refundRequestedAt === null
    || request.totalRefundCents !== attempt.amountCents;
  if (finalizationPreconditionFailed) {
    return requireReview("SHOP_RETURN_REFUND_FINALIZATION_PRECONDITION_FAILED");
  }

  const deferredResolution = await resolveDeferredShopRefundProviderEvents(tx, {
    provider: attempt.provider,
    paymentId: attempt.paymentId,
    refundAttemptId: attempt.id,
    providerRefundId: evidence.providerRefundId,
    status: evidence.status,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
  });
  if (deferredResolution.requiresReview) {
    return requireReview("REFUND_STATUS_CONFLICT");
  }

  if (attempt.status === "SUCCEEDED") {
    return evidence.status !== "FAILED"
      ? { status: "SUCCEEDED" as const, confirmed: true }
      : requireReview("REFUND_STATUS_CONFLICT");
  }
  if (evidence.status === "PENDING") {
    if (attempt.status === "FAILED" || attempt.confirmedAt) {
      return requireReview("REFUND_STATUS_CONFLICT");
    }
    if (attempt.status === "REQUIRES_REVIEW") {
      if (
        (attempt.failureCode === "PROVIDER_EVENT_CORRELATION_DEFERRED"
          || attempt.failureCode === "REFUND_APPLICATION_CORRELATION_REQUIRED")
        && !attempt.confirmedAt
      ) {
        await tx.refundAttempt.update({
          where: { id: attempt.id },
          data: {
            providerRefundId: evidence.providerRefundId,
            status: "PENDING",
            failureCode: null,
          },
        });
        await tx.payment.update({
          where: { id: attempt.paymentId },
          data: { status: "REFUND_PENDING" },
        });
        await paymentAuditOnce("REFUND_PROVIDER_ACCEPTED", "PENDING");
        return { status: "PENDING" as const, confirmed: false };
      }
      if (!attempt.providerRefundId) {
        await tx.refundAttempt.update({
          where: { id: attempt.id },
          data: { providerRefundId: evidence.providerRefundId },
        });
      }
      return { status: "REQUIRES_REVIEW" as const, confirmed: false };
    }
    if (attempt.status !== "PENDING" || attempt.providerRefundId === null) {
      await tx.refundAttempt.update({
        where: { id: attempt.id },
        data: {
          providerRefundId: evidence.providerRefundId,
          status: "PENDING",
          failureCode: null,
        },
      });
      await tx.payment.update({
        where: { id: attempt.paymentId },
        data: { status: "REFUND_PENDING" },
      });
      await paymentAuditOnce("REFUND_PROVIDER_ACCEPTED", "PENDING");
    }
    return { status: "PENDING" as const, confirmed: false };
  }
  if (evidence.status === "FAILED") {
    if (
      attempt.confirmedAt
      || attempt.status === "REQUIRES_REVIEW"
      && attempt.failureCode !== "AMBIGUOUS_PROVIDER_ACCEPTANCE"
      && attempt.failureCode !== "PROVIDER_EVENT_CORRELATION_DEFERRED"
      && attempt.failureCode !== "PROVIDER_FAILED_LOCAL_FINALIZATION_FAILED"
      && attempt.failureCode !== "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED"
      && attempt.failureCode !== "REFUND_APPLICATION_CORRELATION_REQUIRED"
    ) return requireReview("REFUND_STATUS_CONFLICT");
    if (attempt.status === "FAILED") return { status: "FAILED" as const, confirmed: false };
    await tx.refundAttempt.update({
      where: { id: attempt.id },
      data: {
        providerRefundId: evidence.providerRefundId,
        status: "FAILED",
        failureCode: "PROVIDER_REFUND_FAILED",
        confirmedAt: null,
      },
    });
    const confirmed = await tx.refundAttempt.aggregate({
      where: { paymentId: attempt.paymentId, status: "SUCCEEDED" },
      _sum: { amountCents: true },
    });
    const confirmedCents = confirmed._sum.amountCents ?? 0;
    const unresolved = await tx.refundAttempt.count({
      where: { paymentId: attempt.paymentId, status: { in: [...activeRefundStatuses] } },
    });
    await tx.payment.update({
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
    await paymentAuditOnce("REFUND_FAILED", "FAILED");
    await tx.shopReturnRequest.update({
      where: { id: request.id },
      data: { refundStatus: "FAILED" },
    });
    await tx.shopReturnAuditEvent.upsert({
      where: { idempotencyKey: `shop-return:${request.id}:refund-failed:v1` },
      update: {},
      create: {
        shopReturnRequestId: request.id,
        action: "REFUND_FAILED",
        idempotencyKey: `shop-return:${request.id}:refund-failed:v1`,
      },
    });
    return { status: "FAILED" as const, confirmed: false };
  }

  if (
    attempt.status === "FAILED"
    || attempt.status === "REQUIRES_REVIEW"
      && attempt.failureCode !== "AMBIGUOUS_PROVIDER_ACCEPTANCE"
      && attempt.failureCode !== "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED"
      && attempt.failureCode !== "PROVIDER_EVENT_CORRELATION_DEFERRED"
      && attempt.failureCode !== "REFUND_APPLICATION_CORRELATION_REQUIRED"
  ) return requireReview("REFUND_STATUS_CONFLICT");

  const alreadyConfirmed = await tx.refundAttempt.aggregate({
    where: {
      paymentId: attempt.paymentId,
      status: "SUCCEEDED",
      id: { not: attempt.id },
    },
    _sum: { amountCents: true },
  });
  if ((alreadyConfirmed._sum.amountCents ?? 0) + attempt.amountCents > attempt.payment.amountCents) {
    return requireReview("REFUND_EXCEEDED");
  }

  await tx.refundAttempt.update({
    where: { id: attempt.id },
    data: {
      providerRefundId: evidence.providerRefundId,
      status: "SUCCEEDED",
      failureCode: null,
      confirmedAt: evidence.occurredAt,
    },
  });
  const confirmed = await tx.refundAttempt.aggregate({
    where: { paymentId: attempt.paymentId, status: "SUCCEEDED" },
    _sum: { amountCents: true },
  });
  const confirmedCents = confirmed._sum.amountCents ?? 0;
  const unresolved = await tx.refundAttempt.count({
    where: { paymentId: attempt.paymentId, status: { in: [...activeRefundStatuses] } },
  });
  await tx.payment.update({
    where: { id: attempt.paymentId },
    data: {
      status: unresolved > 0
        ? "REFUND_PENDING"
        : confirmedCents === attempt.payment.amountCents
          ? "REFUNDED"
          : "PARTIALLY_REFUNDED",
      refundedAmountCents: confirmedCents,
      refundedAt: evidence.occurredAt,
    },
  });
  await paymentAuditOnce("REFUND_CONFIRMED", "SUCCEEDED");
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
  await tx.shopReturnAuditEvent.upsert({
    where: { idempotencyKey: `shop-return:${request.id}:refund-confirmed:v1` },
    update: {},
    create: {
      shopReturnRequestId: request.id,
      action: "REFUND_CONFIRMED",
      idempotencyKey: `shop-return:${request.id}:refund-confirmed:v1`,
      metadata: json({ amountCents: attempt.amountCents, providerRefundId: evidence.providerRefundId }),
    },
  });
  await enqueueShopAfterSalesNotification(tx, {
    shopOrderId: request.shopOrderId,
    requestId: request.id,
    requestNumber: request.requestNumber,
    kind: "CUSTOMER_SHOP_REFUND_CONFIRMED",
    refundAmountCents: attempt.amountCents,
    creditNoteNumber: creditNote.creditNoteNumber,
  });
  return { status: "SUCCEEDED" as const, confirmed: true };
}

async function applyShopRefundEvidence(
  client: PrismaClient,
  attemptId: string,
  evidence: ShopRefundEvidence,
) {
  return transaction(client, (tx) =>
    applyShopReturnRefundEvidenceInTransaction(tx, attemptId, evidence));
}

async function markAmbiguousRefund(client: PrismaClient, attemptId: string) {
  return transaction(client, async (tx) => {
    await lockShopRefundAttemptForMutation(tx, attemptId);
    const attempt = await tx.refundAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt?.shopReturnRequestId) return "REQUIRES_REVIEW" as const;
    await lockShopRefundCapacity(tx, attempt.paymentId);
    if (attempt.status === "SUCCEEDED" || attempt.status === "FAILED") return attempt.status;
    await tx.payment.update({
      where: { id: attempt.paymentId },
      data: { status: "REFUND_PENDING" },
    });
    const reconciliationAudit = await tx.paymentAuditEvent.findFirst({
      where: { refundAttemptId: attempt.id, action: "REFUND_RECONCILIATION_REQUIRED" },
      select: { id: true },
    });
    if (!reconciliationAudit) await tx.paymentAuditEvent.create({ data: {
      paymentId: attempt.paymentId,
      refundAttemptId: attempt.id,
      provider: attempt.provider,
      action: "REFUND_RECONCILIATION_REQUIRED",
      amountCents: attempt.amountCents,
      result: "REQUIRES_REVIEW",
    } });
    if (attempt.status === "REQUIRES_REVIEW") return "REQUIRES_REVIEW" as const;
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
    return "REQUIRES_REVIEW" as const;
  });
}

async function markFailedRefund(client: PrismaClient, attemptId: string) {
  return transaction(client, async (tx) => {
    await lockShopRefundAttemptForMutation(tx, attemptId);
    const attempt = await tx.refundAttempt.findUnique({ where: { id: attemptId }, include: { payment: true } });
    if (!attempt?.shopReturnRequestId) return "REQUIRES_REVIEW" as const;
    await lockShopRefundCapacity(tx, attempt.paymentId);
    if (attempt.status === "SUCCEEDED" || attempt.status === "FAILED") return attempt.status;
    if (attempt.status !== "PROCESSING" || attempt.providerRefundId || attempt.confirmedAt) {
      await tx.refundAttempt.update({
        where: { id: attempt.id },
        data: { status: "REQUIRES_REVIEW", failureCode: attempt.failureCode ?? "REFUND_STATUS_CONFLICT" },
      });
      await tx.payment.update({ where: { id: attempt.paymentId }, data: { status: "REFUND_PENDING" } });
      await tx.shopReturnRequest.update({
        where: { id: attempt.shopReturnRequestId },
        data: { refundStatus: "REQUIRES_REVIEW" },
      });
      const reconciliationAudit = await tx.paymentAuditEvent.findFirst({
        where: { refundAttemptId: attempt.id, action: "REFUND_RECONCILIATION_REQUIRED" },
        select: { id: true },
      });
      if (!reconciliationAudit) await tx.paymentAuditEvent.create({ data: {
        paymentId: attempt.paymentId,
        refundAttemptId: attempt.id,
        provider: attempt.provider,
        action: "REFUND_RECONCILIATION_REQUIRED",
        amountCents: attempt.amountCents,
        result: "REQUIRES_REVIEW",
      } });
      await tx.shopReturnAuditEvent.upsert({
        where: { idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-review:status-conflict:v1` },
        update: {},
        create: {
          shopReturnRequestId: attempt.shopReturnRequestId,
          action: "REFUND_REQUIRES_REVIEW",
          idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-review:status-conflict:v1`,
        },
      });
      return "REQUIRES_REVIEW" as const;
    }
    await tx.refundAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", failureCode: "REFUND_PROVIDER_REJECTED" } });
    const confirmed = await tx.refundAttempt.aggregate({
      where: { paymentId: attempt.paymentId, status: "SUCCEEDED" },
      _sum: { amountCents: true },
    });
    const confirmedCents = confirmed._sum.amountCents ?? 0;
    const unresolved = await tx.refundAttempt.count({
      where: { paymentId: attempt.paymentId, status: { in: [...activeRefundStatuses] } },
    });
    await tx.payment.update({
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
    const failedAudit = await tx.paymentAuditEvent.findFirst({
      where: { refundAttemptId: attempt.id, action: "REFUND_FAILED" },
      select: { id: true },
    });
    if (!failedAudit) await tx.paymentAuditEvent.create({ data: {
      paymentId: attempt.paymentId,
      refundAttemptId: attempt.id,
      provider: attempt.provider,
      action: "REFUND_FAILED",
      amountCents: attempt.amountCents,
      result: "FAILED",
    } });
    await tx.shopReturnRequest.update({ where: { id: attempt.shopReturnRequestId }, data: { refundStatus: "FAILED" } });
    await tx.shopReturnAuditEvent.upsert({
      where: { idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-failed:v1` },
      update: {},
      create: {
        shopReturnRequestId: attempt.shopReturnRequestId,
        action: "REFUND_FAILED",
        idempotencyKey: `shop-return:${attempt.shopReturnRequestId}:refund-failed:v1`,
      },
    });
    return "FAILED" as const;
  });
}

export async function requestShopReturnRefund(
  actor: ShopAfterSalesActor,
  requestNumberValue: string,
  shippingDecision: "NONE" | "FULL",
  gateway?: ShopRefundGateway,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  assertAdmin(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  const expectedMode = gateway ? "TEST" as const : shopRefundPaymentMode();
  const activeGateway = gateway ?? createConfiguredShopRefundGateway();
  const reserved = await transaction(client, (tx) => reserveShopRefund(tx, actor, requestNumberValue, shippingDecision, now, expectedMode));
  if (reserved.status === "SUCCEEDED" || reserved.status === "FAILED") return { attemptId: reserved.attemptId, status: reserved.status } as const;
  if (reserved.reused && !reserved.providerRefundId) {
    return { attemptId: reserved.attemptId, status: reserved.status === "REQUIRES_REVIEW" ? "REQUIRES_REVIEW" as const : "PENDING" as const };
  }
  let evidence: ShopRefundEvidence | undefined;
  try {
    evidence = reserved.providerRefundId
      ? await activeGateway.retrieve({
          attemptId: reserved.attemptId, paymentId: reserved.paymentId,
          provider: reserved.provider, providerPaymentId: reserved.providerPaymentId,
          providerRefundId: reserved.providerRefundId, amountCents: reserved.amountCents, idempotencyKey: reserved.providerIdempotencyKey,
        })
      : await activeGateway.request({
          attemptId: reserved.attemptId, paymentId: reserved.paymentId, provider: reserved.provider,
          providerPaymentId: reserved.providerPaymentId, amountCents: reserved.amountCents, idempotencyKey: reserved.providerIdempotencyKey,
        });
    const result = await applyShopRefundEvidence(client, reserved.attemptId, evidence);
    return { attemptId: reserved.attemptId, status: result.status } as const;
  } catch (error) {
    if (error instanceof ShopRefundGatewayError && error.code === "AMBIGUOUS") {
      const status = await markAmbiguousRefund(client, reserved.attemptId);
      return { attemptId: reserved.attemptId, status } as const;
    }
    if (error instanceof ShopRefundGatewayError && error.code === "FAILED") {
      const status = await markFailedRefund(client, reserved.attemptId);
      return { attemptId: reserved.attemptId, status } as const;
    }
    if (evidence) {
      const status = await persistShopRefundFinalizationReview(client, reserved.attemptId, evidence);
      return { attemptId: reserved.attemptId, status } as const;
    }
    throw error;
  }
}

export async function reconcileShopReturnRefund(
  actor: ShopAfterSalesActor,
  requestNumberValue: string,
  gateway?: ShopRefundGateway,
  options: ServiceDependencies = {},
) {
  assertAdmin(actor);
  const { client, assertEnabled } = dependencies(options);
  assertEnabled();
  const expectedMode = gateway ? "TEST" as const : shopRefundPaymentMode();
  const activeGateway = gateway ?? createConfiguredShopRefundGateway();
  const request = await client.shopReturnRequest.findUnique({
    where: { requestNumber: requestNumberValue },
    include: { refundAttempt: { include: { payment: true } } },
  });
  const attempt = request?.refundAttempt;
  if (!request || !attempt?.payment.providerPaymentId) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
  if (attempt.payment.mode !== expectedMode || !attempt.providerRefundId) {
    const status = await markAmbiguousRefund(client, attempt.id);
    return { status, confirmed: status === "SUCCEEDED" } as const;
  }
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
    return await applyShopRefundEvidence(client, attempt.id, evidence);
  } catch (error) {
    if (error instanceof ShopRefundGatewayError && error.code === "AMBIGUOUS") {
      const status = await markAmbiguousRefund(client, attempt.id);
      return { status, confirmed: status === "SUCCEEDED" } as const;
    }
    if (error instanceof ShopRefundGatewayError && error.code === "FAILED") {
      const status = await markFailedRefund(client, attempt.id);
      return { status, confirmed: status === "SUCCEEDED" } as const;
    }
    if (evidence) {
      const status = await persistShopRefundFinalizationReview(client, attempt.id, evidence);
      return { status, confirmed: status === "SUCCEEDED" } as const;
    }
    throw error;
  }
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
    const request = await tx.shopReturnRequest.findUnique({
      where: { requestNumber: requestNumberValue },
      include: {
        items: { include: { orderItem: { select: { inventoryTracked: true } } } },
      },
    });
    if (!request) throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    if (!["INSPECTED", "REFUND_PENDING", "REFUNDED"].includes(request.status)) {
      throw new ShopAfterSalesError(409, "RESTOCK_NOT_ALLOWED");
    }
    let changed = 0;
    const restockableItems = request.items
      .filter((item) => (
        item.orderItem.inventoryTracked
        && item.restockDecision === "RESTOCKABLE"
        && item.restockableQuantity > 0
      ))
      .map((item) => ({
        ...item,
        remainingQuantity: item.restockableQuantity - item.restockedQuantity,
      }))
      .filter((item) => item.remainingQuantity > 0)
      .sort((left, right) => left.productId.localeCompare(right.productId));
    if (restockableItems.length === 0) return { restockedQuantity: 0 } as const;
    if (!await lockShopOrderForMutation(tx, request.shopOrderId)) {
      throw new ShopAfterSalesError(404, "RETURN_NOT_FOUND");
    }
    const order = await tx.shopOrder.findUnique({
      where: { id: request.shopOrderId },
      select: { status: true },
    });
    if (
      !order
      || order.status === "CANCELLED"
      || await findShopCancellationBarrier(tx, request.shopOrderId)
    ) throw new ShopAfterSalesError(409, "RESTOCK_NOT_ALLOWED");
    for (const item of restockableItems) {
      const remaining = item.remainingQuantity;
      await lockShopProductStockForMutation(tx, item.productId);
      const key = `shop-return:${request.id}:product:${item.productId}:restock:v1`;
      const existing = await tx.productStockAdjustment.findUnique({ where: { idempotencyKey: key } });
      if (existing) continue;
      const product = await tx.product.findUnique({ where: { id: item.productId }, select: { id: true, trackInventory: true, stock: true } });
      if (!product?.trackInventory || product.stock === null) throw new ShopAfterSalesError(409, "RESTOCK_NOT_ALLOWED");
      const updatedProduct = await tx.product.update({
        where: { id: product.id },
        data: { stock: { increment: remaining }, lockVersion: { increment: 1 } },
        select: { stock: true },
      });
      if (updatedProduct.stock === null) throw new ShopAfterSalesError(409, "RESTOCK_NOT_ALLOWED");
      const stockAfter = updatedProduct.stock;
      await tx.productStockAdjustment.create({ data: {
        productId: product.id,
        delta: remaining,
        stockBefore: stockAfter - remaining,
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
    await options.beforeCommitForTesting?.(tx);
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
    await tx.shopReturnEvidence.updateMany({
      where: { shopReturnRequestId: request.id, status: "ACTIVE", purgeDueAt: null },
      data: { purgeDueAt: savEvidencePurgeDueAt(now) },
    });
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
