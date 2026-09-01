import assert from "node:assert/strict";
import test from "node:test";

import { assertMediaStorageKey } from "@/lib/media/storage/policy";
import { shopAfterSalesQaEnabled } from "@/lib/shop/after-sales-config";
import { parseShopConfiguration } from "@/lib/shop/config";
import { parseShopLegalConfiguration, SHOP_LEGAL_RELEASE_B_CANDIDATE_VERSION } from "@/lib/shop/legal";
import { shopMaintenanceEnabled, SHOP_MAINTENANCE_PRODUCTION_CONFIRMATION } from "@/lib/shop/maintenance-config";
import {
  isMetropolitanFranceDestination,
  isMetropolitanFrancePostalCode,
  normalizeMetropolitanFrancePostalCode,
} from "@/lib/shop/metropolitan-france";
import {
  SHOP_PRODUCTION_CONFIRMATION,
  SHOP_PRODUCTION_DATABASE_TARGET,
  SHOP_PRODUCTION_ORIGIN,
  isStrictShopProductionEnvironment,
} from "@/lib/shop/production-environment";
import { parseShopShippingConfiguration } from "@/lib/shop/shipping-config";
import {
  SHOP_COMMERCIAL_RATE_PRODUCTION_PREPARATION_CONFIRMATION,
  shopCommercialAdminPreparationEnabled,
} from "@/lib/shop/shipping-service";
import { shopShippingOperationsQaEnabled } from "@/lib/shop/shipping-operations-config";

function productionEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "production",
    LNX_DATABASE_TARGET: SHOP_PRODUCTION_DATABASE_TARGET,
    AUTH_URL: SHOP_PRODUCTION_ORIGIN,
    SITE_URL: SHOP_PRODUCTION_ORIGIN,
    SHOP_PRODUCTION_CONFIRM: SHOP_PRODUCTION_CONFIRMATION,
    SHOP_ENABLED: "true",
    SHOP_CUSTOMER_SCOPE: "INDIVIDUALS_ONLY",
    SHOP_ALLOWED_COUNTRIES: "FR",
    SHOP_RESERVATION_TTL_MINUTES: "30",
    SHOP_SHIPPING_ENABLED: "true",
    SHOP_SHIPPING_RATE_SCOPE: "COMMERCIAL_CANDIDATE",
    SHOP_LEGAL_READY: "true",
    SHOP_AFTER_SALES_ENABLED: "true",
    SHOP_AFTER_SALES_REFUND_PROVIDER: "disabled",
    SHOP_SHIPPING_OPERATIONS_ENABLED: "true",
    SHOP_SHIPPING_OPERATIONS_PROVIDER: "manual",
    SHOP_SHIPPING_PROVIDER_ENABLED: "false",
    SHOP_MAINTENANCE_ENABLED: "true",
    SHOP_MAINTENANCE_CONFIRM: SHOP_MAINTENANCE_PRODUCTION_CONFIRMATION,
    LIVE_REFUNDS_ENABLED: "false",
    MUSIC_PRICING_SOURCE: "legacy",
  };
}

test("Release B Production identity is exact and rejects staging, remote origins and wrong targets", () => {
  const exact = productionEnvironment();
  assert.equal(isStrictShopProductionEnvironment(exact), true);
  for (const changed of [
    { ...exact, RAILWAY_ENVIRONMENT_NAME: "staging" },
    { ...exact, RAILWAY_ENVIRONMENT: "preview" },
    { ...exact, LNX_DATABASE_TARGET: "lnx-studio-staging" },
    { ...exact, AUTH_URL: "https://lnxbeats.fr" },
    { ...exact, SITE_URL: "http://127.0.0.1:3000" },
    { ...exact, SHOP_PRODUCTION_CONFIRM: "wrong" },
  ]) assert.equal(isStrictShopProductionEnvironment(changed), false);
});

test("Production shipping, SAV, manual tracking and maintenance require their own exact gates", () => {
  const exact = productionEnvironment();
  assert.deepEqual(parseShopShippingConfiguration(exact), {
    enabled: true,
    scope: "COMMERCIAL_CANDIDATE",
    allowDraft: false,
    runtime: "PRODUCTION",
  });
  assert.equal(shopAfterSalesQaEnabled(exact), true);
  assert.equal(shopShippingOperationsQaEnabled(exact), true);
  assert.equal(shopMaintenanceEnabled(exact), true);
  assert.equal(shopMaintenanceEnabled({ ...exact, SHOP_MAINTENANCE_CONFIRM: "wrong" }), false);
  assert.equal(shopAfterSalesQaEnabled({ ...exact, LIVE_REFUNDS_ENABLED: "true" }), false);
  assert.equal(shopShippingOperationsQaEnabled({ ...exact, SHOP_SHIPPING_PROVIDER_ENABLED: "true" }), false);
});

test("Production Admin shipping preparation is separately armed while public Shop and shipping stay off", () => {
  const exact = {
    ...productionEnvironment(),
    SHOP_ENABLED: "false",
    SHOP_SHIPPING_ENABLED: "false",
    SHOP_LEGAL_READY: "false",
    SHOP_SHIPPING_ADMIN_PREPARATION_ENABLED: "true",
    SHOP_SHIPPING_ADMIN_PREPARATION_CONFIRM: SHOP_COMMERCIAL_RATE_PRODUCTION_PREPARATION_CONFIRMATION,
  };
  assert.equal(shopCommercialAdminPreparationEnabled(exact), true);
  assert.equal(shopCommercialAdminPreparationEnabled({ ...exact, SHOP_ENABLED: "true" }), false);
  assert.equal(shopCommercialAdminPreparationEnabled({ ...exact, SHOP_SHIPPING_ENABLED: "true" }), false);
  assert.equal(shopCommercialAdminPreparationEnabled({ ...exact, SHOP_SHIPPING_ADMIN_PREPARATION_CONFIRM: "wrong" }), false);
  assert.equal(parseShopConfiguration(exact).enabled, false);
  assert.equal(parseShopShippingConfiguration(exact).enabled, false);
});

test("the public Shop cannot be opened by booleans while Release B legal text remains a candidate", () => {
  const exact = {
    ...productionEnvironment(),
    SHOP_ENABLED: "true",
    SHOP_LEGAL_READY: "true",
    SHOP_TERMS_VERSION: SHOP_LEGAL_RELEASE_B_CANDIDATE_VERSION,
  };
  assert.throws(() => parseShopLegalConfiguration(exact), /human approval/);
  assert.throws(() => parseShopConfiguration(exact), /human approval/);
});

test("metropolitan France normalization includes Corsica and excludes overseas or ambiguous codes", () => {
  assert.equal(normalizeMetropolitanFrancePostalCode(" 75 005 "), "75005");
  for (const postalCode of ["01000", "20000", "20169", "20200", "75005", "95000"]) {
    assert.equal(isMetropolitanFranceDestination("FR", postalCode), true, postalCode);
  }
  for (const postalCode of ["00000", "2A000", "97100", "97400", "98000", "98800", "7500", "750000"]) {
    assert.equal(isMetropolitanFrancePostalCode(postalCode), false, postalCode);
  }
  assert.equal(isMetropolitanFranceDestination("BE", "75005"), false);
});

test("SAV object keys are server-generated private references under the dedicated prefix", () => {
  const key = "shop-returns/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg";
  assert.doesNotThrow(() => assertMediaStorageKey("private", key));
  assert.throws(() => assertMediaStorageKey("public", key));
  assert.throws(() => assertMediaStorageKey("private", "shop-returns/../../secret.jpg"));
  assert.throws(() => assertMediaStorageKey("private", "shop-returns/user-chosen/file.jpg"));
});
