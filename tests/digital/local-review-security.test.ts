import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { localDigitalReviewAvailable } from "@/lib/digital/local-review-policy";
const env = { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_LOCAL_REVIEW_AUTHORIZED: "true", DCN_NEW_PAYMENTS_ENABLED: "false", DATABASE_URL: "postgresql://dcn_runtime_a@127.0.0.1:55473/lnx_dcn_runtime_test", AUTH_URL: "http://127.0.0.1:3140", MEDIA_STORAGE_DRIVER: "local", EMAIL_PROVIDER: "capture" };
test("Local simulation cannot be moved to another database/role/port or activated by NODE_ENV", () => {
  for (const DATABASE_URL of ["postgresql://dcn_owner@127.0.0.1:55473/lnx_dcn_runtime_test", "postgresql://dcn_runtime_a@127.0.0.1:5432/lnx_dcn_runtime_test", "postgresql://dcn_runtime_a@127.0.0.1:55473/lnx_dcn11_other", "postgresql://dcn_runtime_a@127.0.0.1:55473/lnx_dcn_runtime_test?schema=other"]) assert.equal(localDigitalReviewAvailable({ ...env, DATABASE_URL }), false);
  for (const NODE_ENV of ["development", "test", "production"]) assert.equal(localDigitalReviewAvailable({ ...env, DCN_LOCAL_REVIEW_AUTHORIZED: undefined, NODE_ENV }), false);
});
test("Local route accepts neither browser evidence nor external gateway/merchant fields", async () => {
  const route = await readFile(new URL("../../app/api/digital/local-review/checkout/route.ts", import.meta.url), "utf8");
  assert.match(route, /digitalBody\(request,\["idempotencyKey","revision","termsVersion","earlyDelivery","withdrawalAcknowledged"\]\)/);
  assert.match(route, /withDigitalApi/); assert.match(route, /localDigitalReviewCheckoutAllowed\(actor\.email/);
  assert.doesNotMatch(route, /fetch\(|new Stripe|digitalGateway\(/);
  assert.match(route, /eventId:`dcn12-local-paid-\$\{attempt\.id\}`/);
});
test("Local launcher whitelists inherited environment and explicitly retains new-payments OFF", async () => {
  const source = await readFile(new URL("../../scripts/digital-local-server.ts", import.meta.url), "utf8");
  assert.match(source, /assert\.equal\(config\.DCN_NEW_PAYMENTS_ENABLED, "false"\)/);
  assert.match(source, /DCN_LOCAL_REVIEW_AUTHORIZED:"true"/); assert.doesNotMatch(source, /\.\.\.process\.env/);
  assert.match(source, /"--hostname", "127\.0\.0\.1"/);
});
