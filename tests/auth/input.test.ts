import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedProfilePayload,
  isAllowedPublicRegistrationPayload,
  normalizeEmail,
  validateProfileName,
  validateRegistrationInput,
} from "@/lib/auth/input";

test("registration normalizes email and applies a neutral optional display name", () => {
  const result = validateRegistrationInput({
    email: "  MEMBER@Example.Invalid ",
    password: "a sufficiently long passphrase",
    passwordConfirmation: "a sufficiently long passphrase",
    displayName: "   ",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.email, "member@example.invalid");
    assert.equal(result.value.displayName, "Membre LNX");
  }
  assert.equal(normalizeEmail(" USER@Example.Invalid "), "user@example.invalid");
});

test("registration rejects weak or mismatched passwords", () => {
  const weak = validateRegistrationInput({ email: "member@example.invalid", password: "short", passwordConfirmation: "short", displayName: "Membre" });
  const mismatch = validateRegistrationInput({ email: "member@example.invalid", password: "a sufficiently long passphrase", passwordConfirmation: "a different long passphrase", displayName: "Membre" });
  assert.equal(weak.ok, false);
  assert.equal(mismatch.ok, false);
});

test("public registration payload rejects role, status and image injection", () => {
  const valid = { email: "member@example.invalid", password: "a sufficiently long passphrase", name: "Membre", callbackURL: "/verifier-email" };
  assert.equal(isAllowedPublicRegistrationPayload(valid), true);
  assert.equal(isAllowedPublicRegistrationPayload({ ...valid, role: "ADMIN" }), false);
  assert.equal(isAllowedPublicRegistrationPayload({ ...valid, status: "ACTIVE" }), false);
  assert.equal(isAllowedPublicRegistrationPayload({ ...valid, image: "https://example.invalid/avatar" }), false);
});

test("profile validation accepts only a bounded display name", () => {
  assert.equal(validateProfileName("  Nouveau   nom  "), "Nouveau nom");
  assert.equal(validateProfileName("   "), null);
  assert.equal(isAllowedProfilePayload({ name: "Nouveau nom" }), true);
  assert.equal(isAllowedProfilePayload({ name: "Nouveau nom", role: "ADMIN" }), false);
});
