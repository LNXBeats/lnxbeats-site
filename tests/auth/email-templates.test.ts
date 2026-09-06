import assert from "node:assert/strict";
import test from "node:test";

import { REGISTRATION_CODE_TTL_MS } from "@/lib/auth/registration-policy";
import { registrationCodeEmailTemplate, resetPasswordEmailTemplate, verificationEmailTemplate } from "@/lib/email/templates";

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  return channels.reduce((sum, channel, index) => {
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test("transactional auth templates contain the requested action without tracking", () => {
  const verification = verificationEmailTemplate("http://localhost:3000/verifier-email#token=masked");
  const reset = resetPasswordEmailTemplate("http://localhost:3000/reinitialiser-mot-de-passe#token=masked");
  const registration = registrationCodeEmailTemplate("012345");
  assert.match(verification.subject, /Confirmez votre adresse email/);
  assert.match(verification.text, /60 minutes/);
  assert.match(reset.subject, /Réinitialisez votre mot de passe/);
  assert.match(reset.text, /30 minutes/);
  assert.equal(registration.subject, "Votre code LNX Beats");
  assert.match(registration.text, /Vérifiez votre adresse/);
  assert.match(registration.text, /Saisissez ce code sur LNX Beats/);
  assert.match(registration.text, /Copiez-collez les 6 chiffres sans espace\./);
  assert.match(registration.text, new RegExp(`Ce code expire dans ${REGISTRATION_CODE_TTL_MS / 60_000} minutes\\.`));
  assert.match(registration.text, /Ce code est personnel\./);
  assert.match(registration.text, /Aucun compte ne sera créé sans ce code\./);
  assert.doesNotMatch(`${verification.html}${reset.html}${registration.html}`, /tracking|pixel|utm_/i);
});

test("registration code remains exact and copyable in HTML and plain text", () => {
  const registration = registrationCodeEmailTemplate("012345");
  assert.deepEqual(registration.text.match(/(?<=^|\n)\d{6}(?=\n|$)/g), ["012345"]);
  assert.equal(registration.html.match(/012345/g)?.length, 1);
  assert.match(registration.html, />012345<\/td>/);
  assert.doesNotMatch(registration.html, /0\s+1\s+2\s+3\s+4\s+5/);
  assert.doesNotMatch(registration.html, /<(?:a|script|img)\b|href=|src=/i);
});

test("registration email footer text keeps AA contrast on the card", () => {
  const registration = registrationCodeEmailTemplate("012345");
  assert.match(registration.html, /border-top:1px solid #332e24;color:#8f897c;font:12px/);
  assert.ok(contrastRatio("#8f897c", "#171717") >= 4.5);
});

test("registration email refuses malformed codes", () => {
  assert.throws(() => registrationCodeEmailTemplate("12345"));
  assert.throws(() => registrationCodeEmailTemplate("12345a"));
  assert.throws(() => registrationCodeEmailTemplate("12345\n"));
  assert.throws(() => registrationCodeEmailTemplate("１２３４５６"));
  assert.throws(() => registrationCodeEmailTemplate("<img>x"));
});
