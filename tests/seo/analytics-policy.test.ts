import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_CANONICAL_ORIGIN, ANALYTICS_CONNECT_ORIGINS, ANALYTICS_CONSENT_MAX_AGE_MS, ANALYTICS_CONSENT_STORAGE_KEY,
  ANALYTICS_CONSENT_VERSION, analyticsPageViewParameters, allowsAnalyticsPath,
  canonicalAnalyticsPageLocation, createAnalyticsConsentRecord, createAnalyticsTestConfiguration,
  isAnalyticsMeasurementId, mayLoadAnalytics, parseAnalyticsConsentRecord,
  readAnalyticsConsent, resolveAnalyticsConfiguration, serializeAnalyticsConsent,
  type AnalyticsConfiguration, type AnalyticsEnvironment, type AnalyticsRequest,
} from "@/lib/analytics/policy";

// Synthetic constants only. No process.env, live account, global clock override or transport.
const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const environment = {
  NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production", SITE_URL: ANALYTICS_CANONICAL_ORIGIN,
  ANALYTICS_ENABLED: "true", ANALYTICS_MEASUREMENT_ID: "G-SYNTHETIC1",
} as const;
const configuration = resolveAnalyticsConfiguration(environment)!;
const request = (overrides: Partial<AnalyticsRequest> = {}): AnalyticsRequest => ({
  configuration, origin: ANALYTICS_CANONICAL_ORIGIN, pathname: "/", consent: "granted", ...overrides,
});
const saved = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  version: ANALYTICS_CONSENT_VERSION, decision: "granted", decidedAt: NOW,
  expiresAt: NOW + ANALYTICS_CONSENT_MAX_AGE_MS, ...overrides,
});

test("configuration is OFF without every explicit production gate", () => {
  assert.equal(resolveAnalyticsConfiguration(), null);
  for (const key of Object.keys(environment)) {
    const missing: AnalyticsEnvironment = { ...environment, [key]: undefined };
    assert.equal(resolveAnalyticsConfiguration(missing), null, key);
  }
  for (const value of [undefined, "", "false", "TRUE", "1", " true", "true "])
    assert.equal(resolveAnalyticsConfiguration({ ...environment, ANALYTICS_ENABLED: value }), null);
  assert.deepEqual(configuration, { enabled: true, mode: "production", origin: ANALYTICS_CANONICAL_ORIGIN, measurementId: "G-SYNTHETIC1" });
  assert.ok(Object.isFrozen(configuration));
});

test("connect origins are fixed and do not allow Ads, Tag Manager or wildcard destinations", () => {
  assert.deepEqual(ANALYTICS_CONNECT_ORIGINS, ["https://www.google-analytics.com", "https://region1.google-analytics.com"]);
  assert.ok(Object.isFrozen(ANALYTICS_CONNECT_ORIGINS));
});

test("origin must be exact, not a parsed/coerced alias or preview", () => {
  for (const origin of ["http://www.lnxbeats.fr", "https://lnxbeats.fr", "https://www.lnxbeats.fr/", "https://WWW.lnxbeats.fr",
    "https://www.lnxbeats.fr:443", "https://www.lnxbeats.fr.evil.example", "https://www.lnxbeats.fr@evil.example",
    "https://user@www.lnxbeats.fr", "https://www.lnxbeats.fr?x=1", "https://www.lnxbeats.fr#x", "https://preview.up.railway.app"])
    assert.equal(resolveAnalyticsConfiguration({ ...environment, SITE_URL: origin }), null, origin);
  for (const overrides of [{ NODE_ENV: "test" }, { NODE_ENV: "development" }, { RAILWAY_ENVIRONMENT_NAME: "preview" }, { RAILWAY_ENVIRONMENT_NAME: "Production" }])
    assert.equal(resolveAnalyticsConfiguration({ ...environment, ...overrides }), null);
});

test("measurement IDs have bounded uppercase ASCII GA4 syntax, never UA/GTM/URLs", () => {
  for (const value of ["G-A", "G-0123456789", `G-${"A".repeat(32)}`]) assert.equal(isAnalyticsMeasurementId(value), true);
  for (const value of [null, undefined, 123, {}, "", "G-", "G-abc", "g-ABC", "G-A_B", "G-A-B", "G-É", "G-Ａ",
    "G-A\n", "G-A\r", " G-A", "G-A ", "G-A?x=1", "G-A#x", "G-A%20", `G-${"A".repeat(33)}`, "UA-123-1", "GTM-ABC", "https://www.lnxbeats.fr"])
    assert.equal(isAnalyticsMeasurementId(value), false, String(value));
});

test("QA-looking environment flags never bypass production configuration", () => {
  assert.equal(resolveAnalyticsConfiguration({ ...environment, NODE_ENV: "test", ANALYTICS_QA_ENABLED: "true", ADS_QA_ENVIRONMENT: "local", SITE_URL: "http://localhost:3000" }), null);
  assert.equal(resolveAnalyticsConfiguration({ ANALYTICS_ENABLED: "true", ANALYTICS_MEASUREMENT_ID: "G-SYNTHETIC1", ANALYTICS_QA_ENABLED: "true" }), null);
});

test("test configurations require an explicit loopback-only factory", () => {
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:4321", "http://[::1]:3000", "https://localhost"])
    assert.deepEqual(createAnalyticsTestConfiguration({ origin, measurementId: "G-SYNTHETIC1" }), { enabled: true, mode: "test", origin, measurementId: "G-SYNTHETIC1" });
  for (const origin of [ANALYTICS_CANONICAL_ORIGIN, "https://preview.up.railway.app", "http://localhost.evil.example", "http://127.1", "http://localhost/", "http://localhost?x=1", "http://localhost#x", "http://user@localhost", "file:///tmp/local", "http://localhost:99999"])
    assert.equal(createAnalyticsTestConfiguration({ origin, measurementId: "G-SYNTHETIC1" }), null, origin);
  assert.equal(createAnalyticsTestConfiguration({ origin: "http://localhost:3000", measurementId: "UA-123-1" }), null);
});

test("only the six public pages and a strict ASCII album slug are eligible", () => {
  for (const pathname of ["/", "/discographie", "/avant-premieres", "/creations", "/boutique", "/a-propos", "/album/vie-de-chien", "/album/a", "/album/2026", `/album/${"a".repeat(120)}`]) {
    assert.equal(allowsAnalyticsPath(pathname), true, pathname);
    assert.equal(canonicalAnalyticsPageLocation(pathname), `${ANALYTICS_CANONICAL_ORIGIN}${pathname}`);
  }
  assert.equal(allowsAnalyticsPath(`/album/${"a".repeat(121)}`), false);
});

test("private, transactional, account, auth, API and unknown routes fail closed", () => {
  for (const pathname of ["/admin", "/admin/users", "/compte", "/compte/profil", "/connexion", "/inscription", "/auth", "/auth/callback",
    "/mot-de-passe-oublie", "/reinitialiser-mot-de-passe", "/panier", "/checkout", "/boutique/panier", "/boutique/checkout", "/boutique/produit/x",
    "/commander", "/commandes", "/commande/x", "/soutenir", "/contact", "/recherche", "/confidentialite", "/api/health", "/media/private/x",
    "/musique/checkout", "/creations/private-project", "/album", "/album/", "/album/a/private", "/unknown"])
    assert.equal(allowsAnalyticsPath(pathname), false, pathname);
});

test("ambiguous slash, encoding, normalization and non-ASCII inputs are never repaired", () => {
  for (const pathname of [undefined, null, {}, "", "//", "//www.lnxbeats.fr", "https://www.lnxbeats.fr/", "/./", "/album/../", "/album/a/..", "/album//a",
    "/album/%61", "/%64iscographie", "/album/a%2fb", "/album/a%252fb", "/album/%2e%2e", "/album/a\\b", "\\discographie", "/discographie/",
    "/DISCographie", "/album/A", "/album/-a", "/album/a-", "/album/a--b", "/album/a_b", "/album/a.b", "/album/é", "/album/а", "/album/a;b",
    "/album/a\n", "/album/a\r", "/album/a\0", "/album/a\t", " /", "/ ", "/discographie?email=private", "/?token=private", "/#private"])
    assert.equal(allowsAnalyticsPath(pathname), false, String(pathname));
});

test("the load gate requires explicit analytics agreement, configuration, origin and route", () => {
  assert.equal(mayLoadAnalytics(request()), true);
  for (const consent of ["unknown", "denied"] as const) assert.equal(mayLoadAnalytics(request({ consent })), false);
  for (const overrides of [{ configuration: null }, { origin: "https://lnxbeats.fr" }, { origin: "http://localhost:3000" }, { pathname: "/compte" }, { pathname: "/?x=1" }])
    assert.equal(mayLoadAnalytics(request(overrides)), false);
  for (const patch of [{ enabled: false }, { mode: "preview" }, { origin: "https://evil.example" }, { measurementId: "UA-123-1" }])
    assert.equal(mayLoadAnalytics(request({ configuration: { ...configuration, ...patch } as AnalyticsConfiguration })), false);
});

test("test context must match its exact loopback origin and still has every consent/route gate", () => {
  const config = createAnalyticsTestConfiguration({ origin: "http://localhost:3000", measurementId: "G-SYNTHETIC1" })!;
  assert.equal(mayLoadAnalytics(request({ configuration: config, origin: config.origin })), true);
  assert.equal(mayLoadAnalytics(request({ configuration: config })), false);
  assert.equal(mayLoadAnalytics(request({ configuration: config, origin: config.origin, consent: "unknown" })), false);
  assert.equal(mayLoadAnalytics(request({ configuration: config, origin: config.origin, pathname: "/admin" })), false);
});

test("page-view parameters contain only canonical path and explicit empty referrer/title", () => {
  const input = { ...request({ pathname: "/discographie" }), search: "?email=private@example.invalid", hash: "#private-token", referrer: "https://private.invalid/account", title: "Private customer", userId: "private-user" };
  const params = analyticsPageViewParameters(input);
  assert.deepEqual(params, { page_location: `${ANALYTICS_CANONICAL_ORIGIN}/discographie`, page_referrer: "", page_title: "" });
  assert.ok(Object.isFrozen(params));
  assert.doesNotMatch(JSON.stringify(params), /private|email|userId|\?|#/);
  assert.equal(analyticsPageViewParameters(request({ pathname: "/compte" })), null);
  assert.equal(analyticsPageViewParameters(request({ consent: "denied" })), null);
});

test("consent has its own version/key and fixed maximum of 180 days", () => {
  assert.equal(ANALYTICS_CONSENT_VERSION, 1);
  assert.equal(ANALYTICS_CONSENT_STORAGE_KEY, "lnx.analytics.consent.v1");
  assert.equal(ANALYTICS_CONSENT_MAX_AGE_MS, 15_552_000_000);
  for (const decision of ["denied", "granted"] as const) {
    const value = createAnalyticsConsentRecord(decision, NOW);
    assert.deepEqual(value, { version: 1, decision, decidedAt: NOW, expiresAt: NOW + ANALYTICS_CONSENT_MAX_AGE_MS });
    assert.ok(Object.isFrozen(value));
    const serialized = serializeAnalyticsConsent(decision, NOW)!;
    assert.deepEqual(parseAnalyticsConsentRecord(serialized, NOW), value);
    assert.equal(readAnalyticsConsent(serialized, NOW), decision);
  }
});

test("only an explicit refusal/agreement creates a record, never advertising/functional consent", () => {
  for (const choice of [undefined, null, true, false, 1, "unknown", "accepted", "TRUE", "GRANTED", " granted", "granted ", { tcString: "synthetic", vendor: { consents: { 755: true } } }, { functional: true }]) {
    assert.equal(createAnalyticsConsentRecord(choice, NOW), null);
    assert.equal(serializeAnalyticsConsent(choice, NOW), null);
  }
});

test("future, expired, overlong, inverted and noninteger consent dates are unknown", () => {
  for (const overrides of [{ decidedAt: NOW + 1 }, { expiresAt: NOW }, { expiresAt: NOW - 1 }, { expiresAt: NOW + ANALYTICS_CONSENT_MAX_AGE_MS + 1 },
    { decidedAt: NOW - 10, expiresAt: NOW - 10 }, { decidedAt: NOW + 0.5 }, { expiresAt: NOW + 1.5 }, { decidedAt: -1 },
    { decidedAt: String(NOW) }, { expiresAt: String(NOW + 1) }, { decidedAt: Number.MAX_SAFE_INTEGER + 1 }, { expiresAt: null }])
    assert.equal(readAnalyticsConsent(saved(overrides), NOW), "unknown", JSON.stringify(overrides));
  assert.equal(readAnalyticsConsent(saved(), NOW + ANALYTICS_CONSENT_MAX_AGE_MS - 1), "granted");
  assert.equal(readAnalyticsConsent(saved(), NOW + ANALYTICS_CONSENT_MAX_AGE_MS), "unknown");
});

test("shorter positive retention is valid and reading never renews the timestamp", () => {
  const raw = saved({ decision: "denied", expiresAt: NOW + 1000 });
  const parsed = parseAnalyticsConsentRecord(raw, NOW + 999)!;
  assert.equal(parsed.decidedAt, NOW); assert.equal(parsed.expiresAt, NOW + 1000);
  assert.equal(readAnalyticsConsent(raw, NOW + 1000), "unknown");
});

test("missing, malformed, oversized and other-version storage fails closed", () => {
  for (const raw of [undefined, null, true, {}, [], "", "{", "null", "[]", "true", "\"granted\"", " ".repeat(513),
    saved({ version: 0 }), saved({ version: 2 }), saved({ version: "1" }), saved({ decision: "unknown" }), saved({ decision: true }),
    saved({ extra: "private" }), JSON.stringify({ version: 1, decision: "granted", decidedAt: NOW }),
    JSON.stringify({ tcString: "synthetic", vendor: { consents: { 755: true } }, purpose: { consents: { 1: true, 3: true, 4: true } } })])
    assert.equal(readAnalyticsConsent(raw, NOW), "unknown");
});

test("ambiguous duplicate keys, escaped field names and prototype additions are rejected", () => {
  assert.equal(readAnalyticsConsent(saved().replace('"decision":"granted"', '"decision":"denied","decision":"granted"'), NOW), "unknown");
  assert.equal(readAnalyticsConsent(saved().replace('"decision":"granted"', '"decision":"denied","\\u0064ecision":"granted"'), NOW), "unknown");
  assert.equal(readAnalyticsConsent(saved().replace('"version"', '"vers\\u0069on"'), NOW), "unknown");
  assert.equal(readAnalyticsConsent(saved().replace('"granted"', '"gran\\u0074ed"'), NOW), "unknown");
  assert.equal(readAnalyticsConsent(saved().replace('{', '{"__proto__":{},'), NOW), "unknown");
  assert.equal(readAnalyticsConsent(`\n ${saved()} \t`, NOW), "granted");
});

test("invalid clocks never create or accept a decision, including unsafe expiry addition", () => {
  for (const now of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(createAnalyticsConsentRecord("granted", now), null);
    assert.equal(readAnalyticsConsent(saved(), now), "unknown");
  }
  assert.equal(createAnalyticsConsentRecord("granted", Number.MAX_SAFE_INTEGER), null);
});

test("revocation and expiration close the gate without changing functional/TCF decisions", () => {
  const grant = serializeAnalyticsConsent("granted", NOW)!;
  const denied = serializeAnalyticsConsent("denied", NOW + 1)!;
  assert.equal(mayLoadAnalytics(request({ consent: readAnalyticsConsent(grant, NOW) })), true);
  assert.equal(mayLoadAnalytics(request({ consent: readAnalyticsConsent(denied, NOW + 1) })), false);
  assert.equal(mayLoadAnalytics(request({ consent: readAnalyticsConsent(grant, NOW + ANALYTICS_CONSENT_MAX_AGE_MS) })), false);
  assert.equal(mayLoadAnalytics(request({ consent: readAnalyticsConsent(null, NOW + 1) })), false);
});
