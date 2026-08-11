import assert from "node:assert/strict";
import test from "node:test";

import { canAccessAdmin } from "@/lib/auth/roles";

test("visitor and MEMBER are refused while ADMIN is authorized", () => {
  assert.equal(canAccessAdmin(undefined), false);
  assert.equal(canAccessAdmin("MEMBER"), false);
  assert.equal(canAccessAdmin("CUSTOMER"), false);
  assert.equal(canAccessAdmin("ADMIN"), true);
});
