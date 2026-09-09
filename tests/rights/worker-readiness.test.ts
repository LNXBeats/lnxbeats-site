import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { notificationDefinition } from "@/lib/notifications/domain";
import type { OrderNotificationKind } from "@/lib/notifications/types";

const rightsKinds = [
  "CUSTOMER_RIGHTS_PAYMENT_CONFIRMED",
  "OWNER_RIGHTS_PAYMENT_CONFIRMED",
  "CUSTOMER_RIGHTS_LICENSE_ACTIVE",
  "CUSTOMER_RIGHTS_WITHDRAWAL_RECORDED",
  "OWNER_RIGHTS_WITHDRAWAL_REQUESTED",
  "CUSTOMER_RIGHTS_WITHDRAWAL_REFUNDED",
] as const satisfies readonly OrderNotificationKind[];

test("the target Notifications worker recognizes every payment, activation and withdrawal Rights type", async () => {
  const templates = await readFile("lib/notifications/templates.ts", "utf8");
  for (const kind of rightsKinds) {
    assert.equal(typeof notificationDefinition(kind).templateKey, "string");
    assert.match(templates, new RegExp(`\\b${kind}: \\[`));
  }
});

test("the existing Maintenance entrypoint runs due Rights activation independently of new-sales gates", async () => {
  const [maintenance, repository, paymentService] = await Promise.all([
    readFile("scripts/shop-maintenance.ts", "utf8"),
    readFile("lib/rights/payment-repository.ts", "utf8"),
    readFile("lib/rights/payment-service.ts", "utf8"),
  ]);
  assert.match(maintenance, /Promise\.allSettled/);
  assert.match(maintenance, /activateDueRightsLicenses\(\)/);
  assert.match(maintenance, /rights\.activation\.completed/);
  assert.doesNotMatch(maintenance, /RIGHTS_COMMERCE_ENABLED|RIGHTS_PAYMENTS_ENABLED|createRefund|captureOrder/);
  assert.doesNotMatch(repository, /assertRightsPaymentsOpen/);
  assert.match(paymentService, /capturePaypalOrderForRights[\s\S]*Closing new Rights[\s\S]*reservePaypalCapture/);
});

test("the proposed ACL patch grants only the verified Maintenance gaps", async () => {
  const sql = await readFile("scripts/sql/rights-maintenance-runtime-grants.sql", "utf8");
  assert.match(sql, /rights_licenses/);
  assert.match(sql, /rights_requests/);
  assert.match(sql, /contract_documents/);
  assert.match(sql, /rights_withdrawal_requests/);
  assert.match(sql, /contract_templates/);
  assert.match(sql, /contract_acceptances/);
  assert.match(sql, /rights_request_events/);
  assert.doesNotMatch(sql, /GRANT ALL|SUPERUSER|OWNER TO|\bDELETE\b|\bTRUNCATE\b/);
  assert.doesNotMatch(sql, /payments|refund_attempts|invoices|order_notifications/);
});
