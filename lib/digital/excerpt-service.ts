import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { assertDigitalUuid, DigitalError, previewWindow, requireDigitalEnvironment } from "./domain";
import { assertDigitalLiveObjectAssets } from "./live-media-policy";
import { DIGITAL_EXCERPT_EVENT, DIGITAL_EXCERPT_POLICY, assertDigitalExcerptRevision, assertDigitalExcerptValidation,
  digitalExcerptBinding, digitalExcerptCandidateReady, digitalExistingExcerptReady, digitalExcerptDetails, digitalExcerptHash, digitalExcerptInput,
  digitalExcerptSelection, type DigitalExcerptDetails, type DigitalExcerptEvent, type DigitalExcerptMaster } from "./excerpt-policy";

export const RECOVERY_EXCERPT_PROJECT_ID = "e62bfcea-6d0c-4a9c-8de9-eee8961c30d7";
export function digitalRecoveryExcerptsReviewOnly() { return process.env.DCN_RECOVERY_EXCERPTS_REVIEW_ONLY === "true"; }
function assertRecoveryExcerptReview(projectId: string) {
  if (!digitalRecoveryExcerptsReviewOnly() || process.env.DCN_MODE !== "TEST" || process.env.DCN_STORAGE_MODE !== "LOCAL"
    || projectId !== RECOVERY_EXCERPT_PROJECT_ID) throw new DigitalError("EXCERPT_NOT_READY", 403);
}
export type DigitalExcerptDb = Prisma.TransactionClient;
export const digitalExcerptMasterInclude = { masterAsset: true, mp3Asset: true, previewAsset: true, track: { select: { projectId: true, title: true } } } as const;
export async function requireDigitalExcerptAdmin(db: DigitalExcerptDb, actorId: string) {
  assertDigitalUuid(actorId);
  const user = await db.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, status: true, emailVerified: true } });
  if (user?.role !== "ADMIN" || user.status !== "ACTIVE" || !user.emailVerified) throw new DigitalError("ADMIN_REQUIRED", 403);
  return user;
}
export async function getCurrentDigitalExcerptMaster(db: DigitalExcerptDb, masterId: string) {
  assertDigitalUuid(masterId);
  const master = await db.digitalMaster.findUnique({ where: { id: masterId }, include: digitalExcerptMasterInclude });
  if (!master) throw new DigitalError("NOT_FOUND", 404);
  digitalExcerptBinding(master);
  const latest = await db.digitalMaster.findFirst({ where: { trackId: master.trackId }, orderBy: { version: "desc" }, select: { id: true } });
  if (latest?.id !== master.id) throw new DigitalError("EXCERPT_MASTER_CHANGED", 409);
  return master;
}
export async function latestDigitalExcerptEvent(db: DigitalExcerptDb, masterId: string) {
  return db.digitalEvent.findFirst({ where: { kind: DIGITAL_EXCERPT_EVENT, details: { path: ["binding", "masterId"], equals: masterId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, actorId: true, kind: true, details: true, createdAt: true } });
}
export async function lockDigitalExcerpt(db: DigitalExcerptDb, master: { id: string; trackId: string }) {
  // Share the ingestion lock, then serialize independent artistic decisions.
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${master.trackId}`})) IS NULL AS locked`;
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-excerpt:${master.id}`})) IS NULL AS locked`;
}
/** Read projection only. No storage key, source hash, actor details or master URL. */
export async function loadDigitalExcerptSelection(db: DigitalExcerptDb, master: DigitalExcerptMaster) {
  return digitalExcerptSelection(master, await latestDigitalExcerptEvent(db, master.id));
}
export async function appendDigitalExcerptEvent(db: DigitalExcerptDb, actorId: string, externalKey: string,
  previous: DigitalExcerptEvent | null, details: Omit<DigitalExcerptDetails, "recordHash">) {
  const createdAt = new Date(Math.max(Date.now(), (previous?.createdAt.getTime() ?? 0) + 1));
  return db.digitalEvent.create({ data: { actorId, externalKey, kind: DIGITAL_EXCERPT_EVENT, createdAt,
    details: { ...details, recordHash: digitalExcerptHash({ actorId, ...details }) } } });
}
export async function getDigitalExcerptSelection(actor: OrderActor, masterId: string) {
  requireDigitalEnvironment();
  return prisma.$transaction(async db => {
    await requireDigitalExcerptAdmin(db, actor.id);
    const master = await getCurrentDigitalExcerptMaster(db, masterId);
    return { selection: await loadDigitalExcerptSelection(db, master) };
  });
}
/** Artistic choices only: no updates of masters, acquisitions, rights, offers or original previews. */
export async function recordDigitalExcerptSelection(actor: OrderActor, masterId: string, raw: unknown, transaction?: DigitalExcerptDb) {
  const mode=requireDigitalEnvironment(); assertDigitalUuid(masterId); const input = digitalExcerptInput(raw);
  const recoveryReview = input.action === "validate-existing", currentReview=input.action==="validate-current", preparedReview=input.action==="validate-prepared";
  const existingReview = recoveryReview || currentReview || preparedReview;
  if (digitalRecoveryExcerptsReviewOnly() && !recoveryReview || currentReview && mode!=="LIVE" || preparedReview && mode!=="TEST") throw new DigitalError("EXCERPT_NOT_READY", 403);
  // Private candidate generation remains a QA preparation tool, not an unstaffed LIVE queue.
  if(mode==="LIVE"&&!currentReview)throw new DigitalError("EXCERPT_NOT_READY",403);
  const execute = async (db: DigitalExcerptDb) => {
    await requireDigitalExcerptAdmin(db, actor.id);
    let master = await getCurrentDigitalExcerptMaster(db, masterId);
    await lockDigitalExcerpt(db, master); master = await getCurrentDigitalExcerptMaster(db, masterId);
    const binding = digitalExcerptBinding(master); previewWindow(binding.durationMs, input.startMs);
    if (recoveryReview) assertRecoveryExcerptReview(master.track.projectId);
    if (currentReview) assertDigitalLiveObjectAssets(mode,[master.masterAsset,master.mp3Asset,master.previewAsset]);
    const externalKey = `dcn-excerpt:${masterId}:${input.idempotencyKey}`, requestHash = digitalExcerptHash({ actorId: actor.id, binding, input });
    const duplicate = await db.digitalEvent.findUnique({ where: { externalKey }, select: { id: true, actorId: true, details: true, createdAt: true, kind: true } });
    if (duplicate) {
      const d = digitalExcerptDetails(duplicate, master);
      if (duplicate.actorId !== actor.id || d.requestHash !== requestHash) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
      return { selection: await loadDigitalExcerptSelection(db, master) };
    }
    const previous = await latestDigitalExcerptEvent(db, master.id), selection = digitalExcerptSelection(master, previous);
    assertDigitalExcerptRevision(selection, input.expectedRevisionId); assertDigitalExcerptValidation(selection, input);
    const previousDetails = previous ? digitalExcerptDetails(previous, master) : null;
    if (existingReview && (selection.status !== "TO_LISTEN" || input.startMs !== master.previewStartMs || !digitalExistingExcerptReady(master)))
      throw new DigitalError("EXCERPT_NOT_READY", 409);
    if (input.action === "validate") {
      const asset = await db.asset.findUnique({ where: { id: previousDetails!.candidateAssetId! } });
      if (!asset || !digitalExcerptCandidateReady(asset, previousDetails!)) throw new DigitalError("EXCERPT_NOT_READY", 409);
    }
    const status = input.action === "save" ? "DRAFT" : input.action === "generate" ? "QUEUED" : "VALIDATED";
    const event = await appendDigitalExcerptEvent(db, actor.id, externalKey, previous, {
      policy: DIGITAL_EXCERPT_POLICY, binding, status, startMs: input.startMs,
      candidateAssetId: existingReview ? master.previewAssetId : input.action === "validate" ? previousDetails!.candidateAssetId : null,
      candidateSha256: existingReview ? master.previewAsset!.checksumSha256 : input.action === "validate" ? previousDetails!.candidateSha256 : null,
      previewDurationMs: existingReview ? master.previewDurationMs : input.action === "validate" ? previousDetails!.previewDurationMs : null,
      requestId: input.action === "validate" ? previousDetails!.requestId : null,
      previousRevisionId: previous?.id ?? null, errorCode: null, attested: (input.action === "validate" || existingReview) && input.attested, requestHash,
      ...(existingReview ? { candidateOrigin: "EXISTING_PROVISIONAL" as const } : {}),
      ...(input.provenance ? { provenance: input.provenance, receiptId: input.receiptId ?? null } : {}),
    });
    return { selection: digitalExcerptSelection(master, event) };
  };
  return transaction ? execute(transaction) : prisma.$transaction(execute);
}
/** Candidate access requires its exact append-only binding; arbitrary private assets are never served. */
export async function getDigitalExcerptCandidate(actor: OrderActor, candidateId: string) {
  requireDigitalEnvironment(); assertDigitalUuid(candidateId);
  return prisma.$transaction(async db => {
    await requireDigitalExcerptAdmin(db, actor.id);
    const event = await db.digitalEvent.findFirst({ where: { kind: DIGITAL_EXCERPT_EVENT, details: { path: ["candidateAssetId"], equals: candidateId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, actorId: true, kind: true, details: true, createdAt: true } });
    if (!event || !event.details || typeof event.details !== "object" || Array.isArray(event.details)) throw new DigitalError("NOT_FOUND", 404);
    const rawBinding = (event.details as Record<string, unknown>).binding;
    if (!rawBinding || typeof rawBinding !== "object" || Array.isArray(rawBinding)) throw new DigitalError("NOT_FOUND", 404);
    const masterId = (rawBinding as Record<string, unknown>).masterId; assertDigitalUuid(masterId);
    // Older candidates remain inspectable by Admin, but are never promoted into a master or public route.
    const master = await db.digitalMaster.findUnique({ where: { id: masterId }, include: digitalExcerptMasterInclude });
    if (!master) throw new DigitalError("NOT_FOUND", 404);
    const details = digitalExcerptDetails(event, master), asset = await db.asset.findUnique({ where: { id: candidateId } });
    if (!["READY", "VALIDATED"].includes(details.status) || details.candidateAssetId !== candidateId || !asset || !digitalExcerptCandidateReady(asset, details)) throw new DigitalError("NOT_FOUND", 404);
    return asset;
  });
}
