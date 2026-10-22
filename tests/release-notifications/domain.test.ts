import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RELEASE_ALERT_CHOICES, parseReleaseAlertChoices, releaseAlertEligible, releaseAlertPreferenceData, releaseAlertPublicPath } from "@/lib/release-notifications/domain";
import { releaseAlertUnsubscribeToken, releaseAlertUnsubscribeUser } from "@/lib/release-notifications/token";
import { releaseAlertTemplate } from "@/lib/release-notifications/template";
import { releaseAlertCopy } from "@/lib/release-notifications/messages";

const id = "3dfde946-d72b-465b-b53c-a7878cac9d37", secret = "synthetic-release-alert-secret-32-characters";
const before = new Date("2026-10-22T10:00:00Z"), published = new Date("2026-10-22T11:00:00Z"), after = new Date("2026-10-22T12:00:00Z");
test("no default subscription; consent is explicit, typed and category-specific", () => {
  assert.deepEqual(DEFAULT_RELEASE_ALERT_CHOICES, { music: false, shop: false, editorial: false, locale: "fr" });
  assert.equal(parseReleaseAlertChoices({ music: "true", shop: false, editorial: false, locale: "fr" }), null);
  assert.equal(parseReleaseAlertChoices({ music: true, locale: "fr" }), null);
  assert.equal(parseReleaseAlertChoices({ music: true, shop: false, editorial: false, locale: "xx" }), null);
  assert.equal(parseReleaseAlertChoices({ music: true, shop: false, editorial: false, locale: "fr", userId: id }), null);
  assert.deepEqual(parseReleaseAlertChoices({ music: true, shop: false, editorial: false, locale: "ja" }), { music: true, shop: false, editorial: false, locale: "ja" });
});
test("consent receipt keeps the original date, withdrawal clears it, re-opt-in starts a new date", () => {
  const first = releaseAlertPreferenceData(null, { ...DEFAULT_RELEASE_ALERT_CHOICES, music: true }, before);
  assert.equal(first.musicConsentedAt, before); assert.equal(first.shopConsentedAt, null);
  const same = releaseAlertPreferenceData(first, { ...DEFAULT_RELEASE_ALERT_CHOICES, music: true }, after);
  assert.equal(same.musicConsentedAt, before);
  const withdrawn = releaseAlertPreferenceData(first, DEFAULT_RELEASE_ALERT_CHOICES, after);
  assert.equal(withdrawn.musicConsentedAt, null);
  const again = releaseAlertPreferenceData(withdrawn, { ...DEFAULT_RELEASE_ALERT_CHOICES, music: true }, after);
  assert.equal(again.musicConsentedAt, after); assert.equal(releaseAlertEligible(again, "MUSIC", published), false);
});
test("an opt-in never authorizes past publications, other categories, invalid kinds or null dates", () => {
  const preference = releaseAlertPreferenceData(null, { ...DEFAULT_RELEASE_ALERT_CHOICES, music: true }, before);
  assert.equal(releaseAlertEligible(preference, "MUSIC", published), true);
  assert.equal(releaseAlertEligible(preference, "SHOP", published), false);
  assert.equal(releaseAlertEligible(preference, "EDITORIAL", published), false);
  assert.equal(releaseAlertEligible(preference, "INVALID", published), false);
  assert.equal(releaseAlertEligible(null, "MUSIC", published), false);
  assert.equal(releaseAlertEligible({ ...preference, musicConsentedAt: null }, "MUSIC", published), false);
});
test("unsubscribe is signed, user-specific, scope-separated, forgery-safe and unavailable without secret", () => {
  const token = releaseAlertUnsubscribeToken(id, secret);
  assert.equal(releaseAlertUnsubscribeUser(token, secret), id);
  assert.equal(releaseAlertUnsubscribeUser(token, "another-synthetic-secret-at-least-32characters"), null);
  assert.equal(releaseAlertUnsubscribeUser(token + ".extra", secret), null);
  assert.equal(releaseAlertUnsubscribeUser(token.replace(id, "4dfde946-d72b-465b-b53c-a7878cac9d37"), secret), null);
  assert.equal(releaseAlertUnsubscribeUser(token, ""), null);
  assert.throws(() => releaseAlertUnsubscribeToken(id, ""));
});
test("all six languages preserve title and brand, escape HTML, include withdrawal and no full-media URL", () => {
  for (const locale of ["fr", "en", "es", "pt", "zh", "ja"] as const) {
    const template = releaseAlertTemplate({ locale, title: "LNX Beats — J’ai adopté un humain <script>", url: "https://www.lnxbeats.fr/album/jai-adopte-un-humain", unsubscribeUrl: "https://www.lnxbeats.fr/desinscription?token=synthetic" });
    assert.match(template.subject, /LNX Beats/); assert.match(template.text, /J’ai adopté un humain/);
    assert.ok(template.text.includes(releaseAlertCopy(locale).unsubscribe));
    assert.match(template.html, /&lt;script&gt;/); assert.doesNotMatch(template.html, /<script>/);
    assert.doesNotMatch(template.text, /\.wav|\.mp3|digital\/masters/);
    assert.notEqual(releaseAlertCopy(locale).heading, "");
  }
});
test("publication links are local trusted paths and cannot be arbitrary URLs", () => {
  assert.equal(releaseAlertPublicPath("MUSIC", "vie-de-chien"), "/album/vie-de-chien");
  assert.equal(releaseAlertPublicPath("SHOP", "nouveau-tshirt"), "/boutique/nouveau-tshirt");
  assert.equal(releaseAlertPublicPath("EDITORIAL", "un-nouveau-projet"), "/creations/un-nouveau-projet");
  assert.throws(() => releaseAlertPublicPath("MUSIC", "../../private"));
  assert.throws(() => releaseAlertPublicPath("MUSIC", "https://attacker.invalid"));
});
