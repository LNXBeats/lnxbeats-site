import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the reservation expiry command is bounded and armed by the exact disposable QA guard", async () => {
  const [script, packageJson] = await Promise.all([
    readFile(new URL("../../scripts/shop-reservations-expire.ts", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ]);

  const guard = script.indexOf("await loadAndAssertShopPhase2QaExpiryEnvironment()");
  const expiry = script.indexOf("await expireShopOrderReservations(");
  assert.ok(guard >= 0 && expiry > guard, "the exact QA guard must pass before expiry can touch PostgreSQL");
  assert.match(script, /const BATCH_LIMIT = 50/);
  assert.match(script, /expireShopOrderReservations\(new Date\(\), BATCH_LIMIT\)/);
  assert.match(packageJson, /"shop:phase2:reservations:expire":\s*"[^"]*scripts\/shop-reservations-expire\.ts"/);
  assert.match(script, /loadAndAssertShopPhase2QaExpiryEnvironment/);
  assert.doesNotMatch(script, /stripe|paypal|resend|fetch\(|railway/i);
  assert.doesNotMatch(script, /process\.env\.(?:DATABASE_URL|AUTH_SECRET|LNX_AUTH_QA_MEMBER_PASSWORD|LNX_AUTH_QA_ADMIN_PASSWORD)/);
});

test("stock observability uses allowlisted non-PII structured fields after service outcomes", async () => {
  const service = await readFile(new URL("../../lib/shop/order-service.ts", import.meta.url), "utf8");

  assert.match(
    service,
    /if \(outcome\.created\)[\s\S]*event: "shop\.stock\.reserved",\s*shopOrderId: order\.id,\s*orderNumber: order\.orderNumber,\s*reservations: reservationCount,\s*units:/,
  );
  assert.match(
    service,
    /const outcome = await withShopTransaction[\s\S]*if \(outcome\.released\) \{\s*console\.info\(JSON\.stringify\(\{\s*event: "shop\.stock\.released",\s*shopOrderId,\s*reservations: outcome\.released/,
  );
  assert.match(
    service,
    /const outcome = await withShopTransaction[\s\S]*event: "shop\.stock\.expired",\s*orders: outcome\.expired,\s*shopOrderIds: outcome\.shopOrderIds/,
  );

  for (const event of ["shop.stock.reserved", "shop.stock.released", "shop.stock.expired"]) {
    const start = service.indexOf(`event: "${event}"`);
    assert.ok(start >= 0, `${event} log is missing`);
    const end = service.indexOf("}));", start);
    assert.ok(end > start, `${event} log is incomplete`);
    assert.doesNotMatch(
      service.slice(start, end),
      /email|address|firstName|lastName|payload|provider|stripe|paypal|resend|databaseUrl/i,
      `${event} must contain allowlisted operational fields only`,
    );
  }
});
