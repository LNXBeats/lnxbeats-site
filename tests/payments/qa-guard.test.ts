import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";

import {
  assertPaymentQaDatabaseEnvironment,
  assertPaymentQaEnvironment,
  assertPaymentQaRuntimeEnvironment,
  PAYMENT_QA_CONFIRMATION,
  PAYMENT_QA_DATABASE_PORT,
  PAYMENT_QA_TARGET,
} from "@/lib/payments/qa-guard";

const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${PAYMENT_QA_DATABASE_PORT}/template1?sslmode=disable`;

function valid() {
  return {
    environment: {
      PAYMENT_QA_CONFIRM: PAYMENT_QA_CONFIRMATION,
      NODE_ENV: "test",
      EMAIL_PROVIDER: "capture",
      LNX_DATABASE_TARGET: PAYMENT_QA_TARGET,
      DATABASE_URL: databaseUrl,
      AUTH_URL: "http://127.0.0.1:31700",
      PAYMENTS_ENABLED: "true",
      STRIPE_MODE: "test",
      STRIPE_SECRET_KEY: ["sk", "test", "fixture-not-a-real-credential"].join("_"),
      STRIPE_WEBHOOK_SECRET: ["whsec", "fixture-not-a-real-secret"].join("_"),
      AUTH_SECRET: "a".repeat(32),
      LNX_AUTH_QA_PASSWORD: "qa-password-strong",
    },
    proof: {
      name: PAYMENT_QA_TARGET,
      pid: 123,
      exports: { database: { connectionString: databaseUrl } },
    },
  };
}

test("accepte uniquement une QA Stripe test locale et jetable", () => {
  const fixture = valid();
  assert.equal(assertPaymentQaEnvironment(fixture.environment, fixture.proof).target, PAYMENT_QA_TARGET);
});

test("autorise le runtime navigateur uniquement en développement local QA", () => {
  const fixture = valid();
  fixture.environment.NODE_ENV = "development";
  assert.equal(
    assertPaymentQaRuntimeEnvironment(fixture.environment, fixture.proof).target,
    PAYMENT_QA_TARGET,
  );
  assert.throws(() => assertPaymentQaEnvironment(fixture.environment, fixture.proof));

  fixture.environment.NODE_ENV = "production";
  assert.throws(() => assertPaymentQaRuntimeEnvironment(fixture.environment, fixture.proof));
});

test("le garde DB jetable reste exécutable sans aucun credential Stripe", () => {
  const fixture = valid();
  const environment: Record<string, string | undefined> = fixture.environment;
  delete environment.STRIPE_SECRET_KEY;
  delete environment.STRIPE_WEBHOOK_SECRET;
  delete environment.PAYMENTS_ENABLED;
  delete environment.STRIPE_MODE;
  assert.equal(
    assertPaymentQaDatabaseEnvironment(environment, fixture.proof).target,
    PAYMENT_QA_TARGET,
  );
  assert.throws(() => assertPaymentQaEnvironment(environment, fixture.proof));
});

test("refuse la preview personnelle, Railway, le port par défaut et les overrides PostgreSQL", () => {
  for (const mutate of [
    (environment: Record<string, string | undefined>) => { environment.LNX_DATABASE_TARGET = "lnx-studio-local-preview"; },
    (environment: Record<string, string | undefined>) => { environment.RAILWAY_ENVIRONMENT = "production"; },
    (environment: Record<string, string | undefined>) => { environment.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/lnx-studio-v070-test"; },
    (environment: Record<string, string | undefined>) => { environment.DATABASE_URL = `${databaseUrl}&host=database.example.invalid`; },
  ]) {
    const fixture = valid();
    mutate(fixture.environment);
    assert.throws(() => assertPaymentQaEnvironment(fixture.environment, fixture.proof));
  }
});

test("refuse le live, une origine personnelle et une preuve Prisma divergente", () => {
  const live = valid();
  live.environment.STRIPE_SECRET_KEY = ["sk", "live", "fixture-forbidden"].join("_");
  assert.throws(() => assertPaymentQaEnvironment(live.environment, live.proof));

  const personalOrigin = valid();
  personalOrigin.environment.AUTH_URL = "http://127.0.0.1:3000";
  assert.throws(() => assertPaymentQaEnvironment(personalOrigin.environment, personalOrigin.proof));

  const mismatchedProof = valid();
  mismatchedProof.proof.exports.database.connectionString = "postgres://other";
  assert.throws(() => assertPaymentQaEnvironment(mismatchedProof.environment, mismatchedProof.proof));
});

test("ne divulgue aucune valeur sensible dans les erreurs de garde QA", () => {
  const cases = [
    {
      sentinel: "database-proof-sentinel-password",
      createFailure() {
        const fixture = valid();
        fixture.proof.exports.database.connectionString =
          `postgres://qa:${this.sentinel}@127.0.0.1:${PAYMENT_QA_DATABASE_PORT}/template1`;
        return () => assertPaymentQaEnvironment(fixture.environment, fixture.proof);
      },
    },
    {
      sentinel: "stripe-secret-sentinel",
      createFailure() {
        const fixture = valid();
        fixture.environment.STRIPE_SECRET_KEY = `sk_live_${this.sentinel}`;
        return () => assertPaymentQaEnvironment(fixture.environment, fixture.proof);
      },
    },
    {
      sentinel: "stripe-webhook-sentinel",
      createFailure() {
        const fixture = valid();
        fixture.environment.STRIPE_WEBHOOK_SECRET = this.sentinel;
        return () => assertPaymentQaEnvironment(fixture.environment, fixture.proof);
      },
    },
    {
      sentinel: "auth-url-sentinel",
      createFailure() {
        const fixture = valid();
        fixture.environment.AUTH_URL =
          `http://${this.sentinel}:${this.sentinel}@127.0.0.1:31700/?token=${this.sentinel}`;
        return () => assertPaymentQaEnvironment(fixture.environment, fixture.proof);
      },
    },
    {
      sentinel: "auth-path-sentinel",
      createFailure() {
        const fixture = valid();
        fixture.environment.AUTH_URL = `http://127.0.0.1:31700/${this.sentinel}`;
        return () => assertPaymentQaEnvironment(fixture.environment, fixture.proof);
      },
    },
  ];

  for (const sensitiveCase of cases) {
    const error = assert.throws(sensitiveCase.createFailure());
    assert.doesNotMatch(String(error), new RegExp(sensitiveCase.sentinel));
    assert.doesNotMatch(inspect(error), new RegExp(sensitiveCase.sentinel));
  }
});
