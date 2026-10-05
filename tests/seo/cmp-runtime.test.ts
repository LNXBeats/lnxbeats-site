import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { googleCmpConfigured, liveAdsEnabled, allowsAdSlot } from "@/lib/ads/policy";
import { contentSecurityPolicy } from "@/lib/security/content-security-policy";
import { GOOGLE_CMP_SCRIPT_URL, GOOGLE_CMP_ORIGIN } from "@/data/google-cmp";

const configured = { NODE_ENV: "production", MEDIA_STORAGE_DRIVER: "local", RAILWAY_ENVIRONMENT_NAME: "production", SITE_URL: "https://www.lnxbeats.fr", ADS_CSP_NONCE_ENABLED: "true", ADS_GOOGLE_CMP_ENABLED: "true", ADS_GOOGLE_CMP_PUBLISHED: "true", ADS_ENABLED: "false" };
test("published, explicitly configured canonical CMP runs independently of Ads", () => {
  assert.equal(googleCmpConfigured(configured), true);
  assert.equal(liveAdsEnabled(configured), false);
  assert.equal(googleCmpConfigured({ ...configured, ADS_ENABLED: undefined }), true);
  assert.equal(liveAdsEnabled({ ...configured, ADS_ENABLED: "true", ADSENSE_SITE_APPROVED: "true" }), false);
});
test("missing/invalid configuration, wrong site, QA and unpublished CMP fail closed", () => {
  assert.equal(googleCmpConfigured({}), false);
  for (const key of ["RAILWAY_ENVIRONMENT_NAME", "SITE_URL", "ADS_CSP_NONCE_ENABLED", "ADS_GOOGLE_CMP_ENABLED", "ADS_GOOGLE_CMP_PUBLISHED"]) {
    assert.equal(googleCmpConfigured({ ...configured, [key]: undefined }), false, key);
    assert.equal(googleCmpConfigured({ ...configured, [key]: "invalid" }), false, key);
  }
  for (const overrides of [{ SITE_URL: "https://lnxbeats.fr" }, { SITE_URL: "https://www.lnxbeats.fr.evil.example" }, { SITE_URL: "http://www.lnxbeats.fr" }, { ADS_QA_PLACEHOLDERS: "true" }, { RAILWAY_ENVIRONMENT_NAME: "preview-v33-media" }]) assert.equal(googleCmpConfigured({ ...configured, ...overrides }), false);
});
test("AFC uses the official publisher tag, not the AFS/ad-blocking recovery tag", () => {
  assert.equal(GOOGLE_CMP_SCRIPT_URL, "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2056594730161751");
  assert.doesNotMatch(GOOGLE_CMP_SCRIPT_URL, /fundingchoicesmessages.*\/i\//);
});
test("CMP adds only its exact connect/frame origin to a nonced eligible document", () => {
  const nonce = randomBytes(32).toString("base64");
  const csp = contentSecurityPolicy(configured, nonce);
  assert.ok(csp.includes(`connect-src 'self' ${GOOGLE_CMP_ORIGIN}`));
  assert.ok(csp.includes(`frame-src 'self' ${GOOGLE_CMP_ORIGIN}`));
  assert.doesNotMatch(csp, /\*|unsafe-eval/);
  assert.doesNotMatch(csp.split(";").find(d => d.includes("script-src"))!, /unsafe-inline/);
  assert.ok(!contentSecurityPolicy(configured).includes(GOOGLE_CMP_ORIGIN));
  assert.ok(!contentSecurityPolicy({ ...configured, ADS_GOOGLE_CMP_ENABLED: "false" }, nonce).includes(GOOGLE_CMP_ORIGIN));
});
test("private, support and transaction routes still reject CMP/Ads slots", () => {
  for (const path of ["/admin", "/admin/commandes/x", "/compte", "/commander", "/soutenir", "/boutique/panier", "/boutique/checkout", "/api/support", "/media/private/x", "/confidentialite"]) for (const slot of ["footer", "content"] as const) assert.equal(allowsAdSlot(path, slot), false);
});
test("component pauses before AFC bootstrap and keeps explicit origin/nonce/route checks", async () => {
  const source = await readFile(new URL("../../components/google-consent-ad.tsx", import.meta.url), "utf8");
  assert.match(source, /script.src = GOOGLE_CMP_SCRIPT_URL/);
  assert.doesNotMatch(source, /enable_page_level_ads|googlefcPresent/);
  assert.match(source, /script\.crossOrigin = "anonymous"/);
  assert.ok(source.indexOf("queue.pauseAdRequests = 1") < source.indexOf("document.head.append(script)"));
  assert.match(source, /location.origin !== "https:\/\/www.lnxbeats.fr"/);
  assert.match(source, /data-google-cmp-state=\{consent\}/);
  assert.doesNotMatch(source, /setReady\(true\)/);
  assert.match(source, /setReady\(googlePreferencesAvailable\(data, success\)/);
  const boundary = await readFile(new URL("../../components/google-cmp-navigation-boundary.tsx", import.meta.url), "utf8");
  assert.match(boundary, /documentEligible.current !== eligible/);
  assert.match(boundary, /window.location.replace/);
  assert.doesNotMatch(boundary, /createElement|adsbygoogle|localStorage|fetch\(/);
});
