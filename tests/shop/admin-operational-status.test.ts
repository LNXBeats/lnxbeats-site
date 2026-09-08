import assert from "node:assert/strict";
import test from "node:test";

import { getShopAdminOperationalStatus } from "@/lib/shop/admin-operational-status";

test("the Admin operational strip derives a fail-closed disabled baseline from runtime flags", () => {
  assert.deepEqual(getShopAdminOperationalStatus({
    NODE_ENV: "test",
    SHOP_ENABLED: "false",
    SHOP_PAYMENTS_ENABLED: "false",
    SHOP_SHIPPING_ENABLED: "false",
    SHOP_AFTER_SALES_ENABLED: "false",
    SHOP_AFTER_SALES_REFUND_PROVIDER: "disabled",
    SHOP_SHIPPING_OPERATIONS_ENABLED: "false",
    SHOP_SHIPPING_PROVIDER_ENABLED: "false",
    MUSIC_PRICING_SOURCE: "legacy",
  }), {
    shop: "CLOSED", payments: "INACTIVE", shipping: "INACTIVE", afterSales: "INACTIVE",
    tracking: "INACTIVE", carrierApi: "DISABLED",
  });
});

test("invalid or partial flags are exposed as blocked instead of optimistic OPEN labels", () => {
  const status = getShopAdminOperationalStatus({
    NODE_ENV: "production",
    SHOP_ENABLED: "yes",
    SHOP_PAYMENTS_ENABLED: "true",
    SHOP_SHIPPING_ENABLED: "true",
    SHOP_AFTER_SALES_ENABLED: "true",
    SHOP_AFTER_SALES_REFUND_PROVIDER: "payments",
    SHOP_SHIPPING_OPERATIONS_ENABLED: "true",
    SHOP_SHIPPING_PROVIDER_ENABLED: "maybe",
  });
  assert.equal(status.shop, "BLOCKED");
  assert.equal(status.payments, "BLOCKED");
  assert.equal(status.carrierApi, "BLOCKED");
});
