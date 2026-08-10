import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, needsPasswordRehash, verifyPassword } from "@/lib/auth/password";

test("Argon2id hashes use the approved parameters and a unique salt", async () => {
  const first = await hashPassword("Lnx-V051-Password!42");
  const second = await hashPassword("Lnx-V051-Password!42");

  assert.match(first, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.notEqual(first, second);
  assert.equal(needsPasswordRehash(first), false);
});

test("a correct password verifies and a wrong password does not", async () => {
  const passwordHash = await hashPassword("Lnx-V051-Password!42");

  assert.equal(await verifyPassword(passwordHash, "Lnx-V051-Password!42"), true);
  assert.equal(await verifyPassword(passwordHash, "Lnx-V051-Wrong!42"), false);
});

test("malformed or obsolete hashes fail closed", async () => {
  assert.equal(await verifyPassword("not-a-password-hash", "Lnx-V051-Password!42"), false);
  assert.equal(needsPasswordRehash("$argon2id$v=19$m=4096,t=3,p=1$legacy"), true);
});
