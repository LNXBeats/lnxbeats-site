import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { requireSupportEnabled, SupportError, supportBaseUrl, validateSupportAmount } from "@/lib/support/config";
import { captureProviderSupport, createProviderCheckout, refundProviderSupport, retrieveSupportRefund, type SupportEvidence } from "@/lib/support/providers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const providerOperations = { createCheckout: createProviderCheckout, capture: captureProviderSupport };
export const supportHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function validSupportId(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }

function ownerMatches(hash: string, token: string) {
  return /^[0-9a-f]{64}$/.test(token) && timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(supportHash(token), "hex"));
}
async function lock(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`support:${id}`})) IS NULL AS locked`;
}

async function owned(id: string, token: string) {
  if (!validSupportId(id)) throw new SupportError("NOT_FOUND");
  const value = await prisma.supportContribution.findUnique({ where: { id } });
  if (!value || !ownerMatches(value.ownerHash, token)) throw new SupportError("NOT_FOUND");
  return value;
}

/** One provider idempotency key per operation forever. No fresh key after a
 * timeout. After 30 minutes an ambiguous operation needs manual reconciliation
 * rather than risking provider retention-window expiry and a second charge. */
export function supportRetryAllowed(createdAt: Date, now = new Date()) {
  return now.getTime() - createdAt.getTime() < 30 * 60_000;
}

/** Recheck current ledger state before reusing any historical attempt. A
 * durable idempotency key is not permission to bypass a later review block. */
export function assertSupportAttemptAllowed(
  value: { status: string; provider: string },
  operation: "CHECKOUT" | "CAPTURE" | "REFUND",
  existing: { status: string } | null,
) {
  if (operation === "CAPTURE" && (value.provider !== "PAYPAL" || value.status !== "PENDING")) throw new SupportError("CONFLICT");
  if (operation === "REFUND" && value.status !== "SUCCEEDED"
    && !(value.status === "REFUND_PENDING" && existing && ["REQUESTED", "SUCCEEDED"].includes(existing.status))) throw new SupportError("CONFLICT");
  if (operation === "CHECKOUT" && !["CREATED", "PENDING"].includes(value.status)) throw new SupportError("CONFLICT");
}

async function attempt(id: string, operation: "CHECKOUT" | "CAPTURE" | "REFUND", actorId?: string) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const value = await tx.supportContribution.findUniqueOrThrow({ where: { id } });
    const existing = await tx.supportContributionAttempt.findUnique({ where: { contributionId_operation: { contributionId: id, operation } } });
    assertSupportAttemptAllowed(value, operation, existing);
    if (existing) {
      if (existing.status !== "SUCCEEDED" && !supportRetryAllowed(existing.createdAt)) throw new SupportError("CONFLICT");
      return existing;
    }
    const key = `support-${operation.toLowerCase()}-${id}`;
    const created = await tx.supportContributionAttempt.create({ data: { contributionId: id, operation, idempotencyKey: key } });
    await tx.supportContributionEvent.create({ data: { contributionId: id, eventKey: `${key}:requested`, type: `${operation}_REQUESTED`, actorId } });
    if (operation === "REFUND") await tx.supportContribution.update({ where: { id }, data: { status: "REFUND_PENDING" } });
    return created;
  });
}

export async function createSupportCheckout(input: { provider: unknown; amountCents: unknown; idempotencyKey: unknown; ownerToken: string; userId?: string }, gateway = providerOperations) {
  requireSupportEnabled();
  const amountCents = validateSupportAmount(input.amountCents);
  if (!validSupportId(input.idempotencyKey) || !["STRIPE", "PAYPAL"].includes(String(input.provider)) || !/^[0-9a-f]{64}$/.test(input.ownerToken)) throw new SupportError("INVALID");
  const provider = String(input.provider);
  const ownerHash = supportHash(input.ownerToken);
  const key = supportHash(`${ownerHash}:${input.idempotencyKey}`);
  const value = await prisma.$transaction(async (tx) => {
    await lock(tx, key);
    const existing = await tx.supportContribution.findUnique({ where: { idempotencyKey: key } });
    return existing ?? tx.supportContribution.create({ data: { id: randomUUID(), ownerHash, idempotencyKey: key, amountCents, provider, userId: input.userId } });
  });
  if (value.amountCents !== amountCents || value.provider !== provider || value.ownerHash !== ownerHash) throw new SupportError("CONFLICT");
  if (value.checkoutUrl) return { contributionId: value.id, checkoutUrl: value.checkoutUrl, status: value.status };
  const operation = await attempt(value.id, "CHECKOUT");
  const result = await gateway.createCheckout(value, supportBaseUrl(), operation.idempotencyKey);
  await prisma.$transaction(async (tx) => {
    await lock(tx, value.id);
    const current = await tx.supportContribution.findUniqueOrThrow({ where: { id: value.id } });
    if (current.providerReference && current.providerReference !== result.id) throw new SupportError("CONFLICT");
    await tx.supportContribution.update({ where: { id: value.id }, data: { providerReference: result.id, checkoutUrl: result.url,
      ...(current.status === "CREATED" ? { status: "PENDING" } : {}) } });
    await tx.supportContributionAttempt.update({ where: { id: operation.id }, data: { status: "SUCCEEDED" } });
  });
  return { contributionId: value.id, checkoutUrl: result.url, status: "PENDING" };
}

export async function getSupportStatus(id: string, ownerToken: string) {
  requireSupportEnabled();
  const value = await owned(id, ownerToken);
  return { id: value.id, amountCents: value.amountCents, currency: value.currency, provider: value.provider, status: value.status };
}

export function supportEvidenceMatches(value: { id: string; provider: string; providerReference: string | null; amountCents: number; currency: string }, evidence: SupportEvidence) {
  return value.id === evidence.contributionId && value.provider === evidence.provider
    && value.providerReference === evidence.providerReference && value.amountCents === evidence.amountCents
    && value.currency === evidence.currency;
}

export function nextSupportStatus(current: string, incoming: SupportEvidence["status"]) {
  if (["REFUNDED", "REFUND_PENDING", "REQUIRES_REVIEW"].includes(current)) return current;
  if (current === "SUCCEEDED") return current;
  if (incoming === "SUCCEEDED") return "SUCCEEDED";
  if (current === "FAILED" && incoming === "PENDING") return current;
  return incoming;
}

export async function reconcileSupportEvidence(evidence: SupportEvidence, eventKey: string) {
  if (!validSupportId(evidence.contributionId) || eventKey.length > 255) throw new SupportError("INVALID");
  return prisma.$transaction(async (tx) => {
    await lock(tx, evidence.contributionId);
    const value = await tx.supportContribution.findUnique({ where: { id: evidence.contributionId } });
    if (!value) throw new SupportError("NOT_FOUND");
    if (await tx.supportContributionEvent.findUnique({ where: { eventKey } })) return value.status;
    // A webhook can win the race with checkout persistence. Ask the provider
    // to retry; never consume an event against an unbound checkout reference.
    if (!value.providerReference) throw new SupportError("UNAVAILABLE");
    const matches = supportEvidenceMatches(value, evidence)
      && (!value.paymentReference || !evidence.paymentReference || value.paymentReference === evidence.paymentReference);
    const status = matches ? nextSupportStatus(value.status, evidence.status) : "REQUIRES_REVIEW";
    await tx.supportContribution.update({ where: { id: value.id }, data: { status,
      ...(matches && evidence.paymentReference ? { paymentReference: evidence.paymentReference } : {}) } });
    await tx.supportContributionEvent.create({ data: { contributionId: value.id, eventKey, type: matches ? `PROVIDER_${evidence.status}` : "EVIDENCE_MISMATCH" } });
    return status;
  });
}

export async function captureSupportContribution(id: string, ownerToken: string, gateway = providerOperations) {
  requireSupportEnabled();
  const value = await owned(id, ownerToken);
  if (value.status === "SUCCEEDED") return getSupportStatus(id, ownerToken);
  const operation = await attempt(id, "CAPTURE");
  // A provider response PENDING is a completed capture request, not a reason
  // to send capture again. Await its verified webhook, even after 30 minutes.
  if (operation.status === "SUCCEEDED") return getSupportStatus(id, ownerToken);
  const evidence = await gateway.capture(value, operation.idempotencyKey);
  await reconcileSupportEvidence(evidence, `${operation.idempotencyKey}:${evidence.status}`);
  await prisma.supportContributionAttempt.update({ where: { id: operation.id }, data: { status: "SUCCEEDED" } });
  return getSupportStatus(id, ownerToken);
}

export async function refundSupportContribution(input: { contributionId: string; adminId: string; confirmation: string }) {
  requireSupportEnabled();
  if (!validSupportId(input.contributionId) || input.confirmation !== `REMBOURSER ${input.contributionId}`) throw new SupportError("INVALID");
  // Auth is revalidated here as well as in the route: no forged actor ID.
  const { requireAdmin } = await import("@/lib/auth/session");
  const session = await requireAdmin();
  if (session.user.id !== input.adminId) throw new SupportError("INVALID");
  const value = await prisma.supportContribution.findUnique({ where: { id: input.contributionId } });
  if (!value) throw new SupportError("NOT_FOUND");
  if (value.status === "REFUNDED") return { status: value.status };
  const operation = await attempt(value.id, "REFUND", input.adminId);
  if (operation.status === "SUCCEEDED") {
    if (value.status === "REFUND_PENDING" && value.refundReference) {
      const status = await retrieveSupportRefund({ ...value, refundReference: value.refundReference });
      await prisma.$transaction(async (tx) => {
        await lock(tx, value.id);
        await tx.supportContribution.updateMany({ where: { id: value.id, status: "REFUND_PENDING" }, data: { status } });
        const eventKey = `${operation.idempotencyKey}:reconciled:${status}`;
        if (!await tx.supportContributionEvent.findUnique({ where: { eventKey } })) await tx.supportContributionEvent.create({
          data: { contributionId: value.id, eventKey, type: status, actorId: input.adminId } });
      });
      return { status };
    }
    return { status: value.status };
  }
  const result = await refundProviderSupport(value, operation.idempotencyKey);
  await prisma.$transaction(async (tx) => {
    await lock(tx, value.id);
    await tx.supportContribution.update({ where: { id: value.id }, data: { status: result.status, refundReference: result.id } });
    await tx.supportContributionAttempt.update({ where: { id: operation.id }, data: { status: "SUCCEEDED" } });
    const eventKey = `${operation.idempotencyKey}:result`;
    if (!await tx.supportContributionEvent.findUnique({ where: { eventKey } })) await tx.supportContributionEvent.create({
      data: { contributionId: value.id, eventKey, type: result.status, actorId: input.adminId } });
  });
  return { status: result.status };
}

const adminSelect = { id: true, amountCents: true, currency: true, provider: true, mode: true, status: true,
  createdAt: true, providerReference: true, paymentReference: true, refundReference: true,
  userId: true, events: { select: { id: true, type: true, createdAt: true, actorId: true }, orderBy: { createdAt: "asc" as const } } };

export async function listAdminSupportContributions(limit = 200) {
  const { requireAdmin } = await import("@/lib/auth/session");
  await requireAdmin();
  return prisma.supportContribution.findMany({ select: adminSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: Math.max(1, Math.min(1000, Math.floor(limit))) });
}
export async function getAdminSupportContribution(id: string) {
  const { requireAdmin } = await import("@/lib/auth/session");
  await requireAdmin();
  if (!validSupportId(id)) throw new SupportError("NOT_FOUND");
  return prisma.supportContribution.findUnique({ where: { id }, select: adminSelect });
}
