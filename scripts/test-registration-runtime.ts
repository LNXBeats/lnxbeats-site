import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";

import { POST as requestCodeRoute } from "@/app/api/auth/registration/code/route";
import { POST as completeRegistrationRoute } from "@/app/api/auth/registration/complete/route";
import { GET as registrationStateRoute } from "@/app/api/auth/registration/state/route";
import { POST as verifyCodeRoute } from "@/app/api/auth/registration/verify/route";
import { promoteConfiguredAdmin } from "@/lib/auth/admin-bootstrap";
import { handleAuthRequest } from "@/lib/auth/handler";
import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { canAccessAdmin } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

const EXPECTED_TARGET = "lnx-studio-v062-auth-test";
const EXPECTED_CAPTURE_PATH = "/private/tmp/lnx-studio-v062-auth-mailbox.jsonl";
const EXPECTED_SERVER_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v062-auth-test/server.json";
const ADMIN_EMAIL = "lnx.beats.pro@gmail.com";
const EMAILS = {
  valid: "lnx-v062-valid@example.invalid",
  incorrect: "lnx-v062-incorrect@example.invalid",
  expired: "lnx-v062-expired@example.invalid",
  used: "lnx-v062-used@example.invalid",
  resend: "lnx-v062-resend@example.invalid",
  limited: "lnx-v062-limited@example.invalid",
  double: "lnx-v062-double@example.invalid",
  existing: "lnx-v062-existing@example.invalid",
  fakeAdmin: "lnx.beats.pro+fake@example.invalid",
} as const;

type CapturedEmail = {
  kind: "registration-code" | "verification" | "password-reset";
  to: string;
  subject: string;
  text: string;
};

type RegistrationResponse = {
  attemptId?: string;
  attemptsRemaining?: number;
  completed?: boolean;
  error?: string;
  maskedEmail?: string;
  message?: string;
  next?: "code" | "password" | "login";
  stage?: "email" | "password";
};

async function validateSafetyGuards() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, EXPECTED_TARGET);
  assert.equal(process.env.EMAIL_PROVIDER, "capture");
  assert.equal(process.env.AUTH_EMAIL_CAPTURE_PATH, EXPECTED_CAPTURE_PATH);
  assert.equal(process.env.LNX_PRISMA_DEV_SERVER_FILE, EXPECTED_SERVER_FILE);
  assert.equal(process.env.ADMIN_EMAIL, ADMIN_EMAIL);
  assert.ok(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32);
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12);
  assert.ok(process.env.DATABASE_URL);

  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(databaseUrl.protocol));
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname));
  assert.ok(databaseUrl.port && databaseUrl.port !== "5432");

  const proof = JSON.parse(await readFile(EXPECTED_SERVER_FILE, "utf8")) as {
    name?: string;
    pid?: number;
    exports?: { database?: { connectionString?: string } };
  };
  assert.equal(proof.name, EXPECTED_TARGET);
  assert.ok(proof.pid && proof.pid > 0);
  assert.equal(proof.exports?.database?.connectionString, process.env.DATABASE_URL);

  const authUrl = new URL(process.env.AUTH_URL ?? "");
  assert.equal(authUrl.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(authUrl.hostname));
}

function request(path: string, init: RequestInit = {}, ip = "127.0.0.10", origin?: string) {
  const authUrl = process.env.AUTH_URL;
  assert.ok(authUrl);
  const headers = new Headers(init.headers);
  headers.set("origin", origin ?? authUrl);
  headers.set("user-agent", "LNX Studio registration runtime QA");
  headers.set("x-forwarded-for", ip);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`${authUrl}${path}`, { ...init, headers });
}

async function json(response: Response) {
  return response.clone().json() as Promise<RegistrationResponse>;
}

function cookie(response: Response, name: string) {
  const values = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? [response.headers.get("set-cookie") ?? ""];
  const raw = values.find((value) => value.startsWith(`${name}=`));
  if (!raw) return undefined;
  assert.match(raw, /;\s*HttpOnly/i);
  assert.match(raw, /;\s*SameSite=Lax/i);
  return raw.split(";", 1)[0];
}

async function capturedMailbox() {
  const content = await readFile(EXPECTED_CAPTURE_PATH, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as CapturedEmail);
}

async function latestCode(email: string) {
  const message = [...await capturedMailbox()].reverse().find((candidate) => (
    candidate.kind === "registration-code" && candidate.to === email
  ));
  assert.ok(message, `A captured registration code for ${email} is required.`);
  assert.equal(message.subject, "Votre code LNX Beats");
  const code = message.text.match(/(?:^|\n)(\d{6})(?:\n|$)/)?.[1];
  assert.ok(code, "The captured registration email must contain six digits.");
  return code;
}

async function requestCode(email: string, ip: string) {
  const response = await requestCodeRoute(request("/api/auth/registration/code", {
    method: "POST",
    body: JSON.stringify({ email }),
  }, ip));
  return { response, body: await json(response) };
}

async function verifyCode(attemptId: string, code: string, ip: string) {
  const response = await verifyCodeRoute(request("/api/auth/registration/verify", {
    method: "POST",
    body: JSON.stringify({ attemptId, code }),
  }, ip));
  return { response, body: await json(response), proofCookie: cookie(response, "lnx-registration-proof") };
}

async function complete(password: string, proofCookie: string | undefined, ip: string, extra: Record<string, unknown> = {}) {
  const response = await completeRegistrationRoute(request("/api/auth/registration/complete", {
    method: "POST",
    headers: proofCookie ? { cookie: proofCookie } : undefined,
    body: JSON.stringify({ password, passwordConfirmation: password, ...extra }),
  }, ip));
  return { response, body: await json(response) };
}

async function authPost(path: string, body: Record<string, unknown>, ip: string, authCookie?: string) {
  return handleAuthRequest(request(path, {
    method: "POST",
    headers: authCookie ? { cookie: authCookie } : undefined,
    body: JSON.stringify(body),
  }, ip));
}

async function login(email: string, password: string, ip: string) {
  const response = await authPost("/api/auth/sign-in/email", { email, password, rememberMe: true }, ip);
  return { response, sessionCookie: cookie(response, "lnx-studio.session_token") };
}

async function readSession(sessionCookie: string, ip: string) {
  const response = await handleAuthRequest(request("/api/auth/get-session", {
    method: "GET",
    headers: { cookie: sessionCookie },
  }, ip));
  return response.json() as Promise<Record<string, unknown> | null>;
}

async function clearMailbox() {
  await unlink(EXPECTED_CAPTURE_PATH).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.registrationAttempt.deleteMany();
    await transaction.rateLimit.deleteMany();
    await transaction.verification.deleteMany();
    await transaction.session.deleteMany();
    await transaction.account.deleteMany();
    await transaction.user.deleteMany();
  });
  await clearMailbox();
}

async function assertClean(stage: string) {
  const counts = await Promise.all([
    prisma.registrationAttempt.count(),
    prisma.rateLimit.count(),
    prisma.verification.count(),
    prisma.session.count(),
    prisma.account.count(),
    prisma.user.count(),
  ]);
  assert.ok(counts.every((count) => count === 0), `${stage}: disposable auth rows remain.`);
  assert.equal((await capturedMailbox()).length, 0, `${stage}: disposable mailbox messages remain.`);
}

async function run() {
  await validateSafetyGuards();
  const password = process.env.LNX_AUTH_QA_PASSWORD;
  assert.ok(password);
  const passed: string[] = [];

  await cleanup();
  await assertClean("precondition");

  try {
    const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`,
    );
    assert.equal(tables.length, 19);
    assert.ok(tables.some(({ tablename }) => tablename === "auth_registration_attempts"));

    const crossOrigin = await requestCodeRoute(request("/api/auth/registration/code", {
      method: "POST",
      body: JSON.stringify({ email: EMAILS.valid }),
    }, "127.0.0.11", "https://untrusted.example.invalid"));
    assert.equal(crossOrigin.status, 403);
    const legacySignup = await authPost("/api/auth/sign-up/email", {
      email: EMAILS.valid,
      password,
      name: "Bypass",
      role: "ADMIN",
    }, "127.0.0.12");
    assert.equal(legacySignup.status, 404);
    assert.equal(await prisma.user.count(), 0);
    passed.push("cross-origin and legacy sign-up bypass rejected");

    const requested = await requestCode(EMAILS.valid.toUpperCase(), "127.0.0.13");
    assert.equal(requested.response.status, 200);
    assert.ok(requested.body.attemptId);
    const validCode = await latestCode(EMAILS.valid);
    const validAttempt = await prisma.registrationAttempt.findUniqueOrThrow({ where: { id: requested.body.attemptId } });
    assert.equal(validAttempt.email, EMAILS.valid);
    const codeLifetime = validAttempt.expiresAt.getTime() - validAttempt.createdAt.getTime();
    assert.ok(codeLifetime <= 10 * 60_000 && codeLifetime >= 10 * 60_000 - 2_000);
    assert.equal(validAttempt.codeHash.includes(validCode), false);
    assert.equal(await prisma.user.count(), 0, "No account may exist before code verification and password choice.");
    passed.push("valid email normalized, code captured and raw code absent from PostgreSQL");

    const verified = await verifyCode(validAttempt.id, validCode, "127.0.0.13");
    assert.equal(verified.response.status, 200);
    assert.equal(verified.body.next, "password");
    assert.ok(verified.proofCookie);
    const state = await registrationStateRoute(request("/api/auth/registration/state", {
      method: "GET",
      headers: { cookie: verified.proofCookie },
    }, "127.0.0.13"));
    assert.equal((await json(state)).stage, "password");
    const afterVerification = await prisma.registrationAttempt.findUniqueOrThrow({ where: { id: validAttempt.id } });
    assert.ok(afterVerification.verifiedAt);
    assert.ok(afterVerification.continuationHash);
    assert.equal(verified.proofCookie.includes(afterVerification.continuationHash), false);
    passed.push("correct code issues a hashed short-lived server continuation proof");

    const injectedCompletion = await complete(password, verified.proofCookie, "127.0.0.13", { role: "ADMIN", status: "ACTIVE" });
    assert.equal(injectedCompletion.response.status, 400);
    assert.equal(await prisma.user.count({ where: { email: EMAILS.valid } }), 0);
    const completed = await complete(password, verified.proofCookie, "127.0.0.13");
    assert.equal(completed.response.status, 200);
    const member = await prisma.user.findUniqueOrThrow({ where: { email: EMAILS.valid } });
    assert.equal(member.role, "MEMBER");
    assert.equal(member.status, "ACTIVE");
    assert.equal(member.emailVerified, true);
    assert.ok(member.emailVerifiedAt);
    const credential = await prisma.account.findFirstOrThrow({ where: { userId: member.id } });
    assert.match(credential.password ?? "", /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    assert.notEqual(credential.password, password);
    assert.equal(await prisma.session.count({ where: { userId: member.id } }), 0);
    passed.push("password completion forces ACTIVE MEMBER and Argon2id without automatic session");

    const loggedIn = await login(EMAILS.valid, password, "127.0.0.14");
    assert.equal(loggedIn.response.status, 200);
    assert.ok(loggedIn.sessionCookie);
    assert.ok(await readSession(loggedIn.sessionCookie, "127.0.0.14"));
    passed.push("new member can log in with a persisted session");

    const wrongRequested = await requestCode(EMAILS.incorrect, "127.0.0.15");
    assert.ok(wrongRequested.body.attemptId);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const wrong = await verifyCode(wrongRequested.body.attemptId, "999999", `127.0.0.${15 + attempt}`);
      assert.equal(wrong.response.status, 400);
      assert.equal(wrong.body.attemptsRemaining, 5 - attempt);
    }
    const invalidated = await prisma.registrationAttempt.findUniqueOrThrow({ where: { id: wrongRequested.body.attemptId } });
    assert.equal(invalidated.failedAttempts, 5);
    assert.ok(invalidated.consumedAt);
    assert.equal((await verifyCode(invalidated.id, await latestCode(EMAILS.incorrect), "127.0.0.21")).response.status, 400);
    passed.push("incorrect code and fifth failure invalidate the attempt");

    const expiredRequested = await requestCode(EMAILS.expired, "127.0.0.22");
    assert.ok(expiredRequested.body.attemptId);
    const expiredCode = await latestCode(EMAILS.expired);
    await prisma.registrationAttempt.update({ where: { id: expiredRequested.body.attemptId }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    assert.equal((await verifyCode(expiredRequested.body.attemptId, expiredCode, "127.0.0.22")).response.status, 400);
    passed.push("expired code rejected");

    const used = await requestCode(EMAILS.used, "127.0.0.23");
    assert.ok(used.body.attemptId);
    const usedCode = await latestCode(EMAILS.used);
    const usedVerification = await verifyCode(used.body.attemptId, usedCode, "127.0.0.23");
    assert.equal(usedVerification.response.status, 200);
    assert.equal((await verifyCode(used.body.attemptId, usedCode, "127.0.0.23")).response.status, 400);
    passed.push("used code cannot be verified twice");

    const resendFirst = await requestCode(EMAILS.resend, "127.0.0.24");
    assert.ok(resendFirst.body.attemptId);
    const firstCode = await latestCode(EMAILS.resend);
    const resendSecond = await requestCode(EMAILS.resend, "127.0.0.24");
    assert.ok(resendSecond.body.attemptId);
    assert.notEqual(resendSecond.body.attemptId, resendFirst.body.attemptId);
    const secondCode = await latestCode(EMAILS.resend);
    assert.equal((await verifyCode(resendFirst.body.attemptId, firstCode, "127.0.0.24")).response.status, 400);
    assert.equal((await verifyCode(resendSecond.body.attemptId, secondCode, "127.0.0.24")).response.status, 200);
    const resentAttempt = await prisma.registrationAttempt.findUniqueOrThrow({ where: { id: resendSecond.body.attemptId } });
    assert.equal(resentAttempt.resendCount, 1);
    passed.push("resend rotates the code and invalidates the former attempt");

    for (let index = 1; index <= 5; index += 1) {
      const limited = await requestCode(EMAILS.limited, `127.0.1.${index}`);
      assert.equal(limited.response.status, index <= 4 ? 200 : 429);
    }
    assert.ok(await prisma.rateLimit.count() > 0);
    passed.push("PostgreSQL email and IP rate limiting enforced");

    const reusableHash = credential.password;
    const proofReuse = await complete(`${password}-different`, verified.proofCookie, "127.0.0.25");
    assert.equal(proofReuse.response.status, 200);
    assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: credential.id } })).password, reusableHash);
    assert.equal(await prisma.user.count({ where: { email: EMAILS.valid } }), 1);
    passed.push("proof reuse is idempotent and never changes the existing credential");

    const doubleRequested = await requestCode(EMAILS.double, "127.0.0.26");
    assert.ok(doubleRequested.body.attemptId);
    const doubleVerified = await verifyCode(doubleRequested.body.attemptId, await latestCode(EMAILS.double), "127.0.0.26");
    assert.ok(doubleVerified.proofCookie);
    const [doubleA, doubleB] = await Promise.all([
      complete(password, doubleVerified.proofCookie, "127.0.0.26"),
      complete(password, doubleVerified.proofCookie, "127.0.0.26"),
    ]);
    assert.equal(doubleA.response.status, 200);
    assert.equal(doubleB.response.status, 200);
    assert.equal(await prisma.user.count({ where: { email: EMAILS.double } }), 1);
    assert.equal(await prisma.account.count({ where: { user: { email: EMAILS.double } } }), 1);
    passed.push("concurrent double completion creates one account and one credential");

    await createInternalAuthUser({ email: EMAILS.existing, password, displayName: "Existing", role: "MEMBER" });
    const newPublic = await requestCode("lnx-v062-anti-enum@example.invalid", "127.0.0.27");
    const existingPublic = await requestCode(EMAILS.existing, "127.0.0.28");
    assert.equal(newPublic.response.status, existingPublic.response.status);
    assert.equal(newPublic.body.message, existingPublic.body.message);
    assert.deepEqual(Object.keys(newPublic.body).sort(), Object.keys(existingPublic.body).sort());
    assert.ok(existingPublic.body.attemptId);
    const existingVerified = await verifyCode(existingPublic.body.attemptId, await latestCode(EMAILS.existing), "127.0.0.28");
    assert.equal(existingVerified.response.status, 200);
    assert.equal(existingVerified.body.next, "login");
    assert.equal(existingVerified.proofCookie, undefined);
    assert.equal(await prisma.user.count({ where: { email: EMAILS.existing } }), 1);
    passed.push("existing and absent emails share the public response; existing is revealed only after mailbox proof");

    const adminRequested = await requestCode(ADMIN_EMAIL, "127.0.0.29");
    assert.ok(adminRequested.body.attemptId);
    const adminVerified = await verifyCode(adminRequested.body.attemptId, await latestCode(ADMIN_EMAIL), "127.0.0.29");
    assert.ok(adminVerified.proofCookie);
    assert.equal((await complete(password, adminVerified.proofCookie, "127.0.0.29")).response.status, 200);
    const adminBefore = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    assert.equal(adminBefore.role, "MEMBER");
    const promoted = await promoteConfiguredAdmin("promote-verified-admin");
    assert.equal(promoted.changed, true);
    assert.equal((await promoteConfiguredAdmin("promote-verified-admin")).changed, false);
    const adminAfter = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    assert.equal(adminAfter.role, "ADMIN");
    assert.equal(canAccessAdmin(adminAfter.role), true);

    await createInternalAuthUser({ email: EMAILS.fakeAdmin, password, displayName: "Fake admin email", role: "MEMBER" });
    const fakeAdmin = await prisma.user.findUniqueOrThrow({ where: { email: EMAILS.fakeAdmin } });
    assert.equal(canAccessAdmin(fakeAdmin.role), false);
    const adminLogin = await login(ADMIN_EMAIL, password, "127.0.0.30");
    assert.ok(adminLogin.sessionCookie);
    const profileInjection = await authPost("/api/auth/update-user", { name: "Admin", role: "MEMBER" }, "127.0.0.30", adminLogin.sessionCookie);
    assert.equal(profileInjection.status, 400);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).role, "ADMIN");
    const logout = await authPost("/api/auth/sign-out", {}, "127.0.0.30", adminLogin.sessionCookie);
    assert.equal(logout.status, 200);
    assert.equal(await readSession(adminLogin.sessionCookie, "127.0.0.30"), null);
    passed.push("verified admin bootstrap is DB-role-only, idempotent, injection-safe and logout revokes the session");
  } finally {
    await cleanup();
    await assertClean("cleanup");
  }

  for (const result of passed) console.info(`PASS ${result}`);
  console.info(`Registration runtime QA passed (${passed.length} controls); dedicated database and mailbox cleanup verified.`);
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : "Registration runtime QA failed.");
    process.exitCode = 1;
  });
