import assert from "node:assert/strict";
import test from "node:test";

import { SHOP_SHIPPING_QA_CONFIRMATION, parseShopShippingConfiguration } from "@/lib/shop/shipping-config";
import {
  quoteShipping,
  ShippingQuoteError,
  type ShippingRateDefinition,
} from "@/lib/shop/shipping-domain";

const rate: ShippingRateDefinition = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  version: "phase5a-test-v1",
  status: "ACTIVE",
  scope: "INTERNAL_QA",
  service: "STANDARD_TRACKED_SIGNATURE",
  currency: "EUR",
  countryCode: "FR",
  minimumBillableWeightGrams: 150,
  packagingWeightGrams: 0,
  tiers: Object.freeze([
    Object.freeze({ position: 0, maxWeightGrams: 250, priceCents: 400 }),
    Object.freeze({ position: 1, maxWeightGrams: 500, priceCents: 600 }),
    Object.freeze({ position: 2, maxWeightGrams: 1_000, priceCents: 800 }),
  ]),
});

function quote(weight: number, quantity = 1, override: Partial<ShippingRateDefinition> = {}) {
  return quoteShipping({
    rate: { ...rate, ...override },
    destinationCountryCode: "FR",
    lines: [{ productId: "product", shippingRequired: true, shippingWeightGrams: weight, quantity }],
  });
}

test("shipping quotes use integer grams, the documented 150 g minimum and deterministic tiers", () => {
  assert.deepEqual(quote(100), {
    required: true,
    rateVersionId: rate.id,
    version: rate.version,
    service: "STANDARD_TRACKED_SIGNATURE",
    currency: "EUR",
    countryCode: "FR",
    productWeightGrams: 100,
    packagingWeightGrams: 0,
    physicalWeightGrams: 100,
    billableWeightGrams: 150,
    billableWeightPolicy: "PACKAGED",
    packagingProfileId: null,
    packagingProfileVersion: null,
    amountCents: 400,
    tierPosition: 0,
    tierMaximumWeightGrams: 250,
  });
  assert.equal(quote(250).amountCents, 400, "the exact tier boundary stays in its tier");
  assert.equal(quote(251).amountCents, 600, "the next gram selects the next tier");
  assert.equal(quote(250, 2).amountCents, 600, "quantity participates in server weight");
});

test("shipping quotes aggregate only shippable lines without trusting a browser price", () => {
  const result = quoteShipping({
    rate,
    destinationCountryCode: "FR",
    lines: [
      { productId: "one", shippingRequired: true, shippingWeightGrams: 120, quantity: 2 },
      { productId: "two", shippingRequired: true, shippingWeightGrams: 260, quantity: 1 },
      { productId: "digital", shippingRequired: false, shippingWeightGrams: null, quantity: 20 },
    ],
  });
  assert.equal(result.productWeightGrams, 500);
  assert.equal(result.amountCents, 600);
});

test("shipping quote inputs fail closed for unsafe weights, destinations and grids", () => {
  const code = (callback: () => unknown) => assert.throws(
    callback,
    (error: unknown) => error instanceof ShippingQuoteError && Boolean(error.code),
  );
  code(() => quote(0));
  code(() => quote(-1));
  code(() => quote(30_001));
  code(() => quote(1_000, 2));
  code(() => quoteShipping({
    rate,
    destinationCountryCode: "BE",
    lines: [{ productId: "one", shippingRequired: true, shippingWeightGrams: 100, quantity: 1 }],
  }));
  code(() => quote(100, 1, { status: "DRAFT" }));
  code(() => quote(100, 1, { status: "RETIRED" }));
  code(() => quote(100, 1, { currency: "USD" }));
  code(() => quote(100, 1, { tiers: [{ position: 1, maxWeightGrams: 250, priceCents: 400 }] }));
  code(() => quote(100, 1, { tiers: [
    { position: 0, maxWeightGrams: 500, priceCents: 400 },
    { position: 1, maxWeightGrams: 250, priceCents: 600 },
  ] }));
  code(() => quote(1_001));
});

test("the internal QA shipping gate is disabled by default and impossible in production or Railway", () => {
  assert.deepEqual(parseShopShippingConfiguration({} as NodeJS.ProcessEnv), { enabled: false, scope: "INTERNAL_QA" });
  const enabled = {
    NODE_ENV: "test",
    SHOP_ENABLED: "true",
    SHOP_SHIPPING_ENABLED: "true",
    SHOP_SHIPPING_QA_CONFIRM: SHOP_SHIPPING_QA_CONFIRMATION,
    AUTH_URL: "http://127.0.0.1:3000",
  } as NodeJS.ProcessEnv;
  assert.equal(parseShopShippingConfiguration(enabled).enabled, true);
  for (const environment of [
    { ...enabled, NODE_ENV: "production" },
    { ...enabled, RAILWAY_ENVIRONMENT: "production" },
    { ...enabled, AUTH_URL: "https://www.lnxbeats.fr" },
    { ...enabled, SHOP_SHIPPING_QA_CONFIRM: "wrong" },
    { ...enabled, SHOP_ENABLED: "false" },
  ]) {
    assert.throws(() => parseShopShippingConfiguration(environment as NodeJS.ProcessEnv), /QA_CONTEXT_REQUIRED/);
  }
  assert.throws(
    () => parseShopShippingConfiguration({ SHOP_SHIPPING_ENABLED: "yes" } as unknown as NodeJS.ProcessEnv),
    /INVALID_FLAG/,
  );
});
