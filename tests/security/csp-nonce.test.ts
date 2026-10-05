import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { nonceCspEnabled, googleCmpConfigured } from "@/lib/ads/policy";
import { contentSecurityPolicy } from "@/lib/security/content-security-policy";
import { CSP_NONCE_HEADER, isScriptNonce } from "@/lib/security/csp-nonce";

const preview = { ADS_CSP_NONCE_ENABLED: "true", ADS_QA_ENVIRONMENT: "staging", SITE_URL: "https://lnx-preview.up.railway.app", RAILWAY_ENVIRONMENT_NAME: "preview", PAYMENT_DEPLOYMENT_ENV: "staging" };
const env = { NODE_ENV: "production", MEDIA_STORAGE_DRIVER: "local" } as const;
const nonce = randomBytes(32).toString("base64");

test("baseline CSP remains exactly unchanged when opt-in is absent", () => {
  assert.equal(contentSecurityPolicy(env), "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'");
});
test("nonce policy trusts nonce scripts, not inline/eval/host wildcards", () => {
  const policy = contentSecurityPolicy(env, nonce);
  assert.ok(policy.includes(`script-src 'nonce-${nonce}' 'strict-dynamic'`));
  assert.ok(policy.includes("base-uri 'none'"));
  const directives = policy.split("; ");
  assert.doesNotMatch(directives.find(d => d.startsWith("script-src"))!, /unsafe-inline|unsafe-eval|\*|https:|http:|'self'/);
  for (const directive of contentSecurityPolicy(env).split("; ").filter(d => !/^(script-src|base-uri)/.test(d))) assert.ok(directives.includes(directive));
  assert.doesNotMatch(contentSecurityPolicy({ ...env, NODE_ENV: "development" }, nonce).split("; ").find(d => d.startsWith("script-src"))!, /unsafe-eval/);
});
test("reject malformed/header-injecting nonces", () => {
  assert.ok(isScriptNonce(nonce));
  for (const value of [undefined, null, "", "short", "x'; script-src *", "x\r\nCSP: *"]) {
    assert.equal(isScriptNonce(value), false);
    if (typeof value === "string") assert.throws(() => contentSecurityPolicy(env, value));
  }
});
test("opt-in limited to approved page and deployment allowlists", () => {
  for (const route of ["/", "/boutique", "/album/vie-de-chien"]) assert.equal(nonceCspEnabled(route, preview), true);
  for (const route of ["/soutenir", "/admin", "/admin/commandes", "/compte", "/commander", "/boutique/panier", "/boutique/produit", "/api/health", "/media/private/test", "/album/"]) assert.equal(nonceCspEnabled(route, preview), false);
  for (const bad of [{}, { ...preview, ADS_CSP_NONCE_ENABLED: "false" }, { ...preview, SITE_URL: "https://unknown.example" }, { ...preview, PAYMENT_DEPLOYMENT_ENV: "production" }]) assert.equal(nonceCspEnabled("/", bad), false);
});
test("nonce opt-in cannot enable Google or real advertising in Preview", () => {
  assert.equal(googleCmpConfigured({ ...preview, ADS_ENABLED: "true", ADS_GOOGLE_CMP_ENABLED: "true", ADS_GOOGLE_CMP_PUBLISHED: "true", ADSENSE_SITE_APPROVED: "true" }), false);
});
test("proxy generates unique 256-bit nonces and forwards matching request/response CSP", t => {
  t.mock.property(process, "env", { ...process.env, ...preview, ...env });
  const seen = new Set<string>();
  for (let i = 0; i < 32; i++) {
    const response = proxy(new NextRequest(`${preview.SITE_URL}/`, { headers: { [CSP_NONCE_HEADER]: "attacker", "content-security-policy": "script-src *", "content-security-policy-report-only": "script-src *" } }));
    const received = response.headers.get(`x-middleware-request-${CSP_NONCE_HEADER}`);
    assert.ok(isScriptNonce(received));
    assert.equal(Buffer.from(received, "base64").length, 32);
    assert.ok(!seen.has(received)); seen.add(received);
    assert.equal(response.headers.get("content-security-policy"), contentSecurityPolicy(env, received));
    assert.equal(response.headers.get("x-middleware-request-content-security-policy"), response.headers.get("content-security-policy"));
    assert.equal(response.headers.get("x-middleware-request-content-security-policy-report-only"), null);
    assert.match(response.headers.get("cache-control")!, /private, no-store/);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  }
});
test("excluded pages and POST never receive nonce CSP or client-supplied trusted headers", t => {
  t.mock.property(process, "env", { ...process.env, ...preview, ...env });
  for (const [path, method] of [["/soutenir", "GET"], ["/admin", "GET"], ["/api/health", "GET"], ["/", "POST"]]) {
    const response = proxy(new NextRequest(`${preview.SITE_URL}${path}`, { method, headers: { [CSP_NONCE_HEADER]: nonce, "content-security-policy": `script-src 'nonce-${nonce}'` } }));
    assert.equal(response.headers.get("content-security-policy"), null);
    assert.equal(response.headers.get(`x-middleware-request-${CSP_NONCE_HEADER}`), null);
    assert.equal(response.headers.get("x-middleware-request-content-security-policy"), null);
  }
});
test("Google bootstrap uses current document nonce before any network insertion", async () => {
  const source = await readFile(new URL("../../components/google-consent-ad.tsx", import.meta.url), "utf8");
  assert.match(source, /script\[nonce\]\[src\^=/);
  assert.ok(source.indexOf("!isScriptNonce(nonce)") < source.indexOf("document.head.append(script)"));
  assert.ok(source.indexOf("script.nonce = nonce") < source.indexOf("document.head.append(script)"));
  assert.doesNotMatch(source, /searchParams.*nonce|localStorage|sessionStorage/);
});
