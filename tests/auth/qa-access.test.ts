import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { canAccessAdmin } from "@/lib/auth/roles";
import { isValidEmail } from "@/lib/auth/input";
import {
  AUTH_QA_ACCESS_CONFIRMATION,
  AUTH_QA_ACCESS_STAGING_ORIGIN,
  assertQaIdentitySnapshot,
  deriveQaCredential,
  ensureQaProfilesInTransaction,
  parseQaAccessConfiguration,
  parseQaAccessPayload,
  QA_ACCESS_PROFILES,
  qaAccessAvailable,
  qaAccessIdentityAllowed,
  qaAccessRateLimitPlan,
  qaAccessSecretMatches,
  QaAccessCollisionError,
  QaAccessRateLimitError,
  QaAccessUnavailableError,
} from "@/lib/auth/qa-access";
import {
  handleQaAccessLogin,
  type QaAccessRouteDependencies,
} from "@/lib/auth/qa-access-route-handler";
import { createQaAccessSession } from "@/lib/auth/qa-access-session";

const ACCESS_SECRET = `qa-access-unit-${"x".repeat(40)}`;

function stagingEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    AUTH_QA_ACCESS_ENABLED: "true",
    AUTH_QA_ACCESS_CONFIRM: AUTH_QA_ACCESS_CONFIRMATION,
    AUTH_QA_ACCESS_SECRET: ACCESS_SECRET,
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "staging",
    RAILWAY_ENVIRONMENT: "staging-environment-id",
    NOTIFICATION_DEPLOYMENT_ENV: "staging",
    PAYMENT_DEPLOYMENT_ENV: "staging",
    MEDIA_DEPLOYMENT_ENV: "staging",
    AUTH_URL: AUTH_QA_ACCESS_STAGING_ORIGIN,
    SITE_URL: AUTH_QA_ACCESS_STAGING_ORIGIN,
    APP_CANONICAL_URL: AUTH_QA_ACCESS_STAGING_ORIGIN,
    ...overrides,
  };
}

test("QA access is absent unless every independent staging gate is armed", () => {
  assert.deepEqual(parseQaAccessConfiguration(stagingEnvironment()), {
    baseUrl: AUTH_QA_ACCESS_STAGING_ORIGIN,
    secret: ACCESS_SECRET,
  });
  assert.equal(qaAccessAvailable(stagingEnvironment()), true);

  const rejected = [
    { AUTH_QA_ACCESS_ENABLED: undefined },
    { AUTH_QA_ACCESS_ENABLED: "false" },
    { AUTH_QA_ACCESS_CONFIRM: undefined },
    { AUTH_QA_ACCESS_CONFIRM: "incorrect" },
    { AUTH_QA_ACCESS_SECRET: undefined },
    { AUTH_QA_ACCESS_SECRET: "too-short" },
    { NODE_ENV: "development" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { RAILWAY_ENVIRONMENT: "production-environment-id" },
    { NOTIFICATION_DEPLOYMENT_ENV: "production" },
    { PAYMENT_DEPLOYMENT_ENV: "development" },
    { MEDIA_DEPLOYMENT_ENV: "production" },
    { AUTH_URL: "https://lnxbeats.fr", SITE_URL: "https://lnxbeats.fr", APP_CANONICAL_URL: "https://lnxbeats.fr" },
    { SITE_URL: "https://example.com" },
    { AUTH_URL: `${AUTH_QA_ACCESS_STAGING_ORIGIN}/qa/access` },
    { SITE_URL: `${AUTH_QA_ACCESS_STAGING_ORIGIN}/qa/access` },
  ];
  for (const override of rejected) {
    assert.throws(
      () => parseQaAccessConfiguration(stagingEnvironment(override)),
      QaAccessUnavailableError,
    );
    assert.equal(qaAccessAvailable(stagingEnvironment(override)), false);
  }
});

test("the secret comparison is deterministic, constant-time primitive backed and credential derivation is isolated", () => {
  assert.equal(qaAccessSecretMatches(ACCESS_SECRET, ACCESS_SECRET), true);
  assert.equal(qaAccessSecretMatches(`${ACCESS_SECRET}x`, ACCESS_SECRET), false);
  const member = deriveQaCredential(ACCESS_SECRET, "member");
  const admin = deriveQaCredential(ACCESS_SECRET, "admin");
  assert.notEqual(member, admin);
  assert.notEqual(member, ACCESS_SECRET);
  assert.notEqual(admin, ACCESS_SECRET);
  assert.equal(member.length <= 128, true);
  assert.equal(admin.length <= 128, true);
});

test("the persisted attempt window is bounded and resets only after ten minutes", () => {
  const now = 1_000_000n;
  assert.equal(qaAccessRateLimitPlan(null, now), "CREATE");
  assert.equal(qaAccessRateLimitPlan({ count: 9, lastRequest: now - 1n }, now), "INCREMENT");
  assert.equal(qaAccessRateLimitPlan({ count: 10, lastRequest: now - 1n }, now), "REJECT");
  assert.equal(qaAccessRateLimitPlan({ count: 100, lastRequest: now - 600_000n }, now), "RESET");
});

test("the browser payload is a closed member or admin choice only", () => {
  assert.equal(parseQaAccessPayload({ profile: "member" }), "member");
  assert.equal(parseQaAccessPayload({ profile: "admin" }), "admin");
  for (const payload of [
    null,
    {},
    { profile: "owner" },
    { profile: "MEMBER" },
    { profile: "member", email: "other@example.invalid" },
    { profile: "member", userId: "74000000-0000-4700-8700-000000000099" },
    { profile: "admin", role: "ADMIN" },
    { profile: "admin", redirect: "https://example.com" },
  ]) assert.equal(parseQaAccessPayload(payload), null);
});

test("reserved QA identities are syntactically valid, verified, closed and correctly authorized", () => {
  assert.equal(isValidEmail(QA_ACCESS_PROFILES.member.email), true);
  assert.equal(isValidEmail(QA_ACCESS_PROFILES.admin.email), true);
  assert.match(QA_ACCESS_PROFILES.member.email, /\.invalid$/);
  assert.match(QA_ACCESS_PROFILES.admin.email, /\.invalid$/);
  assert.equal(QA_ACCESS_PROFILES.member.role, "MEMBER");
  assert.equal(QA_ACCESS_PROFILES.admin.role, "ADMIN");
  assert.equal(canAccessAdmin(QA_ACCESS_PROFILES.member.role), false);
  assert.equal(canAccessAdmin(QA_ACCESS_PROFILES.admin.role), true);
  assert.equal(QA_ACCESS_PROFILES.member.redirectTo, "/compte");
  assert.equal(QA_ACCESS_PROFILES.admin.redirectTo, "/admin");
  assert.equal(qaAccessIdentityAllowed(QA_ACCESS_PROFILES.member.userId, stagingEnvironment()), true);
  assert.equal(qaAccessIdentityAllowed(QA_ACCESS_PROFILES.admin.userId, stagingEnvironment()), true);
  assert.equal(qaAccessIdentityAllowed(QA_ACCESS_PROFILES.member.userId, {}), false);
  assert.equal(qaAccessIdentityAllowed(QA_ACCESS_PROFILES.admin.userId, {}), false);
  assert.equal(qaAccessIdentityAllowed("74000000-0000-4700-8700-000000000099", {}), true);
});

type StoredUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  accounts: Array<{
    id: string;
    userId: string;
    accountId: string;
    providerId: string;
    password: string | null;
  }>;
};

function qaAccountStore(seed: StoredUser[] = []) {
  const users = structuredClone(seed);
  let accountUpdates = 0;
  const transaction = {
    user: {
      findMany: async () => structuredClone(users),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const accounts = data.accounts as { create: Record<string, unknown> };
        const nested = accounts.create;
        users.push({
          id: String(data.id),
          email: String(data.email),
          displayName: String(data.displayName),
          role: String(data.role),
          status: String(data.status),
          emailVerified: Boolean(data.emailVerified),
          emailVerifiedAt: data.emailVerifiedAt as Date,
          accounts: [{
            id: String(nested.id),
            userId: String(data.id),
            accountId: String(nested.accountId),
            providerId: String(nested.providerId),
            password: String(nested.password),
          }],
        });
        return { id: String(data.id) };
      },
    },
    account: {
      update: async ({ where, data }: { where: { id: string }; data: { password: string } }) => {
        accountUpdates += 1;
        const account = users.flatMap((user) => user.accounts).find(({ id }) => id === where.id);
        if (!account) throw new Error("missing test account");
        account.password = data.password;
        return { id: where.id };
      },
    },
  } as unknown as Parameters<typeof ensureQaProfilesInTransaction>[0];
  return { users, transaction, accountUpdates: () => accountUpdates };
}

test("QA profile creation is idempotent and leaves unrelated users untouched", async () => {
  const unrelated: StoredUser = {
    id: "74000000-0000-4700-8700-000000000099",
    email: "unrelated@example.invalid",
    displayName: "Unrelated",
    role: "MEMBER",
    status: "ACTIVE",
    emailVerified: true,
    emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    accounts: [],
  };
  const store = qaAccountStore([unrelated]);
  const first = await ensureQaProfilesInTransaction(store.transaction, { member: "hash-member-1", admin: "hash-admin-1" });
  const second = await ensureQaProfilesInTransaction(store.transaction, { member: "hash-member-2", admin: "hash-admin-2" });
  assert.deepEqual(first, second);
  assert.equal(store.users.length, 3);
  assert.equal(store.users.filter(({ email }) => email.endsWith("@lnx.invalid")).length, 2);
  assert.equal(store.accountUpdates(), 2);
  assert.deepEqual(store.users.find(({ id }) => id === unrelated.id), unrelated);
  for (const profile of ["member", "admin"] as const) {
    const user = store.users.find(({ id }) => id === QA_ACCESS_PROFILES[profile].userId);
    assert.ok(user);
    assertQaIdentitySnapshot(user, profile);
    assert.equal(user.accounts[0]?.password, `hash-${profile}-2`);
  }
});

test("an unexpected identity collision fails closed without an account rewrite", async () => {
  const definition = QA_ACCESS_PROFILES.member;
  const collision: StoredUser = {
    id: definition.userId,
    email: definition.email,
    displayName: definition.displayName,
    role: "ADMIN",
    status: "ACTIVE",
    emailVerified: true,
    emailVerifiedAt: new Date(),
    accounts: [{
      id: definition.accountId,
      userId: definition.userId,
      accountId: definition.userId,
      providerId: "credential",
      password: "existing-hash",
    }],
  };
  const store = qaAccountStore([collision]);
  await assert.rejects(
    ensureQaProfilesInTransaction(store.transaction, { member: "new-member", admin: "new-admin" }),
    QaAccessCollisionError,
  );
  assert.equal(store.accountUpdates(), 0);
  assert.equal(store.users[0]?.accounts[0]?.password, "existing-hash");
});

function routeRequest(
  body: unknown = { profile: "member" },
  options: { origin?: string; secret?: string; cookie?: string } = {},
) {
  const headers = new Headers({
    "content-type": "application/json",
    origin: options.origin ?? AUTH_QA_ACCESS_STAGING_ORIGIN,
    "x-lnx-qa-access-secret": options.secret ?? ACCESS_SECRET,
  });
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(`${AUTH_QA_ACCESS_STAGING_ORIGIN}/api/internal/qa/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function routeHarness(overrides: Partial<QaAccessRouteDependencies> = {}) {
  const events: Array<{ event: string; fields: Readonly<Record<string, string | null>> }> = [];
  let ensured = 0;
  let sessions = 0;
  const dependencies: QaAccessRouteDependencies = {
    configuration: () => ({ baseUrl: AUTH_QA_ACCESS_STAGING_ORIGIN, secret: ACCESS_SECRET }),
    allowedOrigin: (request, baseUrl) => request.headers.get("origin") === baseUrl,
    rateLimit: async () => undefined,
    ensureProfiles: async () => {
      ensured += 1;
      return { member: QA_ACCESS_PROFILES.member.userId, admin: QA_ACCESS_PROFILES.admin.userId };
    },
    createSession: async (_request, _configuration, profile) => {
      sessions += 1;
      return [`__Secure-lnx-studio.session_token=${profile}-opaque; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`];
    },
    log: (event, fields) => events.push({ event, fields }),
    ...overrides,
  };
  return { dependencies, events, ensured: () => ensured, sessions: () => sessions };
}

test("the route is hidden when unarmed and rejects wrong origin, rate limit and secret generically", async () => {
  const unavailable = routeHarness({ configuration: () => { throw new QaAccessUnavailableError(); } });
  assert.equal((await handleQaAccessLogin(routeRequest(), unavailable.dependencies)).status, 404);

  const wrongOrigin = routeHarness();
  assert.equal((await handleQaAccessLogin(routeRequest(undefined, { origin: "https://lnxbeats.fr" }), wrongOrigin.dependencies)).status, 403);

  const limited = routeHarness({ rateLimit: async () => { throw new QaAccessRateLimitError(); } });
  assert.equal((await handleQaAccessLogin(routeRequest(), limited.dependencies)).status, 429);

  const wrongSecret = routeHarness();
  const response = await handleQaAccessLogin(routeRequest({ profile: "admin" }, { secret: "incorrect-secret" }), wrongSecret.dependencies);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "Accès QA refusé." });
  assert.equal(wrongSecret.events.at(-1)?.fields.profile, "admin");
  assert.equal(wrongSecret.ensured(), 0);
  assert.equal(wrongSecret.sessions(), 0);
});

test("only closed payloads create one session and return fixed local redirects", async () => {
  for (const profile of ["member", "admin"] as const) {
    const harness = routeHarness();
    const response = await handleQaAccessLogin(routeRequest({ profile }), harness.dependencies);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, redirectTo: QA_ACCESS_PROFILES[profile].redirectTo });
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly.*Secure.*SameSite=Lax/i);
    assert.equal(harness.ensured(), 1);
    assert.equal(harness.sessions(), 1);
    assert.equal(harness.events.at(-1)?.event, "qa.auth.login.success");
    assert.equal(harness.events.at(-1)?.fields.profile, profile);
    assert.equal(harness.events.at(-1)?.fields.userId, QA_ACCESS_PROFILES[profile].userId);
  }

  for (const body of [
    { profile: "owner" },
    { profile: "member", email: "other@example.invalid" },
    { profile: "admin", userId: QA_ACCESS_PROFILES.admin.userId },
    { profile: "member", redirect: "https://example.com" },
  ]) {
    const harness = routeHarness();
    assert.equal((await handleQaAccessLogin(routeRequest(body), harness.dependencies)).status, 400);
    assert.equal(harness.ensured(), 0);
    assert.equal(harness.sessions(), 0);
  }
});

test("responses and safe logs never contain the submitted QA secret", async () => {
  const harness = routeHarness();
  const response = await handleQaAccessLogin(routeRequest({ profile: "member" }), harness.dependencies);
  const responseText = await response.text();
  const logs = JSON.stringify(harness.events);
  assert.doesNotMatch(responseText, new RegExp(ACCESS_SECRET));
  assert.doesNotMatch(logs, new RegExp(ACCESS_SECRET));
  assert.doesNotMatch(logs, /cookie|password|token/i);
});

test("profile switching revokes the current Better Auth session then creates a secure real session", async () => {
  const calls: Array<{ pathname: string; origin: string | null; cookie: string | null; body: unknown }> = [];
  const authHandler = async (request: Request) => {
    calls.push({
      pathname: new URL(request.url).pathname,
      origin: request.headers.get("origin"),
      cookie: request.headers.get("cookie"),
      body: await request.clone().json(),
    });
    if (new URL(request.url).pathname === "/api/auth/sign-out") return Response.json({ success: true });
    return Response.json({ user: { id: QA_ACCESS_PROFILES.admin.userId } }, {
      headers: {
        "set-cookie": "__Secure-lnx-studio.session_token=opaque-session; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200",
      },
    });
  };
  const request = routeRequest({ profile: "admin" }, { cookie: "lnx-studio.session_token=old-session" });
  const cookies = await createQaAccessSession(
    request,
    { baseUrl: AUTH_QA_ACCESS_STAGING_ORIGIN, secret: ACCESS_SECRET },
    "admin",
    authHandler,
  );
  assert.deepEqual(calls.map(({ pathname }) => pathname), ["/api/auth/sign-out", "/api/auth/sign-in/email"]);
  assert.equal(calls.every(({ origin }) => origin === AUTH_QA_ACCESS_STAGING_ORIGIN), true);
  assert.equal(calls[0]?.cookie, "lnx-studio.session_token=old-session");
  assert.deepEqual(calls[1]?.body, {
    email: QA_ACCESS_PROFILES.admin.email,
    password: deriveQaCredential(ACCESS_SECRET, "admin"),
    rememberMe: false,
  });
  assert.match(cookies[0] ?? "", /^__Secure-lnx-studio\.session_token=.*HttpOnly.*Secure.*SameSite=Lax/i);
});

test("a session response without the production cookie protections is rejected", async () => {
  const insecureHandler = async () => Response.json({}, {
    headers: { "set-cookie": "lnx-studio.session_token=opaque; Path=/; HttpOnly; SameSite=Lax" },
  });
  await assert.rejects(
    createQaAccessSession(
      routeRequest(),
      { baseUrl: AUTH_QA_ACCESS_STAGING_ORIGIN, secret: ACCESS_SECRET },
      "member",
      insecureHandler,
    ),
    /session cookie is unavailable/i,
  );
});

test("client, route and session sources keep QA access closed and side-effect free", () => {
  const root = process.cwd();
  const client = readFileSync(join(root, "components/auth/qa-access-portal.tsx"), "utf8");
  const route = readFileSync(join(root, "lib/auth/qa-access-route-handler.ts"), "utf8");
  const profiles = readFileSync(join(root, "lib/auth/qa-access.ts"), "utf8");
  const session = readFileSync(join(root, "lib/auth/qa-access-session.ts"), "utf8");
  const auth = readFileSync(join(root, "lib/auth.ts"), "utf8");
  const authSession = readFileSync(join(root, "lib/auth/session.ts"), "utf8");
  const orderRequest = readFileSync(join(root, "lib/orders/request.ts"), "utf8");

  assert.doesNotMatch(client, /process\.env|AUTH_QA_ACCESS_CONFIRM|qa\.member@|qa\.admin@/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|URLSearchParams|document\.cookie/);
  assert.match(client, /type="password"/);
  assert.match(session, /\/api\/auth\/sign-out/);
  assert.match(session, /\/api\/auth\/sign-in\/email/);
  assert.match(session, /assertSecureSessionCookie/);
  assert.match(profiles, /timingSafeEqual\(digest\(candidate\), digest\(expected\)\)/);
  assert.match(auth, /expiresIn:\s*60 \* 60 \* 12/);
  assert.match(auth, /cookiePrefix:\s*"lnx-studio"/);
  assert.match(authSession, /qaAccessIdentityAllowed\(session\.user\.id\)/);
  assert.match(orderRequest, /qaAccessIdentityAllowed\(session\.user\.id\)/);
  assert.doesNotMatch(`${route}\n${profiles}\n${session}`, /prisma\.(?:order|payment|providerEvent|orderNotification)/);
  assert.doesNotMatch(`${route}\n${profiles}\n${session}`, /sendEmail|sendSms|createStripe|createPaypal/i);
});
