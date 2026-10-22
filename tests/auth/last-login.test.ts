import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

import { recordSuccessfulLogin, type LastLoginUserStore } from "../../lib/auth/last-login";
import { hashPassword, verifyPassword } from "../../lib/auth/password";

const AUTH_URL = "http://localhost:3000";
const PASSWORD = "Last-login-test-password-123!";
const passwordHash = hashPassword(PASSWORD);
const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const EMAIL = "last-login@example.invalid";

function createUserStore() {
  const lastLogins = new Map<string, Date | null>([[USER_ID, null], [OTHER_USER_ID, null]]);
  const users: LastLoginUserStore = {
    async updateMany({ where, data }) {
      const current = lastLogins.get(where.id);
      if (current === undefined) return { count: 0 };
      const matches = where.OR.some(({ lastLoginAt }) => (
        lastLoginAt === null
          ? current === null
          : current !== null && current.getTime() < lastLoginAt.lt.getTime()
      ));
      if (!matches) return { count: 0 };
      lastLogins.set(where.id, new Date(data.lastLoginAt));
      return { count: 1 };
    },
  };
  return { users, lastLogins };
}

async function fixture(options: {
  emailVerified?: boolean;
  status?: "ACTIVE" | "SUSPENDED";
  users?: LastLoginUserStore;
} = {}) {
  const tracked = createUserStore();
  const createdAt = new Date("2026-10-01T08:00:00.000Z");
  const database: Record<string, Record<string, unknown>[]> = {
    user: [{
      id: USER_ID,
      name: "Login test member",
      email: EMAIL,
      emailVerified: options.emailVerified ?? true,
      status: options.status ?? "ACTIVE",
      lastLoginAt: new Date("2026-10-10T10:30:00.000Z"),
      createdAt,
      updatedAt: createdAt,
    }],
    account: [{
      id: "00000000-0000-4000-8000-000000000003",
      userId: USER_ID,
      accountId: USER_ID,
      providerId: "credential",
      password: await passwordHash,
      createdAt,
      updatedAt: createdAt,
    }],
    session: [],
    verification: [],
  };
  // Standalone auth uses only in-memory records and has no email callbacks or
  // external database. Exercise the installed Better Auth session lifecycle.
  const auth = betterAuth({
    baseURL: AUTH_URL,
    secret: "last-login-test-only-secret-at-least-32-characters",
    trustedOrigins: [AUTH_URL],
    database: memoryAdapter(database),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    user: {
      additionalFields: {
        status: { type: ["ACTIVE", "SUSPENDED"], input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    databaseHooks: {
      session: {
        create: {
          async before(session) {
            return database.user.find((user) => user.id === session.userId)?.status === "ACTIVE";
          },
          async after(session, context) {
            await recordSuccessfulLogin(session, context, options.users ?? tracked.users);
          },
        },
      },
    },
    advanced: { useSecureCookies: false, cookiePrefix: "last-login-test" },
    rateLimit: { enabled: false },
    logger: { disabled: true },
  });

  async function request(path: string, body?: object, cookie?: string) {
    const headers = new Headers({ origin: AUTH_URL });
    if (cookie) headers.set("cookie", cookie);
    if (body) headers.set("content-type", "application/json");
    return auth.handler(new Request(`${AUTH_URL}/api/auth${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }));
  }

  async function signIn(password = PASSWORD) {
    const response = await request("/sign-in/email", { email: EMAIL, password });
    const cookie = response.headers.getSetCookie()
      .find((value) => value.startsWith("last-login-test.session_token="))
      ?.split(";", 1)[0];
    return { response, cookie };
  }

  return { ...tracked, database, request, signIn };
}

test("successful credential sign-in records session creation and survives sign-out", async () => {
  const f = await fixture();
  const { response, cookie } = await f.signIn();
  assert.equal(response.status, 200);
  assert.ok(cookie);
  const payload = await response.json() as { user: Record<string, unknown> };
  assert.equal("lastLoginAt" in payload.user, false);
  assert.equal(f.database.session.length, 1);
  const loginAt = f.lastLogins.get(USER_ID);
  assert.ok(loginAt instanceof Date);
  assert.equal(loginAt.getTime(), (f.database.session[0].createdAt as Date).getTime());
  assert.equal(f.lastLogins.get(OTHER_USER_ID), null);

  assert.equal((await f.request("/sign-out", {}, cookie)).status, 200);
  assert.equal(f.database.session.length, 0);
  assert.equal(f.lastLogins.get(USER_ID)?.getTime(), loginAt.getTime());

  assert.equal((await f.signIn()).response.status, 200);
  assert.ok((f.lastLogins.get(USER_ID)?.getTime() ?? 0) > loginAt.getTime());
});

test("failed, unverified and suspended sign-ins do not record a login", async () => {
  for (const options of [{}, { emailVerified: false }, { status: "SUSPENDED" as const }]) {
    const f = await fixture(options);
    const password = Object.keys(options).length ? PASSWORD : "Incorrect-password-123!";
    assert.equal((await f.signIn(password)).response.ok, false);
    assert.equal(f.database.session.length, 0);
    assert.equal(f.lastLogins.get(USER_ID), null);
  }
});

test("session refresh and password-change replacement do not become new logins", async () => {
  const f = await fixture();
  const { response, cookie } = await f.signIn();
  assert.equal(response.status, 200);
  assert.ok(cookie);
  const loginAt = f.lastLogins.get(USER_ID)?.getTime();
  assert.ok(loginAt);
  const session = f.database.session[0];
  const sessionId = session.id;
  const beforeRefresh = new Date(Date.now() - 2 * 60 * 60 * 1_000);
  session.updatedAt = beforeRefresh;
  session.expiresAt = new Date(Date.now() + 10 * 60 * 60 * 1_000);

  const refreshed = await f.request("/get-session", undefined, cookie);
  assert.equal(refreshed.status, 200);
  const payload = await refreshed.json() as { user: Record<string, unknown> };
  assert.equal("lastLoginAt" in payload.user, false);
  assert.ok((f.database.session[0].updatedAt as Date).getTime() > beforeRefresh.getTime());
  assert.equal(f.lastLogins.get(USER_ID)?.getTime(), loginAt);

  const changed = await f.request("/change-password", {
    currentPassword: PASSWORD,
    newPassword: "New-last-login-test-password-456!",
    revokeOtherSessions: true,
  }, cookie);
  assert.equal(changed.status, 200);
  assert.equal(f.database.session.length, 1);
  assert.notEqual(f.database.session[0].id, sessionId);
  assert.equal(f.lastLogins.get(USER_ID)?.getTime(), loginAt);
});

test("delayed login hooks preserve the newest date and cannot affect another user", async () => {
  const f = createUserStore();
  const newest = new Date("2026-10-22T10:30:00.123Z");
  const older = new Date("2026-10-22T09:00:00.000Z");
  await recordSuccessfulLogin({ userId: USER_ID, createdAt: older }, { path: "/sign-in/email" }, f.users);
  assert.equal(f.lastLogins.get(USER_ID)?.getTime(), older.getTime());
  await recordSuccessfulLogin({ userId: USER_ID, createdAt: newest }, { path: "/sign-in/email" }, f.users);
  await recordSuccessfulLogin({ userId: USER_ID, createdAt: older }, { path: "/sign-in/email" }, f.users);
  await recordSuccessfulLogin({ userId: USER_ID, createdAt: newest }, { path: "/sign-in/email" }, f.users);
  assert.equal(f.lastLogins.get(USER_ID)?.getTime(), newest.getTime());
  assert.equal(f.lastLogins.get(OTHER_USER_ID), null);
});

test("session creation without the credential sign-in context is not tracked", async () => {
  const f = createUserStore();
  const session = { userId: USER_ID, createdAt: new Date() };
  for (const context of [null, undefined, {}, { path: "/change-password" }, { path: "/get-session" }, { path: "/sign-up/email" }]) {
    await recordSuccessfulLogin(session, context, f.users);
  }
  assert.equal(f.lastLogins.get(USER_ID), null);
});

test("a metadata write failure keeps login working and logs no sensitive details", async (t) => {
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  const f = await fixture({
    users: {
      async updateMany() {
        throw new Error("Sensitive database connection details must not be logged");
      },
    },
  });
  const { response, cookie } = await f.signIn();
  assert.equal(response.status, 200);
  assert.ok(cookie);
  assert.equal(f.database.session.length, 1);
  assert.equal(f.lastLogins.get(USER_ID), null);
  assert.deepEqual(errors, [["auth.last_login.record_failed"]]);
});

test("additive migration leaves existing members with an unknown last login", async () => {
  const database = new PGlite();
  try {
    await database.exec('CREATE TABLE "users" ("id" text PRIMARY KEY, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL)');
    await database.query('INSERT INTO "users" VALUES ($1, $2, $3)', [
      USER_ID, "2026-10-01T08:00:00.000Z", "2026-10-20T14:00:00.000Z",
    ]);
    const migration = await readFile(new URL("../../prisma/migrations/20261022090000_user_last_login/migration.sql", import.meta.url), "utf8");
    await database.exec(migration);
    const result = await database.query<{ lastLoginAt: Date | null }>('SELECT "lastLoginAt" FROM "users"');
    assert.deepEqual(result.rows, [{ lastLoginAt: null }]);
  } finally {
    await database.close();
  }
});
