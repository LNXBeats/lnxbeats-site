import assert from "node:assert/strict";
import test from "node:test";

import {
  handleShopShippingQuote,
  type ShopShippingQuoteRequestDependencies,
} from "@/lib/shop/shipping-quote-request";

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "MEMBER" as const,
};
const productId = "22222222-2222-4222-8222-222222222222";

function request(body: unknown) {
  return new Request("http://127.0.0.1:31775/api/shop/shipping/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dependencies(
  overrides: Partial<ShopShippingQuoteRequestDependencies> = {},
): ShopShippingQuoteRequestDependencies {
  return {
    allowed: () => true,
    actor: async () => actor,
    readJson: async (input) => input.json(),
    quote: async () => ({
      subtotalCents: 2_000,
      shippingCents: 400,
      totalCents: 2_400,
      currency: "EUR",
      shippingRequired: true,
      shippingQuoteVersion: "phase5a-qa-internal-v1",
      shippingMethod: "STANDARD_TRACKED_SIGNATURE",
      shippingWeightGrams: 100,
      shippingPhysicalGrams: 160,
      shippingBillableGrams: 150,
      shippingTierMaxGrams: 250,
    }),
    ...overrides,
  };
}

const validPayload = {
  items: [{ productId, quantity: 1, observedLockVersion: 1 }],
};

test("shipping quote rejects origin and authentication before calculation", async () => {
  let calls = 0;
  const denied = await handleShopShippingQuote(request(validPayload), dependencies({
    allowed: () => false,
    actor: async () => {
      calls += 1;
      return actor;
    },
    quote: async () => {
      calls += 1;
      throw new Error("unreachable");
    },
  }));
  assert.deepEqual(denied, {
    status: 403,
    body: { ok: false, code: "ORIGIN_REFUSED", message: "Origine refusée." },
  });
  assert.equal(calls, 0);

  const unauthenticated = await handleShopShippingQuote(request(validPayload), dependencies({
    actor: async () => null,
    quote: async () => {
      calls += 1;
      throw new Error("unreachable");
    },
  }));
  assert.equal(unauthenticated.status, 401);
  assert.equal(calls, 0);
});

test("shipping quote accepts only cart identity and returns the server snapshot", async () => {
  let capturedItems: readonly unknown[] | undefined;
  const result = await handleShopShippingQuote(request(validPayload), dependencies({
    quote: async (_actor, intent) => {
      capturedItems = intent.items;
      return dependencies().quote(_actor, intent);
    },
  }));
  assert.deepEqual(capturedItems, validPayload.items);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    quote: {
      subtotalCents: 2_000,
      shippingCents: 400,
      totalCents: 2_400,
      currency: "EUR",
      shippingRequired: true,
      shippingQuoteVersion: "phase5a-qa-internal-v1",
      shippingMethod: "STANDARD_TRACKED_SIGNATURE",
      shippingWeightGrams: 100,
      shippingPhysicalGrams: 160,
      shippingBillableGrams: 150,
      shippingTierMaxGrams: 250,
    },
  });
});

test("shipping quote rejects browser prices and arbitrary fields", async () => {
  let called = false;
  const result = await handleShopShippingQuote(request({
    ...validPayload,
    shippingCents: 1,
  }), dependencies({
    quote: async () => {
      called = true;
      throw new Error("unreachable");
    },
  }));
  assert.equal(result.status, 422);
  assert.equal(result.body.code, "INVALID_PAYLOAD");
  assert.equal(called, false);
});

test("shipping quote does not accept a browser-selected address or tariff version", async () => {
  let called = false;
  const result = await handleShopShippingQuote(request({
    ...validPayload,
    shippingAddress: { countryCode: "FR" },
    shippingQuoteVersion: "browser-controlled",
  }), dependencies({
    quote: async () => {
      called = true;
      throw new Error("unreachable");
    },
  }));
  assert.equal(result.status, 422);
  assert.equal(result.body.code, "INVALID_PAYLOAD");
  assert.equal(called, false);
});
