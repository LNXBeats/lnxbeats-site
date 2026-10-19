import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { supportLegalMessages } from "../../lib/i18n/messages-support-legal";
import { brandSafeTranslation } from "../../lib/i18n/protected-content";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("support and legal-document UI provides five complete translations with unchanged identities and variables", () => {
  for (const [key, values] of Object.entries(supportLegalMessages)) {
    assert.equal(values.length, 5, key);
    for (const text of values) {
      assert.ok(text.trim(), key);
      assert.equal(brandSafeTranslation(key, text), text, key);
      for (const token of key.match(/\{\w+\}/g) ?? []) assert.ok(text.includes(token), `${key} ${token}`);
    }
  }
});

test("versioned conditions and legal declarations remain exact French sources with a localized reading notice", () => {
  const contract = source("components/legal-candidate-document.tsx");
  assert.match(contract, /ContractLanguageNotice/);
  assert.match(contract, /className="legal-document__sections" lang="fr" translate="no"/);
  assert.match(contract, /publicLegalDocument\(document\)/);
  const digital = source("app/musique/conditions/page.tsx");
  assert.match(digital, /approvedDigitalFranceContractPublication/);
  assert.match(digital, /id="dcn-france-terms" className=\{styles.panel\} lang="fr" translate="no"/);
  const withdrawal = source("components/withdrawal-form.tsx");
  assert.match(withdrawal, /className="withdrawal-review__declaration" lang="fr" translate="no"/);
  assert.match(withdrawal, /consumerRequestDeclaration\(/);
  assert.match(withdrawal, /declarationAccepted: true/);
});

test("support translation does not alter checkout, retry identity, provider allowlist or capture semantics", () => {
  const form = source("components/support-form.tsx");
  assert.match(form, /lnx-support-attempt/);
  assert.match(form, /idempotencyKey, newContribution, email, message/);
  assert.match(form, /checkout\.stripe\.com/);
  assert.match(form, /mode === "TEST" \? "www\.sandbox\.paypal\.com" : "www\.paypal\.com"/);
  assert.match(form, /<label lang="fr" translate="no"><input type="checkbox"/);
  const confirmation = source("components/support-confirmation.tsx");
  assert.match(confirmation, /SUPPORT_CONFIRMATION_LEGAL/);
  assert.match(confirmation, /money\(status.amountCents\)/);
  assert.match(confirmation, /\/capture`, \{ method: "POST"/);
});
