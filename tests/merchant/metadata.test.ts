import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isValidGtin, parseMerchantMetadata } from "@/lib/merchant/metadata";
import { parseProductEditorInput } from "@/lib/shop/product-domain";

test("GTIN checksum, lengths and all-zero protection", () => {
  assert.equal(isValidGtin("4006381333931"), true);
  for (const value of ["4006381333932", "0000000000000", "123", "not-a-gtin"]) assert.equal(isValidGtin(value), false);
});
test("old callers preserve metadata; no inferred attributes", () => {
  assert.deepEqual(parseMerchantMetadata({ title: "Badge noir" }), {});
  assert.deepEqual(parseMerchantMetadata({ merchantColor: " Noir / Blanc " }), { merchantColor: "Noir / Blanc" });
  assert.deepEqual(parseMerchantMetadata({ merchantMpn: "" }), { merchantMpn: null });
});
test("invalid and contradictory metadata is rejected", () => {
  for (const input of [{ merchantGtin: "4006381333932" }, { merchantColor: "x\nsecret" }, { merchantMpn: 123 }, { merchantMpn: "X".repeat(71) }, { merchantIdentifiersAbsent: "yes" }, { merchantIdentifiersAbsent: true, merchantMpn: "REAL-MPN" }]) assert.throws(() => parseMerchantMetadata(input));
});
test("publication metadata cannot overwrite an existing official MPN", () => {
  assert.throws(() => parseProductEditorInput({ slug: "badge-lnx-beats", title: "Badge", description: "Badge", currency: "EUR", position: 0, shippingRequired: false, shippingPriceCents: 0, trackInventory: false, merchantMpn: "DIFFERENT" }));
});
test("feed and sitemap sources never merge editorial/external commerce entries", async () => {
  const route = await readFile(new URL("../../app/merchant-center.xml/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /listPublicExternalProducts|supportContribution|ShopSupportCard/);
  const source = await readFile(new URL("../../lib/shop/order-service.ts", import.meta.url), "utf8");
  const projection = source.slice(source.indexOf("const publicProductSelect"), source.indexOf("const publicProductSelect") + 1800);
  assert.match(projection, /updatedAt: true/);
  assert.match(projection, /merchantGtin: true/);
});
