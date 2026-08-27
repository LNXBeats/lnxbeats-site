import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Shop Phase 2 fixtures stay CLI-only, env-backed and scoped to synthetic local data", async () => {
  const [fixture, preview, packageSource] = await Promise.all([
    readFile(new URL("../../scripts/shop-phase2-browser-fixtures.ts", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/shop-phase2-preview.ts", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(fixture, /await loadAndAssertShopPhase2QaEnvironment\(\)/);
  assert.match(fixture, /createInternalAuthUser/);
  assert.match(fixture, /const memberPassword = process\.env\.LNX_AUTH_QA_MEMBER_PASSWORD/);
  assert.match(fixture, /const adminPassword = process\.env\.LNX_AUTH_QA_ADMIN_PASSWORD/);
  assert.match(fixture, /password: memberPassword/);
  assert.match(fixture, /password: adminPassword/);
  assert.doesNotMatch(fixture, /LNX_AUTH_QA_PASSWORD/);
  assert.doesNotMatch(fixture, /password:\s*["'`][^"'`]+["'`]/);
  assert.match(fixture, /createAdminProduct[\s\S]*replaceAdminProductImage[\s\S]*publishAdminProduct/);
  assert.match(fixture, /removeCatalogImage/);
  assert.match(fixture, /paymentStatus, "PAID"/);
  assert.match(fixture, /reservation\?\.status !== "CONFIRMED"/);
  assert.doesNotMatch(fixture, /confirmShopOrderPayment|stripe|paypal|fetch\(/i);

  assert.match(preview, /await loadAndAssertShopPhase2QaEnvironment\(\)[\s\S]*spawn\(/);
  assert.match(packageSource, /shop:phase2:fixtures:setup/);
  assert.match(packageSource, /shop:phase2:fixtures:cleanup/);
  assert.match(packageSource, /shop:phase2:preview:build/);
  assert.match(packageSource, /shop:phase2:preview:start/);
  for (const script of [
    "test:shop-order:runtime",
    "shop:phase2:migrate",
    "shop:phase2:fixtures:setup",
    "shop:phase2:fixtures:cleanup",
    "shop:phase2:reservations:expire",
    "shop:phase2:preview:build",
    "shop:phase2:preview:start",
  ]) {
    const command = JSON.parse(packageSource).scripts[script] as string;
    assert.match(command, /--env-file-if-exists=\.env\.phase2-qa\.local/);
    assert.doesNotMatch(command, /(?:^|\s)--env-file=\.env\.phase2-qa\.local/);
  }
});
