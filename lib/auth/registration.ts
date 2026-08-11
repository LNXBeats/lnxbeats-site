import "server-only";

import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { sendRegistrationCodeEmail } from "@/lib/auth/email-delivery";
import { isPersistentLocalPreview } from "@/lib/auth/environment";
import { hashPassword } from "@/lib/auth/password";
import { createOpaqueToken, hashOpaqueToken, isOpaqueToken } from "@/lib/auth/tokens";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export const REGISTRATION_CODE_TTL_MS = 10 * 60_000;
export const REGISTRATION_PROOF_TTL_MS = 10 * 60_000;
export const REGISTRATION_MAX_FAILED_ATTEMPTS = 5;

const GENERIC_CODE_MESSAGE = "Si cette adresse peut être utilisée, un code de vérification a été préparé.";
const PROOF_COOKIE_NAME = "lnx-registration-proof";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Transaction = Prisma.TransactionClient;

export class RegistrationServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "RegistrationServiceError";
  }
}

function registrationSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new RegistrationServiceError("L’inscription est temporairement indisponible.", 503, "AUTH_UNAVAILABLE");
  return secret;
}

function keyedDigest(scope: string, value: string) {
  return createHmac("sha256", registrationSecret()).update(`${scope}\0${value}`, "utf8").digest("base64url");
}

function codeDigest(attemptId: string, email: string, code: string) {
  return keyedDigest("registration-code", `${attemptId}\0${email}\0${code}`);
}

function equalDigest(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function withRegistrationLock<T>(key: string, operation: (transaction: Transaction) => Promise<T>) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
    return operation(transaction);
  });
}

async function consumeRateLimit(scope: string, identifier: string, windowMs: number, max: number) {
  const key = `registration:${scope}:${keyedDigest("registration-rate-limit", identifier)}`;
  const now = BigInt(Date.now());
  return withRegistrationLock(key, async (transaction) => {
    const current = await transaction.rateLimit.findUnique({ where: { key } });
    if (!current) {
      await transaction.rateLimit.create({ data: { key, count: 1, lastRequest: now } });
      return true;
    }
    if (now - current.lastRequest >= BigInt(windowMs)) {
      await transaction.rateLimit.update({ where: { key }, data: { count: 1, lastRequest: now } });
      return true;
    }
    if (current.count >= max) return false;
    await transaction.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return true;
  });
}

async function enforceLimits(entries: Array<[scope: string, identifier: string, windowMs: number, max: number]>) {
  for (const entry of entries) {
    if (!await consumeRateLimit(...entry)) {
      throw new RegistrationServiceError("Trop de demandes ont été reçues. Réessayez plus tard.", 429, "RATE_LIMITED");
    }
  }
}

function sixDigitCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
}

export function registrationClientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return candidate.replace(/[^0-9a-f:.]/gi, "").slice(0, 64) || "unknown";
}

export async function requestRegistrationCode(email: string, clientAddress: string) {
  assertDatabaseConfigured();
  await enforceLimits([
    ["code-email", email, 60 * 60_000, 4],
    ["code-ip", clientAddress, 60 * 60_000, 20],
  ]);

  const attemptId = randomUUID();
  const code = sixDigitCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REGISTRATION_CODE_TTL_MS);
  const emailLock = `registration-email:${keyedDigest("registration-email-lock", email)}`;

  const attempt = await withRegistrationLock(emailLock, async (transaction) => {
    const previous = await transaction.registrationAttempt.findFirst({
      where: { email },
      orderBy: { createdAt: "desc" },
      select: { resendCount: true, createdAt: true },
    });
    await transaction.registrationAttempt.updateMany({
      where: { email, consumedAt: null },
      data: { consumedAt: now, continuationHash: null, continuationExpiresAt: null },
    });
    const resendCount = previous && now.getTime() - previous.createdAt.getTime() < 60 * 60_000
      ? previous.resendCount + 1
      : 0;
    return transaction.registrationAttempt.create({
      data: {
        id: attemptId,
        email,
        codeHash: codeDigest(attemptId, email, code),
        expiresAt,
        resendCount,
      },
    });
  });

  try {
    await sendRegistrationCodeEmail({
      email,
      code,
      idempotencyKey: `registration-code/${attempt.id}`,
    });
  } catch {
    await prisma.registrationAttempt.updateMany({
      where: { id: attempt.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    throw new RegistrationServiceError("Le message n’a pas pu être préparé. Réessayez plus tard.", 503, "DELIVERY_UNAVAILABLE");
  }

  return { attemptId: attempt.id, message: GENERIC_CODE_MESSAGE };
}

export type RegistrationVerificationResult =
  | { next: "password"; proof: string; maskedEmail: string }
  | { next: "login"; maskedEmail: string }
  | { next: "code"; attemptsRemaining: number };

export async function verifyRegistrationCode(input: {
  attemptId: string;
  code: string;
  clientAddress: string;
}): Promise<RegistrationVerificationResult> {
  assertDatabaseConfigured();
  await enforceLimits([
    ["verify-attempt", input.attemptId, 10 * 60_000, 8],
    ["verify-ip", input.clientAddress, 10 * 60_000, 40],
  ]);

  const proof = createOpaqueToken();
  const now = new Date();
  return withRegistrationLock(`registration-attempt:${input.attemptId}`, async (transaction) => {
    const attempt = await transaction.registrationAttempt.findUnique({ where: { id: input.attemptId } });
    if (!attempt || attempt.consumedAt || attempt.verifiedAt || attempt.expiresAt <= now) {
      return { next: "code", attemptsRemaining: 0 };
    }

    if (!equalDigest(attempt.codeHash, codeDigest(attempt.id, attempt.email, input.code))) {
      const failedAttempts = attempt.failedAttempts + 1;
      await transaction.registrationAttempt.update({
        where: { id: attempt.id },
        data: {
          failedAttempts,
          ...(failedAttempts >= REGISTRATION_MAX_FAILED_ATTEMPTS ? { consumedAt: now } : {}),
        },
      });
      return { next: "code", attemptsRemaining: Math.max(0, REGISTRATION_MAX_FAILED_ATTEMPTS - failedAttempts) };
    }

    const existing = await transaction.user.findUnique({ where: { email: attempt.email }, select: { id: true } });
    if (existing) {
      await transaction.registrationAttempt.update({
        where: { id: attempt.id },
        data: { verifiedAt: now, consumedAt: now, continuationHash: null, continuationExpiresAt: null },
      });
      return { next: "login", maskedEmail: maskEmail(attempt.email) };
    }

    await transaction.registrationAttempt.update({
      where: { id: attempt.id },
      data: {
        verifiedAt: now,
        continuationHash: hashOpaqueToken(proof),
        continuationExpiresAt: new Date(now.getTime() + REGISTRATION_PROOF_TTL_MS),
      },
    });
    return { next: "password", proof, maskedEmail: maskEmail(attempt.email) };
  });
}

function parseProofCookie(cookieHeader: string | null) {
  const cookies = (cookieHeader ?? "").split(";").map((value) => value.trim());
  const encoded = cookies.find((value) => value.startsWith(`${PROOF_COOKIE_NAME}=`))?.slice(PROOF_COOKIE_NAME.length + 1);
  if (!encoded) return null;
  const value = decodeURIComponent(encoded);
  const separator = value.indexOf(".");
  const attemptId = value.slice(0, separator);
  const proof = value.slice(separator + 1);
  if (separator < 1 || !UUID_PATTERN.test(attemptId) || !isOpaqueToken(proof)) return null;
  return { attemptId, proof };
}

export function registrationProofCookie(attemptId: string, proof: string) {
  const secure = process.env.NODE_ENV === "production" && !isPersistentLocalPreview();
  return `${PROOF_COOKIE_NAME}=${encodeURIComponent(`${attemptId}.${proof}`)}; Max-Age=${REGISTRATION_PROOF_TTL_MS / 1_000}; Path=/api/auth/registration; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearRegistrationProofCookie() {
  const secure = process.env.NODE_ENV === "production" && !isPersistentLocalPreview();
  return `${PROOF_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/api/auth/registration; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

async function continuationFromCookie(cookieHeader: string | null) {
  const parsed = parseProofCookie(cookieHeader);
  if (!parsed) return null;
  const attempt = await prisma.registrationAttempt.findUnique({ where: { id: parsed.attemptId } });
  if (!attempt?.verifiedAt || attempt.consumedAt || !attempt.continuationHash || !attempt.continuationExpiresAt) return null;
  if (attempt.continuationExpiresAt <= new Date()) return null;
  if (!equalDigest(attempt.continuationHash, hashOpaqueToken(parsed.proof))) return null;
  return { attempt, proof: parsed.proof };
}

export async function registrationContinuationState(cookieHeader: string | null) {
  assertDatabaseConfigured();
  const continuation = await continuationFromCookie(cookieHeader);
  return continuation ? { stage: "password" as const, maskedEmail: maskEmail(continuation.attempt.email) } : { stage: "email" as const };
}

export async function completeRegistration(input: {
  password: string;
  cookieHeader: string | null;
  clientAddress: string;
}) {
  assertDatabaseConfigured();
  const parsed = parseProofCookie(input.cookieHeader);
  if (!parsed) throw new RegistrationServiceError("Cette vérification n’est plus valable. Demandez un nouveau code.", 400, "PROOF_INVALID");
  await enforceLimits([
    ["complete-attempt", parsed.attemptId, 15 * 60_000, 5],
    ["complete-ip", input.clientAddress, 15 * 60_000, 20],
  ]);

  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  return withRegistrationLock(`registration-attempt:${parsed.attemptId}`, async (transaction) => {
    let attempt = await transaction.registrationAttempt.findUnique({ where: { id: parsed.attemptId } });
    if (attempt) {
      const emailLock = `registration-email:${keyedDigest("registration-email-lock", attempt.email)}`;
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${emailLock})) IS NULL AS locked`;
      attempt = await transaction.registrationAttempt.findUnique({ where: { id: parsed.attemptId } });
    }
    const valid = attempt?.verifiedAt
      && !attempt.consumedAt
      && attempt.continuationHash
      && attempt.continuationExpiresAt
      && attempt.continuationExpiresAt > now
      && equalDigest(attempt.continuationHash, hashOpaqueToken(parsed.proof));
    if (!attempt || !valid) {
      const existing = attempt && equalDigest(attempt.continuationHash ?? "", hashOpaqueToken(parsed.proof))
        ? await transaction.user.findUnique({ where: { email: attempt.email }, select: { id: true } })
        : null;
      if (attempt?.consumedAt && existing) return { completed: true as const };
      throw new RegistrationServiceError("Cette vérification n’est plus valable. Demandez un nouveau code.", 400, "PROOF_INVALID");
    }

    const existing = await transaction.user.findUnique({ where: { email: attempt.email }, select: { id: true } });
    if (existing) {
      await transaction.registrationAttempt.update({ where: { id: attempt.id }, data: { consumedAt: now } });
      return { completed: true as const };
    }

    const user = await transaction.user.create({
      data: {
        email: attempt.email,
        emailVerified: true,
        emailVerifiedAt: now,
        displayName: "Membre LNX",
        role: "MEMBER",
        status: "ACTIVE",
      },
    });
    await transaction.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      },
    });
    await transaction.registrationAttempt.update({ where: { id: attempt.id }, data: { consumedAt: now } });
    return { completed: true as const };
  });
}
