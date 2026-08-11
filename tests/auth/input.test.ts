import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedProfilePayload,
  isAllowedRegistrationCodePayload,
  isAllowedRegistrationCompletionPayload,
  isAllowedRegistrationEmailPayload,
  normalizeEmail,
  validateProfileName,
  validateRegistrationCode,
  validateRegistrationEmail,
  validateRegistrationPassword,
} from "@/lib/auth/input";

test("registration begins with a normalized valid email only", () => {
  const result = validateRegistrationEmail("  MEMBER@Example.Invalid ");
  assert.deepEqual(result, { ok: true, value: "member@example.invalid" });
  assert.equal(normalizeEmail(" USER@Example.Invalid "), "user@example.invalid");
  assert.equal(isAllowedRegistrationEmailPayload({ email: "member@example.invalid" }), true);
  assert.equal(isAllowedRegistrationEmailPayload({ email: "member@example.invalid", role: "ADMIN" }), false);
  assert.equal(isAllowedRegistrationEmailPayload({ email: "invalid" }), false);
});

test("registration code accepts exactly six decimal digits", () => {
  assert.deepEqual(validateRegistrationCode(" 012345 "), { ok: true, value: "012345" });
  assert.equal(validateRegistrationCode("12345").ok, false);
  assert.equal(validateRegistrationCode("12345a").ok, false);
  assert.equal(isAllowedRegistrationCodePayload({
    attemptId: "f7f3bead-2f8f-4ac3-8ff2-e719d0c378d3",
    code: "012345",
  }), true);
  assert.equal(isAllowedRegistrationCodePayload({
    attemptId: "f7f3bead-2f8f-4ac3-8ff2-e719d0c378d3",
    code: "012345",
    status: "ACTIVE",
  }), false);
});

test("password completion enforces length, equality and a closed payload", () => {
  const password = "a sufficiently long passphrase";
  assert.deepEqual(validateRegistrationPassword({ password, passwordConfirmation: password }), { ok: true, value: password });
  assert.equal(validateRegistrationPassword({ password: "short", passwordConfirmation: "short" }).ok, false);
  assert.equal(validateRegistrationPassword({ password, passwordConfirmation: "a different long passphrase" }).ok, false);
  assert.equal(isAllowedRegistrationCompletionPayload({ password, passwordConfirmation: password }), true);
  assert.equal(isAllowedRegistrationCompletionPayload({ password, passwordConfirmation: password, role: "ADMIN" }), false);
});

test("profile validation accepts only a bounded display name", () => {
  assert.equal(validateProfileName("  Nouveau   nom  "), "Nouveau nom");
  assert.equal(validateProfileName("   "), null);
  assert.equal(isAllowedProfilePayload({ name: "Nouveau nom" }), true);
  assert.equal(isAllowedProfilePayload({ name: "Nouveau nom", role: "ADMIN" }), false);
});
