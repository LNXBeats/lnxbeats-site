import assert from "node:assert/strict";

import { prisma } from "@/lib/prisma";
import { loadAndAssertShopPhase3CPaypalSandboxQaEnvironment } from "@/lib/shop/paypal-sandbox-qa-guard";

async function run() {
  const runtime = await loadAndAssertShopPhase3CPaypalSandboxQaEnvironment();
  const database = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
    SELECT current_database() AS database, current_schema() AS schema
  `;
  assert.deepEqual(database[0], { database: "template1", schema: "public" });
  const migrations = await prisma.$queryRaw<Array<{ count: bigint; latest: bigint }>>`
    SELECT
      count(*) FILTER (WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)::bigint AS count,
      count(*) FILTER (
        WHERE "migration_name" = '20260827220000_shop_payment_fulfillment_foundation'
          AND "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
      )::bigint AS latest
    FROM "_prisma_migrations"
  `;
  assert.equal(Number(migrations[0]?.count), 21);
  assert.equal(Number(migrations[0]?.latest), 1);
  console.info("PASS environment.local-qa");
  console.info("PASS origin.loopback");
  console.info("PASS database.disposable");
  console.info("PASS migrations.21");
  console.info(`PASS paypal.environment.${runtime.paypalEnvironment}`);
  console.info("PASS paypal.credentials.present");
  console.info("PASS paypal.webhook-id.present");
  console.info("PASS paypal.live.absent");
  console.info("PASS stripe.network.disabled");
  console.info("PASS notifications.capture");
  console.info("PASS media.local");
  console.info("PASS shop.enabled");
  console.info("PASS shop-payments.enabled");
  console.info("PASS legal.qa-armed");
  console.info("PASS railway.absent");
  console.info("READY_FOR_PAYPAL_SANDBOX_QA");
}

run().catch(() => {
  console.error("BLOCKED_PAYPAL_SANDBOX_CONFIGURATION_REQUIRED");
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
