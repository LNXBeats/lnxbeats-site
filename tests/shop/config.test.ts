import assert from "node:assert/strict";
import test from "node:test";

import { parseShopConfiguration, shopHealthSummary } from "@/lib/shop/config";

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
    /forbidden in a production runtime/,
  );
  assert.equal(parseShopConfiguration({
    NODE_ENV: "test",
    SHOP_ENABLED: "true",
    SHOP_LOCAL_QA_CONFIRM: "enable-local-shop-commerce-qa",
    SITE_URL: "http://127.0.0.1:31760",
    SHOP_ALLOWED_COUNTRIES: "FR",
    SHOP_RESERVATION_TTL_MINUTES: "30",
  }).enabled, true);
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
