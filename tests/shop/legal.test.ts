import assert from "node:assert/strict";
import test from "node:test";

import {
  parseShopLegalConfiguration,
  requireAcceptedShopTerms,
  requireAcceptedShopTermsForOrder,
  SHOP_LEGAL_QA_ARCHIVED_TERMS_VERSION,
  SHOP_LEGAL_QA_CONFIRMATION,
  SHOP_LEGAL_QA_TERMS_VERSION,
  ShopLegalGateError,
  shopLegalHealthSummary,
} from "@/lib/shop/legal";

const armedQaEnvironment = {
  NODE_ENV: "test",
  AUTH_URL: "http://127.0.0.1:31760",
  SHOP_LEGAL_READY: "true",
  SHOP_TERMS_VERSION: SHOP_LEGAL_QA_TERMS_VERSION,
  SHOP_LEGAL_QA_CONFIRM: SHOP_LEGAL_QA_CONFIRMATION,
} as const;

test("Shop legal readiness is closed by default and rejects loose booleans", () => {
  const closed = parseShopLegalConfiguration({});
  assert.deepEqual(closed, { ready: false, activeTerms: null });
  assert.deepEqual(shopLegalHealthSummary(closed), {
    ready: false,
    activeVersionConfigured: false,
    productionApproved: false,
  });
  assert.throws(
    () => parseShopLegalConfiguration({ SHOP_LEGAL_READY: "1" }),
    (error: unknown) => error instanceof ShopLegalGateError
      && error.code === "CONFIGURATION_INVALID",
  );
});

test("Shop legal QA requires an immutable registered version and exact local armament", () => {
  assert.throws(
    () => parseShopLegalConfiguration({ SHOP_LEGAL_READY: "true" }),
    /SHOP_TERMS_VERSION/,
  );
  assert.throws(
    () => parseShopLegalConfiguration({
      ...armedQaEnvironment,
      SHOP_TERMS_VERSION: "unregistered",
    }),
    /registered immutable version/,
  );
  assert.throws(
    () => parseShopLegalConfiguration({
      ...armedQaEnvironment,
      SHOP_LEGAL_QA_CONFIRM: "wrong",
    }),
    /SHOP_LEGAL_QA_CONFIRM/,
  );
  assert.throws(
    () => parseShopLegalConfiguration({
      ...armedQaEnvironment,
      AUTH_URL: "https://preview.example.com",
    }),
    /loopback HTTP/,
  );
  assert.throws(
    () => parseShopLegalConfiguration({
      ...armedQaEnvironment,
      NODE_ENV: "production",
    }),
    /forbidden in a production runtime/,
  );
  const configuration = parseShopLegalConfiguration(armedQaEnvironment);
  assert.equal(configuration.ready, true);
  assert.equal(configuration.activeTerms?.version, SHOP_LEGAL_QA_TERMS_VERSION);
  assert.match(configuration.activeTerms?.hashSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.equal(configuration.activeTerms?.approval, "QA_ONLY");
});

test("acceptance is explicit and snapshots only server-owned terms identity", () => {
  assert.throws(
    () => requireAcceptedShopTerms(false, armedQaEnvironment),
    (error: unknown) => error instanceof ShopLegalGateError
      && error.code === "TERMS_NOT_ACCEPTED",
  );
  assert.throws(
    () => requireAcceptedShopTerms(true, {}),
    (error: unknown) => error instanceof ShopLegalGateError
      && error.code === "LEGAL_NOT_READY",
  );

  const acceptedAt = new Date("2026-08-27T20:00:00.000Z");
  const snapshot = requireAcceptedShopTerms(true, armedQaEnvironment, acceptedAt);
  assert.deepEqual(snapshot, {
    termsVersion: SHOP_LEGAL_QA_TERMS_VERSION,
    termsHashSha256: snapshot.termsHashSha256,
    termsAcceptedAt: acceptedAt,
  });
  assert.match(snapshot.termsHashSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(snapshot.termsAcceptedAt, acceptedAt, "the snapshot owns its Date instance");
  assert.equal(Object.isFrozen(snapshot), true);
});

test("a retry preserves the registered terms snapshot accepted before an active-version rotation", () => {
  const acceptedAt = new Date("2026-08-27T19:00:00.000Z");
  const archived = requireAcceptedShopTerms(true, {
    ...armedQaEnvironment,
    SHOP_TERMS_VERSION: SHOP_LEGAL_QA_ARCHIVED_TERMS_VERSION,
  }, acceptedAt);
  const retried = requireAcceptedShopTermsForOrder(
    true,
    archived,
    armedQaEnvironment,
    new Date("2026-08-27T21:00:00.000Z"),
  );
  assert.deepEqual(retried, archived);
  assert.equal(retried.termsVersion, SHOP_LEGAL_QA_ARCHIVED_TERMS_VERSION);
  assert.notEqual(retried.termsAcceptedAt, archived.termsAcceptedAt);
  assert.throws(
    () => requireAcceptedShopTermsForOrder(true, {
      ...archived,
      termsHashSha256: "f".repeat(64),
    }, armedQaEnvironment),
    /not registered/,
  );
  assert.throws(
    () => requireAcceptedShopTermsForOrder(true, {
      termsVersion: archived.termsVersion,
      termsHashSha256: null,
      termsAcceptedAt: archived.termsAcceptedAt,
    }, armedQaEnvironment),
    /incomplete/,
  );
});
