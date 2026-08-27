import assert from "node:assert/strict";
import test from "node:test";

import { parseShopConfiguration, shopHealthSummary } from "@/lib/shop/config";

test("shop and database pricing remain fail-closed by default", () => {
  const configuration = parseShopConfiguration({});
  assert.deepEqual(configuration, { enabled: false, pricingSource: "legacy" });
  assert.deepEqual(shopHealthSummary(configuration), {
    enabled: false,
    pricingSource: "legacy",
  });
});

test("shop accepts only exact server-side flag values", () => {
  assert.equal(parseShopConfiguration({ SHOP_ENABLED: "false" }).enabled, false);
  assert.throws(() => parseShopConfiguration({ SHOP_ENABLED: "true" }), /foundation phase/);
  assert.throws(() => parseShopConfiguration({ SHOP_ENABLED: "TRUE" }), /SHOP_ENABLED/);
  assert.throws(() => parseShopConfiguration({ SHOP_ENABLED: "1" }), /SHOP_ENABLED/);
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
