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

/**
 * Phase 5E commercial candidate copied in integer cents from the Colissimo
 * Domicile France 2026 public schedule supplied for this sprint. It is seeded
 * as DRAFT and can only become active through the explicit Admin workflow.
 */
export const PHASE5E_COLISSIMO_FRANCE_2026_RATE = Object.freeze({
  version: "colissimo-domicile-france-2026-v1",
  status: "DRAFT" as const,
  scope: "COMMERCIAL_CANDIDATE" as const,
  service: "COLISSIMO_HOME_FRANCE" as const,
  currency: "EUR" as const,
  countryCode: "FR" as const,
  minimumBillableWeightGrams: 1,
  packagingWeightGrams: 60,
  billableWeightPolicy: "PRODUCTS_ONLY" as const,
  sourceLabel: "Colissimo Domicile France · tarif candidat 2026",
  validFrom: "2026-01-01",
  packaging: Object.freeze({
    version: "carton-cd-60g-v1",
    name: "Carton CD",
    status: "DRAFT" as const,
    physicalWeightGrams: 60,
    maximumItemQuantity: 16,
    customerBillableWeightIncluded: false,
  }),
  tiers: Object.freeze([
    Object.freeze({ position: 0, maxWeightGrams: 250, priceCents: 549 }),
    Object.freeze({ position: 1, maxWeightGrams: 500, priceCents: 759 }),
    Object.freeze({ position: 2, maxWeightGrams: 750, priceCents: 929 }),
    Object.freeze({ position: 3, maxWeightGrams: 1_000, priceCents: 959 }),
    Object.freeze({ position: 4, maxWeightGrams: 2_000, priceCents: 1_119 }),
    Object.freeze({ position: 5, maxWeightGrams: 5_000, priceCents: 1_739 }),
    Object.freeze({ position: 6, maxWeightGrams: 10_000, priceCents: 2_529 }),
    Object.freeze({ position: 7, maxWeightGrams: 15_000, priceCents: 3_199 }),
    Object.freeze({ position: 8, maxWeightGrams: 30_000, priceCents: 3_959 }),
  ]),
});
