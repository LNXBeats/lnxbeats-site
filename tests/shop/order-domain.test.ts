import assert from "node:assert/strict";
import test from "node:test";

import {
  assertShippingAddress,
  checkedMoney,
  getAvailableProductQuantity,
  parseShopIdempotencyKey,
  parseShopOrderCancellationFormData,
  parseShopOrderIntent,
  shopOrderIntentFingerprint,
} from "@/lib/shop/order-domain";
import { effectiveShopOrderStatus } from "@/lib/shop/order-presentation";

const firstProduct = "11111111-1111-4111-8111-111111111111";
const secondProduct = "22222222-2222-4222-8222-222222222222";

test("shop order intent is closed, normalized and deterministically fingerprinted", () => {
  const intent = parseShopOrderIntent({
    items: [
      { productId: secondProduct, quantity: 1, observedLockVersion: 7 },
      { productId: firstProduct, quantity: 2, observedLockVersion: 3 },
      { productId: firstProduct, quantity: 1, observedLockVersion: 3 },
    ],
    shippingAddress: {
      firstName: "  Camille ",
      lastName: "Test",
      addressLine1: "1 rue Locale",
      addressLine2: "",
      postalCode: "75001",
      city: "Paris",
      countryCode: "FR",
    },
  });
  assert.deepEqual(intent.items, [
    { productId: firstProduct, quantity: 3, observedLockVersion: 3 },
    { productId: secondProduct, quantity: 1, observedLockVersion: 7 },
  ]);
  assert.equal(intent.shippingAddress?.firstName, "Camille");
  assert.equal(intent.shippingAddress?.addressLine2, null);
  assert.equal(shopOrderIntentFingerprint(intent), shopOrderIntentFingerprint(parseShopOrderIntent({
    items: [
      { productId: firstProduct, quantity: 3, observedLockVersion: 3 },
      { productId: secondProduct, quantity: 1, observedLockVersion: 7 },
    ],
    shippingAddress: intent.shippingAddress,
  })));
  assert.throws(
    () => parseShopOrderIntent({ items: [{ productId: firstProduct, quantity: 1, observedLockVersion: 1, priceCents: 1 }] }),
    /champ inattendu/,
  );
  assert.throws(
    () => parseShopOrderIntent({ items: [{ productId: firstProduct, quantity: 21, observedLockVersion: 1 }] }),
    /comprise entre 1 et 20/,
  );
});

test("shop idempotency keys accept only UUID values", () => {
  assert.equal(
    parseShopIdempotencyKey("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  assert.throws(() => parseShopIdempotencyKey("client-order-1"), /invalide/);
  assert.throws(() => parseShopIdempotencyKey(null), /invalide/);
});

test("shipping country, money and stock helpers fail closed", () => {
  const address = parseShopOrderIntent({
    items: [{ productId: firstProduct, quantity: 1, observedLockVersion: 1 }],
    shippingAddress: {
      firstName: "Camille",
      lastName: "Test",
      addressLine1: "1 rue Locale",
      postalCode: "75001",
      city: "Paris",
      countryCode: "FR",
    },
  }).shippingAddress;
  assert.equal(assertShippingAddress(address, ["FR"]).countryCode, "FR");
  assert.throws(() => assertShippingAddress(address, ["BE"]), /pas disponible/);
  assert.equal(checkedMoney(2_000, 500, 300), 2_800);
  assert.throws(() => checkedMoney(100_000_000, 1), /trop élevé/);
  assert.equal(getAvailableProductQuantity({ trackInventory: true, stock: 3, activeReserved: 2 }), 1);
  assert.equal(getAvailableProductQuantity({ trackInventory: true, stock: 1, activeReserved: 2 }), 0);
  assert.equal(getAvailableProductQuantity({ trackInventory: false, stock: null, activeReserved: 0 }), null);
});

test("member cancellation form ignores only React action metadata and stays closed", () => {
  const valid = new FormData();
  valid.set("$ACTION_ID_test", "metadata");
  valid.set("orderNumber", "LNX-SHOP-2026-000001");
  valid.set("confirmation", "CONFIRM_SHOP_ORDER_CANCELLATION");
  assert.deepEqual(parseShopOrderCancellationFormData(valid), {
    orderNumber: "LNX-SHOP-2026-000001",
    confirmation: "CONFIRM_SHOP_ORDER_CANCELLATION",
  });

  const unexpected = new FormData();
  unexpected.set("orderNumber", "LNX-SHOP-2026-000001");
  unexpected.set("confirmation", "CONFIRM_SHOP_ORDER_CANCELLATION");
  unexpected.set("userId", firstProduct);
  assert.throws(() => parseShopOrderCancellationFormData(unexpected), /invalide/);

  const duplicate = new FormData();
  duplicate.append("orderNumber", "LNX-SHOP-2026-000001");
  duplicate.append("orderNumber", "LNX-SHOP-2026-000002");
  duplicate.set("confirmation", "CONFIRM_SHOP_ORDER_CANCELLATION");
  assert.throws(() => parseShopOrderCancellationFormData(duplicate), /invalide/);

  const duplicateActionMetadata = new FormData();
  duplicateActionMetadata.append("$ACTION_ID_test", "metadata");
  duplicateActionMetadata.append("$ACTION_ID_test", "metadata");
  duplicateActionMetadata.set("orderNumber", "LNX-SHOP-2026-000001");
  duplicateActionMetadata.set("confirmation", "CONFIRM_SHOP_ORDER_CANCELLATION");
  assert.throws(() => parseShopOrderCancellationFormData(duplicateActionMetadata), /invalide/);
});

test("an elapsed active reservation is presented as expired before cleanup", () => {
  const order = {
    status: "OPEN" as const,
    paymentStatus: "AWAITING_PAYMENT" as const,
    reservationExpiresAt: new Date("2026-08-27T12:00:00.000Z"),
  };
  assert.equal(effectiveShopOrderStatus(order, new Date("2026-08-27T11:59:59.999Z")), "OPEN");
  assert.equal(effectiveShopOrderStatus(order, new Date("2026-08-27T12:00:00.000Z")), "EXPIRED");
  assert.equal(effectiveShopOrderStatus({ ...order, paymentStatus: "PAID" }, new Date("2026-08-28T12:00:00.000Z")), "OPEN");
});
