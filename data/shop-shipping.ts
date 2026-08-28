import {
  SHOP_SHIPPING_COUNTRY,
  SHOP_SHIPPING_CURRENCY,
  SHOP_SHIPPING_MINIMUM_BILLABLE_GRAMS,
  SHOP_SHIPPING_SCOPE,
  SHOP_SHIPPING_SERVICE,
} from "@/lib/shop/shipping-domain";

/**
 * Deterministic Phase 5A fixture. These values are internal QA data, are not
 * sourced from La Poste and must never be presented as contractual tariffs.
 */
export const PHASE5A_QA_SHIPPING_RATE = Object.freeze({
  version: "phase5a-qa-internal-v1",
  status: "ACTIVE" as const,
  scope: SHOP_SHIPPING_SCOPE,
  service: SHOP_SHIPPING_SERVICE,
  currency: SHOP_SHIPPING_CURRENCY,
  countryCode: SHOP_SHIPPING_COUNTRY,
  minimumBillableWeightGrams: SHOP_SHIPPING_MINIMUM_BILLABLE_GRAMS,
  packagingWeightGrams: 0,
  tiers: Object.freeze([
    Object.freeze({ position: 0, maxWeightGrams: 250, priceCents: 400 }),
    Object.freeze({ position: 1, maxWeightGrams: 500, priceCents: 600 }),
    Object.freeze({ position: 2, maxWeightGrams: 1_000, priceCents: 800 }),
    Object.freeze({ position: 3, maxWeightGrams: 2_000, priceCents: 1_000 }),
    Object.freeze({ position: 4, maxWeightGrams: 5_000, priceCents: 1_400 }),
    Object.freeze({ position: 5, maxWeightGrams: 30_000, priceCents: 2_000 }),
  ]),
});
