import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { allowsAdSlot, liveAdsEnabled, qaAdSlotEnabled, validatedAdsTxt } from "@/lib/ads/policy";
import { ADSENSE_CLIENT_ID, ADSENSE_SELLER_LINE } from "@/data/adsense";
import { GET as adsTxt } from "@/app/ads.txt/route";

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
test("ads.txt uses the user-confirmed seller, never a QA or different account", () => {
  assert.equal(validatedAdsTxt({}), `${ADSENSE_SELLER_LINE}\n`);
  assert.equal(validatedAdsTxt({ ADSENSE_AUTHORIZED_SELLER_LINE: "fake" }), null);
  const fixture = "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0";
  assert.equal(validatedAdsTxt({ ADSENSE_AUTHORIZED_SELLER_LINE: fixture }), null);
  assert.equal(validatedAdsTxt({ ADSENSE_AUTHORIZED_SELLER_LINE: fixture + "\ninjected" }), null);
});
test("real ads.txt response is 200 plain text and one exact line", async () => {
  const original = process.env.ADSENSE_AUTHORIZED_SELLER_LINE;
  delete process.env.ADSENSE_AUTHORIZED_SELLER_LINE;
  try {
    const response = adsTxt();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assert.equal(await response.text(), "google.com, pub-2056594730161751, DIRECT, f08c47fec0942fa0\n");
  } finally {
    if (original === undefined) delete process.env.ADSENSE_AUTHORIZED_SELLER_LINE;
    else process.env.ADSENSE_AUTHORIZED_SELLER_LINE = original;
  }
});
test("site verification metadata is inert and uses the real client ID", async () => {
  assert.equal(ADSENSE_CLIENT_ID, "ca-pub-2056594730161751");
  const layout = await readFile(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /"google-adsense-account": ADSENSE_CLIENT_ID/);
  assert.doesNotMatch(layout, /pagead2|<script|adsbygoogle/);
});
test("QA slot never loads an ad, consent tracking or click destination", async () => {
  const slot = await readFile(new URL("../../components/editorial-ad-slot.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(slot, /<script|<iframe|href=|adsbygoogle|fetch\(|localStorage/);
  const layout = await readFile(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /EditorialAdSlot|adsbygoogle/);
});
