import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptPath = "scripts/admin-production-inventory.ts";

async function source() {
  return readFile(scriptPath, "utf8");
}

test("the production inventory requires explicit Railway production and confirmation guards", async () => {
  const script = await source();

  assert.match(script, /RAILWAY_ENVIRONMENT_NAME === "production"/);
  assert.match(script, /RAILWAY_ENVIRONMENT === "production"/);
  assert.match(script, /LNX_ADMIN_INVENTORY_CONFIRM !== INVENTORY_CONFIRMATION/);
  assert.match(script, /read-only-v120-admin-inventory/);
  assert.match(script, /databaseUrl\.protocol !== "postgresql:"/);
  assert.match(script, /databaseUrl\.protocol !== "postgres:"/);
});

test("the inventory establishes and verifies a PostgreSQL read-only transaction before querying", async () => {
  const script = await source();
  const transactionIndex = script.indexOf("prisma.$transaction");
  const readOnlyIndex = script.indexOf("SET TRANSACTION READ ONLY", transactionIndex);
  const verificationIndex = script.indexOf("SHOW transaction_read_only", readOnlyIndex);
  const inventoryIndex = script.indexOf("return buildInventory(transaction)", verificationIndex);

  assert.ok(transactionIndex >= 0);
  assert.ok(readOnlyIndex > transactionIndex);
  assert.ok(verificationIndex > readOnlyIndex);
  assert.ok(inventoryIndex > verificationIndex);
  assert.match(script, /transaction_read_only !== "on"/);
  assert.doesNotMatch(script, /\$executeRawUnsafe|\$queryRawUnsafe/);
});

test("the source contains no database or provider mutation path", async () => {
  const script = await source();

  assert.doesNotMatch(script, /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
  assert.doesNotMatch(script, /\b(?:INSERT|UPDATE|UPSERT|ALTER|DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(script, /stripe|paypal|resend|fetch\s*\(/i);
  assert.doesNotMatch(script, /adminRecordArchive|adminCleanupAuditEvent|admin_record_archives|admin_cleanup_audit_events/);
});

test("the JSON projection is bounded and excludes personal and provider identifiers", async () => {
  const script = await source();
  const projectionStart = script.indexOf("function musicOrderInventory");
  const projectionEnd = script.indexOf("async function buildInventory", projectionStart);
  const projection = script.slice(projectionStart, projectionEnd);

  assert.match(script, /const MUSIC_ORDER_LIMIT = 10/);
  assert.match(script, /take: MUSIC_ORDER_LIMIT/);
  assert.match(script, /classifyMusicOrderCleanup\(row\)/);
  assert.match(script, /title: hasQaTitleMarker\(row\.title\) \? "\[essai détecté\]" : "\[masqué\]"/);
  assert.doesNotMatch(projection, /title:\s*hasQaTitleMarker\(row\.title\)\s*\?\s*row\.title/);
  assert.match(script, /paymentEvidence/);
  assert.match(script, /creditNote/);
  assert.match(script, /openAction/);
  assert.match(script, /hasRefundPending/);
  assert.match(script, /hasRefundDue/);
  assert.match(script, /DELETE_SAFE/);
  assert.match(script, /ARCHIVE_REQUIRED/);
  assert.match(script, /KEEP_ACTION_REQUIRED/);
  assert.doesNotMatch(projection, /customerEmail|customerName|displayName|shippingFirstName|shippingLastName|shippingAddress|recipient|providerPaymentId|providerCheckoutId|providerRefundId/);
});

test("the inventory uses the same fail-closed financial and notification action boundaries as the cockpit", async () => {
  const script = await source();

  assert.match(script, /\["REQUIRES_REVIEW", "REFUND_PENDING"\]/);
  assert.match(script, /\["REFUSED", "CANCELLED", "REFUNDED"\]/);
  assert.match(script, /\["SUCCEEDED", "PARTIALLY_REFUNDED"\]/);
  assert.match(script, /OR: \[\{ leaseExpiresAt: null \}, \{ leaseExpiresAt: \{ lte: now \} \}\]/);
  assert.match(script, /shopOrders,/);
  assert.match(script, /shopReturns: Number/);
  assert.match(script, /shopReturnRequestId[\s\S]{0,240}IN \('PROCESSING', 'PENDING', 'REQUIRES_REVIEW'\)/);
  assert.match(script, /commander: commander \+ financialEvents/);
  assert.match(script, /uncorrelatedFinancialEvents: financialEvents/);
});

test("the package command loads no local env file and runs only this inventory", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
  const command = packageJson.scripts["admin:inventory:production"];

  assert.equal(
    command,
    "NODE_OPTIONS=--conditions=react-server node --import tsx scripts/admin-production-inventory.ts",
  );
  assert.doesNotMatch(command, /env-file|railway run|railway shell/);
});
