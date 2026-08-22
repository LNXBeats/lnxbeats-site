import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export const AUTH_QA_ACCESS_CONFIRMATION = "I_UNDERSTAND_THIS_ENABLES_STAGING_QA_LOGIN" as const;
export const AUTH_QA_ACCESS_SECRET_HEADER = "x-lnx-qa-access-secret" as const;
export const AUTH_QA_ACCESS_ROUTE = "/api/internal/qa/auth/login" as const;
export const AUTH_QA_ACCESS_STAGING_ORIGIN = "https://lnxbeats-site-staging.up.railway.app" as const;

export const QA_ACCESS_PROFILES = {
  member: {
    key: "member",
    userId: "74000000-0000-4700-8700-000000000001",
    accountId: "74000000-0000-4700-8700-000000000002",
    email: "qa.member@lnx.invalid",
    displayName: "QA Member — Staging",
    role: "MEMBER",
    redirectTo: "/compte",
  },
  admin: {
    key: "admin",
    userId: "74000000-0000-4700-8700-000000000003",
    accountId: "74000000-0000-4700-8700-000000000004",
    email: "qa.admin@lnx.invalid",
    displayName: "QA Admin — Staging",
    role: "ADMIN",
    redirectTo: "/admin",
  },
} as const;

export type QaAccessProfile = keyof typeof QA_ACCESS_PROFILES;

export type QaAccessConfiguration = Readonly<{
  baseUrl: string;
  secret: string;
}>;

export class QaAccessUnavailableError extends Error {
  constructor() {
    super("QA access is unavailable.");
    this.name = "QaAccessUnavailableError";
  }
}

export class QaAccessCollisionError extends Error {
  constructor() {
    super("A QA identity collision requires review.");
    this.name = "QaAccessCollisionError";
  }
}

export class QaAccessRateLimitError extends Error {
  constructor() {
    super("Too many QA access attempts.");
    this.name = "QaAccessRateLimitError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function canonicalStagingOrigin(environment: Environment) {
  const raw = environment.AUTH_URL ?? environment.SITE_URL;
  if (!raw) throw new QaAccessUnavailableError();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QaAccessUnavailableError();
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) throw new QaAccessUnavailableError();
  for (const candidate of [environment.AUTH_URL, environment.SITE_URL, environment.APP_CANONICAL_URL]) {
    if (!candidate) continue;
    try {
      const candidateUrl = new URL(candidate);
      if (
        candidateUrl.origin !== url.origin
        || candidateUrl.protocol !== "https:"
        || candidateUrl.username
        || candidateUrl.password
        || candidateUrl.pathname !== "/"
        || candidateUrl.search
        || candidateUrl.hash
      ) throw new QaAccessUnavailableError();
    } catch {
      throw new QaAccessUnavailableError();
    }
  }
  return url.origin;
}

export function parseQaAccessConfiguration(
  environment: Environment = process.env,
): QaAccessConfiguration {
  if (
    environment.AUTH_QA_ACCESS_ENABLED !== "true"
    || environment.AUTH_QA_ACCESS_CONFIRM !== AUTH_QA_ACCESS_CONFIRMATION
    || environment.NODE_ENV !== "production"
    || environment.RAILWAY_ENVIRONMENT_NAME !== "staging"
    || /production/i.test(environment.RAILWAY_ENVIRONMENT ?? "")
    || environment.NOTIFICATION_DEPLOYMENT_ENV !== "staging"
    || environment.PAYMENT_DEPLOYMENT_ENV !== "staging"
    || environment.MEDIA_DEPLOYMENT_ENV !== "staging"
  ) throw new QaAccessUnavailableError();

  const secret = environment.AUTH_QA_ACCESS_SECRET;
  if (
    !secret
    || secret.length < 32
    || secret.length > 1_024
    || /[\r\n]/.test(secret)
  ) throw new QaAccessUnavailableError();

  const baseUrl = canonicalStagingOrigin(environment);
  if (baseUrl !== AUTH_QA_ACCESS_STAGING_ORIGIN) throw new QaAccessUnavailableError();
  return { baseUrl, secret };
}

export function qaAccessAvailable(environment: Environment = process.env) {
  try {
    parseQaAccessConfiguration(environment);
    return true;
  } catch {
    return false;
  }
}

export function qaAccessIdentityAllowed(
  userId: string,
  environment: Environment = process.env,
) {
  const qaIdentity = Object.values(QA_ACCESS_PROFILES).some((profile) => profile.userId === userId);
  return !qaIdentity || qaAccessAvailable(environment);
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function qaAccessSecretMatches(candidate: string, expected: string) {
  return timingSafeEqual(digest(candidate), digest(expected));
}

export function parseQaAccessPayload(value: unknown): QaAccessProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("profile" in record)) return null;
  return record.profile === "member" || record.profile === "admin"
    ? record.profile
    : null;
}

export function deriveQaCredential(secret: string, profile: QaAccessProfile) {
  const definition = QA_ACCESS_PROFILES[profile];
  return `qa_${createHmac("sha256", secret)
    .update(`lnx-studio:staging-qa:${definition.userId}`, "utf8")
    .digest("base64url")}`;
}

type QaUserSnapshot = Readonly<{
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  accounts: readonly Readonly<{
    id: string;
    userId: string;
    accountId: string;
    providerId: string;
    password: string | null;
  }>[];
}>;

type QaAccountTransaction = Pick<Prisma.TransactionClient, "user" | "account">;

function matchingSnapshots(users: readonly QaUserSnapshot[], profile: QaAccessProfile) {
  const definition = QA_ACCESS_PROFILES[profile];
  return users.filter((user) => user.id === definition.userId || user.email === definition.email);
}

export function assertQaIdentitySnapshot(snapshot: QaUserSnapshot, profile: QaAccessProfile) {
  const definition = QA_ACCESS_PROFILES[profile];
  const credential = snapshot.accounts[0];
  if (
    snapshot.id !== definition.userId
    || snapshot.email !== definition.email
    || snapshot.displayName !== definition.displayName
    || snapshot.role !== definition.role
    || snapshot.status !== "ACTIVE"
    || snapshot.emailVerified !== true
    || snapshot.emailVerifiedAt === null
    || snapshot.accounts.length !== 1
    || !credential
    || credential.id !== definition.accountId
    || credential.userId !== definition.userId
    || credential.accountId !== definition.userId
    || credential.providerId !== "credential"
    || !credential.password
  ) throw new QaAccessCollisionError();
}

export async function ensureQaProfilesInTransaction(
  transaction: QaAccountTransaction,
  passwordHashes: Readonly<Record<QaAccessProfile, string>>,
) {
  const definitions = Object.values(QA_ACCESS_PROFILES);
  const users = await transaction.user.findMany({
    where: {
      OR: [
        { id: { in: definitions.map(({ userId }) => userId) } },
        { email: { in: definitions.map(({ email }) => email) } },
      ],
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      emailVerified: true,
      emailVerifiedAt: true,
      accounts: {
        select: {
          id: true,
          userId: true,
          accountId: true,
          providerId: true,
          password: true,
        },
      },
    },
  });

  for (const profile of ["member", "admin"] as const) {
    const definition = QA_ACCESS_PROFILES[profile];
    const matches = matchingSnapshots(users, profile);
    if (matches.length > 1) throw new QaAccessCollisionError();
    const existing = matches[0];
    if (existing) {
      assertQaIdentitySnapshot(existing, profile);
      await transaction.account.update({
        where: { id: definition.accountId },
        data: { password: passwordHashes[profile] },
        select: { id: true },
      });
      continue;
    }
    await transaction.user.create({
      data: {
        id: definition.userId,
        email: definition.email,
        displayName: definition.displayName,
        role: definition.role,
        status: "ACTIVE",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        accounts: {
          create: {
            id: definition.accountId,
            accountId: definition.userId,
            providerId: "credential",
            password: passwordHashes[profile],
          },
        },
      },
      select: { id: true },
    });
  }

  return {
    member: QA_ACCESS_PROFILES.member.userId,
    admin: QA_ACCESS_PROFILES.admin.userId,
  } as const;
}

export async function ensureQaAccessProfiles(secret: string) {
  assertDatabaseConfigured();
  const [memberHash, adminHash] = await Promise.all([
    hashPassword(deriveQaCredential(secret, "member")),
    hashPassword(deriveQaCredential(secret, "admin")),
  ]);
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('auth:qa-access:profiles')) IS NULL AS locked`;
    return ensureQaProfilesInTransaction(transaction, { member: memberHash, admin: adminHash });
  }, { isolationLevel: "ReadCommitted" });
}

const QA_ACCESS_RATE_LIMIT_KEY = "auth:qa-access:staging";
const QA_ACCESS_RATE_LIMIT_MAX = 10;
const QA_ACCESS_RATE_LIMIT_WINDOW_MS = 10 * 60_000;

export function qaAccessRateLimitPlan(
  current: Readonly<{ count: number; lastRequest: bigint }> | null,
  now: bigint,
) {
  if (!current) return "CREATE" as const;
  if (now - current.lastRequest >= BigInt(QA_ACCESS_RATE_LIMIT_WINDOW_MS)) return "RESET" as const;
  if (current.count >= QA_ACCESS_RATE_LIMIT_MAX) return "REJECT" as const;
  return "INCREMENT" as const;
}

export async function enforceQaAccessRateLimit() {
  assertDatabaseConfigured();
  const now = BigInt(Date.now());
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${QA_ACCESS_RATE_LIMIT_KEY})) IS NULL AS locked`;
    const current = await transaction.rateLimit.findUnique({ where: { key: QA_ACCESS_RATE_LIMIT_KEY } });
    const plan = qaAccessRateLimitPlan(current, now);
    if (plan === "CREATE") {
      await transaction.rateLimit.create({ data: { key: QA_ACCESS_RATE_LIMIT_KEY, count: 1, lastRequest: now } });
      return;
    }
    if (plan === "RESET") {
      await transaction.rateLimit.update({ where: { key: QA_ACCESS_RATE_LIMIT_KEY }, data: { count: 1, lastRequest: now } });
      return;
    }
    if (plan === "REJECT") throw new QaAccessRateLimitError();
    await transaction.rateLimit.update({
      where: { key: QA_ACCESS_RATE_LIMIT_KEY },
      data: { count: { increment: 1 }, lastRequest: now },
    });
  }, { isolationLevel: "ReadCommitted" });
}
