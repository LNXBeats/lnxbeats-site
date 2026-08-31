import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fakeLocalShippingProvider } from "@/lib/shop/fake-local-shipping-provider";
import {
  parseShopShippingProviderCreateForm,
  parseShopShippingProviderReconcileForm,
  SHOP_SHIPPING_PROVIDER_CONFIRMATIONS,
} from "@/lib/shop/shipping-provider-domain";
import {
  shopShippingProviderQaEnabled,
  SHOP_SHIPPING_PROVIDER_QA_CONFIRMATION,
} from "@/lib/shop/shipping-provider-config";
import {
  SHOP_PHASE5D_QA_ORIGIN,
  SHOP_PHASE5D_QA_TARGET,
  SHOP_PHASE5D_RUNTIME_QA_TARGET,
} from "@/lib/shop/qa-contract";

function providerEnvironment(target = SHOP_PHASE5D_QA_TARGET) {
  return {
    NODE_ENV: "test",
    LNX_DATABASE_TARGET: target,
    LNX_PRISMA_DEV_SERVER_FILE: `/private/tmp/prisma-dev-nodejs/${target}/server.json`,
    DATABASE_URL: "postgresql://127.0.0.1:51279/template1?schema=public",
    AUTH_URL: SHOP_PHASE5D_QA_ORIGIN,
    SITE_URL: SHOP_PHASE5D_QA_ORIGIN,
    SHOP_SHIPPING_PROVIDER_ENABLED: "true",
    SHOP_SHIPPING_PROVIDER: "FAKE_LOCAL",
    SHOP_SHIPPING_PROVIDER_QA_CONFIRM: SHOP_SHIPPING_PROVIDER_QA_CONFIRMATION,
    PAYMENTS_ENABLED: "false",
    SHOP_PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
    LIVE_REFUNDS_ENABLED: "false",
    NOTIFICATION_EMAIL_TRANSPORT: "capture",
    EMAIL_PROVIDER: "capture",
    MEDIA_STORAGE_DRIVER: "local",
  } as NodeJS.ProcessEnv;
}

function input(scenario: "SUCCEEDED" | "PENDING" | "FAILED" | "AMBIGUOUS") {
  return Object.freeze({
    orderNumber: "LNX-SHOP-2026-510001",
    idempotencyKey: "shop-order:00000000-0000-4000-8000-000000000001:shipping-provider:1:v1",
    scenario,
    service: "STANDARD_TRACKED_SIGNATURE",
    billableGrams: 270,
    destination: Object.freeze({ countryCode: "FR", postalCode: "75001" }),
  });
}

test("FAKE_LOCAL returns deterministic normalized states without network credentials", async () => {
  const successA = await fakeLocalShippingProvider.createShipment(input("SUCCEEDED"));
  const successB = await fakeLocalShippingProvider.createShipment(input("SUCCEEDED"));
  assert.deepEqual(successA, successB);
  assert.equal(successA.status, "SUCCEEDED");
  assert.match(successA.providerShipmentId ?? "", /^FAKE-SHIP-[A-F0-9]{20}$/);
  assert.match(successA.tracking?.number ?? "", /^LNXQA[A-F0-9]{20}$/);
  assert.match(successA.tracking?.url ?? "", /^https:\/\/example\.invalid\/track\//);

  const pending = await fakeLocalShippingProvider.createShipment(input("PENDING"));
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.tracking, null);
  const reconciled = await fakeLocalShippingProvider.reconcileShipment({
    orderNumber: input("PENDING").orderNumber,
    idempotencyKey: input("PENDING").idempotencyKey,
    providerShipmentId: pending.providerShipmentId!,
    scenario: "PENDING",
  });
  assert.equal(reconciled.status, "SUCCEEDED");
  assert.ok(reconciled.tracking);

  const failed = await fakeLocalShippingProvider.createShipment(input("FAILED"));
  assert.deepEqual([failed.status, failed.tracking, failed.errorCode], ["FAILED", null, "FAKE_LOCAL_REQUEST_REJECTED"]);
  const ambiguous = await fakeLocalShippingProvider.createShipment(input("AMBIGUOUS"));
  assert.deepEqual([ambiguous.status, ambiguous.tracking, ambiguous.errorCode], ["REQUIRES_REVIEW", null, "AMBIGUOUS_PROVIDER_ACCEPTANCE"]);
});

test("Phase 5D provider QA guard is cumulative, exact and fail-closed", () => {
  const exact = providerEnvironment();
  assert.equal(shopShippingProviderQaEnabled(exact), true);
  assert.equal(shopShippingProviderQaEnabled(providerEnvironment(SHOP_PHASE5D_RUNTIME_QA_TARGET)), true);
  for (const mutation of [
    { SHOP_SHIPPING_PROVIDER_ENABLED: "false" },
    { SHOP_SHIPPING_PROVIDER: "COLISSIMO" },
    { SHOP_SHIPPING_PROVIDER_QA_CONFIRM: "wrong" },
    { AUTH_URL: "https://www.lnxbeats.fr" },
    { SITE_URL: "http://127.0.0.1:31777" },
    { LNX_DATABASE_TARGET: "lnx-studio-production" },
    { DATABASE_URL: "postgresql://127.0.0.1:5432/template1" },
    { DATABASE_URL: "postgresql://remote.example.invalid:51279/template1" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { PAYMENTS_ENABLED: "true" },
    { NOTIFICATION_EMAIL_TRANSPORT: "resend" },
    { MEDIA_STORAGE_DRIVER: "s3" },
    { COLISSIMO_API_KEY: "forbidden" },
    { CARRIER_OAUTH_TOKEN: "forbidden" },
  ]) assert.equal(shopShippingProviderQaEnabled({ ...exact, ...mutation }), false);
});

test("provider forms require exact fields, scenarios, identifiers and explicit confirmations", () => {
  const create = new FormData();
  create.set("orderNumber", "LNX-SHOP-2026-510001");
  create.set("scenario", "PENDING");
  create.set("confirmation", SHOP_SHIPPING_PROVIDER_CONFIRMATIONS.create);
  assert.deepEqual(parseShopShippingProviderCreateForm(create), {
    orderNumber: "LNX-SHOP-2026-510001",
    scenario: "PENDING",
  });
  const reconcile = new FormData();
  reconcile.set("orderNumber", "LNX-SHOP-2026-510001");
  reconcile.set("attemptId", "00000000-0000-4000-8000-000000000001");
  reconcile.set("confirmation", SHOP_SHIPPING_PROVIDER_CONFIRMATIONS.reconcile);
  assert.equal(parseShopShippingProviderReconcileForm(reconcile).attemptId, "00000000-0000-4000-8000-000000000001");
  create.set("confirmation", "yes");
  assert.throws(() => parseShopShippingProviderCreateForm(create));
  create.set("confirmation", SHOP_SHIPPING_PROVIDER_CONFIRMATIONS.create);
  create.set("scenario", "LIVE");
  assert.throws(() => parseShopShippingProviderCreateForm(create));
});

test("Phase 5D remains provider-network-free and non-authoritative for money, stock, billing, SAV and notifications", async () => {
  const [adapter, service, migration, memberPage, adminPage, fixture] = await Promise.all([
    readFile(new URL("../../lib/shop/fake-local-shipping-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/shipping-provider-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../prisma/migrations/20260831200000_shop_shipping_provider_foundation/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../../app/compte/achats/[orderNumber]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/commandes/[orderNumber]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/shop-phase5d-fixture.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(adapter, /fetch\(|https\.request|stripe|paypal|resend|colissimo|la poste/i);
  assert.doesNotMatch(service, /shippingCents\s*:|subtotalCents\s*:|totalCents\s*:|\.product\.update|\.invoice\.|\.creditNote\.|\.shopReturnRequest\.|enqueueShop/);
  assert.match(service, /ORDER_ALREADY_SHIPPED/);
  assert.doesNotMatch(migration, /\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO)\b/i);
  assert.match(migration, /FAKE_LOCAL/);
  for (const technical of ["FAKE_LOCAL", "REQUIRES_REVIEW", "idempotencyKey", "providerShipmentId", "shippingProviderAttempts"]) {
    assert.doesNotMatch(memberPage, new RegExp(technical));
  }
  assert.doesNotMatch(fixture, /shippingLastName:\s*`[^`]*\$\{definition\.scenario\}/);
  assert.doesNotMatch(fixture, /title:\s*"[^"]*Provider transporteur/);
  assert.match(adminPage, /Provider transporteur — QA/);
  assert.match(adminPage, /Aucun réseau, achat, bordereau postal réel/);
  assert.match(adminPage, /metadata\?\.source === "PROVIDER"/);
  assert.doesNotMatch(adminPage, /Acheter une étiquette Colissimo|Générer une vraie étiquette|Envoyer via La Poste/);
});
