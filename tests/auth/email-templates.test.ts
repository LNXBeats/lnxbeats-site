import assert from "node:assert/strict";
import test from "node:test";

import { resetPasswordEmailTemplate, verificationEmailTemplate } from "@/lib/email/templates";

test("transactional auth templates contain the requested action without tracking", () => {
  const verification = verificationEmailTemplate("http://localhost:3000/verifier-email#token=masked");
  const reset = resetPasswordEmailTemplate("http://localhost:3000/reinitialiser-mot-de-passe#token=masked");
  assert.match(verification.subject, /Confirmez votre adresse email/);
  assert.match(verification.text, /60 minutes/);
  assert.match(reset.subject, /Réinitialisez votre mot de passe/);
  assert.match(reset.text, /30 minutes/);
  assert.doesNotMatch(`${verification.html}${reset.html}`, /tracking|pixel|utm_/i);
});
