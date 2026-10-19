import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { digitalFormatsLabel, digitalAcquiredFormatsDescription } from "../../lib/digital/format-presentation";
import { digitalAdminMasterLabel, digitalAdminMp3Label, digitalAdminReleaseLabels } from "../../lib/digital/admin-presentation";
import { isAuthorizedMp3OnlySource, MP3_ONLY_SOURCE } from "../../lib/digital/mp3-only-policy";
import { digitalFormatMessages } from "../../lib/i18n/messages-digital-formats";
import { translate } from "../../lib/i18n/messages";
import { LANGUAGES } from "../../lib/i18n/config";

test("format labels reflect the exact quote and never invent a WAV for an MP3-only offer", () => {
  assert.equal(digitalFormatsLabel(["MP3"]), "MP3 uniquement");
  assert.equal(digitalFormatsLabel(["WAV", "MP3"]), "WAV + MP3");
  assert.equal(digitalFormatsLabel(["WAV"]), "WAV");
  for (const value of [null, undefined, [], ["MP3", "WAV"] as const]) assert.equal(digitalFormatsLabel(value), "Formats à vérifier");
});

test("new MP3-only purchases are not mislabeled historical or upgraded to lossless", () => {
  assert.match(digitalAcquiredFormatsDescription(["MP3"], false), /MP3 uniquement/);
  assert.doesNotMatch(digitalAcquiredFormatsDescription(["MP3"], false), /Achat historique|320/);
  assert.match(digitalAcquiredFormatsDescription(["MP3"], false), /sans WAV ni amélioration/);
  assert.match(digitalAcquiredFormatsDescription(["WAV"], true), /Achat historique/);
  assert.equal(digitalAcquiredFormatsDescription(["WAV", "MP3"], false), "WAV et MP3 inclus dans cet achat.");
});

test("Admin labels keep MP3 original and WAV-derived bitrate distinct", () => {
  assert.equal(digitalAdminMasterLabel(1, "mp3"), "Version audio 1 — MP3 source privé");
  assert.doesNotMatch(digitalAdminMp3Label(false, 320, true), /320|à préparer/);
  assert.match(digitalAdminReleaseLabels("SINGLE", true).formats, /aucun WAV ni qualité supérieure/);
  assert.equal(digitalAdminMasterLabel(2), "Version audio 2 — WAV privé");
});

test("all added interface labels have five translations and retain format tokens", () => {
  for (const [source, values] of Object.entries(digitalFormatMessages)) {
    assert.equal(values.length, 5);
    for (const value of values) {
      assert.ok(value.trim(), source);
      for (const token of source.match(/\b(?:MP3|WAV)\b/g) ?? []) assert.ok(value.includes(token), source);
    }
    for (const { code } of LANGUAGES) assert.equal(translate(code, source), code === "fr" ? source : values[({en:0,es:1,pt:2,zh:3,ja:4} as const)[code]]);
  }
});

test("catalogue, cart and checkout use server formats, not a universal WAV+MP3 promise", () => {
  const cart = readFileSync(new URL("../../components/digital-cart.tsx", import.meta.url), "utf8");
  const checkout = readFileSync(new URL("../../components/digital-checkout.tsx", import.meta.url), "utf8");
  const catalogue = readFileSync(new URL("../../components/digital-catalog.tsx", import.meta.url), "utf8");
  assert.match(cart, /digitalFormatsLabel\(l.formats\)/);
  assert.doesNotMatch(cart, /· WAV \+ MP3<\/p>|WAV \+ MP3 inclus\. Panier/);
  assert.match(checkout, /digitalFormatsLabel\(line.formats\)/);
  assert.doesNotMatch(checkout, /articles? · WAV et MP3 inclus/);
  assert.match(catalogue, /digitalFormatsLabel\(formats\)/);
  assert.match(checkout, /formatSupplementHash:formatSupplement.hashSha256/);
  assert.match(checkout, /J’accepte aussi le complément MP3 uniquement ci-dessous/);
  assert.match(checkout, /<div lang="fr" translate="no"><h3>\{formatSupplement.title\}/);
});

test("Admin status mirror only accepts the exact single source and retains rights/excerpt checks", () => {
  const page = readFileSync(new URL("../../app/admin/musique/[slug]/page.tsx", import.meta.url), "utf8");
  const expression = page.match(/mediaCleared: (.+),$/m)?.[1];
  assert.ok(expression);
  const source: { checksumSha256: string; sizeBytes: number; rightsStatus: string } = { checksumSha256: MP3_ONLY_SOURCE.sourceSha256, sizeBytes: MP3_ONLY_SOURCE.sourceBytes, rightsStatus: "CLEARED" };
  const master = { id: "master", status: "READY", codec: "mp3", masterAsset: source, mp3Asset: null, previewAsset: { visibility: "PUBLIC", rightsStatus: "CLEARED" } };
  const evaluate = (patch: Partial<typeof master> = {}, context: { projectId?: string; projectType?: string; trackId?: string; rights?: string } = {}) => runInNewContext(expression, {
    m: { ...master, ...patch }, p: { id: context.projectId ?? MP3_ONLY_SOURCE.projectId, type: context.projectType ?? "SINGLE" },
    t: { id: context.trackId ?? MP3_ONLY_SOURCE.trackId }, rightsReviews: [{ masterId: master.id, status: context.rights ?? "APPROVED" }],
    digitalCommercialAudioReady: (m: typeof master) => m.status === "READY", MP3_ONLY_SOURCE, isAuthorizedMp3OnlySource,
  });
  assert.equal(evaluate(), true);
  assert.equal(evaluate({}, { trackId: "another-track" }), false);
  assert.equal(evaluate({}, { projectId: "another-project" }), false);
  assert.equal(evaluate({}, { projectType: "ALBUM" }), false);
  assert.equal(evaluate({ masterAsset: { ...source, checksumSha256: "a".repeat(64) } }), false);
  assert.equal(evaluate({ masterAsset: { ...source, sizeBytes: source.sizeBytes + 1 } }), false);
  assert.equal(evaluate({ status: "QUARANTINED" }), false);
  assert.equal(evaluate({}, { rights: "PENDING" }), false);
  assert.equal(evaluate({ masterAsset: { ...source, rightsStatus: "PENDING" } }), false);
  assert.equal(evaluate({ previewAsset: { visibility: "PUBLIC", rightsStatus: "PENDING" } }), false);
});
