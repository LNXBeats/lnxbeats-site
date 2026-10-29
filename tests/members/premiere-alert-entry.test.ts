import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseAlertPreferences } from "../../components/release-alert-preferences";

// Presentation integration only. Existing consent, outbox, provider and
// unsubscribe suites retain their scope; no account or actual mail is created.
test("the reusable premiere alert entry renders optional, unchecked and disabled until existing preferences load", () => {
  const html = renderToStaticMarkup(createElement(ReleaseAlertPreferences));
  assert.match(html, /Facultatif/);
  assert.match(html, /<fieldset[^>]*disabled=""/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<input[^>]*\schecked(?:=|\s|>)/);
  assert.match(html, /Enregistrer mes choix/);
  assert.match(html, /tout décocher|désinscrire/);
  assert.doesNotMatch(html, /Vos préférences ont été enregistrées/);
});

test("mounting the alert entry only reads saved choices; subscription changes require explicit form submission", async () => {
  const source = await readFile(new URL("../../components/release-alert-preferences.tsx", import.meta.url), "utf8");
  const effectStart = source.indexOf("useEffect(() =>");
  const saveStart = source.indexOf("async function save(");
  assert.ok(effectStart >= 0 && saveStart > effectStart);
  const mount = source.slice(effectStart, saveStart);
  assert.match(mount, /fetch\("\/api\/account\/release-alerts", \{ cache: "no-store" \}\)/);
  assert.doesNotMatch(mount, /method:|JSON\.stringify|\bsave\(|music:\s*true|shop:\s*true|editorial:\s*true/);
  assert.match(source, /onSubmit=\{save\}/);
  assert.match(source, /if \(!loaded \|\| pending\) return/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /JSON\.stringify\(\{ \.\.\.choices, locale \}\)/);
  assert.doesNotMatch(source, /dispatchReleaseAlerts|enqueueReleasePublication|sendResendEmail/);
});

test("the public premiere page offers the existing preferences only to eligible members without sending mail or changing consent", async () => {
  const page = await readFile(new URL("../../app/avant-premieres/page.tsx", import.meta.url), "utf8");
  const experience = await readFile(new URL("../../components/premiere-experience.tsx", import.meta.url), "utf8");
  assert.match(page, /premiereMemberAllowed\(session\?\.user\)/);
  assert.match(page, /const access = member \? "member"/);
  assert.match(experience, /member = access === "member"/);
  assert.match(experience, /member \? <ReleaseAlertPreferences \/>/);
  assert.match(experience, /Aucun abonnement automatique/);
  assert.doesNotMatch(page + experience, /saveReleaseAlertPreferences|dispatchReleaseAlerts|enqueueReleasePublication|sendResendEmail|RELEASE_ALERT_EMAIL_ENABLED\s*=/);
});
