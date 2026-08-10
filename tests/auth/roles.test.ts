import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessAccount,
  canAccessAdmin,
  canAccessRole,
  isActiveStatus,
  isUserRole,
} from "@/lib/auth/roles";

test("all declared roles can enter the account space", () => {
  assert.equal(canAccessAccount("ADMIN"), true);
  assert.equal(canAccessAccount("MEMBER"), true);
  assert.equal(canAccessAccount("CUSTOMER"), true);
});

test("only ADMIN can enter the administration space", () => {
  assert.equal(canAccessAdmin("ADMIN"), true);
  assert.equal(canAccessAdmin("MEMBER"), false);
  assert.equal(canAccessAdmin("CUSTOMER"), false);
  assert.equal(canAccessAdmin("admin"), false);
});

test("role and status checks reject unknown client-controlled values", () => {
  assert.equal(isUserRole("OWNER"), false);
  assert.equal(isUserRole(null), false);
  assert.equal(canAccessRole("ADMIN", ["MEMBER"]), false);
  assert.equal(isActiveStatus("ACTIVE"), true);
  assert.equal(isActiveStatus("PENDING"), false);
  assert.equal(isActiveStatus("SUSPENDED"), false);
  assert.equal(isActiveStatus("DEACTIVATED"), false);
});
