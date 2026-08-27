import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseShopPreparingForm,
  parseShopShippedForm,
  SHOP_FULFILLMENT_CONFIRMATIONS,
} from "@/lib/shop/fulfillment-domain";

const ORDER_NUMBER = "LNX-SHOP-2026-000001";

test("Shop fulfillment forms are exact and require explicit confirmations", () => {
  const preparing = new FormData();
  preparing.set("orderNumber", ORDER_NUMBER);
  preparing.set("confirmation", SHOP_FULFILLMENT_CONFIRMATIONS.preparing);
  assert.deepEqual(parseShopPreparingForm(preparing), { orderNumber: ORDER_NUMBER });

  const missing = new FormData();
  missing.set("orderNumber", ORDER_NUMBER);
  assert.throws(() => parseShopPreparingForm(missing));

  const extra = new FormData();
  extra.set("orderNumber", ORDER_NUMBER);
  extra.set("confirmation", SHOP_FULFILLMENT_CONFIRMATIONS.preparing);
  extra.set("role", "ADMIN");
  assert.throws(() => parseShopPreparingForm(extra));
});

test("Shop shipment accepts bounded optional tracking and HTTPS only", () => {
  const shipped = new FormData();
  shipped.set("orderNumber", ORDER_NUMBER);
  shipped.set("confirmation", SHOP_FULFILLMENT_CONFIRMATIONS.shipped);
  shipped.set("carrier", "La Poste");
  shipped.set("trackingNumber", "QA-0001");
  shipped.set("trackingUrl", "https://tracking.example.invalid/QA-0001");
  assert.deepEqual(parseShopShippedForm(shipped), {
    orderNumber: ORDER_NUMBER,
    shipment: {
      carrier: "La Poste",
      trackingNumber: "QA-0001",
      trackingUrl: "https://tracking.example.invalid/QA-0001",
    },
  });

  shipped.set("trackingUrl", "http://tracking.example.invalid/QA-0001");
  assert.throws(() => parseShopShippedForm(shipped), /HTTPS/);
});

test("fulfillment service keeps paid-state guards and transaction-bound notifications", async () => {
  const source = await readFile(new URL("../../lib/shop/fulfillment-service.ts", import.meta.url), "utf8");
  assert.match(source, /paymentStatus !== "PAID"/);
  assert.match(source, /paymentReviewAt !== null/);
  assert.match(source, /role: "ADMIN", status: "ACTIVE"/);
  assert.match(source, /ACTOR_NOT_ADMIN/);
  assert.match(source, /fulfillmentStatus !== "PENDING"/);
  assert.match(source, /fulfillmentStatus !== "PREPARING"/);
  assert.match(source, /enqueueShopPreparingNotification\(transaction, order\.id\)/);
  assert.match(source, /enqueueShopShippedNotification\(transaction, order\.id\)/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /shop-payments:order:\$\{shopOrderId\}/);
  assert.match(source, /FROM "shop_orders"[\s\S]*FOR UPDATE/);
  assert.match(source, /updateMany\([\s\S]*paymentReviewAt: null/);
  assert.match(source, /shopOrderLifecycleEvent\.create/);
});
