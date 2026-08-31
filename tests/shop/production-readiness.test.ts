import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PHASE5E_COLISSIMO_FRANCE_2026_RATE } from "@/data/shop-shipping";
import { parseShopConfiguration } from "@/lib/shop/config";
import { parseCustomerRequestForm, ShopCustomerRequestError } from "@/lib/shop/customer-request-domain";
import { assertShopEvidenceCount, ShopEvidenceError, validateShopEvidenceUpload } from "@/lib/shop/evidence-domain";
import { addBusinessDays, savEvidencePurgeDueAt, savFirstAnalysisIsOverdue } from "@/lib/shop/readiness-domain";
import {
  assertShopProductionReadinessQaEnabled,
  SHOP_PHASE5E_CONFIRMATION,
  SHOP_PHASE5E_ORDER_SNAPSHOT_VERSION,
  SHOP_PHASE5E_ORIGIN,
  SHOP_PHASE5E_PREVIEW_TARGET,
  SHOP_PHASE5E_TERMS_VERSION,
} from "@/lib/shop/production-readiness-config";
import { quoteShipping, ShippingQuoteError } from "@/lib/shop/shipping-domain";
import { SHOP_LEGAL_QA_TERMS_HASH, SHOP_LEGAL_QA_TERMS_VERSION } from "@/lib/shop/legal";
import { SHOP_PAYMENT_PRICING_VERSION } from "@/lib/shop/payment-types";

function environment() {
  return {
    NODE_ENV: "test",
    LNX_DATABASE_TARGET: SHOP_PHASE5E_PREVIEW_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/private/tmp/prisma-dev-nodejs/${SHOP_PHASE5E_PREVIEW_TARGET}/server.json`,
    DATABASE_URL: "postgresql://127.0.0.1:51280/template1?schema=public",
    AUTH_URL: SHOP_PHASE5E_ORIGIN,
    SITE_URL: SHOP_PHASE5E_ORIGIN,
    SHOP_PRODUCTION_READINESS_QA: "true",
    SHOP_PRODUCTION_READINESS_QA_CONFIRM: SHOP_PHASE5E_CONFIRMATION,
    SHOP_ENABLED: "true",
    SHOP_CUSTOMER_SCOPE: "INDIVIDUALS_ONLY",
    SHOP_ALLOWED_COUNTRIES: "FR",
    SHOP_RESERVATION_TTL_MINUTES: "30",
    SHOP_SHIPPING_ENABLED: "true",
    SHOP_SHIPPING_RATE_SCOPE: "COMMERCIAL_CANDIDATE",
    SHOP_SHIPPING_QA_CONFIRM: SHOP_PHASE5E_CONFIRMATION,
    SHOP_PAYMENTS_ENABLED: "false",
    PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
    LIVE_REFUNDS_ENABLED: "false",
    NOTIFICATION_EMAIL_TRANSPORT: "capture",
    NOTIFICATION_WORKER_ENABLED: "false",
    SHOP_TERMS_VERSION: SHOP_LEGAL_QA_TERMS_VERSION,
    SHOP_ORDER_SNAPSHOT_VERSION: SHOP_PAYMENT_PRICING_VERSION,
    MUSIC_PRICING_SOURCE: "legacy",
  } as NodeJS.ProcessEnv;
}

test("Phase 5E launch contract is individuals-only, France-only, 30 minutes and fail-closed", () => {
  assert.doesNotThrow(() => assertShopProductionReadinessQaEnabled(environment()));
  assert.deepEqual(parseShopConfiguration({ ...environment(), SHOP_LOCAL_QA_CONFIRM: "enable-local-shop-commerce-qa" }), {
    enabled: true, pricingSource: "legacy", allowedCountries: ["FR"], reservationTtlMinutes: 30, commerceConfigured: true,
  });
  for (const mutation of [
    { SHOP_CUSTOMER_SCOPE: "BUSINESS" }, { SHOP_ALLOWED_COUNTRIES: "FR,BE" },
    { SHOP_RESERVATION_TTL_MINUTES: "31" }, { RAILWAY_ENVIRONMENT_NAME: "production" },
    { DATABASE_URL: "postgresql://127.0.0.1:5432/template1" }, { STRIPE_SECRET_KEY: "forbidden" },
  ]) assert.throws(() => assertShopProductionReadinessQaEnabled({ ...environment(), ...mutation }));
});

test("Phase 5E QA reuses the canonical legal and Shop payment identifiers", () => {
  assert.equal(SHOP_PHASE5E_TERMS_VERSION, SHOP_LEGAL_QA_TERMS_VERSION);
  assert.match(SHOP_LEGAL_QA_TERMS_HASH, /^[0-9a-f]{64}$/);
  assert.equal(SHOP_PHASE5E_ORDER_SNAPSHOT_VERSION, SHOP_PAYMENT_PRICING_VERSION);
});

test("commercial 2026 Colissimo tiers use product weight only and free 60 g packaging", () => {
  const rate = { ...PHASE5E_COLISSIMO_FRANCE_2026_RATE, id: "rate", status: "ACTIVE" as const, packagingProfile: { ...PHASE5E_COLISSIMO_FRANCE_2026_RATE.packaging, id: "package" } };
  const quote = (quantity: number) => quoteShipping({ rate, destinationCountryCode: "FR", lines: [{ productId: "cd", shippingRequired: true, shippingWeightGrams: 25, quantity }] });
  assert.deepEqual([quote(1).billableWeightGrams, quote(1).physicalWeightGrams, quote(1).amountCents], [25, 85, 549]);
  assert.deepEqual([quote(10).billableWeightGrams, quote(10).physicalWeightGrams, quote(10).amountCents], [250, 310, 549]);
  assert.deepEqual([quote(11).billableWeightGrams, quote(11).physicalWeightGrams, quote(11).amountCents], [275, 335, 759]);
  assert.equal(quote(16).amountCents, 759);
  assert.throws(() => quote(17), (error: unknown) => error instanceof ShippingQuoteError && error.code === "RATE_LIMIT_EXCEEDED");
  assert.equal(PHASE5E_COLISSIMO_FRANCE_2026_RATE.status, "DRAFT");
});

test("SAV evidence accepts zero photos at request time and validates 1/5/6, MIME, extension and magic", () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  assert.equal(validateShopEvidenceUpload({ name: "preuve.png", type: "image/png", bytes: png }).mimeType, "image/png");
  assert.doesNotThrow(() => assertShopEvidenceCount(0, 1));
  assert.doesNotThrow(() => assertShopEvidenceCount(0, 5));
  assert.throws(() => assertShopEvidenceCount(0, 6), ShopEvidenceError);
  assert.throws(() => validateShopEvidenceUpload({ name: "preuve.jpg", type: "image/png", bytes: png }), ShopEvidenceError);
  assert.throws(() => validateShopEvidenceUpload({ name: "../preuve.png", type: "image/png", bytes: png }), ShopEvidenceError);
});

test("SAV scheduler dates use five business days and ninety days after closure", () => {
  const friday = new Date("2026-08-28T12:00:00.000Z");
  assert.equal(addBusinessDays(friday, 5).toISOString(), "2026-09-04T12:00:00.000Z");
  assert.equal(savFirstAnalysisIsOverdue(friday, null, new Date("2026-09-04T12:00:01.000Z")), true);
  assert.equal(savFirstAnalysisIsOverdue(friday, friday, new Date("2027-01-01T00:00:00.000Z")), false);
  assert.equal(savEvidencePurgeDueAt(friday).toISOString(), "2026-11-26T12:00:00.000Z");
});

test("paid-order cancellation and France address correction requests require explicit confirmation", () => {
  const form = new FormData();
  form.set("orderNumber", "LNX-SHOP-2026-000001"); form.set("type", "SHIPPING_ADDRESS_CORRECTION");
  form.set("reason", "Adresse à corriger avant expédition."); form.set("confirmation", "CONFIRM_SHOP_CUSTOMER_REQUEST");
  form.set("firstName", "Jean"); form.set("lastName", "Test"); form.set("addressLine1", "5 rue du Test");
  form.set("postalCode", "75005"); form.set("city", "Paris"); form.set("countryCode", "FR");
  assert.equal(parseCustomerRequestForm(form).address?.countryCode, "FR");
  form.set("countryCode", "BE");
  assert.throws(() => parseCustomerRequestForm(form), ShopCustomerRequestError);
});

test("Phase 5E runbook distinguishes local readiness, activation and non-destructive rollback", async () => {
  const document = await readFile("docs/SHOP_PRODUCTION_READINESS_PHASE5E.md", "utf8");
  for (const fact of [
    "28 migrations", "colissimo-domicile-france-2026-v1", "particuliers", "France",
    "30 minutes", "90 jours", "cinq jours ouvrés", "SHOP_ENABLED", "prisma migrate reset",
    "https://www.lnxbeats.fr", "FAKE_LOCAL", "LOCAL FOUNDATION READY",
  ]) assert.match(document, new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(document, /n'autorise aucune promotion ni activation/i);
});
