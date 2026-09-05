import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { fakeLocalShippingProvider } from "@/lib/shop/fake-local-shipping-provider";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  findShopCancellationBarrier,
  lockShopOrderForMutation,
} from "@/lib/shop/order-coordination";
import { assertShopShippingProviderQaEnabled } from "@/lib/shop/shipping-provider-config";
import type {
  ShippingProviderCreateInput,
  ShippingProviderAdapter,
  ShippingProviderResult,
  ShippingProviderScenario,
} from "@/lib/shop/shipping-provider";

type Transaction = Prisma.TransactionClient;

type ServiceDependencies = Readonly<{
  client?: PrismaClient;
  provider?: ShippingProviderAdapter;
  assertEnabled?: () => void;
}>;

function dependencies(input: ServiceDependencies = {}) {
  if (!input.client) assertDatabaseConfigured();
  return {
    client: input.client ?? prisma,
    provider: input.provider ?? fakeLocalShippingProvider,
    assertEnabled: input.assertEnabled ?? assertShopShippingProviderQaEnabled,
  };
}

export class ShopShippingProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "ORDER_NOT_FOUND"
      | "ATTEMPT_NOT_FOUND"
      | "ACTOR_NOT_ADMIN"
      | "PAYMENT_REQUIRED"
      | "ORDER_NOT_READY"
      | "SHIPPING_SNAPSHOT_INVALID"
      | "IDEMPOTENCY_CONFLICT"
      | "RECONCILIATION_NOT_ALLOWED"
      | "TRACKING_CONFLICT"
      | "CANCELLATION_IN_PROGRESS",
  ) {
    super(message);
    this.name = "ShopShippingProviderError";
  }
}

async function assertActiveAdmin(transaction: Transaction, actorAdminId: string) {
  const actor = await transaction.user.findFirst({
    where: { id: actorAdminId, role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  if (!actor) throw new ShopShippingProviderError("Action réservée à un administrateur actif.", "ACTOR_NOT_ADMIN");
}

async function lockedTransaction<T>(client: PrismaClient, operation: (transaction: Transaction) => Promise<T>) {
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

async function loadLockedOrder(transaction: Transaction, orderNumber: string) {
  const identity = await transaction.shopOrder.findUnique({ where: { orderNumber }, select: { id: true } });
  if (!identity) throw new ShopShippingProviderError("Commande Boutique introuvable.", "ORDER_NOT_FOUND");
  if (!await lockShopOrderForMutation(transaction, identity.id)) {
    throw new ShopShippingProviderError("Commande Boutique introuvable.", "ORDER_NOT_FOUND");
  }
  const order = await transaction.shopOrder.findUnique({
    where: { id: identity.id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      paymentReviewAt: true,
      fulfillmentStatus: true,
      shippingRequired: true,
      shippingMethod: true,
      shippingBillableGrams: true,
      shippingCountryCode: true,
      shippingPostalCode: true,
      shippingCarrier: true,
      trackingNumber: true,
      trackingUrl: true,
      trackingSource: true,
      trackingRevision: true,
    },
  });
  if (!order) throw new ShopShippingProviderError("Commande Boutique introuvable.", "ORDER_NOT_FOUND");
  return order;
}

async function cancellationBarrier(transaction: Transaction, shopOrderId: string) {
  return findShopCancellationBarrier(transaction, shopOrderId);
}

function throwCancellationBarrier() {
  throw new ShopShippingProviderError(
    "Une annulation financière est réservée pour cette commande.",
    "CANCELLATION_IN_PROGRESS",
  );
}

function assertProviderContext(order: Awaited<ReturnType<typeof loadLockedOrder>>) {
  if (order.status !== "OPEN" || order.paymentStatus !== "PAID" || order.paymentReviewAt !== null) {
    throw new ShopShippingProviderError("Le provider reste verrouillé tant que le paiement n’est pas confirmé.", "PAYMENT_REQUIRED");
  }
  if (
    !order.shippingRequired
    || !order.shippingMethod
    || !order.shippingBillableGrams
    || order.shippingBillableGrams <= 0
    || !order.shippingCountryCode
    || !order.shippingPostalCode
  ) {
    throw new ShopShippingProviderError("Le snapshot logistique est incomplet.", "SHIPPING_SNAPSHOT_INVALID");
  }
}

function assertReady(order: Awaited<ReturnType<typeof loadLockedOrder>>) {
  assertProviderContext(order);
  if (order.fulfillmentStatus !== "READY_TO_SHIP") {
    throw new ShopShippingProviderError("La commande doit être prête à expédier.", "ORDER_NOT_READY");
  }
}

function assertAttemptResolvable(order: Awaited<ReturnType<typeof loadLockedOrder>>) {
  assertProviderContext(order);
  if (order.fulfillmentStatus !== "READY_TO_SHIP" && order.fulfillmentStatus !== "SHIPPED") {
    throw new ShopShippingProviderError("La tentative provider ne peut pas être résolue dans cet état.", "ORDER_NOT_READY");
  }
}

function createInput(
  order: Awaited<ReturnType<typeof loadLockedOrder>>,
  scenario: ShippingProviderScenario,
  idempotencyKey: string,
): ShippingProviderCreateInput {
  assertProviderContext(order);
  return Object.freeze({
    orderNumber: order.orderNumber,
    idempotencyKey,
    scenario,
    service: order.shippingMethod!,
    billableGrams: order.shippingBillableGrams!,
    destination: Object.freeze({
      countryCode: order.shippingCountryCode!,
      postalCode: order.shippingPostalCode!,
    }),
  });
}

async function applyProviderResult({
  orderNumber,
  attemptId,
  actorAdminId,
  result,
  reconciled,
  now,
  client,
}: {
  orderNumber: string;
  attemptId: string;
  actorAdminId: string;
  result: ShippingProviderResult;
  reconciled: boolean;
  now: Date;
  client: PrismaClient;
}) {
  return lockedTransaction(client, async (transaction) => {
    await assertActiveAdmin(transaction, actorAdminId);
    const order = await loadLockedOrder(transaction, orderNumber);
    const attempt = await transaction.shopShippingProviderAttempt.findFirst({
      where: { id: attemptId, shopOrderId: order.id },
    });
    if (!attempt) throw new ShopShippingProviderError("Tentative provider introuvable.", "ATTEMPT_NOT_FOUND");
    if (reconciled) {
      if (!["REQUESTED", "PENDING"].includes(attempt.status)) return attempt;
    } else if (attempt.status !== "REQUESTED") {
      return attempt;
    }
    const cancellation = await cancellationBarrier(transaction, order.id);
    if (!cancellation) assertAttemptResolvable(order);

    let finalStatus = result.status;
    let errorCode = result.errorCode;
    const hasManualTracking = order.trackingSource === "MANUAL" && Boolean(order.trackingNumber);
    const hasDifferentProviderTracking = order.trackingSource === "PROVIDER"
      && Boolean(order.trackingNumber)
      && order.trackingNumber !== result.tracking?.number;
    if (cancellation) {
      finalStatus = "REQUIRES_REVIEW";
      errorCode = "ORDER_CANCELLATION_IN_PROGRESS";
    } else if (result.status === "SUCCEEDED" && order.fulfillmentStatus === "SHIPPED") {
      finalStatus = "REQUIRES_REVIEW";
      errorCode = "ORDER_ALREADY_SHIPPED";
    } else if (result.status === "SUCCEEDED" && hasManualTracking) {
      finalStatus = "REQUIRES_REVIEW";
      errorCode = "MANUAL_TRACKING_CONFLICT";
    } else if (result.status === "SUCCEEDED" && hasDifferentProviderTracking) {
      finalStatus = "REQUIRES_REVIEW";
      errorCode = "ACTIVE_PROVIDER_TRACKING_CONFLICT";
    }

    const reconciliationCount = attempt.reconciliationCount + (reconciled ? 1 : 0);
    const updated = await transaction.shopShippingProviderAttempt.update({
      where: { id: attempt.id },
      data: {
        status: finalStatus,
        providerShipmentId: result.providerShipmentId,
        trackingCarrier: result.tracking?.carrier ?? null,
        trackingNumber: result.tracking?.number ?? null,
        trackingUrl: result.tracking?.url ?? null,
        errorCode,
        reconciliationCount,
        lastReconciledAt: reconciled ? now : attempt.lastReconciledAt,
        lastReconciledByUserId: reconciled ? actorAdminId : attempt.lastReconciledByUserId,
        resolvedAt: finalStatus === "PENDING" ? null : now,
      },
    });

    if (finalStatus === "SUCCEEDED" && result.tracking && !order.trackingNumber) {
      const nextRevision = order.trackingRevision + 1;
      const changed = await transaction.shopOrder.updateMany({
        where: {
          id: order.id,
          status: "OPEN",
          paymentStatus: "PAID",
          paymentReviewAt: null,
          fulfillmentStatus: "READY_TO_SHIP",
          trackingRevision: order.trackingRevision,
          trackingSource: null,
          trackingNumber: null,
        },
        data: {
          shippingCarrier: result.tracking.carrier,
          trackingNumber: result.tracking.number,
          trackingUrl: result.tracking.url,
          trackingSource: "PROVIDER",
          trackingRecordedAt: now,
          trackingRevision: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw new ShopShippingProviderError("Le suivi opérationnel a été modifié par une autre action.", "TRACKING_CONFLICT");
      }
      await transaction.shopOrderLifecycleEvent.create({
        data: {
          shopOrderId: order.id,
          actorUserId: actorAdminId,
          type: "TRACKING_RECORDED",
          idempotencyKey: `shop-order:${order.id}:tracking:${nextRevision}`,
          metadata: {
            source: "PROVIDER",
            revision: nextRevision,
            carrier: result.tracking.carrier,
            trackingNumber: result.tracking.number,
            trackingUrl: result.tracking.url,
          },
        },
      });
    }

    await transaction.shopOrderLifecycleEvent.create({
      data: {
        shopOrderId: order.id,
        actorUserId: actorAdminId,
        type: "SHIPPING_PROVIDER_RECONCILED",
        idempotencyKey: `shop-shipping-provider:${attempt.id}:result:${reconciliationCount}`,
        metadata: {
          provider: "FAKE_LOCAL",
          scenario: attempt.scenario,
          status: finalStatus,
          attemptNumber: attempt.attemptNumber,
          reconciliationCount,
          errorCode,
          trackingAdopted: !cancellation && finalStatus === "SUCCEEDED" && Boolean(result.tracking),
        },
      },
    });
    console.info(JSON.stringify({
      event: "shop.shipping_provider.result_recorded",
      provider: "FAKE_LOCAL",
      shopOrderId: order.id,
      attemptId: attempt.id,
      status: finalStatus,
      reconciliationCount,
    }));
    return updated;
  });
}

export async function createShopShippingProviderAttempt(
  orderNumber: string,
  actorAdminId: string,
  scenario: ShippingProviderScenario,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  const { client, provider, assertEnabled } = dependencies(options);
  assertEnabled();
  const prepared = await lockedTransaction(client, async (transaction) => {
    await assertActiveAdmin(transaction, actorAdminId);
    const order = await loadLockedOrder(transaction, orderNumber);
    if (await cancellationBarrier(transaction, order.id)) throwCancellationBarrier();
    const existing = await transaction.shopShippingProviderAttempt.findFirst({
      where: { shopOrderId: order.id },
      orderBy: [{ attemptNumber: "desc" }, { id: "desc" }],
    });
    if (existing) {
      if (existing.scenario !== scenario) {
        throw new ShopShippingProviderError(
          "Une intention provider existe déjà avec un autre scénario. Aucun second envoi n’est créé.",
          "IDEMPOTENCY_CONFLICT",
        );
      }
      return { created: false as const, attempt: existing, input: null };
    }
    assertReady(order);
    const attemptNumber = 1;
    const idempotencyKey = `shop-order:${order.id}:shipping-provider:${attemptNumber}:v1`;
    const attempt = await transaction.shopShippingProviderAttempt.create({
      data: {
        shopOrderId: order.id,
        provider: "FAKE_LOCAL",
        scenario,
        status: "REQUESTED",
        attemptNumber,
        idempotencyKey,
        requestedAt: now,
        createdByUserId: actorAdminId,
      },
    });
    await transaction.shopOrderLifecycleEvent.create({
      data: {
        shopOrderId: order.id,
        actorUserId: actorAdminId,
        type: "SHIPPING_PROVIDER_REQUESTED",
        idempotencyKey: `shop-shipping-provider:${attempt.id}:requested`,
        metadata: { provider: "FAKE_LOCAL", scenario, attemptNumber },
      },
    });
    return { created: true as const, attempt, input: createInput(order, scenario, idempotencyKey) };
  });
  if (!prepared.created) return prepared.attempt;
  let result: ShippingProviderResult;
  try {
    result = await provider.createShipment(prepared.input);
  } catch {
    result = Object.freeze({
      status: "REQUIRES_REVIEW",
      providerShipmentId: null,
      tracking: null,
      errorCode: "PROVIDER_RESPONSE_UNCERTAIN",
    });
  }
  return applyProviderResult({
    orderNumber,
    attemptId: prepared.attempt.id,
    actorAdminId,
    result,
    reconciled: false,
    now,
    client,
  });
}

export async function reconcileShopShippingProviderAttempt(
  orderNumber: string,
  attemptId: string,
  actorAdminId: string,
  now = new Date(),
  options: ServiceDependencies = {},
) {
  const { client, provider, assertEnabled } = dependencies(options);
  assertEnabled();
  const prepared = await lockedTransaction(client, async (transaction) => {
    await assertActiveAdmin(transaction, actorAdminId);
    const order = await loadLockedOrder(transaction, orderNumber);
    if (await cancellationBarrier(transaction, order.id)) throwCancellationBarrier();
    const attempt = await transaction.shopShippingProviderAttempt.findFirst({
      where: { id: attemptId, shopOrderId: order.id },
    });
    if (!attempt) throw new ShopShippingProviderError("Tentative provider introuvable.", "ATTEMPT_NOT_FOUND");
    if (attempt.status === "SUCCEEDED" || attempt.status === "FAILED" || attempt.status === "REQUIRES_REVIEW") {
      return { reconcile: false as const, attempt, input: null };
    }
    assertAttemptResolvable(order);
    if (!attempt.providerShipmentId && attempt.status !== "REQUESTED") {
      throw new ShopShippingProviderError("La tentative ne peut pas être réconciliée.", "RECONCILIATION_NOT_ALLOWED");
    }
    return {
      reconcile: true as const,
      attempt,
      input: createInput(order, attempt.scenario, attempt.idempotencyKey),
    };
  });
  if (!prepared.reconcile) return prepared.attempt;
  let result: ShippingProviderResult;
  try {
    result = prepared.attempt.status === "REQUESTED"
      ? await provider.createShipment(prepared.input)
      : await provider.reconcileShipment({
          orderNumber,
          idempotencyKey: prepared.attempt.idempotencyKey,
          providerShipmentId: prepared.attempt.providerShipmentId!,
          scenario: prepared.attempt.scenario,
        });
  } catch {
    result = Object.freeze({
      status: "REQUIRES_REVIEW",
      providerShipmentId: prepared.attempt.providerShipmentId,
      tracking: null,
      errorCode: "PROVIDER_RESPONSE_UNCERTAIN",
    });
  }
  return applyProviderResult({
    orderNumber,
    attemptId,
    actorAdminId,
    result,
    reconciled: true,
    now,
    client,
  });
}
