import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DigitalStudioJob, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getMediaObject } from "@/lib/media/storage";
import type { OrderActor } from "@/lib/orders/domain";
import { assertDigitalUuid, DigitalError, signatureMatches } from "./domain";
import { requireDigitalExcerptAdmin } from "./excerpt-service";
import { assertStudioExistingSource, studioExistingMetadataHash, studioExistingSourceInput, type StudioExistingSourceSnapshot } from "./studio-existing-source-policy";
import { requireStudioEnvironment, studioEnabled, studioHash } from "./studio-policy";
import { processStudioBoundSource } from "./studio-worker";
import { DIGITAL_WORK_LIMITS, checkDigitalDisk, releaseDigitalSlot, renewDigitalSlot } from "./work-slots";

export const studioExistingMasterInclude = { masterAsset: true, track: { include: { credits: { orderBy: { id: "asc" as const } },
  project: { include: { credits: { orderBy: { id: "asc" as const } } } } } } } as const;
type ExistingMaster = Prisma.DigitalMasterGetPayload<{ include: typeof studioExistingMasterInclude }>;
export function studioExistingSourceSnapshot(master: ExistingMaster): StudioExistingSourceSnapshot {
  return { id: master.id, trackId: master.trackId, version: master.version, status: master.status, previewStartMs: master.previewStartMs,
    title: master.track.title, album: master.track.project.type === "ALBUM" ? master.track.project.title : null,
    metadata: { credits: [...master.track.project.credits, ...master.track.credits].map(credit => ({ name: credit.name, role: credit.role, note: credit.note })),
      ...(master.track.project.releaseDate ? { date: master.track.project.releaseDate.toISOString().slice(0, 10) } : {}) }, source: master.masterAsset };
}

/** No upload is fabricated or reset. This entry point requires an explicit
 * owner-reviewed selection of exact private master IDs, hashes and metadata. */
export async function prepareExistingStudioSources(actor: OrderActor, raw: unknown) {
  requireStudioEnvironment();
  const sources = studioExistingSourceInput(raw);
  await requireDigitalExcerptAdmin(prisma, actor.id);
  const jobs: Array<{ jobId: string; masterId: string; reused: boolean; status: string }> = [];
  for (const input of sources) {
    const result = await prisma.$transaction(async tx => {
      await requireDigitalExcerptAdmin(tx, actor.id);
      const master = await tx.digitalMaster.findUnique({ where: { id: input.masterId }, include: studioExistingMasterInclude });
      if (!master) throw new DigitalError("NOT_FOUND", 404);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${master.trackId}`})) IS NULL AS locked`;
      const current = await tx.digitalMaster.findFirst({ where: { trackId: master.trackId }, orderBy: { version: "desc" }, include: studioExistingMasterInclude });
      if (!current || current.id !== master.id) throw new DigitalError("MASTER_VERSION_CONFLICT", 409);
      const snapshot = studioExistingSourceSnapshot(current), preparationKey = assertStudioExistingSource(snapshot, input);
      const existing = await tx.digitalStudioJob.findFirst({ where: { preparationKey }, orderBy: { attempt: "desc" } });
      if (existing) return { jobId: existing.id, masterId: master.id, reused: true, status: existing.status };
      if (await tx.digitalUpload.findFirst({ where: { trackId: master.trackId, status: { in: ["PREPARING", "UPLOADING", "COMPLETING", "QUARANTINE", "VALIDATING"] },
        expiresAt: { gt: new Date() } }, select: { id: true } })) throw new DigitalError("UPLOAD_ALREADY_ACTIVE", 409);
      const job = await tx.digitalStudioJob.create({ data: { uploadId: null, preparationKey, previewStartMs: snapshot.previewStartMs,
        actorId: actor.id, trackId: snapshot.trackId, baseMasterId: snapshot.id, expectedVersion: snapshot.version, title: snapshot.title, album: snapshot.album,
        metadata: snapshot.metadata as Prisma.InputJsonValue, sourceAssetId: snapshot.source.id, sourceSha256: snapshot.source.checksumSha256!, sourceLossy: snapshot.source.mimeType === "audio/mpeg" } });
      await tx.digitalEvent.create({ data: { actorId: actor.id, kind: "STUDIO_EXISTING_SOURCE_QUEUED", externalKey: `studio-queued:${job.id}`, details: {
        jobId: job.id, masterId: master.id, sourceAssetId: snapshot.source.id, sourceSha256: snapshot.source.checksumSha256,
        metadataHash: studioExistingMetadataHash(snapshot), preparationKey, originalReused: true, uploadsChanged: false, masterChanged: false, offerActivated: false } } });
      return { jobId: job.id, masterId: master.id, reused: false, status: job.status };
    }, { timeout: 15_000 });
    jobs.push(result);
  }
  return { jobs, preparationOnly: true as const, commercialActivation: false as const };
}

function restoreJob(job: Pick<DigitalStudioJob, "report">) {
  return !!job.report && typeof job.report === "object" && !Array.isArray(job.report) && "studioRestore" in job.report;
}

/** Used before reading source bytes and again under the track lock immediately
 * before READY. A change never causes substitution of a different recording. */
export async function assertStudioExistingJobCurrent(tx: Prisma.TransactionClient, job: DigitalStudioJob) {
  if (job.uploadId || !job.baseMasterId || !job.preparationKey || !job.sourceAssetId || !job.sourceSha256 || job.previewStartMs === null) throw new DigitalError("STUDIO_SOURCE_CHANGED", 409);
  await requireDigitalExcerptAdmin(tx, job.actorId);
  const latest = await tx.digitalMaster.findFirst({ where: { trackId: job.trackId }, orderBy: { version: "desc" }, include: studioExistingMasterInclude });
  if (!latest || latest.id !== job.baseMasterId || latest.version !== job.expectedVersion) throw new DigitalError("MASTER_VERSION_CONFLICT", 409);
  const snapshot = studioExistingSourceSnapshot(latest);
  if (snapshot.title !== job.title || snapshot.album !== job.album || studioHash(snapshot.metadata) !== studioHash(job.metadata)) throw new DigitalError("STUDIO_METADATA_CHANGED", 409);
  if (!restoreJob(job) && assertStudioExistingSource(snapshot, { masterId: job.baseMasterId, expectedVersion: job.expectedVersion,
    sourceAssetId: job.sourceAssetId, sourceSha256: job.sourceSha256, expectedMetadataHash: studioExistingMetadataHash({ ...snapshot, previewStartMs: job.previewStartMs }) }) !== job.preparationKey) throw new DigitalError("STUDIO_SOURCE_CHANGED", 409);
  const source = await tx.asset.findUnique({ where: { id: job.sourceAssetId } });
  if (!source || source.visibility !== "PRIVATE" || source.checksumSha256 !== job.sourceSha256 || source.sizeBytes < 12n || source.sizeBytes > BigInt(DIGITAL_WORK_LIMITS.masterBytes)
    || !["audio/wav", "audio/mpeg"].includes(source.mimeType)) throw new DigitalError("STUDIO_SOURCE_CHANGED", 409);
  return source;
}

async function claimExistingSource(jobId?: string) {
  const now = new Date();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('studio-existing-audio')) IS NULL AS locked`;
    // Cross-process bound: only one existing-source/restore preparation may use
    // one of the already provisioned audio slots. Legacy upload priority is kept
    // by the existing worker's caller, not a second scheduler or poll loop.
    if (await tx.digitalStudioJob.findFirst({ where: { uploadId: null, status: "PROCESSING", leaseUntil: { gt: now } }, select: { id: true } })) return null;
    const job = await tx.digitalStudioJob.findFirst({ where: { ...(jobId ? { id: jobId } : {}), uploadId: null, preparationKey: { not: null }, binding: null, decision: "PENDING",
      OR: [{ status: "QUEUED" }, { status: "PROCESSING", leaseUntil: { lte: now } }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!job) return null;
    for (let i = 0; i < DIGITAL_WORK_LIMITS.audioConcurrency; i++) {
      const id = `audio-${i}`, leaseToken = randomUUID();
      const slot = await tx.digitalWorkSlot.updateMany({ where: { id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
        data: { jobId: job.id, leaseToken, leaseUntil: new Date(Date.now() + DIGITAL_WORK_LIMITS.leaseMs) } });
      if (!slot.count) continue;
      await tx.digitalStudioJob.update({ where: { id: job.id }, data: { status: "PROCESSING", phase: "ANALYZING", leaseToken,
        leaseUntil: new Date(Date.now() + 15 * 60_000), errorCode: null } });
      return { job: { ...job, status: "PROCESSING", leaseToken }, slot: { id, jobId: job.id, leaseToken } };
    }
    return null;
  });
}

/** One bounded invocation from the existing isolated media worker. No poll,
 * financial API, automatic approval, current-master switch or historical write. */
export async function processNextStudioExistingSource(hooks: { signal?: AbortSignal; jobId?: string; afterSource?: () => Promise<void> } = {}) {
  requireStudioEnvironment(); if (hooks.signal?.aborted) return { processed: false as const };
  if (hooks.jobId) assertDigitalUuid(hooks.jobId);
  const claim = await claimExistingSource(hooks.jobId);
  if (!claim) return { processed: false as const };
  const { job, slot } = claim, stop = new AbortController();
  let temporary: string | null = null, temporaryOwned = false, renewing = false;
  const abort = () => stop.abort(); hooks.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 20 * 60_000);
  const heartbeat = setInterval(() => { if (renewing) return; renewing = true; void (async () => {
    if (!studioEnabled() || !await renewDigitalSlot(slot) || !(await prisma.digitalStudioJob.updateMany({ where: { id: job.id, status: "PROCESSING", leaseToken: slot.leaseToken,
      leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + 15 * 60_000) } })).count) stop.abort();
  })().catch(() => stop.abort()).finally(() => { renewing = false; }); }, 10_000);
  try {
    if (hooks.signal?.aborted) stop.abort(); if (stop.signal.aborted) throw new DigitalError("WORKER_SHUTDOWN");
    const sourceAsset = await assertStudioExistingJobCurrent(prisma, job);
    const expectedSize = Number(sourceAsset.sizeBytes);
    temporary = path.join(await checkDigitalDisk(Math.min(4_294_967_295, expectedSize * 8 + 16 * 1024 * 1024)), `studio-existing-${job.id}.${slot.leaseToken}`);
    await mkdir(temporary, { mode: 0o700 }); temporaryOwned = true;
    const extension = sourceAsset.mimeType === "audio/wav" ? "wav" : "mp3", source = path.join(temporary, `source.${extension}`);
    const object = await getMediaObject(sourceAsset); if (object.contentLength !== expectedSize) { await object.body.cancel(); throw new DigitalError("SIZE_MISMATCH", 409); }
    const hash = createHash("sha256"); let bytes = 0;
    await pipeline(Readable.fromWeb(object.body as never), new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > expectedSize) return callback(new DigitalError("SIZE_MISMATCH", 409));
      if (process.memoryUsage().rss > DIGITAL_WORK_LIMITS.nodeRssBytes) return callback(new DigitalError("WORKER_MEMORY_LIMIT", 503));
      hash.update(chunk); callback(null, chunk);
    } }), createWriteStream(source, { flags: "wx", mode: 0o600 }), { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(5 * 60_000)]) });
    if (bytes !== expectedSize || hash.digest("hex") !== job.sourceSha256) throw new DigitalError("STUDIO_SOURCE_CHANGED", 409);
    const fd = await open(source, "r"), header = Buffer.alloc(12); try { await fd.read(header, 0, 12, 0); } finally { await fd.close(); }
    if (!signatureMatches(header, extension)) throw new DigitalError("INVALID_SIGNATURE");
    await hooks.afterSource?.();
    if (restoreJob(job)) {
      const { processStudioRestoreJob } = await import("./studio-restore");
      await processStudioRestoreJob(job, { leaseToken: slot.leaseToken, signal: stop.signal, slot });
      return { processed: true as const, ready: true, studio: true, existingSource: true, restoredCandidate: true, jobId: job.id, errorCode: undefined };
    }
    const result = await processStudioBoundSource({ jobId: job.id, sourceAsset, source, outputDirectory: path.join(temporary, "studio"),
      checksum: job.sourceSha256!, previewStartMs: job.previewStartMs!, signal: stop.signal, leaseToken: slot.leaseToken, slot,
      validateCurrent: async tx => { await assertStudioExistingJobCurrent(tx, job); } });
    return { ...result, existingSource: true };
  } catch (error) {
    const errorCode = stop.signal.aborted ? "WORKER_SHUTDOWN" : error instanceof DigitalError ? error.code : "STUDIO_PROCESSING_FAILED";
    await prisma.digitalStudioJob.updateMany({ where: { id: job.id, status: "PROCESSING", leaseToken: slot.leaseToken },
      data: { status: "FAILED", phase: "ERROR", errorCode, leaseToken: null, leaseUntil: null } });
    return { processed: true as const, ready: false, studio: true, existingSource: true, jobId: job.id, errorCode };
  } finally {
    hooks.signal?.removeEventListener("abort", abort); clearTimeout(timeout); clearInterval(heartbeat); stop.abort();
    if (temporary && temporaryOwned) await rm(temporary, { recursive: true, force: true });
    await releaseDigitalSlot(slot);
  }
}
