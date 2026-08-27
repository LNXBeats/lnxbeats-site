import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ShopOrder service keeps ownership, kill switch and PostgreSQL locking at the server boundary", async () => {
  const [service, route, memberPage, adminDetail] = await Promise.all([
    readFile(new URL("../../lib/shop/order-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/shop/orders/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/compte/achats/[orderNumber]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/commandes/[orderNumber]/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(service, /const configuration = configurationForCreation\(\);[\s\S]*withShopTransaction/);
  assert.match(service, /where:\s*\{ userId, orderNumber \}/);
  assert.match(service, /findFirst\(\{[\s\S]*where:\s*\{ userId, orderNumber \}/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /shop-order:rate-limit:\$\{actor\.id\}/);
  assert.match(service, /product\.lockVersion !== item\.observedLockVersion/);
  assert.match(service, /"PRODUCT_CHANGED"/);
  assert.match(memberPage, /getMemberShopOrder\(session\.user\.id, orderNumber\)/);
  assert.match(memberPage, /item\.reservation\?\.status === "EXPIRED"/);
  assert.match(adminDetail, /requireAdmin\(\)/);
  assert.doesNotMatch(`${service}\n${route}`, /@\/lib\/payments|stripe|paypal|ProviderEvent/);
  assert.doesNotMatch(route, /confirmShopOrderPayment|paymentStatus:\s*["']PAID/);
});

test("the internal payment-confirmation preparation has no public Phase 2 call site", async () => {
  const routeSources = await Promise.all([
    readFile(new URL("../../app/api/shop/orders/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/compte/achats/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/actions.ts", import.meta.url), "utf8"),
  ]);
  assert.ok(routeSources.every((source) => !source.includes("confirmShopOrderPayment")));
});
