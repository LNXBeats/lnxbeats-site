import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  HISTORICAL_INVOICE_BACKFILL_CONFIRMATION,
  assertHistoricalInvoiceBackfillArguments,
  assertHistoricalInvoiceBackfillProductionEnvironment,
} from "../../scripts/historical-invoice-backfill-apply";

const production = {
  NODE_ENV: "production",
  RAILWAY_ENVIRONMENT_NAME: "production",
  RAILWAY_PROJECT_ID: "116aee1d-3daf-471c-adb0-fdbb34bd5da0",
  RAILWAY_ENVIRONMENT_ID: "75201c67-bb4f-4912-9bda-d6fa81bbb707",
  RAILWAY_SERVICE_ID: "57e307d9-12dc-42a1-bcb5-a2a7bb90fcbe",
  RAILWAY_GIT_COMMIT_SHA: "ac88a130ec567dad09f6ec8391396f0247d30dbc",
  LIVE_REFUNDS_ENABLED: "false",
  SHOP_ENABLED: "false",
  SHOP_PAYMENTS_ENABLED: "false",
  SHOP_SHIPPING_ENABLED: "false",
  CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "true",
  DATABASE_URL: "postgresql://private.internal:5432/railway",
};

test("apply requires its exact one-shot confirmation", () => {
  assert.doesNotThrow(() => assertHistoricalInvoiceBackfillArguments([
    "--apply",
    `--confirm=${HISTORICAL_INVOICE_BACKFILL_CONFIRMATION}`,
  ]));
  assert.throws(() => assertHistoricalInvoiceBackfillArguments(["--apply"]));
  assert.throws(() => assertHistoricalInvoiceBackfillArguments(["--dry-run"]));
  assert.throws(() => assertHistoricalInvoiceBackfillArguments([
    "--apply",
    `--confirm=${HISTORICAL_INVOICE_BACKFILL_CONFIRMATION}`,
    "LNX-2026-999999",
  ]));
});

test("apply environment is bound to the exact dark Production Web runtime", () => {
  assert.doesNotThrow(() => assertHistoricalInvoiceBackfillProductionEnvironment(production));
  for (const override of [
    { RAILWAY_ENVIRONMENT_NAME: "staging" },
    { RAILWAY_PROJECT_ID: "another-project" },
    { RAILWAY_SERVICE_ID: "another-service" },
    { RAILWAY_GIT_COMMIT_SHA: "b134af0c0cc9f9d01fdaa7e649dfb4118b51d024" },
    { LIVE_REFUNDS_ENABLED: "true" },
    { LIVE_REFUNDS_PRODUCTION_CONFIRM: "ARMED" },
    { SHOP_ENABLED: "true" },
    { SHOP_PAYMENTS_ENABLED: "true" },
    { SHOP_SHIPPING_ENABLED: "true" },
    { CLIENT_EMAIL_NOTIFICATIONS_ENABLED: "false" },
    { DATABASE_URL: "postgresql://127.0.0.1:55432/template1" },
    { DATABASE_URL: "postgresql://db.example.invalid:5432/staging" },
  ]) assert.throws(() => assertHistoricalInvoiceBackfillProductionEnvironment({ ...production, ...override }));
});

test("apply source is one-shot, fixed-whitelist and has no provider, email, credit-note or public-route behavior", async () => {
  const source = await readFile(new URL("../../scripts/historical-invoice-backfill-apply.ts", import.meta.url), "utf8");
  for (const orderNumber of ["LNX-2026-000003", "LNX-2026-000007", "LNX-2026-000011"]) assert.match(source, new RegExp(orderNumber));
  assert.match(source, /validationCompletedBeforeFirstNextval: true/);
  assert.match(source, /isolationLevel: "Serializable"/);
  assert.match(source, /issueInvoiceForPayment/);
  assert.doesNotMatch(source, /readHistoricalInvoiceBackfillPlan/);
  assert.doesNotMatch(source, /issueCreditNoteForRefund|enqueue.*Notification|stripe\.|paypal\.|resend/i);
});
