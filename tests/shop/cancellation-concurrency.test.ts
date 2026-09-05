import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hasValidShopCancellationInventoryReservations } from "@/lib/shop/order-coordination";

test("customer cancellation and every fulfillment entry point share one durable order boundary", async () => {
  const [coordination, cancellation, fulfillment, shippingProvider] = await Promise.all([
    readFile(new URL("../../lib/shop/order-coordination.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/customer-request-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/fulfillment-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/shipping-provider-service.ts", import.meta.url), "utf8"),
  ]);

  assert.match(coordination, /SHOP_ORDER_MUTATION_LOCK_PREFIX = "shop-payments:order"/);
  assert.match(coordination, /pg_advisory_xact_lock[\s\S]*FROM "shop_orders"[\s\S]*FOR UPDATE/);
  assert.match(coordination, /PROCESSING[\s\S]*PENDING[\s\S]*SUCCEEDED[\s\S]*REQUIRES_REVIEW/);
  assert.match(cancellation, /lockShopOrderForMutation/);
  assert.match(cancellation, /lockShopRefundCapacity/);
  assert.match(cancellation, /findUnresolvedShopShippingIntent/);
  assert.match(fulfillment, /findShopCancellationBarrier/g);
  assert.match(shippingProvider, /findShopCancellationBarrier/g);
  assert.doesNotMatch(shippingProvider, /shop-shipping-provider:order/);
});

test("provider evidence converges on one monotone accounting finalizer", async () => {
  const [service, finalizer, safety] = await Promise.all([
    readFile(new URL("../../lib/shop/customer-request-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/refund-finalization-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/refund-accounting-safety.ts", import.meta.url), "utf8"),
  ]);

  assert.match(service, /applyShopCustomerCancellationEvidence/);
  assert.match(finalizer, /applyShopCustomerCancellationEvidenceInTransaction/);
  assert.match(
    finalizer,
    /if \(alreadyCompleted\) \{[\s\S]*evidence\.status === "FAILED"[\s\S]*"REFUND_STATUS_CONFLICT"[\s\S]*: "SUCCEEDED"/,
  );
  assert.match(
    finalizer,
    /if \(attempt\.status === "SUCCEEDED"\)[\s\S]*"SUCCEEDED_REFUND_NOT_FINALIZED"/,
  );
  assert.match(finalizer, /PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED|SHOP_CANCELLATION_FINALIZATION_PRECONDITION_FAILED/);
  assert.match(safety, /confirmedAt: evidence\.occurredAt/);
  assert.match(safety, /status: "REFUND_PENDING"/);
});

test("customer cancellation credit notes persist the semantic reason and Admin exposes the financial effect", async () => {
  const [finalizer, admin] = await Promise.all([
    readFile(new URL("../../lib/shop/refund-finalization-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/commandes/[orderNumber]/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(finalizer, /reasonCode: "WITHDRAWAL"/);
  assert.match(finalizer, /Annulation demandée par le client avant expédition/);
  assert.doesNotMatch(finalizer, /reasonCode: "SELLER_ERROR"/);
  assert.match(admin, /L.acceptation déclenche le remboursement total/);
  assert.match(admin, /livraison de \{formatShopMoney\(order\.shippingCents\)\} comprise/);
  assert.match(admin, /ANNULER ET REMBOURSER/);
  assert.match(admin, /une seule fois/);
});

test("cancellation and SAV use an effect-based cross-workflow disposition barrier", async () => {
  const [coordination, cancellation, finalizer, afterSales] = await Promise.all([
    readFile(new URL("../../lib/shop/order-coordination.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/customer-request-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/refund-finalization-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/after-sales-service.ts", import.meta.url), "utf8"),
  ]);

  const dispositionHelper = coordination.slice(
    coordination.indexOf("export async function findShopReturnDispositionBarrier"),
    coordination.indexOf("export function hasValidShopCancellationInventoryReservations"),
  );
  assert.match(dispositionHelper, /restockedQuantity: \{ gt: 0 \}/);
  assert.match(dispositionHelper, /orderItem: \{ is: \{ inventoryTracked: true \} \}/);
  assert.match(dispositionHelper, /stockAdjustments: \{ some: \{\} \}/);
  assert.match(dispositionHelper, /shopReturnDispositionRefundStatuses/);
  assert.match(coordination, /shopReturnDispositionRefundStatuses = \[[\s\S]*"PROCESSING"[\s\S]*"PENDING"[\s\S]*"SUCCEEDED"[\s\S]*"REQUIRES_REVIEW"/);
  assert.doesNotMatch(dispositionHelper, /status: \{ notIn: \["REJECTED", "CANCELLED"\] \}/);
  assert.match(cancellation, /findShopReturnDispositionBarrier/);
  assert.match(finalizer, /SHOP_CANCELLATION_RETURN_DISPOSITION_CONFLICT_AFTER_REFUND/);
  assert.match(afterSales, /findShopCancellationBarrier/g);
  assert.match(afterSales, /order\.status === "CANCELLED"/);
  assert.match(afterSales, /item\.orderItem\.inventoryTracked/);
  assert.match(
    afterSales,
    /export async function inspectShopReturn[\s\S]*lockShopOrderForMutation[\s\S]*findShopCancellationBarrier[\s\S]*restockableQuantity: line\.restockableQuantity/,
  );
});

test("cancellation only restores inventory backed by exact confirmed reservations", () => {
  assert.equal(hasValidShopCancellationInventoryReservations([
    { inventoryTracked: false, quantity: 3, reservation: null },
    { inventoryTracked: true, quantity: 2, reservation: { status: "CONFIRMED", quantity: 2 } },
  ]), true);
  assert.equal(hasValidShopCancellationInventoryReservations([
    { inventoryTracked: true, quantity: 1, reservation: null },
  ]), false);
  assert.equal(hasValidShopCancellationInventoryReservations([
    { inventoryTracked: true, quantity: 2, reservation: { status: "CONFIRMED", quantity: 1 } },
  ]), false);
  assert.equal(hasValidShopCancellationInventoryReservations([
    { inventoryTracked: true, quantity: 1, reservation: { status: "RELEASED", quantity: 1 } },
  ]), false);
});
