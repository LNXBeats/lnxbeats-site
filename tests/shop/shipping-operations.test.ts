import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  shopShippingOperationsQaEnabled,
  SHOP_SHIPPING_OPERATIONS_QA_CONFIRMATION,
} from "@/lib/shop/shipping-operations-config";
import {
  SHOP_PHASE5C_QA_ORIGIN,
  SHOP_PHASE5C_QA_TARGET,
  SHOP_PHASE5C_RUNTIME_QA_TARGET,
} from "@/lib/shop/qa-contract";

function exactEnvironment() {
  return {
    NODE_ENV: "test",
    LNX_DATABASE_TARGET: SHOP_PHASE5C_QA_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/private/tmp/prisma-dev-nodejs/${SHOP_PHASE5C_QA_TARGET}/server.json`,
    DATABASE_URL: "postgresql://127.0.0.1:51277/template1?schema=public",
    AUTH_URL: SHOP_PHASE5C_QA_ORIGIN,
    SITE_URL: SHOP_PHASE5C_QA_ORIGIN,
    SHOP_SHIPPING_OPERATIONS_ENABLED: "true",
    SHOP_SHIPPING_OPERATIONS_QA_CONFIRM: SHOP_SHIPPING_OPERATIONS_QA_CONFIRMATION,
    SHOP_SHIPPING_OPERATIONS_PROVIDER: "manual",
    PAYMENTS_ENABLED: "false",
    SHOP_PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
    LIVE_REFUNDS_ENABLED: "false",
    NOTIFICATION_EMAIL_TRANSPORT: "capture",
    EMAIL_PROVIDER: "capture",
  } as NodeJS.ProcessEnv;
}

test("Phase 5C QA shipping operations are enabled only by the exact local manual contract", () => {
  const exact = exactEnvironment();
  assert.equal(shopShippingOperationsQaEnabled(exact), true);
  assert.equal(shopShippingOperationsQaEnabled({
    ...exact,
    LNX_DATABASE_TARGET: SHOP_PHASE5C_RUNTIME_QA_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/private/tmp/prisma-dev-nodejs/${SHOP_PHASE5C_RUNTIME_QA_TARGET}/server.json`,
  }), true);
  for (const mutation of [
    { SHOP_SHIPPING_OPERATIONS_ENABLED: "false" },
    { SHOP_SHIPPING_OPERATIONS_QA_CONFIRM: "wrong" },
    { SHOP_SHIPPING_OPERATIONS_PROVIDER: "provider" },
    { AUTH_URL: "https://www.lnxbeats.fr" },
    { SITE_URL: "http://127.0.0.1:31776" },
    { DATABASE_URL: "postgresql://db.example.invalid:51277/template1" },
    { DATABASE_URL: "postgresql://127.0.0.1:5432/template1" },
    { LNX_DATABASE_TARGET: "lnx-studio-production" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { NOTIFICATION_EMAIL_TRANSPORT: "resend" },
    { PAYMENTS_ENABLED: "true" },
    { PAYPAL_CLIENT_SECRET: "forbidden" },
  ]) assert.equal(shopShippingOperationsQaEnabled({ ...exact, ...mutation }), false);
});

test("Member and Admin shipping presentation is human-readable and never claims carrier delivery", async () => {
  const [memberPage, adminPage, presentation] = await Promise.all([
    readFile(new URL("../../app/compte/achats/[orderNumber]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/commandes/[orderNumber]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/order-presentation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(memberPage, /Les informations de suivi seront affichées ici lorsqu’elles seront disponibles\./);
  assert.match(memberPage, /Suivre l’expédition/);
  assert.match(memberPage, /rel="noopener noreferrer"/);
  assert.match(memberPage, /ne confirme pas sa livraison/);
  assert.doesNotMatch(memberPage, />READY_TO_SHIP</);
  assert.match(adminPage, /Expédition opérationnelle/);
  assert.match(adminPage, /Suivi manuel/);
  assert.doesNotMatch(adminPage, />Livré</);
  assert.match(presentation, /Expédition suivie avec remise contre signature/);
  assert.match(presentation, /Saisie manuelle/);
});

test("Phase 5C remains carrier-provider-free and does not change money, stock, billing or SAV services", async () => {
  const [service, migration] = await Promise.all([
    readFile(new URL("../../lib/shop/fulfillment-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../prisma/migrations/20260830220000_shop_shipping_operations/migration.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(service, /stripe|paypal|resend|colissimo|la poste/i);
  assert.doesNotMatch(service, /shippingCents|subtotalCents|totalCents|stockOnHand|shopInvoice|shopCreditNote|shopReturnRequest/);
  assert.doesNotMatch(migration, /\b(?:DROP TABLE|TRUNCATE|DELETE FROM|UPDATE|INSERT INTO)\b/i);
  assert.match(migration, /READY_TO_SHIP/);
  assert.match(migration, /ShopTrackingSource/);
  assert.match(migration, /MANUAL/);
  assert.match(migration, /PROVIDER/);
});
