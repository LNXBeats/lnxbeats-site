import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { requireSupportEnabled, requireSupportEnvironment, SupportError, supportBaseUrl, validateSupportAmount } from "@/lib/support/config";
import { captureProviderSupport, createProviderCheckout, refundProviderSupport, recoverProviderSupport, type SupportRecovery, type SupportEvidence } from "@/lib/support/providers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const providerOperations: { createCheckout: typeof createProviderCheckout; capture: typeof captureProviderSupport; recover?: typeof recoverProviderSupport; refund?: typeof refundProviderSupport } = { createCheckout: createProviderCheckout, capture: captureProviderSupport, recover: recoverProviderSupport, refund: refundProviderSupport };
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
  requireSupportEnvironment(value.mode);
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

type Operation = "CHECKOUT" | "CAPTURE" | "REFUND";
export type SupportGateway = typeof providerOperations;
async function attempt(id: string, operation: Operation, actorId?: string, recoveryOnly = false) {
  return prisma.$transaction(async tx => {
    await lock(tx, id);
    const value = await tx.supportContribution.findUniqueOrThrow({ where: { id } });
    requireSupportEnvironment(value.mode);
    const old = await tx.supportContributionAttempt.findUnique({ where: { contributionId_operation: { contributionId: id, operation } } });
    if (operation === "REFUND" && !old && value.mode === "LIVE" && process.env.SUPPORT_LIVE_REFUNDS_ENABLED !== "true") throw new SupportError("DISABLED");
    if (old && ((operation === "CAPTURE" && value.status === "SUCCEEDED") || (operation === "REFUND" && value.status === "REFUNDED"))) return null;
    if (!recoveryOnly) assertSupportAttemptAllowed(value, operation, old);
    if (old?.leaseUntil && old.leaseUntil > new Date()) return null;
    const lease = { leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000), lastCheckedAt: new Date() };
    if (old) return { ...await tx.supportContributionAttempt.update({ where: { id: old.id }, data: lease }), fresh: false };
    if (recoveryOnly) return null;
    const key = `support-${operation.toLowerCase()}-${id}`;
    const created = await tx.supportContributionAttempt.create({ data: { contributionId: id, operation, idempotencyKey: key, ...lease } });
    await tx.supportContributionEvent.create({ data: { contributionId: id, eventKey: `${key}:requested`, type: `${operation}_REQUESTED`, actorId } });
    if (operation === "REFUND") await tx.supportContribution.update({ where: { id }, data: { status: "REFUND_PENDING" } });
    return { ...created, fresh: true };
  });
}
async function finish(id: string, operation: NonNullable<Awaited<ReturnType<typeof attempt>>>, result: SupportRecovery | null) {
  await prisma.$transaction(async tx => {
    await lock(tx, id);
    const active = await tx.supportContributionAttempt.findUniqueOrThrow({ where: { id: operation.id } });
    if (active.leaseToken !== operation.leaseToken) return;
    const current = await tx.supportContribution.findUniqueOrThrow({ where: { id } });
    let resolved = false;
    if (result?.checkout) {
      if (current.providerReference && current.providerReference !== result.checkout.id) throw new SupportError("CONFLICT");
      await tx.supportContribution.update({ where: { id }, data: { providerReference: result.checkout.id, checkoutUrl: result.checkout.url,
        ...(current.status === "CREATED" ? { status: "PENDING" } : {}) } });
      resolved = true;
    }
    if (result?.evidence) {
      const evidence = result.evidence;
      if (evidence.paymentReference) await lock(tx, `payment:${evidence.provider}:${evidence.paymentReference}`);
      const safe = supportEvidenceMatches({ ...current, providerReference: current.providerReference ?? evidence.providerReference }, evidence)
        && (!current.paymentReference || !evidence.paymentReference || current.paymentReference === evidence.paymentReference);
      const other = evidence.paymentReference ? await tx.supportContribution.findUnique({ where: { paymentReference: evidence.paymentReference } }) : null;
      const matches = safe && (!other || other.id === id);
      await tx.supportContribution.update({ where: { id }, data: { status: matches ? nextSupportStatus(current.status, evidence.status) : "REQUIRES_REVIEW",
        ...(matches ? { providerReference: evidence.providerReference, ...(evidence.paymentReference ? { paymentReference: evidence.paymentReference } : {}) } : {}) } });
      await tx.supportContributionEvent.create({ data: { contributionId: id, eventKey: `recover:${operation.id}:${operation.leaseToken}`,
        type: matches ? `RECOVERED_${evidence.status}` : "EVIDENCE_MISMATCH", evidence: { ...evidence } } });
      resolved = true;
    }
    if (result?.refund) {
      if (current.refundReference && current.refundReference !== result.refund.id) throw new SupportError("CONFLICT");
      await tx.supportContribution.update({ where: { id }, data: { refundReference: result.refund.id, status: current.status === "REQUIRES_REVIEW" ? current.status : result.refund.status } });
      resolved = true;
    }
    await tx.supportContributionAttempt.update({ where: { id: operation.id }, data: { leaseToken: null, leaseUntil: null, ...(resolved ? { status: "SUCCEEDED" } : {}) } });
    await tx.supportContributionEvent.create({ data: { contributionId: id, eventKey: `attempt:${operation.id}:${operation.leaseToken}`,
      type: resolved ? `${operation.operation}_RECONCILED` : `${operation.operation}_OUTCOME_UNKNOWN` } });
  });
}
/** Initial POST once. Every subsequent call is GET-only. No network inside a
 * transaction. A crashed process leaves a recoverable, fenced persistent lease. */
export async function runSupportOperation(id: string, kind: Operation, gateway = providerOperations, actorId?: string, recoveryOnly = false, referenceHint?: string) {
  requireSupportEnvironment();
  const operation = await attempt(id, kind, actorId, recoveryOnly);
  if (!operation) return;
  const value = await prisma.supportContribution.findUniqueOrThrow({ where: { id } });
  try {
    let result: SupportRecovery | null;
    if (!operation.fresh) result = await (gateway.recover ?? recoverProviderSupport)({ ...value,
      ...(referenceHint && kind === "CHECKOUT" && !value.providerReference ? { providerReference: referenceHint } : {}),
      ...(referenceHint && kind === "REFUND" && !value.refundReference ? { refundReference: referenceHint } : {}) }, kind);
    else if (kind === "CHECKOUT") result = { checkout: await gateway.createCheckout(value, supportBaseUrl(), operation.idempotencyKey) };
    else if (kind === "CAPTURE") result = { evidence: await gateway.capture(value, operation.idempotencyKey) };
    else result = { refund: await (gateway.refund ?? refundProviderSupport)(value, operation.idempotencyKey) };
    await finish(id, operation, result);
  } catch (error) {
    await finish(id, operation, null);
    if (error instanceof SupportError && error.code === "CONFLICT") {
      await prisma.$transaction(async tx => {
        await lock(tx, id);
        await tx.supportContribution.update({ where: { id }, data: { status: "REQUIRES_REVIEW" } });
        await tx.supportContributionEvent.create({ data: { contributionId: id, eventKey: `conflict:${operation.id}:${operation.leaseToken}`, type: "PROVIDER_CONFLICT_REVIEW_REQUIRED" } });
      });
    }
    throw new SupportError("UNAVAILABLE");
  }
}
export async function reconcileSupportContribution(id: string, gateway = providerOperations) {
  requireSupportEnvironment();
  if (!validSupportId(id)) throw new SupportError("INVALID");
  const value = await prisma.supportContribution.findUniqueOrThrow({ where: { id }, include: { attempts: true } });
  requireSupportEnvironment(value.mode);
  for (const a of value.attempts) {
    if (a.operation === "REFUND" && ["REFUNDED", "REQUIRES_REVIEW"].includes(value.status)) continue;
    if (a.operation !== "REFUND" && ["SUCCEEDED", "REFUNDED", "REFUND_PENDING", "REQUIRES_REVIEW"].includes(value.status)) continue;
    await runSupportOperation(id, a.operation as Operation, gateway, undefined, true);
  }
}
export async function createSupportCheckout(input: { provider: unknown; amountCents: unknown; idempotencyKey: unknown; ownerToken: string; userId?: string; newContribution?: boolean }, gateway = providerOperations) {
  requireSupportEnabled();
  const amountCents = validateSupportAmount(input.amountCents);
  if (!validSupportId(input.idempotencyKey) || !["STRIPE", "PAYPAL"].includes(String(input.provider)) || !/^[0-9a-f]{64}$/.test(input.ownerToken)) throw new SupportError("INVALID");
  const provider = String(input.provider), ownerHash = supportHash(input.ownerToken), key = supportHash(`${ownerHash}:${input.idempotencyKey}`);
  requireSupportEnabled(provider as "STRIPE" | "PAYPAL");
  const mode = requireSupportEnvironment();
  const value = await prisma.$transaction(async tx => {
    await lock(tx, ownerHash);
    const old = await tx.supportContribution.findUnique({ where: { idempotencyKey: key } });
    if (old && old.mode !== mode) throw new SupportError("CONFLICT");
    if (!old && !input.newContribution && await tx.supportContribution.findFirst({ where: { ownerHash, mode, status: { in: ["CREATED", "PENDING", "REFUND_PENDING", "REQUIRES_REVIEW"] } } })) throw new SupportError("CONFLICT");
    return old ?? tx.supportContribution.create({ data: { ownerHash, idempotencyKey: key, amountCents, provider, mode, userId: input.userId } });
  });
  if (value.amountCents !== amountCents || value.provider !== provider) throw new SupportError("CONFLICT");
  if (!value.checkoutUrl) {
    try { await runSupportOperation(value.id, "CHECKOUT", gateway); }
    catch (error) { if (!(error instanceof SupportError) || error.code !== "UNAVAILABLE") throw error; }
  }
  const current = await prisma.supportContribution.findUniqueOrThrow({ where: { id: value.id } });
  return { contributionId: value.id, checkoutUrl: current.status === "PENDING" ? current.checkoutUrl : null, status: current.status };
}

export async function getSupportStatus(id: string, ownerToken: string) {
  requireSupportEnvironment();
  const value = await owned(id, ownerToken);
  const unresolved = await prisma.supportContributionAttempt.count({ where: { contributionId: id, status: "REQUESTED" } });
  return { id: value.id, amountCents: value.amountCents, currency: value.currency, provider: value.provider, status: value.status, needsReconciliation: unresolved > 0 };
}

export function supportEvidenceMatches(value: { id: string; provider: string; providerReference: string | null; amountCents: number; currency: string; mode?: string }, evidence: SupportEvidence) {
  return value.id === evidence.contributionId && value.provider === evidence.provider
    && (value.mode ?? "TEST") === (evidence.mode ?? "TEST")
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
  const mode = requireSupportEnvironment();
  if ((evidence.mode ?? "TEST") !== mode) throw new SupportError("INVALID");
  if (!validSupportId(evidence.contributionId) || eventKey.length > 255) throw new SupportError("INVALID");
  return prisma.$transaction(async (tx) => {
    await lock(tx, evidence.contributionId);
    if (evidence.paymentReference) await lock(tx, `payment:${evidence.provider}:${evidence.paymentReference}`);
    const value = await tx.supportContribution.findUnique({ where: { id: evidence.contributionId } });
    if (!value) throw new SupportError("NOT_FOUND");
    requireSupportEnvironment(value.mode);
    if (await tx.supportContributionEvent.findUnique({ where: { eventKey } })) return value.status;
    // A webhook can win the race with checkout persistence. Ask the provider
    // to retry; never consume an event against an unbound checkout reference.
    if (!value.providerReference) throw new SupportError("UNAVAILABLE");
    const duplicate = evidence.paymentReference ? await tx.supportContribution.findUnique({ where: { paymentReference: evidence.paymentReference } }) : null;
    const matches = (!duplicate || duplicate.id === value.id) && supportEvidenceMatches(value, evidence)
      && (!value.paymentReference || !evidence.paymentReference || value.paymentReference === evidence.paymentReference);
    const status = matches ? nextSupportStatus(value.status, evidence.status) : "REQUIRES_REVIEW";
    await tx.supportContribution.update({ where: { id: value.id }, data: { status,
      ...(matches && evidence.paymentReference ? { paymentReference: evidence.paymentReference } : {}) } });
    await tx.supportContributionEvent.create({ data: { contributionId: value.id, eventKey, type: matches ? `PROVIDER_${evidence.status}` : "EVIDENCE_MISMATCH", evidence: { ...evidence } } });
    return status;
  });
}

export async function captureSupportContribution(id: string, ownerToken: string, gateway = providerOperations) {
  requireSupportEnvironment();
  const value = await owned(id, ownerToken);
  if (value.status !== "SUCCEEDED") await runSupportOperation(id, "CAPTURE", gateway);
  return getSupportStatus(id, ownerToken);
}
export async function reconcileOwnedSupport(id: string, token: string) {
  await owned(id, token);
  await reconcileSupportContribution(id);
  return getSupportStatus(id, token);
}
/** Dashboard reference is a hint, never evidence. GET validates its immutable
 * amount/custom-id/capture before any attachment. Requires an existing attempt. */
export async function reconcileAdminSupportReference(id: string, operation: "CHECKOUT" | "REFUND", reference: string) {
  const { requireAdmin } = await import("@/lib/auth/session");
  const session = await requireAdmin();
  if (!validSupportId(id) || !/^[A-Za-z0-9_-]{3,255}$/.test(reference)) throw new SupportError("INVALID");
  await runSupportOperation(id, operation, providerOperations, session.user.id, true, reference);
}
export async function refundSupportContribution(input: { contributionId: string; adminId: string; confirmation: string }) {
  requireSupportEnvironment();
  if (!validSupportId(input.contributionId) || input.confirmation !== `REMBOURSER ${input.contributionId}`) throw new SupportError("INVALID");
  const { requireAdmin } = await import("@/lib/auth/session");
  if ((await requireAdmin()).user.id !== input.adminId) throw new SupportError("INVALID");
  const value = await prisma.supportContribution.findUniqueOrThrow({ where: { id: input.contributionId } });
  if (value.status !== "REFUNDED") await runSupportOperation(value.id, "REFUND", providerOperations, input.adminId);
  return { status: (await prisma.supportContribution.findUniqueOrThrow({ where: { id: value.id } })).status };
}

const adminSelect = { id: true, amountCents: true, currency: true, provider: true, mode: true, status: true,
  createdAt: true, providerReference: true, paymentReference: true, refundReference: true,
  attempts: { select: { id: true, operation: true, status: true, createdAt: true, lastCheckedAt: true }, orderBy: { createdAt: "asc" as const } },
  userId: true, events: { select: { id: true, type: true, createdAt: true, actorId: true, evidence: true }, orderBy: { createdAt: "asc" as const } } };

export async function listAdminSupportContributions(limit = 200, mode: "TEST" | "LIVE" = "TEST", cursor?: string) {
  const { requireAdmin } = await import("@/lib/auth/session");
  await requireAdmin();
  if (cursor && !validSupportId(cursor)) throw new SupportError("INVALID");
  return prisma.supportContribution.findMany({ where: { mode }, select: adminSelect, orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: Math.max(1, Math.min(1000, Math.floor(limit))) });
}
export async function getAdminSupportContribution(id: string) {
  const { requireAdmin } = await import("@/lib/auth/session");
  await requireAdmin();
  if (!validSupportId(id)) throw new SupportError("NOT_FOUND");
  return prisma.supportContribution.findUnique({ where: { id }, select: adminSelect });
}
