import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedRegistrationCodePayload,
  isAllowedRegistrationCompletionPayload,
  isAllowedRegistrationEmailPayload,
} from "@/lib/auth/input";
import { readRegistrationJson } from "@/lib/auth/registration-http";

// Exercise only the registration HTTP reader and pure payload guards. No
// registration service method, Prisma query or email delivery is invoked.
function request(body: string) {
  return new Request("http://127.0.0.1:3199/api/auth/registration/fixture", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:3199" },
    body,
  });
}

test("the bounded registration reader preserves a valid email request", async () => {
  const payload = { email: "registration-fixture@example.test" };
  const parsed = await readRegistrationJson(request(JSON.stringify(payload)));
  assert.deepEqual(parsed, payload);
  assert.equal(isAllowedRegistrationEmailPayload(parsed), true);
});

test("the bounded registration reader preserves the six-digit code including leading zero", async () => {
  const payload = { attemptId: "20686f82-c930-4318-892c-b46c6b55b48e", code: "012345" };
  const parsed = await readRegistrationJson(request(JSON.stringify(payload)));
  assert.deepEqual(parsed, payload);
  assert.equal(isAllowedRegistrationCodePayload(parsed), true);
});

test("the bounded registration reader preserves passwords and exact independent alert choices", async () => {
  const payload = {
    firstName: "Marie",
    lastName: "Dupont",
    password: "synthetic registration password",
    passwordConfirmation: "synthetic registration password",
    releaseAlerts: { music: false, shop: true, editorial: false, locale: "fr" },
  };
  const parsed = await readRegistrationJson(request(JSON.stringify(payload)));
  assert.deepEqual(parsed, payload);
  assert.equal(isAllowedRegistrationCompletionPayload(parsed), true);
  assert.equal(isAllowedRegistrationCompletionPayload({ ...payload, role: "ADMIN" }), false);
  assert.equal(isAllowedRegistrationCompletionPayload({ ...payload, releaseAlerts: { ...payload.releaseAlerts, music: "true" } }), false);
});

test("the registration HTTP reader rejects excessive size, excessive depth and malformed JSON without a service call", async () => {
  const bodies = [
    JSON.stringify({ email: `${"x".repeat(16 * 1024)}@example.test` }),
    `${'{"nested":'.repeat(128)}0${"}".repeat(128)}`,
    '{"email":',
  ];
  for (const body of bodies) {
    const parsed = await readRegistrationJson(request(body));
    assert.equal(parsed, null);
    assert.equal(isAllowedRegistrationEmailPayload(parsed), false);
    assert.equal(isAllowedRegistrationCodePayload(parsed), false);
    assert.equal(isAllowedRegistrationCompletionPayload(parsed), false);
  }
});
