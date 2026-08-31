import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ShopOrder creation recalculates and snapshots one server shipping quote", async () => {
  const [service, cart, route, migration] = await Promise.all([
    readFile(new URL("../../lib/shop/order-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../components/shop-cart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/shop/shipping/quote/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../prisma/migrations/20260828220000_shop_shipping_quotes/migration.sql", import.meta.url), "utf8"),
  ]);

  assert.match(service, /quoteVersionedShopShipping\(transaction/);
  assert.match(service, /intent\.shippingQuoteVersion !== shipping\.quote\.version/);
  assert.match(service, /shippingCents:\s*quote\.amountCents/);
  assert.match(service, /unitShippingCents:\s*0/);
  assert.match(service, /lineShippingCents:\s*0/);
  assert.doesNotMatch(service, /shippingPriceCents\s*\*\s*item\.quantity/);
  assert.match(cart, /fetch\("\/api\/shop\/shipping\/quote"/);
  assert.doesNotMatch(cart, /shippingPriceCents\s*\*/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(migration, /shipping_rate_versions_used_definition_immutable/);
  assert.match(migration, /shipping_rate_tiers_used_immutable/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
});

test("the logistics UI distinguishes internal QA from the inactive commercial candidate without carrier network", async () => {
  const [admin, fixture, packageJson] = await Promise.all([
    readFile(new URL("../../app/admin/boutique/logistique/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../data/shop-shipping.ts", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /QA interne non contractuelle/);
  assert.match(admin, /Candidate France · activation Admin requise/);
  assert.match(admin, /Aucun achat d’étiquette, appel transporteur/);
  assert.match(fixture, /not[\s\S]*contractual tariffs/i);
  assert.doesNotMatch(`${admin}\n${fixture}\n${packageJson}`, /api\.laposte|fetch\([^)]*(?:colissimo|laposte)/i);
});

test("the PostgreSQL runtime isolates its intentional trigger rejection", async () => {
  const runtime = await readFile(
    new URL("../../scripts/test-shop-logistics-runtime.ts", import.meta.url),
    "utf8",
  );

  assert.match(runtime, /new PrismaClient\(\{ adapter: new PrismaPg\(\{ connectionString \}\) \}\)/);
  assert.match(runtime, /await assertUsedShippingRateIsImmutable\(v1\.id\)/);
  assert.doesNotMatch(
    runtime,
    /assert\.rejects\(\s*prisma\.shippingRateTier\.updateMany/,
  );
  assert.match(runtime, /await isolatedClient\.\$disconnect\(\)/);
  assert.match(runtime, /client\.query\(\) when the client is already executing a query/);
  assert.match(runtime, /assert\.equal\(\s*overlappingTransactionQueryWarning,\s*null/);
});
