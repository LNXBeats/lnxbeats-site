import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { DigitalError, assertDigitalUuid, requireDigitalEnvironment } from "./domain";
import { DIGITAL_RIGHTS_ATTESTATION, DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_RIGHTS_REVIEW_POLICY, DIGITAL_RIGHTS_REVIEW_STATUSES,
  assessDigitalRightsReview, digitalRightsEvidenceReference, digitalRightsEvidenceSha, digitalRightsMasterBinding, digitalRightsReviewHash,
  type DigitalRightsMaster, type DigitalRightsReviewDetails, type DigitalRightsReviewStatus, type DigitalRightsReviewSummary } from "./rights-review-policy";

type Tx = Prisma.TransactionClient;
export { DIGITAL_RIGHTS_REVIEW_POLICY } from "./rights-review-policy";
const masterInclude = { masterAsset: true, mp3Asset: true, previewAsset: true } as const;
function masterIds(value: unknown, maximum = 100): string[] {
  if (!Array.isArray(value) || !value.length || value.length > maximum || new Set(value).size !== value.length) throw new DigitalError("INVALID_RIGHTS_REVIEW", 400);
  value.forEach(assertDigitalUuid); return [...value].sort();
}
async function reviewer(db: Tx, actorId: string) {
  return db.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, status: true, emailVerified: true } });
}
async function requireReviewer(db: Tx, actorId: string) {
  const actor = await reviewer(db, actorId);
  if (!actor || actor.role !== "ADMIN" || actor.status !== "ACTIVE" || !actor.emailVerified) throw new DigitalError("ADMIN_REQUIRED", 403);
  return actor;
}
async function latestReview(db: Tx, masterId: string) {
  return db.digitalEvent.findFirst({ where: { kind: DIGITAL_RIGHTS_REVIEW_EVENT, details: { path: ["binding", "masterId"], equals: masterId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, kind: true, actorId: true, details: true, createdAt: true } });
}
export async function loadDigitalRightsReviews(db: Tx, masters: DigitalRightsMaster[]): Promise<DigitalRightsReviewSummary[]> {
  const results = [];
  for (const master of masters) { const event = await latestReview(db, master.id); results.push(assessDigitalRightsReview(master, event, event?.actorId ? await reviewer(db, event.actorId) : null)); }
  return results;
}
/** Admin-only caller; explicit safe projection, never evidence references or document hashes. */
export async function loadProjectDigitalRightsHistory(db: Tx, projectId: string) {
  assertDigitalUuid(projectId);
  const tracks = await db.track.findMany({ where: { projectId }, select: { id: true } });
  if (!tracks.length) return { entries: [], truncated: false };
  const events = await db.digitalEvent.findMany({ where: { kind: DIGITAL_RIGHTS_REVIEW_EVENT,
    OR: tracks.map(track => ({ details: { path: ["binding", "trackId"], equals: track.id } })) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, select: { id: true, actorId: true, details: true, createdAt: true } });
  return { truncated: events.length > 50, entries: events.slice(0, 50).map(event => {
    const details = event.details && typeof event.details === "object" && !Array.isArray(event.details) ? event.details as Record<string, unknown> : {};
    const binding = details.binding && typeof details.binding === "object" && !Array.isArray(details.binding) ? details.binding as Record<string, unknown> : {};
    return { createdAt: event.createdAt.toISOString(), masterVersion: Number.isSafeInteger(binding.version) ? Number(binding.version) : null,
      status: DIGITAL_RIGHTS_REVIEW_STATUSES.includes(details.status as DigitalRightsReviewStatus) ? details.status as DigitalRightsReviewStatus : "REVIEW_REQUIRED" as const,
      reviewerId: event.actorId, reviewId: event.id };
  }) };
}
/** For new sale / first delivery only. Existing acquired downloads do not call this gate.
 * Pinned earlier editions may still be checked after a newer master appears; only
 * recording a new review requires the current strict-ingestion edition.
 */
export async function assertDigitalRightsReviews(db: Tx, rawIds: string[]) {
  // A cart remains bounded at 50 offers; a prepared album may contain 100 tracks.
  const ids = masterIds([...new Set(rawIds)], 5000);
  for (const id of ids) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-rights-master:${id}`})) IS NULL AS locked`;
  const masters = await db.digitalMaster.findMany({ where: { id: { in: ids } }, include: masterInclude });
  if (masters.length !== ids.length) throw new DigitalError("RIGHTS_REVIEW_REQUIRED", 409);
  for (const master of masters) { try { digitalRightsMasterBinding(master); } catch { throw new DigitalError("RIGHTS_REVIEW_REQUIRED", 409); } }
  const summaries = await loadDigitalRightsReviews(db, masters);
  if (summaries.some(summary => summary.status !== "APPROVED")) throw new DigitalError("RIGHTS_REVIEW_REQUIRED", 409);
}
export async function listProjectDigitalRightsReviews(actor: OrderActor, projectId: string) {
  requireDigitalEnvironment(); assertDigitalUuid(projectId);
  return prisma.$transaction(async db => {
    await requireReviewer(db, actor.id);
    const project = await db.project.findUnique({ where: { id: projectId }, include: { tracks: { orderBy: [{ position: "asc" }, { id: "asc" }],
      include: { digitalMasters: { orderBy: { version: "desc" }, take: 1, include: masterInclude } } } } });
    if (!project) throw new DigitalError("NOT_FOUND", 404);
    const masters = project.tracks.flatMap(track => track.digitalMasters);
    return loadDigitalRightsReviews(db, masters);
  });
}
type ReviewInput = { projectId: string; masterIds: string[]; expectedReviews: Array<{ masterId: string; reviewId: string | null }>; status: DigitalRightsReviewStatus;
  privateEvidenceReference: string | null; evidenceSha256: string | null; attested: boolean; reason: string | null; idempotencyKey: string };
export function digitalRightsReviewInput(value: unknown): ReviewInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DigitalError("INVALID_RIGHTS_REVIEW", 400);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["projectId", "masterIds", "expectedReviews", "status", "privateEvidenceReference", "evidenceSha256", "attested", "reason", "idempotencyKey"].includes(key))) throw new DigitalError("INVALID_RIGHTS_REVIEW", 400);
  assertDigitalUuid(input.projectId); assertDigitalUuid(input.idempotencyKey);
  const ids = masterIds(input.masterIds);
  if (!DIGITAL_RIGHTS_REVIEW_STATUSES.includes(input.status as DigitalRightsReviewStatus) || typeof input.attested !== "boolean"
    || !Array.isArray(input.expectedReviews) || input.expectedReviews.length !== ids.length) throw new DigitalError("INVALID_RIGHTS_REVIEW", 400);
  const expectedReviews = input.expectedReviews.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["masterId", "reviewId"].includes(key))) throw new DigitalError("INVALID_RIGHTS_REVIEW", 400);
    assertDigitalUuid(value.masterId); if (value.reviewId !== null) assertDigitalUuid(value.reviewId);
    return { masterId: value.masterId as string, reviewId: value.reviewId as string | null };
  }).sort((a, b) => a.masterId.localeCompare(b.masterId));
  if (expectedReviews.some((entry, index) => entry.masterId !== ids[index])) throw new DigitalError("INVALID_RIGHTS_REVIEW", 400);
  const status = input.status as DigitalRightsReviewStatus, evidence = input.privateEvidenceReference === null || input.privateEvidenceReference === "" ? null : digitalRightsEvidenceReference(input.privateEvidenceReference);
  const sha = input.evidenceSha256 === null || input.evidenceSha256 === "" ? null : digitalRightsEvidenceSha(input.evidenceSha256);
  if (input.reason !== null && (typeof input.reason !== "string" || input.reason.trim().length > 500 || /[\x00-\x1f]/.test(input.reason))) throw new DigitalError("INVALID_RIGHTS_REVIEW", 400);
  const reason = typeof input.reason === "string" ? input.reason.trim() || null : null;
  if (status === "APPROVED" && (!input.attested || !evidence || !sha)) throw new DigitalError("RIGHTS_EVIDENCE_REQUIRED", 400);
  if (["REJECTED", "REVOKED"].includes(status) && !reason) throw new DigitalError("RIGHTS_REASON_REQUIRED", 400);
  return { projectId: input.projectId, masterIds: ids, expectedReviews, status, privateEvidenceReference: evidence, evidenceSha256: sha,
    attested: input.attested, reason, idempotencyKey: input.idempotencyKey };
}
/** New append-only facts only: no master, asset, offer, acquisition or prior event mutation. */
export async function recordDigitalRightsReviews(actor: OrderActor, raw: unknown) {
  requireDigitalEnvironment(); const input = digitalRightsReviewInput(raw);
  return prisma.$transaction(async db => {
    await requireReviewer(db, actor.id);
    for (const id of input.masterIds) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-rights-master:${id}`})) IS NULL AS locked`;
    const masters = await db.digitalMaster.findMany({ where: { id: { in: input.masterIds }, track: { projectId: input.projectId } }, include: masterInclude });
    if (masters.length !== input.masterIds.length) throw new DigitalError("NOT_FOUND", 404);
    // Share the ingestion lock: an upload cannot publish a replacement between
    // the current-version check and this approval's append-only commit.
    for (const trackId of [...new Set(masters.map(master=>master.trackId))].sort()) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${trackId}`})) IS NULL AS locked`;
    const prepared = [];
    for (const master of masters) {
      const binding = digitalRightsMasterBinding(master);
      const current = await db.digitalMaster.findFirst({ where: { trackId: master.trackId }, orderBy: { version: "desc" }, select: { id: true } });
      if (current?.id !== master.id && !["REVOKED", "REJECTED"].includes(input.status)) throw new DigitalError("RIGHTS_MASTER_CHANGED", 409);
      const requestHash = digitalRightsReviewHash({ actorId: actor.id, input, binding }), externalKey = `dcn-rights:${input.idempotencyKey}:${master.id}`;
      const previous = await db.digitalEvent.findUnique({ where: { externalKey }, select: { id: true, actorId: true, details: true } });
      if (previous) {
        if (previous.actorId !== actor.id || !previous.details || typeof previous.details !== "object" || Array.isArray(previous.details)
          || (previous.details as Record<string, unknown>).requestHash !== requestHash) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
        continue;
      }
      const latest = await latestReview(db, master.id);
      if ((latest?.id ?? null) !== input.expectedReviews.find(entry => entry.masterId === master.id)!.reviewId) throw new DigitalError("RIGHTS_REVIEW_CHANGED", 409);
      prepared.push({ master, binding, requestHash, externalKey, previousCreatedAt: latest?.createdAt ?? null });
    }
    for (const record of prepared) {
      // UUID ordering is not chronology: serialize reviews and advance at least
      // one millisecond so a same-tick revocation can never lose to an older UUID.
      const createdAt = new Date(Math.max(Date.now(), (record.previousCreatedAt?.getTime() ?? 0) + 1)), proof = { policy: DIGITAL_RIGHTS_REVIEW_POLICY, binding: record.binding, status: input.status,
        privateEvidenceReference: input.privateEvidenceReference, evidenceSha256: input.evidenceSha256, attestation: input.attested ? DIGITAL_RIGHTS_ATTESTATION : null,
        reason: input.reason, reviewedAt: createdAt.toISOString(), requestHash: record.requestHash };
      const details: DigitalRightsReviewDetails = { ...proof, recordHash: digitalRightsReviewHash({ actorId: actor.id, ...proof }) };
      await db.digitalEvent.create({ data: { kind: DIGITAL_RIGHTS_REVIEW_EVENT, actorId: actor.id, externalKey: record.externalKey, createdAt, details } });
    }
    return loadDigitalRightsReviews(db, masters);
  });
}
