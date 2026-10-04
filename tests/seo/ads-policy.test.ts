import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { allowsAdSlot, liveAdsEnabled, qaAdSlotEnabled, validatedAdsTxt } from "@/lib/ads/policy";

const qa = { SITE_URL: "http://127.0.0.1:3130", ADS_ENABLED: "false", ADS_QA_PLACEHOLDERS: "true", ADS_QA_ENVIRONMENT: "local", ADS_CONTENT_SLOT_ENABLED: "true", ADS_FOOTER_SLOT_ENABLED: "true" };
test("all ads default off and live cannot be enabled by a flag", () => {
  assert.equal(qaAdSlotEnabled("/", "footer", {}), false);
  assert.equal(liveAdsEnabled(), false);
  assert.equal(qaAdSlotEnabled("/", "footer", { ...qa, ADS_ENABLED: "true" }), false);
  assert.equal(qaAdSlotEnabled("/", "footer", { ...qa, RAILWAY_ENVIRONMENT_NAME: "production" }), false);
  assert.equal(qaAdSlotEnabled("/", "footer", { ...qa, PAYMENT_DEPLOYMENT_ENV: "production" }), false);
  assert.equal(qaAdSlotEnabled("/", "footer", { ...qa, SITE_URL: "https://www.lnxbeats.fr" }), false);
});
test("one manual placeholder per eligible page, no shared global insertion", () => {
  for (const path of ["/", "/boutique", "/album/vie-de-chien"]) {
    const slots = (["footer", "content"] as const).filter(slot => qaAdSlotEnabled(path, slot, qa));
    assert.equal(slots.length, 1);
  }
  assert.equal(qaAdSlotEnabled("/", "footer", { ...qa, ADS_FOOTER_SLOT_ENABLED: "false" }), false);
});
test("all sensitive, transactional, legal and unsupported routes fail closed", () => {
  for (const path of ["/admin", "/admin/commandes/123", "/compte", "/connexion", "/commander", "/commande/123", "/boutique/panier", "/boutique/checkout", "/boutique/badge", "/soutenir", "/soutenir/confirmation", "/api/support", "/media/private/a", "/documents/a", "/cgv", "/confidentialite", "/qa", "/album/x/secret", "/album/%2fadmin"]) {
    for (const slot of ["footer", "content"] as const) assert.equal(allowsAdSlot(path, slot), false, path);
  }
});
test("ads.txt has no fake default, validates exact seller line and rejects injection", () => {
  assert.equal(validatedAdsTxt({}), null);
  assert.equal(validatedAdsTxt({ ADSENSE_AUTHORIZED_SELLER_LINE: "fake" }), null);
  const fixture = "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0";
  assert.equal(validatedAdsTxt({ ADSENSE_AUTHORIZED_SELLER_LINE: fixture }), `${fixture}\n`);
  assert.equal(validatedAdsTxt({ ADSENSE_AUTHORIZED_SELLER_LINE: fixture + "\ninjected" }), null);
});
test("QA slot never loads an ad, consent tracking or click destination", async () => {
  const slot = await readFile(new URL("../../components/editorial-ad-slot.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(slot, /<script|<iframe|href=|adsbygoogle|fetch\(|localStorage/);
  const layout = await readFile(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /EditorialAdSlot|adsbygoogle/);
});
