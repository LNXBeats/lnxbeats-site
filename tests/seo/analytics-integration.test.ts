import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { contentSecurityPolicy } from "@/lib/security/content-security-policy";
import { CSP_NONCE_HEADER, isScriptNonce } from "@/lib/security/csp-nonce";
import { ANALYTICS_CONNECT_ORIGINS, mayLoadAnalytics, resolveAnalyticsConfiguration } from "@/lib/analytics/policy";

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

test("no analytics permission on POST or noncanonical/QA host", t => {
  t.mock.property(process, "env", { ...env });
  for (const request of [
    new NextRequest(`${env.SITE_URL}/`, { method: "POST" }),
    new NextRequest("http://127.0.0.1:3194/"),
    new NextRequest("https://preview.up.railway.app/"),
  ]) assert.doesNotMatch(proxy(request).headers.get("content-security-policy") ?? "", analyticsPattern);
});

test("canonical Host behind an internal HTTP reverse proxy receives the public Analytics CSP", t => {
  t.mock.property(process, "env", { ...env });
  for (const method of ["GET", "HEAD"]) for (const path of ["/", "/discographie", "/avant-premieres"]) for (const host of ["www.lnxbeats.fr", "WWW.LNXBEATS.FR", "www.lnxbeats.fr:443"]) {
    const request = new NextRequest(`http://127.0.0.1:3000${path}`, { method, headers: { host } });
    assert.notEqual(request.nextUrl.origin, env.SITE_URL);
    const response = proxy(request);
    const generated = response.headers.get(`x-middleware-request-${CSP_NONCE_HEADER}`);
    assert.ok(isScriptNonce(generated));
    assert.match(response.headers.get("content-security-policy")!, analyticsPattern);
    assert.equal(response.headers.get("x-middleware-request-content-security-policy"), response.headers.get("content-security-policy"));
    assert.equal(response.headers.get("location"), null);
  }
  // Host permission is not a transport/consent grant in a real HTTP/QA browser.
  const configuration = resolveAnalyticsConfiguration(env);
  for (const origin of ["http://www.lnxbeats.fr", "http://127.0.0.1:3000"]) {
    assert.equal(mayLoadAnalytics({ configuration, origin, pathname: "/", consent: "granted" }), false);
  }
});

test("reverse-proxy support never trusts a false or forwarded Host, nor an apex redirect", t => {
  t.mock.property(process, "env", { ...env });
  for (const host of ["localhost:3000", "127.0.0.1:3000", "preview.up.railway.app", "www.lnxbeats.fr.evil.test", "evil.test@www.lnxbeats.fr", "www.lnxbeats.fr/path", "www.lnxbeats.fr:80", "www.lnxbeats.fr, evil.test"]) {
    const response = proxy(new NextRequest("http://127.0.0.1:3000/discographie", { headers: { host, "x-forwarded-host": "www.lnxbeats.fr", "x-forwarded-proto": "https" } }));
    assert.doesNotMatch(response.headers.get("content-security-policy") ?? "", analyticsPattern, host);
  }
  const apex = proxy(new NextRequest("http://127.0.0.1:3000/discographie", { headers: { host: "lnxbeats.fr" } }));
  assert.equal(apex.status, 308);
  assert.equal(apex.headers.get("location"), "https://www.lnxbeats.fr/discographie");
  assert.equal(apex.headers.get("content-security-policy"), null);
});

test("canonical reverse-proxy Host still requires Production flags and a public path", t => {
  const request = (path: string) => new NextRequest(`http://127.0.0.1:3000${path}`, { headers: { host: "www.lnxbeats.fr" } });
  const scopedEnv: NodeJS.ProcessEnv = { ...env };
  t.mock.property(process, "env", scopedEnv);
  for (const path of ["/compte", "/admin", "/api/auth/session", "/musique/checkout", "/musique/panier", "/commander"]) {
    assert.doesNotMatch(proxy(request(path)).headers.get("content-security-policy") ?? "", analyticsPattern, path);
  }
  for (const context of [{ ...env, RAILWAY_ENVIRONMENT_NAME: "preview" }, { ...env, ANALYTICS_ENABLED: "false" }, { ...env, SITE_URL: "http://127.0.0.1:3000" }]) {
    Object.assign(scopedEnv, context);
    assert.doesNotMatch(proxy(request("/discographie")).headers.get("content-security-policy") ?? "", analyticsPattern);
  }
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
