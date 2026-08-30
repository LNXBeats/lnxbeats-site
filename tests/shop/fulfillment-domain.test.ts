import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseShopPreparingForm,
  parseShopReadyForm,
  parseShopShippedForm,
  parseShopTrackingForm,
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

  const ready = new FormData();
  ready.set("orderNumber", ORDER_NUMBER);
  ready.set("confirmation", SHOP_FULFILLMENT_CONFIRMATIONS.ready);
  assert.deepEqual(parseShopReadyForm(ready), { orderNumber: ORDER_NUMBER });

  const shipped = new FormData();
  shipped.set("orderNumber", ORDER_NUMBER);
  shipped.set("confirmation", SHOP_FULFILLMENT_CONFIRMATIONS.shipped);
  assert.deepEqual(parseShopShippedForm(shipped), { orderNumber: ORDER_NUMBER });
});

function trackingForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const values = {
    orderNumber: ORDER_NUMBER,
    confirmation: SHOP_FULFILLMENT_CONFIRMATIONS.tracking,
    carrier: "Transporteur QA",
    trackingNumber: "QA-0001/FR",
    trackingUrl: "https://tracking.example.invalid/QA-0001",
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  return form;
}

test("manual tracking is normalized, bounded and independent from any carrier-specific format", () => {
  assert.deepEqual(parseShopTrackingForm(trackingForm({ carrier: "  Transporteur QA  ", trackingNumber: " QA-0001/FR " })), {
    orderNumber: ORDER_NUMBER,
    tracking: {
      carrier: "Transporteur QA",
      trackingNumber: "QA-0001/FR",
      trackingUrl: "https://tracking.example.invalid/QA-0001",
    },
  });

  assert.equal(parseShopTrackingForm(trackingForm({ trackingUrl: "" })).tracking.trackingUrl, null);
  assert.throws(() => parseShopTrackingForm(trackingForm({ carrier: "" })), /requis/);
  assert.throws(() => parseShopTrackingForm(trackingForm({ trackingNumber: "" })), /requis/);
  assert.throws(() => parseShopTrackingForm(trackingForm({ trackingNumber: "<script>" })), /caractères/);
  assert.throws(() => parseShopTrackingForm(trackingForm({ trackingNumber: "A".repeat(161) })));
  assert.throws(() => parseShopTrackingForm(trackingForm({ carrier: "A".repeat(121) })));
});

test("tracking URLs accept HTTPS only and reject active schemes or embedded credentials", () => {
  for (const trackingUrl of [
    "http://tracking.example.invalid/QA-0001",
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/test",
    "ftp://tracking.example.invalid/QA-0001",
    "https://user:password@tracking.example.invalid/QA-0001",
  ]) {
    assert.throws(() => parseShopTrackingForm(trackingForm({ trackingUrl })), /URL|HTTPS/);
  }
  assert.throws(() => parseShopTrackingForm(trackingForm({ trackingUrl: `https://tracking.example.invalid/${"x".repeat(1000)}` })));
});

test("fulfillment service keeps paid-state guards and transaction-bound notifications", async () => {
  const source = await readFile(new URL("../../lib/shop/fulfillment-service.ts", import.meta.url), "utf8");
  assert.match(source, /paymentStatus !== "PAID"/);
  assert.match(source, /paymentReviewAt !== null/);
  assert.match(source, /role: "ADMIN", status: "ACTIVE"/);
  assert.match(source, /ACTOR_NOT_ADMIN/);
  assert.match(source, /fulfillmentStatus !== "PENDING"/);
  assert.match(source, /fulfillmentStatus !== "PREPARING"/);
  assert.match(source, /fulfillmentStatus !== "READY_TO_SHIP"/);
  assert.match(source, /trackingSource: "MANUAL"/);
  assert.match(source, /trackingRevision: \{ increment: 1 \}/);
  assert.match(source, /TRACKING_REQUIRED/);
  assert.match(source, /enqueueShopPreparingNotification\(transaction, order\.id\)/);
  assert.match(source, /enqueueShopShippedNotification\(transaction, order\.id\)/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /shop-payments:order:\$\{shopOrderId\}/);
  assert.match(source, /FROM "shop_orders"[\s\S]*FOR UPDATE/);
  assert.match(source, /updateMany\([\s\S]*paymentReviewAt: null/);
  assert.match(source, /shopOrderLifecycleEvent\.create/);
});
