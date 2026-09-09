import assert from "node:assert/strict";
import test from "node:test";

import { assertRightsPaymentsOpen, rightsPaymentConfiguration, RIGHTS_PRODUCTION_CONFIRMATION } from "@/lib/rights/payment-config";

test("Rights payments stay closed by default and on partial configuration", () => {
  assert.equal(rightsPaymentConfiguration({}).open, false);
  assert.equal(rightsPaymentConfiguration({ RIGHTS_COMMERCE_ENABLED: "true" }).open, false);
  assert.equal(rightsPaymentConfiguration({ RIGHTS_PAYMENTS_ENABLED: "true" }).open, false);
  const configured = rightsPaymentConfiguration({ RIGHTS_COMMERCE_ENABLED: "true", RIGHTS_PAYMENTS_ENABLED: "true" });
  assert.equal(configured.codeOpen, true);
  assert.equal(configured.open, true);
});

test("Production additionally requires the exact non-secret confirmation", () => {
  const base = { NODE_ENV: "production", RIGHTS_COMMERCE_ENABLED: "true", RIGHTS_PAYMENTS_ENABLED: "true" };
  assert.equal(rightsPaymentConfiguration(base).open, false);
  assert.throws(() => assertRightsPaymentsOpen(base), /RIGHTS_PAYMENTS_NOT_OPEN/);
  assert.equal(rightsPaymentConfiguration({ ...base, RIGHTS_PRODUCTION_CONFIRM: "almost" }).open, false);
  const confirmed = rightsPaymentConfiguration({ ...base, RIGHTS_PRODUCTION_CONFIRM: RIGHTS_PRODUCTION_CONFIRMATION });
  assert.equal(confirmed.productionConfirmed, true);
  assert.equal(confirmed.open, true);
  assert.doesNotThrow(() => assertRightsPaymentsOpen({ ...base, RIGHTS_PRODUCTION_CONFIRM: RIGHTS_PRODUCTION_CONFIRMATION }));
});
