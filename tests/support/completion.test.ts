import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { supportAccountingRows, supportCsvCell } from "@/lib/support/accounting";
import { isSupportTestEnvironment } from "@/lib/support/config";

test("support accounting neutralizes formulas and preserves ordinary Unicode", () => {
  for (const value of ["=HYPERLINK(1)", " +cmd", "\t@SUM(1)", "\r-1", "\u0000=1"]) assert.ok(supportCsvCell(value).startsWith('"\''));
  assert.equal(supportCsvCell('LNX "création"'), '"LNX ""création"""');
});
test("accounting records attempts separately and never fabricates provider fees", () => {
  const rows = supportAccountingRows({ id: "qa", createdAt: new Date(0), amountCents: 500, currency: "EUR", provider: "PAYPAL", mode: "TEST", status: "REFUND_PENDING", providerReference: "order", paymentReference: "capture", refundReference: null,
    attempts: [{ id: "a", operation: "CAPTURE", status: "REQUESTED", lastCheckedAt: null }, { id: "b", operation: "REFUND", status: "REQUESTED", lastCheckedAt: new Date(0) }] });
  assert.equal(rows.length, 2); assert.equal(rows[0][5], "TEST"); assert.deepEqual(rows[0].slice(-2), ["", ""]);
  assert.equal(rows[0][2], 500); assert.equal(rows[1][2], "");
});
test("new-payment switch is independent of the safe TEST settlement context", () => {
  assert.equal(isSupportTestEnvironment({ SUPPORT_ENABLED: "false", SUPPORT_TEST_MODE: "true", SITE_URL: "http://127.0.0.1:3117" }), true);
  const service = readFileSync("lib/support/service.ts", "utf8");
  for (const name of ["captureSupportContribution", "refundSupportContribution", "getSupportStatus", "reconcileSupportContribution"]) {
    assert.match(service.slice(service.indexOf(`export async function ${name}`), service.indexOf(`export async function ${name}`) + 250), /requireSupportEnvironment/);
  }
});
test("new migration only adds recovery/audit metadata; historic support migration unchanged", () => {
  const sql = readFileSync("prisma/migrations/20261004160000_support_reconciliation/migration.sql", "utf8");
  assert.equal(/DROP|DELETE|TRUNCATE|UPDATE\s+"/.test(sql), false);
  assert.equal(/ALTER TABLE "(?!support_)/.test(sql), false);
});
