import assert from "node:assert/strict";
import test from "node:test";

import { parseShopConfiguration, shopHealthSummary } from "@/lib/shop/config";
import {
  SHOP_PHASE5E_CONFIRMATION,
  SHOP_PHASE5E_ORIGIN,
  SHOP_PHASE5E_PREVIEW_TARGET,
} from "@/lib/shop/production-readiness-config";

function phase5ePreviewEnvironment() {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://127.0.0.1:51280/template1?schema=public",
    LNX_DATABASE_TARGET: SHOP_PHASE5E_PREVIEW_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/tmp/prisma-dev-nodejs/${SHOP_PHASE5E_PREVIEW_TARGET}/server.json`,
    AUTH_URL: SHOP_PHASE5E_ORIGIN,
    SITE_URL: SHOP_PHASE5E_ORIGIN,
    SHOP_PRODUCTION_READINESS_QA: "true",
    SHOP_PRODUCTION_READINESS_QA_CONFIRM: SHOP_PHASE5E_CONFIRMATION,
    SHOP_ENABLED: "true",
    SHOP_LOCAL_QA_CONFIRM: "enable-local-shop-commerce-qa",
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
    SHOP_TERMS_VERSION: "shop-cgv-phase3-qa-v1",
    SHOP_ORDER_SNAPSHOT_VERSION: "shop-order-v1",
    MUSIC_PRICING_SOURCE: "legacy",
  } as const;
}

test("shop and database pricing remain fail-closed by default", () => {
  const configuration = parseShopConfiguration({});
  assert.deepEqual(configuration, {
    enabled: false,
    pricingSource: "legacy",
    allowedCountries: [],
    reservationTtlMinutes: 0,
    commerceConfigured: false,
  });
  assert.deepEqual(shopHealthSummary(configuration), {
    enabled: false,
    pricingSource: "legacy",
    commerceConfigured: false,
  });
});

test("shop accepts only exact server-side flag values", () => {
  assert.equal(parseShopConfiguration({ SHOP_ENABLED: "false" }).enabled, false);
  assert.throws(() => parseShopConfiguration({ SHOP_ENABLED: "true" }), /SHOP_LOCAL_QA_CONFIRM/);
  assert.throws(
    () => parseShopConfiguration({
      SHOP_ENABLED: "true",
      SHOP_LOCAL_QA_CONFIRM: "enable-local-shop-commerce-qa",
      SITE_URL: "https://preview.example.com",
    }),
    /loopback preview/,
  );
  assert.throws(
    () => parseShopConfiguration({
      NODE_ENV: "production",
      SHOP_ENABLED: "true",
      SHOP_LOCAL_QA_CONFIRM: "enable-local-shop-commerce-qa",
      SITE_URL: "http://127.0.0.1:31760",
    }),
    /forbidden outside a confirmed Shop Production runtime/,
  );
  assert.equal(parseShopConfiguration({
    NODE_ENV: "test",
    SHOP_ENABLED: "true",
    SHOP_LOCAL_QA_CONFIRM: "enable-local-shop-commerce-qa",
    SITE_URL: "http://127.0.0.1:31760",
    SHOP_ALLOWED_COUNTRIES: "FR",
    SHOP_RESERVATION_TTL_MINUTES: "30",
  }).enabled, true);
  assert.equal(parseShopConfiguration(phase5ePreviewEnvironment()).enabled, true);
  assert.throws(
    () => parseShopConfiguration({ ...phase5ePreviewEnvironment(), RAILWAY_ENVIRONMENT: "production" }),
    /forbidden outside a confirmed Shop Production runtime/,
  );
  assert.throws(() => parseShopConfiguration({ SHOP_ENABLED: "TRUE" }), /SHOP_ENABLED/);
  assert.throws(() => parseShopConfiguration({ SHOP_ENABLED: "1" }), /SHOP_ENABLED/);
});

test("shop validates countries and reservation TTL while staying configured when disabled", () => {
  const configuration = parseShopConfiguration({
    SHOP_ALLOWED_COUNTRIES: "FR,BE",
    SHOP_RESERVATION_TTL_MINUTES: "45",
  });
  assert.deepEqual(configuration.allowedCountries, ["FR", "BE"]);
  assert.equal(configuration.reservationTtlMinutes, 45);
  assert.equal(configuration.commerceConfigured, true);
  assert.throws(() => parseShopConfiguration({ SHOP_ALLOWED_COUNTRIES: "fr" }), /ISO 3166-1/);
  assert.throws(() => parseShopConfiguration({ SHOP_ALLOWED_COUNTRIES: "FR,FR" }), /duplicates/);
  assert.throws(() => parseShopConfiguration({ SHOP_RESERVATION_TTL_MINUTES: "4" }), /between 5 and 120/);
  assert.throws(() => parseShopConfiguration({ SHOP_RESERVATION_TTL_MINUTES: "121" }), /between 5 and 120/);
  assert.throws(
    () => parseShopConfiguration({
      NODE_ENV: "test",
      SHOP_ENABLED: "true",
      SHOP_LOCAL_QA_CONFIRM: "enable-local-shop-commerce-qa",
      SITE_URL: "http://127.0.0.1:31760",
    }),
    /SHOP_ALLOWED_COUNTRIES and SHOP_RESERVATION_TTL_MINUTES/,
  );
});

test("pricing source stays on the V1 legacy runtime until the financial cutover", () => {
  assert.equal(parseShopConfiguration({ MUSIC_PRICING_SOURCE: "legacy" }).pricingSource, "legacy");
  assert.throws(
    () => parseShopConfiguration({ MUSIC_PRICING_SOURCE: "database" }),
    /financial cutover/,
  );
  assert.throws(
    () => parseShopConfiguration({ MUSIC_PRICING_SOURCE: "fallback" }),
    /MUSIC_PRICING_SOURCE/,
  );
});
