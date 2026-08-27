import assert from "node:assert/strict";
import test from "node:test";

import { handleCreateShopOrder, type ShopOrderRequestDependencies } from "@/lib/shop/order-request";
import { ShopServiceError } from "@/lib/shop/order-service";

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "MEMBER" as const,
};
const productId = "22222222-2222-4222-8222-222222222222";
const creationToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function request(body: unknown, key = creationToken) {
  return new Request("http://127.0.0.1:31760/api/shop/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

function dependencies(
  overrides: Partial<ShopOrderRequestDependencies> = {},
): ShopOrderRequestDependencies {
  return {
    allowed: () => true,
    actor: async () => actor,
    readJson: async (input) => input.json(),
    create: async () => ({
      orderNumber: "LNX-SHOP-2026-000001",
      status: "OPEN",
      paymentStatus: "AWAITING_PAYMENT",
      subtotalCents: 2_000,
      shippingCents: 500,
      totalCents: 2_500,
      currency: "EUR",
      reservationExpiresAt: new Date("2026-08-27T13:00:00.000Z"),
    }),
    ...overrides,
  };
}

test("shop order route refuses origin and unauthenticated actors before creating", async () => {
  let called = false;
  const denied = await handleCreateShopOrder(request({ items: [] }), dependencies({
    allowed: () => false,
    create: async () => {
      called = true;
      throw new Error("unreachable");
    },
  }));
  assert.equal(denied.status, 403);
  assert.equal(called, false);

  const unauthenticated = await handleCreateShopOrder(request({ items: [] }), dependencies({
    actor: async () => null,
  }));
  assert.equal(unauthenticated.status, 401);
});

test("shop order route accepts only cart identity and returns server totals", async () => {
  let capturedQuantity = 0;
  const result = await handleCreateShopOrder(request({
    items: [{ productId, quantity: 2, observedLockVersion: 4 }],
    shippingAddress: null,
  }), dependencies({
    create: async (_actor, intent, key) => {
      assert.equal(key, creationToken);
      capturedQuantity = intent.items[0]?.quantity ?? 0;
      return {
        orderNumber: "LNX-SHOP-2026-000001",
        status: "OPEN",
        paymentStatus: "AWAITING_PAYMENT",
        subtotalCents: 4_000,
        shippingCents: 1_000,
        totalCents: 5_000,
        currency: "EUR",
        reservationExpiresAt: new Date("2026-08-27T13:00:00.000Z"),
      };
    },
  }));
  assert.equal(result.status, 201);
  assert.equal(capturedQuantity, 2);
  assert.deepEqual(result.body.order, {
    orderNumber: "LNX-SHOP-2026-000001",
    status: "OPEN",
    paymentStatus: "AWAITING_PAYMENT",
    subtotalCents: 4_000,
    shippingCents: 1_000,
    totalCents: 5_000,
    currency: "EUR",
    reservationExpiresAt: "2026-08-27T13:00:00.000Z",
  });
});

test("shop order route rejects forged prices, malformed keys and idempotency conflicts", async () => {
  const forged = await handleCreateShopOrder(request({
    items: [{ productId, quantity: 1, observedLockVersion: 4, priceCents: 1 }],
  }), dependencies());
  assert.equal(forged.status, 422);
  assert.equal(forged.body.code, "INVALID_PAYLOAD");

  const malformed = await handleCreateShopOrder(request({
    items: [{ productId, quantity: 1, observedLockVersion: 4 }],
  }, "not-a-uuid"), dependencies());
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, "INVALID_IDEMPOTENCY_KEY");

  const conflict = await handleCreateShopOrder(request({
    items: [{ productId, quantity: 1, observedLockVersion: 4 }],
  }), dependencies({
    create: async () => {
      throw new ShopServiceError("Clé réutilisée.", "IDEMPOTENCY_CONFLICT", 409);
    },
  }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");

  const changed = await handleCreateShopOrder(request({
    items: [{ productId, quantity: 1, observedLockVersion: 4 }],
  }), dependencies({
    create: async () => {
      throw new ShopServiceError("Produit modifié.", "PRODUCT_CHANGED", 409, productId);
    },
  }));
  assert.equal(changed.status, 409);
  assert.equal(changed.body.productId, productId);

  for (const [code, message] of [
    ["OUT_OF_STOCK", "Stock insuffisant."],
    ["PRODUCT_UNAVAILABLE", "Produit indisponible."],
  ] as const) {
    const unavailable = await handleCreateShopOrder(request({
      items: [{ productId, quantity: 1, observedLockVersion: 4 }],
    }), dependencies({
      create: async () => {
        throw new ShopServiceError(message, code, 409, productId);
      },
    }));
    assert.equal(unavailable.status, 409);
    assert.equal(unavailable.body.code, code);
    assert.equal(unavailable.body.productId, productId);
  }
});
