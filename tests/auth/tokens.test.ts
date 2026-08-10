import assert from "node:assert/strict";
import test from "node:test";

import { createOpaqueToken, hashOpaqueToken, isExpired, isOpaqueToken } from "@/lib/auth/tokens";

test("opaque tokens are unpredictable-looking, valid and uniquely salted by randomness", () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.equal(isOpaqueToken(first), true);
  assert.equal(isOpaqueToken(second), true);
  assert.notEqual(first, second);
  assert.notEqual(hashOpaqueToken(first), first);
  assert.equal(hashOpaqueToken(first), hashOpaqueToken(first));
});

test("token expiration is evaluated at the boundary", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  assert.equal(isExpired(new Date("2026-08-10T11:59:59.999Z"), now), true);
  assert.equal(isExpired(new Date("2026-08-10T12:00:00.000Z"), now), true);
  assert.equal(isExpired(new Date("2026-08-10T12:00:00.001Z"), now), false);
});
