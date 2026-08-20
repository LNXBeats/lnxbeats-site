import assert from "node:assert/strict";
import { inspect } from "node:util";
import test from "node:test";

import { assertRightsQaEnvironment, RIGHTS_QA_CONFIRMATION, RIGHTS_QA_TARGET } from "@/lib/rights/qa-guard";

const databaseUrl = "postgresql://fixture:fixture@127.0.0.1:51250/template1";
const environment = {
  RIGHTS_QA_CONFIRM: RIGHTS_QA_CONFIRMATION,
  NODE_ENV: "test",
  EMAIL_PROVIDER: "capture",
  LNX_DATABASE_TARGET: RIGHTS_QA_TARGET,
  DATABASE_URL: databaseUrl,
  AUTH_URL: "http://127.0.0.1:31720",
  AUTH_SECRET: "rights-qa-auth-secret-longer-than-thirty-two",
  LNX_AUTH_QA_PASSWORD: "rights-qa-password",
  PAYMENTS_ENABLED: "false",
};
const proof = { name: RIGHTS_QA_TARGET, pid: 123, exports: { database: { connectionString: databaseUrl } } };

test("rights QA guard accepts only its exact disposable local target", () => {
  assert.equal(assertRightsQaEnvironment(environment, proof).target, RIGHTS_QA_TARGET);
  for (const bad of [
    { ...environment, LNX_DATABASE_TARGET: "lnx-studio-local-preview" },
    { ...environment, DATABASE_URL: databaseUrl.replace("51250", "5432") },
    { ...environment, PAYMENTS_ENABLED: "true" },
    { ...environment, STRIPE_SECRET_KEY: ["sk", "test", "fixture"].join("_") },
  ]) assert.throws(() => assertRightsQaEnvironment(bad, proof));
});

test("guard errors never contain credentials or URL userinfo", () => {
  const sentinel = "RIGHTS_SENTINEL_SECRET";
  let caught: unknown;
  try { assertRightsQaEnvironment({ ...environment, DATABASE_URL: databaseUrl.replace("fixture:fixture", `${sentinel}:${sentinel}`) }, proof); } catch (error) { caught = error; }
  assert.ok(caught);
  assert.doesNotMatch(String(caught), new RegExp(sentinel));
  assert.doesNotMatch(inspect(caught), new RegExp(sentinel));
});
