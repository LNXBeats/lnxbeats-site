import assert from "node:assert/strict";
import test from "node:test";

import { isSameOriginMutation } from "@/lib/auth/origin";

test("sensitive mutations require the exact configured origin", () => {
  const trusted = "http://localhost:3000";
  assert.equal(isSameOriginMutation(new Request(`${trusted}/api/auth/sign-up/email`, { headers: { origin: trusted } }), trusted), true);
  assert.equal(isSameOriginMutation(new Request(`${trusted}/api/auth/sign-up/email`, { headers: { origin: "https://evil.example.invalid" } }), trusted), false);
  assert.equal(isSameOriginMutation(new Request(`${trusted}/api/auth/sign-up/email`), trusted), false);
});
