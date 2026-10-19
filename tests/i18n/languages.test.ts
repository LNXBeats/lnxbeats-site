import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LANGUAGES, siteLocale, localizedMoney } from "@/lib/i18n/config";
import { messages, translate } from "@/lib/i18n/messages";
test("six langues explicites, aucune ouverture de territoire", () => { assert.deepEqual(LANGUAGES.map(l => l.code), ["fr", "en", "es", "pt", "zh", "ja"]); for (const invalid of ["FR", "<script>", "", undefined, "en-US"]) assert.equal(siteLocale(invalid), "fr"); });
test("chaque phrase possède cinq traductions non vides", () => { for (const [source, values] of Object.entries(messages)) { assert.equal(values.length, 5, source); for (const v of values) assert.ok(v.trim(), source); assert.equal(translate("fr", source), source); } });
test("japonais/chinois, montant toujours en euros, repli français explicite", () => {
  assert.equal(translate("zh", "Compte"), "账户"); assert.equal(translate("ja", "Compte"), "アカウント");
  for (const l of LANGUAGES) assert.ok(/€|EUR/.test(localizedMoney(129, l.code)));
  assert.equal(translate("en", "J’AI DIT PROMENADE ?"), "J’AI DIT PROMENADE ?");
});
test("pas de traduction des consentements contractuels ni de mutation financière", () => {
  const checkout = fs.readFileSync("components/digital-checkout.tsx", "utf8");
  assert.ok(checkout.includes("{DIGITAL_CHECKOUT_IMMEDIATE_CONSENT_TEXT}")); assert.ok(checkout.includes("ContractLanguageNotice"));
  const language = fs.readFileSync("components/site-language.tsx", "utf8");
  assert.ok(!language.includes("innerHTML")); assert.ok(!language.includes("fetch(")); assert.ok(!language.includes(".reload(")); assert.ok(language.includes("router.refresh()"));
});
