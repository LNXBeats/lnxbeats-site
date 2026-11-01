import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { contentSecurityPolicy } from "@/lib/security/content-security-policy";
import { CSP_NONCE_HEADER, isScriptNonce } from "@/lib/security/csp-nonce";
import { ANALYTICS_CONNECT_ORIGINS } from "@/lib/analytics/policy";

const env = {
  NODE_ENV: "production", SITE_URL: "https://www.lnxbeats.fr", RAILWAY_ENVIRONMENT_NAME: "production",
  ANALYTICS_ENABLED: "true", ANALYTICS_MEASUREMENT_ID: "G-TESTONLY123",
  MEDIA_STORAGE_DRIVER: "local", ADS_CSP_NONCE_ENABLED: "false", ADS_GOOGLE_CMP_ENABLED: "false",
} as const;
const nonce = Buffer.alloc(32, 1).toString("base64");
const analyticsPattern = /google-analytics\.com/;

test("GA network permission needs all three guards: config, route and nonce", () => {
  const allowed = contentSecurityPolicy(env, nonce, { analyticsPathname: "/discographie" });
  const connections = allowed.split("; ").find(d => d.startsWith("connect-src"))!;
  for (const origin of ANALYTICS_CONNECT_ORIGINS) assert.ok(connections.includes(origin));
  assert.doesNotMatch(allowed, /https:\/\/\*|google\.com|doubleclick/);
  for (const policy of [
    contentSecurityPolicy(env, nonce),
    contentSecurityPolicy(env, undefined, { analyticsPathname: "/" }),
    contentSecurityPolicy({}, nonce, { analyticsPathname: "/" }),
    contentSecurityPolicy({ ...env, ANALYTICS_ENABLED: "false" }, nonce, { analyticsPathname: "/" }),
    contentSecurityPolicy({ ...env, RAILWAY_ENVIRONMENT_NAME: "preview" }, nonce, { analyticsPathname: "/" }),
    contentSecurityPolicy(env, nonce, { analyticsPathname: "/compte" }),
  ]) assert.doesNotMatch(policy, analyticsPattern);
});

test("public GET uses fresh matching CSP and ignores attacker nonce headers", t => {
  t.mock.property(process, "env", { ...env });
  const nonces = new Set<string>();
  for (const path of ["/", "/discographie", "/avant-premieres", "/creations", "/boutique", "/a-propos", "/album/vie-de-chien"]) {
    const response = proxy(new NextRequest(`${env.SITE_URL}${path}`, { headers: { [CSP_NONCE_HEADER]: "untrusted", "content-security-policy": "default-src *" } }));
    const generated = response.headers.get(`x-middleware-request-${CSP_NONCE_HEADER}`);
    assert.ok(isScriptNonce(generated));
    assert.ok(!nonces.has(generated)); nonces.add(generated);
    assert.equal(response.headers.get("content-security-policy"), contentSecurityPolicy(env, generated, { analyticsPathname: path }));
    assert.equal(response.headers.get("x-middleware-request-content-security-policy"), response.headers.get("content-security-policy"));
    assert.match(response.headers.get("cache-control")!, /private, no-store/);
  }
});

test("no analytics CSP on private/unknown/API/transactional routes even when enabled", t => {
  t.mock.property(process, "env", { ...env });
  for (const path of ["/admin", "/compte", "/connexion", "/inscription", "/commander", "/contact", "/soutenir", "/musique/checkout", "/musique/panier", "/boutique/panier", "/api/auth/session", "/confidentialite", "/album/a%2Fb"]) {
    const response = proxy(new NextRequest(`${env.SITE_URL}${path}`));
    assert.doesNotMatch(response.headers.get("content-security-policy") ?? "", analyticsPattern, path);
  }
});

test("no analytics permission on POST or noncanonical/QA origin", t => {
  t.mock.property(process, "env", { ...env });
  for (const request of [
    new NextRequest(`${env.SITE_URL}/`, { method: "POST" }),
    new NextRequest("http://127.0.0.1:3194/"),
    new NextRequest("https://preview.up.railway.app/"),
    new NextRequest("http://www.lnxbeats.fr/"),
  ]) assert.doesNotMatch(proxy(request).headers.get("content-security-policy") ?? "", analyticsPattern);
});

test("new GA-only nonce pages do not broaden the existing CMP network perimeter", t => {
  const both = { ...env, ADS_CSP_NONCE_ENABLED: "true", ADS_GOOGLE_CMP_ENABLED: "true", ADS_GOOGLE_CMP_PUBLISHED: "true" };
  t.mock.property(process, "env", both);
  for (const path of ["/discographie", "/avant-premieres", "/creations", "/a-propos"]) {
    const policy = proxy(new NextRequest(`${env.SITE_URL}${path}`)).headers.get("content-security-policy")!;
    assert.match(policy, analyticsPattern);
    assert.doesNotMatch(policy, /fundingchoicesmessages|frame-src/);
  }
  for (const path of ["/", "/boutique", "/album/vie-de-chien"]) {
    const policy = proxy(new NextRequest(`${env.SITE_URL}${path}`)).headers.get("content-security-policy")!;
    assert.match(policy, analyticsPattern);
    assert.match(policy, /fundingchoicesmessages/);
  }
  const checkout = proxy(new NextRequest(`${env.SITE_URL}/musique/checkout`)).headers.get("content-security-policy")!;
  assert.match(checkout, /fundingchoicesmessages/); // unchanged legacy nonce policy
  assert.doesNotMatch(checkout, analyticsPattern);
});

test("rollout is server-configured and no measurement ID is embedded into source", async () => {
  const layout = await readFile(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /SiteAnalytics configuration=\{resolveAnalyticsConfiguration\(process\.env\)\}/);
  assert.doesNotMatch(layout, /G-[A-Z0-9]+|googletagmanager\.com\/gtag/);
});

test("privacy supplement is conditional and does not rewrite historical terms", async () => {
  const source = await readFile(new URL("../../app/confidentialite/page.tsx", import.meta.url), "utf8");
  assert.match(source, /document=\{approvedPrivacyNotice\}/);
  assert.match(source, /resolveAnalyticsConfiguration\(process\.env\) \?/);
  for (const phrase of ["accord préalable", "Refuser", "180 jours", "retirer votre accord", "hors de l’Espace économique européen", "Google Signals"]) assert.ok(source.includes(phrase), phrase);
});
