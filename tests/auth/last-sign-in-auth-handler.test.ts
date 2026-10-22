import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { recordSuccessfulSignIn } from "@/lib/auth/last-sign-in";

test("Better Auth records a real successful in-memory credential sign-in, not failure, refresh or logout", async () => {
  const now = new Date();
  const userId = "c8036d62-0b53-40de-bc2a-6cc4b47dbdad";
  const user = { id: userId, name: "Synthetic sign-in fixture", email: "last-sign-in@example.test", emailVerified: true, role: "MEMBER", status: "ACTIVE", createdAt: now, updatedAt: now, lastSignedInAt: null as Date | null };
  const memory = { user: [user], account: [{ id: "3aa12b7e-ce9d-429a-aa1f-0550391e63dd", userId, accountId: userId, providerId: "credential", password: "synthetic-digest-only", createdAt: now, updatedAt: now }], session: [], verification: [] };
  let recorded = 0;
  const observation = { user: { async updateMany(input: { where: { id: string }; data: { lastSignedInAt: Date } }) {
    assert.equal(input.where.id, userId);
    user.lastSignedInAt = input.data.lastSignedInAt;
    recorded++;
    return { count: 1 };
  } } };
  const instance = betterAuth({
    baseURL: "http://127.0.0.1:3199", secret: randomBytes(32).toString("base64url"), database: memoryAdapter(memory),
    emailAndPassword: { enabled: true, disableSignUp: true, requireEmailVerification: true,
      // Explicitly synthetic credential adapter; no real password/account/DB.
      password: { hash: async () => "synthetic-digest-only", verify: async ({ hash, password }) => hash === "synthetic-digest-only" && password === "synthetic-correct-password" },
    },
    emailVerification: { sendOnSignIn: false, async sendVerificationEmail() {} },
    user: { additionalFields: { role: { type: "string", input: false }, status: { type: "string", input: false } } },
    session: { expiresIn: 3600, updateAge: 0, cookieCache: { enabled: false } },
    databaseHooks: { session: { create: {
      async before() { return user.status === "ACTIVE"; },
      async after(session, context) { await recordSuccessfulSignIn(observation, session, context?.path); },
    } } },
    rateLimit: { enabled: false }, logger: { level: "error" },
  });
  const signIn = (password: string) => instance.handler(new Request("http://127.0.0.1:3199/api/auth/sign-in/email", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3199" }, body: JSON.stringify({ email: user.email, password }),
  }));
  assert.equal((await signIn("synthetic-wrong-password")).status, 401);
  assert.equal(recorded, 0);
  const response = await signIn("synthetic-correct-password");
  assert.equal(response.status, 200);
  assert.equal(recorded, 1);
  assert.ok(user.lastSignedInAt instanceof Date);
  const payload = await response.json();
  assert.equal(Object.hasOwn(payload.user, "lastSignedInAt"), false);
  const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  assert.ok(cookie);
  const retained = user.lastSignedInAt;
  const session = await instance.api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(session?.user.id, userId);
  assert.equal(recorded, 1);
  assert.equal(Object.hasOwn(session!.user, "lastSignedInAt"), false);
  const signedOut = await instance.handler(new Request("http://127.0.0.1:3199/api/auth/sign-out", { method: "POST", headers: { origin: "http://127.0.0.1:3199", cookie } }));
  assert.equal(signedOut.status, 200);
  assert.equal(user.lastSignedInAt, retained);
  user.emailVerified = false;
  assert.equal((await signIn("synthetic-correct-password")).status, 403);
  assert.equal(recorded, 1);
  user.emailVerified = true;
  user.status = "SUSPENDED";
  assert.equal((await signIn("synthetic-correct-password")).status, 401);
  assert.equal(recorded, 1);
});
