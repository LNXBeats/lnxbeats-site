import assert from "node:assert/strict";
import test from "node:test";

import { registrationCodeEmailTemplate, resetPasswordEmailTemplate, verificationEmailTemplate } from "@/lib/email/templates";

test("transactional auth templates contain the requested action without tracking", () => {
  const verification = verificationEmailTemplate("http://localhost:3000/verifier-email#token=masked");
  const reset = resetPasswordEmailTemplate("http://localhost:3000/reinitialiser-mot-de-passe#token=masked");
  const registration = registrationCodeEmailTemplate("012345");
  assert.match(verification.subject, /Confirmez votre adresse email/);
  assert.match(verification.text, /60 minutes/);
  assert.match(reset.subject, /Réinitialisez votre mot de passe/);
  assert.match(reset.text, /30 minutes/);
  assert.equal(registration.subject, "Votre code LNX Beats");
  assert.match(registration.text, /012345/);
  assert.match(registration.text, /Votre code de vérification est :/);
  assert.match(registration.text, /Ce code expire dans 10 minutes\./);
  assert.match(registration.text, /Si vous n’êtes pas à l’origine de cette demande, ignorez ce message\./);
  assert.doesNotMatch(`${verification.html}${reset.html}${registration.html}`, /tracking|pixel|utm_/i);
});

test("registration email refuses malformed codes", () => {
  assert.throws(() => registrationCodeEmailTemplate("12345"));
  assert.throws(() => registrationCodeEmailTemplate("12345a"));
});
