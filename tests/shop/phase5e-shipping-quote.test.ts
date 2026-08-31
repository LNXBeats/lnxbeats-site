import assert from "node:assert/strict";
import test from "node:test";

import { PHASE5E_COLISSIMO_FRANCE_2026_RATE } from "@/data/shop-shipping";
import {
  SHOP_PHASE5E_CONFIRMATION,
  SHOP_PHASE5E_ORIGIN,
  SHOP_PHASE5E_PREVIEW_TARGET,
} from "@/lib/shop/production-readiness-config";
import { quoteVersionedShopShipping } from "@/lib/shop/shipping-service";

function phase5eEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://127.0.0.1:51280/template1?schema=public",
    LNX_DATABASE_TARGET: SHOP_PHASE5E_PREVIEW_TARGET,
    LNX_PRISMA_DEV_SERVER_FILE: `/tmp/prisma-dev-nodejs/${SHOP_PHASE5E_PREVIEW_TARGET}/server.json`,
    AUTH_URL: SHOP_PHASE5E_ORIGIN,
    SITE_URL: SHOP_PHASE5E_ORIGIN,
    SHOP_PRODUCTION_READINESS_QA: "true",
    SHOP_PRODUCTION_READINESS_QA_CONFIRM: SHOP_PHASE5E_CONFIRMATION,
    SHOP_ENABLED: "true",
    SHOP_CUSTOMER_SCOPE: "INDIVIDUALS_ONLY",
    SHOP_ALLOWED_COUNTRIES: "FR",
    SHOP_RESERVATION_TTL_MINUTES: "30",
    SHOP_SHIPPING_ENABLED: "true",
    SHOP_SHIPPING_RATE_SCOPE: "COMMERCIAL_CANDIDATE",
    SHOP_SHIPPING_QA_CONFIRM: SHOP_PHASE5E_CONFIRMATION,
    SHOP_PAYMENTS_ENABLED: "false",
    PAYMENTS_ENABLED: "false",
    STRIPE_PAYMENTS_ENABLED: "false",
    PAYPAL_PAYMENTS_ENABLED: "false",
    LIVE_REFUNDS_ENABLED: "false",
    NOTIFICATION_EMAIL_TRANSPORT: "capture",
    NOTIFICATION_WORKER_ENABLED: "false",
    SHOP_TERMS_VERSION: "shop-cgv-phase3-qa-v1",
    SHOP_ORDER_SNAPSHOT_VERSION: "shop-order-v1",
    MUSIC_PRICING_SOURCE: "legacy",
  };
}

const candidate = {
  id: "11111111-1111-4111-8111-111111111111",
  ...PHASE5E_COLISSIMO_FRANCE_2026_RATE,
  packagingProfile: {
    id: "22222222-2222-4222-8222-222222222222",
    ...PHASE5E_COLISSIMO_FRANCE_2026_RATE.packaging,
  },
};

test("exact Phase 5E cart path quotes the DRAFT candidate without activating it", async () => {
  const observedQueries: unknown[] = [];
  const database = {
    shippingRateVersion: {
      findFirst: async (query: unknown) => {
        observedQueries.push(query);
        return candidate;
      },
    },
  };

  for (const [quantity, expectedWeight, expectedShipping] of [
    [1, 25, 549],
    [10, 250, 549],
    [11, 275, 759],
  ] as const) {
    const quote = await quoteVersionedShopShipping(database as never, {
      destinationCountryCode: "FR",
      lines: [{
        productId: "33333333-3333-4333-8333-333333333333",
        shippingRequired: true,
        shippingWeightGrams: 25,
        quantity,
      }],
    }, phase5eEnvironment());
    assert.equal(quote.productWeightGrams, expectedWeight);
    assert.equal(quote.packagingWeightGrams, 60);
    assert.equal(quote.billableWeightGrams, expectedWeight);
    assert.equal(quote.amountCents, expectedShipping);
    assert.equal(quote.version, PHASE5E_COLISSIMO_FRANCE_2026_RATE.version);
  }

  assert.equal(candidate.status, "DRAFT");
  assert.equal(observedQueries.length, 3);
  for (const query of observedQueries) assert.deepEqual(
    (query as { where: unknown }).where,
    {
      version: PHASE5E_COLISSIMO_FRANCE_2026_RATE.version,
      status: "DRAFT",
      scope: "COMMERCIAL_CANDIDATE",
    },
  );
});

test("Phase 5E DRAFT quote fails closed outside the exact local guard", async () => {
  let queried = false;
  const database = {
    shippingRateVersion: {
      findFirst: async () => {
        queried = true;
        return candidate;
      },
    },
  };
  await assert.rejects(
    quoteVersionedShopShipping(database as never, {
      destinationCountryCode: "FR",
      lines: [{ productId: "product", shippingRequired: true, shippingWeightGrams: 25, quantity: 1 }],
    }, { ...phase5eEnvironment(), RAILWAY_ENVIRONMENT: "production" }),
    /configuration logistique locale est invalide/i,
  );
  assert.equal(queried, false);
});
