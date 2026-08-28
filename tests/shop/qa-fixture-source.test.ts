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

test("Shop Phase 3 preview stays offline, disposable and payment-provider free", async () => {
  const [fixture, preview, packageSource] = await Promise.all([
    readFile(new URL("../../scripts/shop-phase3-browser-fixtures.ts", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/shop-phase3-preview.ts", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(
    fixture,
    /await loadAndAssertShopPhase2QaEnvironment\(\)[\s\S]*await assertDatabaseState\(\)[\s\S]*armOfflinePhase3Runtime\(\)/,
  );
  assert.match(fixture, /20260827220000_shop_payment_fulfillment_foundation/);
  assert.match(fixture, /Number\(migration\[0\]\?\.count\), 21/);
  assert.match(fixture, /Object\.assign\(process\.env, shopPhase3QaRuntimeOverrides\(process\.env\)\)/);
  assert.match(fixture, /createShopOrder/);
  assert.match(fixture, /repository\.reserveAttempt/);
  assert.match(fixture, /repository\.recordSession/);
  assert.match(fixture, /repository\.reconcile/);
  assert.match(fixture, /createShopPaymentDatabaseRepository\(prisma, "TEST"\)/);
  assert.match(fixture, /dispatchOrderNotification/);
  assert.match(fixture, /OWNER_SHOP_ORDER_PAID/);
  assert.match(fixture, /CUSTOMER_SHOP_PAYMENT_CONFIRMED/);
  assert.match(fixture, /productStockAdjustment\.delete/);
  assert.match(fixture, /shopOrder\.delete/);
  assert.doesNotMatch(fixture, /createStripeCheckoutForShopOrder|createPaypalOrderForShopOrder|createStripeCheckoutGateway|createPaypalGateway|sendResendEmail|fetch\s*\(/);
  assert.doesNotMatch(fixture, /process\.env\.(?:STRIPE_SECRET_KEY|PAYPAL_CLIENT_SECRET|RESEND_API_KEY|DATABASE_URL)/);
  assert.doesNotMatch(fixture, /password:\s*["'`][^"'`]+["'`]/);

  assert.match(preview, /await loadAndAssertShopPhase2QaEnvironment\(\)[\s\S]*spawn\(/);
  assert.match(preview, /env: shopPhase3QaChildEnvironment\(process\.env, \{ validatedRuntime: true \}\)/);
  assert.doesNotMatch(preview, /STRIPE_PAYMENTS_ENABLED:\s*"true"|PAYPAL_PAYMENTS_ENABLED:\s*"true"|fetch\s*\(/);

  const scripts = JSON.parse(packageSource).scripts as Record<string, string>;
  assert.match(scripts["shop:phase3:fixtures:setup"], /shop-phase3-browser-fixtures\.ts cleanup[\s\S]*shop-phase2-browser-fixtures\.ts setup[\s\S]*shop-phase3-browser-fixtures\.ts setup/);
  assert.match(scripts["shop:phase3:fixtures:cleanup"], /shop-phase3-browser-fixtures\.ts cleanup[\s\S]*shop-phase2-browser-fixtures\.ts cleanup/);
  for (const name of [
    "shop:phase3:fixtures:setup",
    "shop:phase3:fixtures:cleanup",
    "shop:phase3:preview:build",
    "shop:phase3:preview:start",
  ]) {
    assert.match(scripts[name], /--env-file-if-exists=\.env\.phase2-qa\.local/);
    assert.doesNotMatch(scripts[name], /(?:^|\s)--env-file=\.env\.phase2-qa\.local/);
  }
});
