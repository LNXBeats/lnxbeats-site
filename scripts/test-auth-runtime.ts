import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";

import { createEmailVerificationToken } from "better-auth/api";

import { consumeEmailVerification } from "@/lib/auth/email-verification-consume";
import { handleAuthRequest } from "@/lib/auth/handler";
import { hashOpaqueToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/prisma";

const EXPECTED_TARGET = "lnx-studio-v052-test";
const EXPECTED_CAPTURE_PATH = "/private/tmp/lnx-studio-v052-mailbox.jsonl";
const EXPECTED_SERVER_FILE = "/Users/lnxbeats/Library/Application Support/prisma-dev-nodejs/lnx-studio-v052-test/server.json";
const QA_EMAILS = {
  member: "lnx-v052-member@example.invalid",
  pending: "lnx-v052-pending@example.invalid",
  missing: "lnx-v052-missing@example.invalid",
} as const;

type CapturedEmail = {
  kind: "verification" | "password-reset";
  to: string;
  subject: string;
  text: string;
};

type LoginResult = {
  response: Response;
  body: Record<string, unknown>;
  cookie?: string;
};

async function validateSafetyGuards() {
  assert.equal(process.env.NODE_ENV, "test", "NODE_ENV must be test.");
  assert.equal(process.env.LNX_DATABASE_TARGET, EXPECTED_TARGET, `LNX_DATABASE_TARGET must be ${EXPECTED_TARGET}.`);
  assert.equal(process.env.AUTH_EMAIL_TRANSPORT, "capture", "Only the local capture transport is accepted.");
  assert.equal(process.env.AUTH_EMAIL_CAPTURE_PATH, EXPECTED_CAPTURE_PATH, "The QA mailbox path is not approved.");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required.");
  assert.equal(process.env.LNX_PRISMA_DEV_SERVER_FILE, EXPECTED_SERVER_FILE, "The Prisma Dev proof path is not approved.");
  assert.ok(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32, "A disposable AUTH_SECRET is required.");
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12, "A disposable QA password is required.");

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
  assert.ok(proof.pid && proof.pid > 0, "The Prisma Dev proof does not identify a running process.");
  assert.equal(proof.exports?.database?.connectionString, process.env.DATABASE_URL);

  const authUrl = new URL(process.env.AUTH_URL ?? "");
  assert.equal(authUrl.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(authUrl.hostname));
}

function authRequest(path: string, init: RequestInit = {}, ip = "127.0.0.10", origin?: string) {
  const authUrl = process.env.AUTH_URL;
  assert.ok(authUrl);
  const headers = new Headers(init.headers);
  headers.set("origin", origin ?? authUrl);
  headers.set("user-agent", "LNX Studio V0.5.2 runtime QA");
  headers.set("x-forwarded-for", ip);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`${authUrl}${path}`, { ...init, headers });
}

async function post(path: string, body: Record<string, unknown>, ip: string, cookie?: string, origin?: string) {
  return handleAuthRequest(authRequest(path, {
    method: "POST",
    body: JSON.stringify(body),
    ...(cookie ? { headers: { cookie } } : {}),
  }, ip, origin));
}

async function responseJson(response: Response) {
  return response.clone().json() as Promise<Record<string, unknown>>;
}

function sessionCookie(response: Response) {
  const cookieHeaders = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? [response.headers.get("set-cookie") ?? ""];
  const rawCookie = cookieHeaders.find((value) => value.startsWith("lnx-studio.session_token="));
  if (!rawCookie) return undefined;
  assert.match(rawCookie, /;\s*HttpOnly/i);
  assert.match(rawCookie, /;\s*SameSite=Lax/i);
  assert.match(rawCookie, /;\s*Path=\//i);
  assert.doesNotMatch(rawCookie, /;\s*Secure/i);
  return rawCookie.split(";", 1)[0];
}

async function login(email: string, password: string, ip: string): Promise<LoginResult> {
  const response = await post("/api/auth/sign-in/email", { email, password, rememberMe: true }, ip);
  return {
    response,
    body: await responseJson(response),
    cookie: response.ok ? sessionCookie(response) : undefined,
  };
}

async function readSession(cookie: string, ip: string) {
  const response = await handleAuthRequest(authRequest("/api/auth/get-session", { method: "GET", headers: { cookie } }, ip));
  assert.equal(response.status, 200);
  return response.json() as Promise<Record<string, unknown> | null>;
}

async function clearMailbox() {
  await unlink(EXPECTED_CAPTURE_PATH).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function mailbox() {
  const content = await readFile(EXPECTED_CAPTURE_PATH, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as CapturedEmail);
}

function latestEmail(messages: CapturedEmail[], kind: CapturedEmail["kind"], to: string) {
  const message = [...messages].reverse().find((candidate) => candidate.kind === kind && candidate.to === to);
  assert.ok(message, `A captured ${kind} email is required.`);
  assert.match(message.to, /@example\.invalid$/);
  const link = message.text.match(/https?:\/\/[^\s]+/)?.[0];
  assert.ok(link, "The captured email must contain a local action link.");
  return new URL(link);
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.rateLimit.deleteMany();
    await transaction.verification.deleteMany();
    await transaction.session.deleteMany();
    await transaction.account.deleteMany();
    await transaction.user.deleteMany({ where: { email: { endsWith: "@example.invalid" } } });
  });
  await clearMailbox();
}

async function assertAuthStateEmpty(stage: string) {
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.account.count(),
    prisma.session.count(),
    prisma.verification.count(),
    prisma.rateLimit.count(),
  ]);
  assert.ok(counts.every((count) => count === 0), `${stage}: authentication QA rows remain.`);
  assert.equal((await mailbox()).length, 0, `${stage}: captured QA emails remain.`);
}

async function run() {
  await validateSafetyGuards();
  const password = process.env.LNX_AUTH_QA_PASSWORD;
  assert.ok(password);
  const changedPassword = `${password}-changed`;
  const resetPassword = `${password}-reset`;
  const passed: string[] = [];

  await clearMailbox();
  await assertAuthStateEmpty("precondition");

  try {
    const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`,
    );
    assert.equal(tables.length, 18);
    assert.ok(tables.some(({ tablename }) => tablename === "commercial_licenses"));
    passed.push("physical authentication schema inspected");

    const crossOriginSignup = await post("/api/auth/sign-up/email", {
      email: QA_EMAILS.member,
      password,
      name: "LNX V0.5.2 Member",
      callbackURL: "/verifier-email",
    }, "127.0.0.11", undefined, "https://untrusted.example.invalid");
    assert.equal(crossOriginSignup.status, 403);

    const injectedSignup = await post("/api/auth/sign-up/email", {
      email: QA_EMAILS.member,
      password,
      name: "LNX V0.5.2 Member",
      callbackURL: "/verifier-email",
      role: "ADMIN",
      status: "ACTIVE",
    }, "127.0.0.12");
    assert.equal(injectedSignup.status, 400);

    const weakSignup = await post("/api/auth/sign-up/email", {
      email: QA_EMAILS.member,
      password: "too-short",
      name: "LNX V0.5.2 Member",
      callbackURL: "/verifier-email",
    }, "127.0.0.13");
    assert.equal(weakSignup.status, 400);
    assert.equal(await prisma.user.count(), 0);
    passed.push("cross-origin, role injection and weak registration rejected");

    const signup = await post("/api/auth/sign-up/email", {
      email: QA_EMAILS.member.toUpperCase(),
      password,
      name: "LNX V0.5.2 Member",
      callbackURL: "/verifier-email",
    }, "127.0.0.14");
    assert.equal(signup.status, 200);
    const signupBody = await responseJson(signup);

    const duplicate = await post("/api/auth/sign-up/email", {
      email: QA_EMAILS.member,
      password,
      name: "LNX V0.5.2 Member",
      callbackURL: "/verifier-email",
    }, "127.0.0.15");
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await responseJson(duplicate), signupBody);

    const member = await prisma.user.findUniqueOrThrow({ where: { email: QA_EMAILS.member } });
    assert.equal(member.role, "MEMBER");
    assert.equal(member.status, "PENDING");
    assert.equal(member.emailVerified, false);
    assert.equal(await prisma.user.count({ where: { email: QA_EMAILS.member } }), 1);
    const account = await prisma.account.findFirstOrThrow({ where: { userId: member.id } });
    assert.ok(account.password?.startsWith("$argon2id$v=19$m=65536,t=3,p=1$"));
    assert.notEqual(account.password, password);

    const verificationLink = latestEmail(await mailbox(), "verification", QA_EMAILS.member);
    const verificationToken = new URLSearchParams(verificationLink.hash.slice(1)).get("token");
    assert.ok(verificationToken);
    assert.equal(await prisma.verification.count(), 0, "Signed verification tokens must not be stored before use.");
    passed.push("MEMBER registration normalized, anti-enumerated and captured locally");

    const pendingLogin = await login(QA_EMAILS.member, password, "127.0.0.16");
    assert.equal(pendingLogin.response.status, 401);
    assert.equal(await prisma.session.count(), 0);

    assert.equal(await consumeEmailVerification(verificationToken), true);
    const consumedVerification = await prisma.verification.findUnique({
      where: { identifier: `lnx-email-used:${hashOpaqueToken(verificationToken)}` },
    });
    assert.ok(consumedVerification);
    assert.equal(consumedVerification.identifier.includes(verificationToken), false);
    assert.equal(await consumeEmailVerification(verificationToken), false);
    const verifiedMember = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    assert.equal(verifiedMember.emailVerified, true);
    assert.ok(verifiedMember.emailVerifiedAt);
    assert.equal(verifiedMember.status, "ACTIVE");
    passed.push("signed verification token expires safely and leaves a hashed one-time marker");

    await post("/api/auth/sign-up/email", {
      email: QA_EMAILS.pending,
      password,
      name: "LNX Pending QA",
      callbackURL: "/verifier-email",
    }, "127.0.0.17");
    const pendingUser = await prisma.user.findUniqueOrThrow({ where: { email: QA_EMAILS.pending } });
    const pendingLink = latestEmail(await mailbox(), "verification", QA_EMAILS.pending);
    const pendingToken = new URLSearchParams(pendingLink.hash.slice(1)).get("token");
    assert.ok(pendingToken);
    const publicNativeVerification = await handleAuthRequest(authRequest(
      `/api/auth/verify-email?token=${encodeURIComponent(pendingToken)}`,
      { method: "GET" },
      "127.0.0.17",
    ));
    assert.equal(publicNativeVerification.status, 404);
    assert.ok(process.env.AUTH_SECRET);
    const expiredVerificationToken = await createEmailVerificationToken(
      process.env.AUTH_SECRET,
      QA_EMAILS.pending,
      undefined,
      -1,
    );
    assert.equal(await consumeEmailVerification(expiredVerificationToken), false);
    assert.equal(await consumeEmailVerification("invalid-verification-token"), false);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: pendingUser.id } })).emailVerified, false);

    const resendExisting = await post("/api/auth/send-verification-email", {
      email: QA_EMAILS.pending,
      callbackURL: "/verifier-email",
    }, "127.0.0.18");
    const resendMissing = await post("/api/auth/send-verification-email", {
      email: QA_EMAILS.missing,
      callbackURL: "/verifier-email",
    }, "127.0.0.19");
    assert.equal(resendExisting.status, 200);
    assert.equal(resendMissing.status, 200);
    assert.deepEqual(await responseJson(resendExisting), await responseJson(resendMissing));

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await post("/api/auth/send-verification-email", {
        email: QA_EMAILS.pending,
        callbackURL: "/verifier-email",
      }, "127.0.0.20");
      assert.equal(response.status, attempt <= 3 ? 200 : 429);
    }
    const latestPendingLink = latestEmail(await mailbox(), "verification", QA_EMAILS.pending);
    const latestPendingToken = new URLSearchParams(latestPendingLink.hash.slice(1)).get("token");
    assert.ok(latestPendingToken);
    assert.equal(await consumeEmailVerification(latestPendingToken), true);
    passed.push("verification resend is generic and database-rate-limited");

    const firstLogin = await login(QA_EMAILS.member, password, "127.0.0.21");
    assert.equal(firstLogin.response.status, 200);
    assert.ok(firstLogin.cookie);
    const secondLogin = await login(QA_EMAILS.member, password, "127.0.0.22");
    assert.equal(secondLogin.response.status, 200);
    assert.ok(secondLogin.cookie);

    const profileUpdate = await post("/api/auth/update-user", { name: "Nom membre vérifié" }, "127.0.0.21", firstLogin.cookie);
    assert.equal(profileUpdate.status, 200);
    const profileInjection = await post("/api/auth/update-user", { name: "Intrus", role: "ADMIN", status: "ACTIVE" }, "127.0.0.21", firstLogin.cookie);
    assert.equal(profileInjection.status, 400);
    const crossOriginProfile = await post("/api/auth/update-user", { name: "Intrus" }, "127.0.0.21", firstLogin.cookie, "https://untrusted.example.invalid");
    assert.equal(crossOriginProfile.status, 403);
    const updatedProfile = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    assert.equal(updatedProfile.displayName, "Nom membre vérifié");
    assert.equal(updatedProfile.role, "MEMBER");
    assert.equal(updatedProfile.status, "ACTIVE");
    passed.push("profile update is session-bound and cannot alter role or status");

    const changePassword = await post("/api/auth/change-password", {
      currentPassword: password,
      newPassword: changedPassword,
      revokeOtherSessions: true,
    }, "127.0.0.21", firstLogin.cookie);
    assert.equal(changePassword.status, 200);
    const rotatedPasswordSession = sessionCookie(changePassword);
    assert.ok(rotatedPasswordSession);
    assert.ok(await readSession(rotatedPasswordSession, "127.0.0.21"));
    assert.equal(await readSession(firstLogin.cookie, "127.0.0.21"), null);
    assert.equal(await readSession(secondLogin.cookie, "127.0.0.22"), null);
    passed.push("connected password change rotates the current session and revokes every prior session");

    const thirdLogin = await login(QA_EMAILS.member, changedPassword, "127.0.0.23");
    const fourthLogin = await login(QA_EMAILS.member, changedPassword, "127.0.0.24");
    assert.ok(thirdLogin.cookie);
    assert.ok(fourthLogin.cookie);
    await clearMailbox();

    const forgotExisting = await post("/api/auth/request-password-reset", {
      email: QA_EMAILS.member,
      redirectTo: "/reinitialiser-mot-de-passe",
    }, "127.0.0.25");
    const forgotMissing = await post("/api/auth/request-password-reset", {
      email: QA_EMAILS.missing,
      redirectTo: "/reinitialiser-mot-de-passe",
    }, "127.0.0.26");
    assert.equal(forgotExisting.status, 200);
    assert.equal(forgotMissing.status, 200);
    assert.deepEqual(await responseJson(forgotExisting), await responseJson(forgotMissing));

    const resetLink = latestEmail(await mailbox(), "password-reset", QA_EMAILS.member);
    const resetToken = new URLSearchParams(resetLink.hash.slice(1)).get("token");
    assert.ok(resetToken);
    const resetIdentifier = hashOpaqueToken(`reset-password:${resetToken}`);
    const resetRow = await prisma.verification.findFirstOrThrow({ where: { identifier: resetIdentifier } });
    assert.equal(resetRow.identifier.includes(resetToken), false);

    const crossOriginReset = await post("/api/auth/reset-password", { newPassword: resetPassword, token: resetToken }, "127.0.0.27", undefined, "https://untrusted.example.invalid");
    assert.equal(crossOriginReset.status, 403);
    const weakReset = await post("/api/auth/reset-password", { newPassword: "too-short", token: resetToken }, "127.0.0.27");
    assert.equal(weakReset.status, 400);
    assert.ok(await prisma.verification.findFirst({ where: { identifier: resetIdentifier } }));

    const validReset = await post("/api/auth/reset-password", { newPassword: resetPassword, token: resetToken }, "127.0.0.27");
    assert.equal(validReset.status, 200);
    const reusedReset = await post("/api/auth/reset-password", { newPassword: `${resetPassword}-again`, token: resetToken }, "127.0.0.28");
    assert.equal(reusedReset.status, 400);
    assert.equal(await prisma.session.count({ where: { userId: member.id } }), 0);
    assert.equal(await readSession(firstLogin.cookie, "127.0.0.21"), null);
    assert.equal(await readSession(thirdLogin.cookie, "127.0.0.23"), null);
    assert.equal(await readSession(fourthLogin.cookie, "127.0.0.24"), null);
    assert.equal((await login(QA_EMAILS.member, changedPassword, "127.0.0.29")).response.status, 401);
    const loginAfterReset = await login(QA_EMAILS.member, resetPassword, "127.0.0.30");
    assert.equal(loginAfterReset.response.status, 200);
    assert.ok(loginAfterReset.cookie);
    passed.push("password reset is hashed, single-use and revokes all prior sessions");

    await clearMailbox();
    await post("/api/auth/request-password-reset", {
      email: QA_EMAILS.member,
      redirectTo: "/reinitialiser-mot-de-passe",
    }, "127.0.0.31");
    const expiredResetLink = latestEmail(await mailbox(), "password-reset", QA_EMAILS.member);
    const expiredResetToken = new URLSearchParams(expiredResetLink.hash.slice(1)).get("token");
    assert.ok(expiredResetToken);
    const expiredIdentifier = hashOpaqueToken(`reset-password:${expiredResetToken}`);
    await prisma.verification.updateMany({ where: { identifier: expiredIdentifier }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const expiredReset = await post("/api/auth/reset-password", { newPassword: `${resetPassword}-expired`, token: expiredResetToken }, "127.0.0.32");
    assert.equal(expiredReset.status, 400);
    const invalidReset = await post("/api/auth/reset-password", { newPassword: `${resetPassword}-invalid`, token: "invalid-token-value-that-is-long-enough" }, "127.0.0.33");
    assert.equal(invalidReset.status, 400);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await post("/api/auth/request-password-reset", {
        email: QA_EMAILS.member,
        redirectTo: "/reinitialiser-mot-de-passe",
      }, "127.0.0.34");
      assert.equal(response.status, attempt <= 3 ? 200 : 429);
    }
    assert.ok(await prisma.rateLimit.count() > 0);
    passed.push("forgot/reset responses are generic, expiry-safe and rate-limited");
  } finally {
    await cleanup();
    await assertAuthStateEmpty("cleanup");
  }

  for (const result of passed) console.info(`PASS ${result}`);
  console.info(`Authentication V0.5.2 runtime QA passed (${passed.length} controls); database and mailbox cleanup verified.`);
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Authentication V0.5.2 runtime QA failed.");
    process.exitCode = 1;
  });
