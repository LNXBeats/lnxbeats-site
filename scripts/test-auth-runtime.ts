import assert from "node:assert/strict";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { handleAuthRequest } from "@/lib/auth/handler";
import { canAccessAccount, canAccessAdmin, type UserRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

const EXPECTED_TARGET = "lnx-studio-v051-test";
const QA_EMAILS = {
  member: "lnx-v051-member@example.invalid",
  customer: "lnx-v051-customer@example.invalid",
  admin: "lnx-v051-admin@example.invalid",
  suspended: "lnx-v051-suspended@example.invalid",
} as const;

type LoginResult = {
  response: Response;
  body: Record<string, unknown>;
  cookie?: string;
};

function validateSafetyGuards() {
  assert.equal(process.env.NODE_ENV, "test", "NODE_ENV must be test.");
  assert.equal(process.env.LNX_DATABASE_TARGET, EXPECTED_TARGET, `LNX_DATABASE_TARGET must be ${EXPECTED_TARGET}.`);
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required.");
  assert.ok(process.env.LNX_PRISMA_DEV_PROXY_URL, "LNX_PRISMA_DEV_PROXY_URL is required.");
  assert.ok(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32, "A disposable AUTH_SECRET of at least 32 characters is required.");
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12, "A disposable QA password is required.");

  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(databaseUrl.protocol), "Only a direct PostgreSQL URL is accepted.");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname), "Only a loopback database host is accepted.");
  assert.ok(databaseUrl.port && databaseUrl.port !== "5432", "An explicit non-default database port is required.");

  const proxyUrl = new URL(process.env.LNX_PRISMA_DEV_PROXY_URL);
  assert.equal(proxyUrl.protocol, "prisma+postgres:", "Only a Prisma Dev proxy URL is accepted as instance proof.");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(proxyUrl.hostname), "The Prisma Dev proxy must be loopback-only.");
  assert.ok(proxyUrl.port && proxyUrl.port !== "5432", "The Prisma Dev proxy must use an explicit non-default port.");

  const apiKey = proxyUrl.searchParams.get("api_key");
  assert.ok(apiKey, "The Prisma Dev instance proof is incomplete.");
  const proof = JSON.parse(Buffer.from(apiKey, "base64url").toString("utf8")) as {
    name?: string;
    databaseUrl?: string;
  };
  assert.equal(proof.name, EXPECTED_TARGET, "The Prisma Dev instance name does not match the disposable target.");
  assert.equal(proof.databaseUrl, process.env.DATABASE_URL, "The runtime URL does not belong to the approved Prisma Dev instance.");

  const authUrl = new URL(process.env.AUTH_URL ?? "");
  assert.equal(authUrl.protocol, "http:", "Runtime QA must use local HTTP.");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(authUrl.hostname), "AUTH_URL must be loopback-only during QA.");
}

function authRequest(path: string, init: RequestInit = {}, ip = "127.0.0.10") {
  const authUrl = process.env.AUTH_URL;
  assert.ok(authUrl);
  const headers = new Headers(init.headers);
  headers.set("origin", authUrl);
  headers.set("user-agent", "LNX Studio V0.5.1 runtime QA");
  headers.set("x-forwarded-for", ip);
  if (init.body) headers.set("content-type", "application/json");

  return new Request(`${authUrl}${path}`, { ...init, headers });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function sessionCookie(response: Response) {
  const cookieHeaders = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? [response.headers.get("set-cookie") ?? ""];
  const rawCookie = cookieHeaders.find((value) => value.startsWith("lnx-studio.session_token="));
  if (!rawCookie) return undefined;

  assert.match(rawCookie, /;\s*HttpOnly/i);
  assert.match(rawCookie, /;\s*SameSite=Lax/i);
  assert.match(rawCookie, /;\s*Path=\//i);
  assert.match(rawCookie, /;\s*Max-Age=43200/i);
  assert.doesNotMatch(rawCookie, /;\s*Secure/i, "The local HTTP cookie must not use Secure.");
  return rawCookie.split(";", 1)[0];
}

async function login(email: string, password: string, ip: string, extra: Record<string, unknown> = {}): Promise<LoginResult> {
  const response = await handleAuthRequest(authRequest(
    "/api/auth/sign-in/email",
    { method: "POST", body: JSON.stringify({ email, password, rememberMe: true, ...extra }) },
    ip,
  ));
  const body = await json(response.clone());
  return { response, body, cookie: response.ok ? sessionCookie(response) : undefined };
}

async function readSession(cookie: string, ip: string) {
  const response = await handleAuthRequest(authRequest(
    "/api/auth/get-session",
    { method: "GET", headers: { cookie } },
    ip,
  ));
  assert.equal(response.status, 200);
  return response.json() as Promise<Record<string, unknown> | null>;
}

async function logout(cookie: string, ip: string) {
  const response = await handleAuthRequest(authRequest(
    "/api/auth/sign-out",
    { method: "POST", headers: { cookie }, body: JSON.stringify({}) },
    ip,
  ));
  assert.equal(response.status, 200);
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.rateLimit.deleteMany();
    await transaction.verification.deleteMany();
    await transaction.session.deleteMany();
    await transaction.account.deleteMany();
    await transaction.user.deleteMany({ where: { email: { endsWith: "@example.invalid" } } });
  });
}

async function assertAuthTablesEmpty(stage: string) {
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.account.count(),
    prisma.session.count(),
    prisma.verification.count(),
    prisma.rateLimit.count(),
  ]);
  assert.ok(counts.every((count) => count === 0), `${stage}: authentication QA rows remain.`);
}

async function run() {
  validateSafetyGuards();
  const password = process.env.LNX_AUTH_QA_PASSWORD;
  assert.ok(password);
  const passed: string[] = [];

  await assertAuthTablesEmpty("precondition");

  try {
    const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`,
    );
    assert.equal(tables.length, 17, "The migrated schema must expose 17 model tables.");
    for (const table of ["auth_accounts", "auth_rate_limits", "auth_sessions", "auth_verifications", "users"]) {
      assert.ok(tables.some(({ tablename }) => tablename === table), `Missing ${table}.`);
    }
    passed.push("physical auth schema inspected");

    const signUpResponse = await handleAuthRequest(authRequest(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        body: JSON.stringify({
          email: "lnx-v051-public-signup@example.invalid",
          password,
          name: "Unauthorized signup",
          role: "ADMIN",
          status: "ACTIVE",
        }),
      },
      "127.0.0.11",
    ));
    assert.equal(signUpResponse.status, 400);
    assert.equal(await prisma.user.count(), 0);
    passed.push("public signup and role injection rejected");

    const roleFixtures: Array<{ key: "member" | "customer" | "admin"; role: UserRole; ip: string }> = [
      { key: "member", role: "MEMBER", ip: "127.0.0.21" },
      { key: "customer", role: "CUSTOMER", ip: "127.0.0.22" },
      { key: "admin", role: "ADMIN", ip: "127.0.0.23" },
    ];

    for (const fixture of roleFixtures) {
      await createInternalAuthUser({
        email: QA_EMAILS[fixture.key],
        password,
        displayName: `LNX V0.5.1 ${fixture.role} QA`,
        role: fixture.role,
      });
    }
    const suspended = await createInternalAuthUser({
      email: QA_EMAILS.suspended,
      password,
      displayName: "LNX V0.5.1 Suspended QA",
      role: "MEMBER",
    });
    await prisma.user.update({ where: { id: suspended.id }, data: { status: "SUSPENDED" } });

    const accounts = await prisma.account.findMany({ select: { password: true } });
    assert.equal(accounts.length, 4);
    for (const account of accounts) {
      assert.ok(account.password?.startsWith("$argon2id$v=19$m=65536,t=3,p=1$"));
      assert.notEqual(account.password, password);
    }
    passed.push("internal users created with Argon2id only");

    const invalidExisting = await login(QA_EMAILS.member, `${password}-wrong`, "127.0.0.31");
    const invalidMissing = await login("lnx-v051-missing@example.invalid", `${password}-wrong`, "127.0.0.32");
    const invalidSuspended = await login(QA_EMAILS.suspended, password, "127.0.0.33");
    assert.equal(invalidExisting.response.status, 401);
    assert.equal(invalidMissing.response.status, 401);
    assert.equal(invalidSuspended.response.status, 401);
    assert.deepEqual(invalidExisting.body, invalidMissing.body);
    assert.deepEqual(invalidExisting.body, invalidSuspended.body);
    assert.equal(await prisma.session.count({ where: { userId: suspended.id } }), 0);
    passed.push("invalid, missing and suspended logins are indistinguishable");

    const authUrl = process.env.AUTH_URL;
    assert.ok(authUrl);
    const crossOriginResponse = await handleAuthRequest(new Request(`${authUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://untrusted.example.invalid",
        "x-forwarded-for": "127.0.0.34",
      },
      body: JSON.stringify({ email: QA_EMAILS.member, password, rememberMe: true }),
    }));
    assert.equal(crossOriginResponse.status, 401);
    assert.equal(await prisma.session.count(), 0);
    passed.push("cross-origin login rejected before session creation");

    for (const fixture of roleFixtures) {
      const loginResult = await login(
        QA_EMAILS[fixture.key],
        password,
        fixture.ip,
        { role: fixture.role === "ADMIN" ? "MEMBER" : "ADMIN", status: "ACTIVE" },
      );
      assert.equal(loginResult.response.status, 200);
      assert.ok(loginResult.cookie);

      const current = await readSession(loginResult.cookie, fixture.ip);
      assert.ok(current);
      const user = current.user as { email?: string; role?: string; status?: string };
      assert.equal(user.email, QA_EMAILS[fixture.key]);
      assert.equal(user.role, fixture.role, "A client-supplied role altered authorization.");
      assert.equal(user.status, "ACTIVE");
      assert.equal(canAccessAccount(user.role), true);
      assert.equal(canAccessAdmin(user.role), fixture.role === "ADMIN");

      const persisted = await prisma.session.findMany({
        where: { user: { email: QA_EMAILS[fixture.key] } },
      });
      assert.equal(persisted.length, 1);
      const lifetimeSeconds = (persisted[0].expiresAt.getTime() - persisted[0].createdAt.getTime()) / 1_000;
      assert.ok(lifetimeSeconds >= 43_190 && lifetimeSeconds <= 43_210, "The database session lifetime is not 12 hours.");

      await logout(loginResult.cookie, fixture.ip);
      assert.equal(await prisma.session.count({ where: { userId: persisted[0].userId } }), 0);
      const afterLogout = await readSession(loginResult.cookie, fixture.ip);
      assert.equal(afterLogout, null);
    }
    passed.push("MEMBER, CUSTOMER and ADMIN sessions validated then revoked");
    passed.push("cookie flags and 12-hour expiry validated");

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const rateLimited = await login(QA_EMAILS.member, `${password}-wrong`, "127.0.0.41");
      assert.equal(rateLimited.response.status, attempt <= 5 ? 401 : 429);
      if (attempt === 6) assert.deepEqual(rateLimited.body, invalidExisting.body);
    }
    assert.ok(await prisma.rateLimit.count() > 0, "The database rate-limit store was not used.");
    passed.push("database-backed login rate limit enforced");
  } finally {
    await cleanup();
    await assertAuthTablesEmpty("cleanup");
  }

  for (const result of passed) console.info(`PASS ${result}`);
  console.info(`Authentication runtime QA passed (${passed.length} controls); cleanup verified.`);
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Authentication runtime QA failed.");
    process.exitCode = 1;
  });
