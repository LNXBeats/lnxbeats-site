import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createConsentGate, googleConsentState, mayRequestAd, type ConsentState, type TcfData } from "@/lib/ads/consent";
import { googleCmpConfigured, liveAdsEnabled, liveAdSlotId } from "@/lib/ads/policy";
import { approvedPrivacyNotice } from "@/data/legal";

// Provider doubles only. These are not real consent strings or a certified CMP.
const accepted: TcfData = { cmpStatus: "loaded", eventStatus: "useractioncomplete", tcString: "unit-test-only", vendor: { consents: { 755: true } }, purpose: { consents: { 1: true, 3: true, 4: true } } };
test("absent, failed, loading and open consent UI fail closed", () => {
  for (const data of [undefined, {}, { ...accepted, tcString: "" }, { ...accepted, cmpStatus: "error" }, { ...accepted, eventStatus: "cmpuishown" }]) assert.equal(googleConsentState(data, true), "unknown");
  assert.equal(googleConsentState(accepted, false), "unknown");
});
test("refusal and missing vendor/purpose consent never request ads", () => {
  for (const data of [{ ...accepted, vendor: undefined }, { ...accepted, purpose: undefined }, { ...accepted, vendor: { consents: { 755: false } } }, { ...accepted, purpose: { consents: { 1: true, 3: false, 4: true } } }]) {
    assert.equal(googleConsentState(data, true), "denied");
    assert.equal(mayRequestAd("/", "footer", true, googleConsentState(data, true)), false);
  }
});
test("accepted TCF signal still needs route and feature permission", () => {
  assert.equal(googleConsentState(accepted, true), "granted");
  assert.equal(mayRequestAd("/", "footer", true, "granted"), true);
  assert.equal(mayRequestAd("/", "footer", false, "granted"), false);
  for (const path of ["/soutenir", "/commander", "/admin", "/confidentialite", "/boutique/panier", "/media/private/x"]) assert.equal(mayRequestAd(path, "footer", true, "granted"), false);
});
test("accept, withdraw, refuse, reaccept and late callback after disposal", () => {
  const states: ConsentState[] = [];
  const gate = createConsentGate(state => states.push(state));
  gate.update(accepted, true);
  gate.revoke();
  gate.update({ ...accepted, vendor: { consents: {} } }, true);
  gate.update(accepted, true);
  gate.dispose();
  gate.update(accepted, true);
  assert.deepEqual(states, ["unknown", "granted", "unknown", "denied", "granted", "unknown"]);
});
test("unpublished CMP / unverified CSP hard gate cannot be bypassed by flags", () => {
  const flags = { RAILWAY_ENVIRONMENT_NAME: "production", SITE_URL: "https://www.lnxbeats.fr", ADS_ENABLED: "true", ADS_GOOGLE_CMP_ENABLED: "true", ADS_GOOGLE_CMP_PUBLISHED: "true", ADSENSE_SITE_APPROVED: "true" };
  for (const environment of [flags, { ...flags, RAILWAY_ENVIRONMENT_NAME: "preview-v33-media" }, {}]) {
    assert.equal(googleCmpConfigured(environment), false);
    assert.equal(liveAdsEnabled(environment), false);
  }
});
test("unit IDs require explicit format; none is invented", () => {
  assert.equal(liveAdSlotId("footer", {}), null);
  assert.equal(liveAdSlotId("footer", { ADSENSE_FOOTER_SLOT_ID: "not-a-slot" }), null);
  assert.equal(liveAdSlotId("footer", { ADSENSE_FOOTER_SLOT_ID: "1234567890" }), "1234567890");
});
test("adapter pauses before script, uses TCF events/revocation and no home-made cookie", async () => {
  const source = await readFile(new URL("../../components/google-consent-ad.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf("queue.pauseAdRequests = 1") < source.indexOf("document.head.append(script)"));
  assert.match(source, /CONSENT_API_READY/);
  assert.match(source, /addEventListener", 2/);
  assert.match(source, /removeEventListener", 2/);
  assert.match(source, /showRevocationMessage/);
  assert.doesNotMatch(source, /document\.cookie|localStorage|sessionStorage|getTCData|gtag\(/);
});
test("privacy explains conditional AdSense, Google CMP, refusal and withdrawal", () => {
  const text = JSON.stringify(approvedPrivacyNotice);
  for (const phrase of ["Google AdSense", "reste désactivée", "CMP certifiée Google", "accepter, refuser", "retirer le consentement", "partenaires", "Soutenir"]) assert.ok(text.includes(phrase), phrase);
});
