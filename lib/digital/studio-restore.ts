import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assertDigitalUuid, DigitalError } from "./domain";
import { requireStudioEnvironment } from "./studio-policy";
import { assertStudioRestoreRequest, STUDIO_RESTORE_COPY_ROLES, STUDIO_RESTORE_POLICY, STUDIO_RESTORE_REQUIRED_ROLES, type StudioRestoreCurrent } from "./studio-restore-policy";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { studioBinding, studioHash } from "./studio-policy";
import { requireDigitalExcerptAdmin } from "./excerpt-service";
import { MediaStorageError, type MediaObject, type MediaObjectMetadata, type MediaStorageReference } from "@/lib/media/storage/types";

/** Not connected to an API or worker until the independent schema/permission
 * guards have been authorised. It only copies bytes; it cannot approve, create
 * a master, change an acquisition or publish anything. */
type RestoreAsset = MediaStorageReference & { checksumSha256: string | null; sizeBytes: bigint | number; mimeType: string };
type Put = {
  scope: "private"; key: string; body: Readable; contentLength: number; contentType: string; checksumSha256: string;
};
type Stored = { storageBackend: "LOCAL" | "OBJECT"; storageProvider: string };
export type StudioRestoreCopyDependencies = {
  destination: Stored;
  get(reference: MediaStorageReference): Promise<MediaObject>;
  head(reference: MediaStorageReference): Promise<MediaObjectMetadata>;
  put(input: Put): Promise<Stored>;
};
async function dependencies(): Promise<StudioRestoreCopyDependencies> {
  const { activeStorageMetadata, getMediaObject, headMediaObject, putMediaObject } = await import("@/lib/media/storage");
  return { destination: activeStorageMetadata(), get: getMediaObject, head: headMediaObject, put: putMediaObject };
}
function checkedSize(asset: RestoreAsset, role: string) {
  const size = Number(asset.sizeBytes), maximum = role === "PREVIEW" ? 3 * 1024 * 1024 : asset.mimeType === "audio/mpeg" ? 96 * 1024 * 1024 : 512 * 1024 * 1024;
  const expectedMime = role === "WAV_CD" || role === "WAV_24" ? "audio/wav" : "audio/mpeg";
  if (!Number.isSafeInteger(size) || size < 1 || size > maximum || asset.visibility !== "PRIVATE" || !/^[a-f0-9]{64}$/.test(asset.checksumSha256 ?? "")
    || asset.mimeType !== expectedMime) throw new DigitalError("STUDIO_RESTORE_ASSET_INVALID", 409);
  return size;
}
function active(signal: AbortSignal) { if (signal.aborted) throw new DigitalError("WORKER_SHUTDOWN"); }
function verifier(expectedSize: number, expectedHash: string) {
  let bytes = 0; const hash = createHash("sha256");
  return new Transform({ transform(chunk: Buffer, _, callback) {
    if (process.memoryUsage().rss > 512 * 1024 * 1024) return callback(new DigitalError("WORKER_MEMORY_LIMIT", 503));
    bytes += chunk.length;
    if (bytes > expectedSize) return callback(new DigitalError("STUDIO_RESTORE_INTEGRITY", 409));
    hash.update(chunk); callback(null, chunk);
  }, flush(callback) {
    callback(bytes === expectedSize && hash.digest("hex") === expectedHash ? null : new DigitalError("STUDIO_RESTORE_INTEGRITY", 409));
  } });
}
async function verifyObject(object: MediaObject, size: number, checksum: string, signal: AbortSignal) {
  if (object.contentLength !== size) { await object.body.cancel(); throw new DigitalError("STUDIO_RESTORE_INTEGRITY", 409); }
  const sink = new Transform({ transform(_chunk, _, callback) { callback(); } });
  await pipeline(Readable.fromWeb(object.body as never), verifier(size, checksum), sink, { signal });
}
export async function copyStudioRestoreArtifact(input: {
  source: RestoreAsset; jobId: string; assetId: string; role: string; signal: AbortSignal;
}, supplied?: StudioRestoreCopyDependencies) {
  requireStudioEnvironment(); active(input.signal); assertDigitalUuid(input.jobId); assertDigitalUuid(input.assetId);
  if (!(STUDIO_RESTORE_COPY_ROLES as readonly string[]).includes(input.role)) throw new DigitalError("STUDIO_RESTORE_ASSET_INVALID", 409);
  const size = checkedSize(input.source, input.role), checksum = input.source.checksumSha256!, extension = input.source.mimeType === "audio/wav" ? "wav" : "mp3";
  const key = `digital/studio/${input.jobId}/${input.assetId}.${extension}`;
  if (key === input.source.storageKey) throw new DigitalError("STUDIO_RESTORE_OVERWRITE_REFUSED", 409);
  const storage = supplied ?? await dependencies(), signal = AbortSignal.any([input.signal, AbortSignal.timeout(5 * 60_000)]);
  try {
    await storage.head({ storageKey: key, ...storage.destination, visibility: "PRIVATE" });
    throw new DigitalError("STUDIO_RESTORE_OVERWRITE_REFUSED", 409);
  } catch (error) { if (!(error instanceof MediaStorageError) || error.code !== "NOT_FOUND") throw error; }
  const source = await storage.get(input.source); active(signal);
  if (source.contentLength !== size) { await source.body.cancel(); throw new DigitalError("STUDIO_RESTORE_INTEGRITY", 409); }
  const reader = Readable.fromWeb(source.body as never), checked = verifier(size, checksum);
  const transfer = pipeline(reader, checked, { signal });
  const store = storage.put({ scope: "private", key, body: checked, contentLength: size, contentType: input.source.mimeType, checksumSha256: checksum });
  let stored: Stored;
  try { [stored] = await Promise.all([store, transfer]); }
  catch (error) { reader.destroy(); checked.destroy(); await Promise.allSettled([store, transfer]); throw error; }
  active(signal);
  if (stored.storageBackend !== storage.destination.storageBackend || stored.storageProvider !== storage.destination.storageProvider) throw new DigitalError("STUDIO_RESTORE_STORAGE_CHANGED", 409);
  const reference = { storageKey: key, storageBackend: stored.storageBackend, storageProvider: stored.storageProvider, visibility: "PRIVATE" as const };
  // Read back the new object, not merely its declared checksum metadata.
  await verifyObject(await storage.get(reference), size, checksum, signal);
  return { ...reference, assetId: input.assetId, sha256: checksum, sizeBytes: size, mimeType: input.source.mimeType,
    evidence: "SOURCE_AND_PRIVATE_COPY_BYTES_SHA256_VERIFIED" as const };
}

const restoreInclude = { artifacts: { include: { asset: true } }, upload: { select: { previewStartMs: true } } } as const;
const restoreMasterInclude = { masterAsset: true, track: { include: { credits: { orderBy: { id: "asc" as const } }, project: { include: { credits: { orderBy: { id: "asc" as const } } } } } } } as const;
type RestoreJob = Prisma.DigitalStudioJobGetPayload<{ include: typeof restoreInclude }>;
type RestoreDB = Prisma.TransactionClient;
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
async function currentSnapshot(db: RestoreDB, trackId: string) {
  const master = await db.digitalMaster.findFirst({ where: { trackId }, orderBy: { version: "desc" }, include: restoreMasterInclude });
  if (!master) throw new DigitalError("STUDIO_RESTORE_CURRENT_REQUIRED", 409);
  const metadata = { credits: [...master.track.project.credits, ...master.track.credits].map(credit => ({ name: credit.name, role: credit.role, note: credit.note })),
    ...(master.track.project.releaseDate ? { date: master.track.project.releaseDate.toISOString().slice(0, 10) } : {}) };
  const snapshot: StudioRestoreCurrent = { id: master.id, trackId: master.trackId, version: master.version, masterAssetId: master.masterAssetId,
    masterSha256: master.masterAsset.checksumSha256, title: master.track.title, album: master.track.project.type === "ALBUM" ? master.track.project.title : null, metadata };
  return { master, snapshot };
}
async function approvedSource(db: RestoreDB, id: string, expected: string) {
  const job = await db.digitalStudioJob.findUnique({ where: { id }, include: restoreInclude });
  if (!job || job.status !== "READY" || job.decision !== "APPROVED" || job.sourceLossy || !job.publishedMasterId || !job.binding
    || job.binding !== expected || studioBinding(job, job.artifacts) !== expected) throw new DigitalError("STUDIO_RESTORE_NOT_AVAILABLE", 409);
  const approval = await db.digitalEvent.findUnique({ where: { externalKey: `studio-approved:${id}` } }), proof = record(approval?.details);
  if (approval?.kind !== "STUDIO_FILES_APPROVED" || proof?.binding !== expected || proof.humanListened !== true || proof.publishedMasterId !== job.publishedMasterId) throw new DigitalError("STUDIO_RESTORE_APPROVAL_REQUIRED", 409);
  for (const role of STUDIO_RESTORE_REQUIRED_ROLES) {
    const file = job.artifacts.find(item => item.role === role);
    if (!file || file.asset.visibility !== "PRIVATE" || !/^[a-f0-9]{64}$/.test(file.asset.checksumSha256 ?? "") || file.asset.sizeBytes <= 0n
      || (["MP3", "WAV_CD", "WAV_24"].includes(role) && !file.metadataVerified)) throw new DigitalError("STUDIO_RESTORE_ASSET_INVALID", 409);
  }
  const published = await db.digitalMaster.findUnique({ where: { id: job.publishedMasterId } });
  if (!published || published.trackId !== job.trackId || published.status !== "READY" || published.codec !== "wav"
    || published.masterAssetId !== job.artifacts.find(item => item.role === "WAV_24")!.assetId
    || published.mp3AssetId !== job.artifacts.find(item => item.role === "MP3")!.assetId) throw new DigitalError("STUDIO_RESTORE_APPROVAL_REQUIRED", 409);
  const original = job.artifacts.find(item => item.role === "ORIGINAL")!, preview = record(record(job.report)?.preview);
  const previewStartMs = job.previewStartMs ?? job.upload?.previewStartMs;
  if (job.sourceAssetId !== original.assetId || job.sourceSha256 !== original.asset.checksumSha256 || !Number.isSafeInteger(previewStartMs)
    || previewStartMs! < 0 || preview?.startMs !== previewStartMs) throw new DigitalError("STUDIO_PREVIEW_CHANGED", 409);
  return { job, original, previewStartMs: previewStartMs! };
}

/** Enqueues only an exact-byte private candidate. This does not restore a
 * current master. The ordinary human approval must subsequently append N+1. */
export async function prepareStudioRestore(actor: OrderActor, input: {
  jobId: string; expectedBinding: string; expectedCurrentBinding?: string; confirmReplacement: boolean; confirmExistingPurchases: boolean;
}) {
  requireStudioEnvironment(); assertDigitalUuid(input.jobId);
  const { prisma } = await import("@/lib/prisma");
  return prisma.$transaction(async tx => {
    await requireDigitalExcerptAdmin(tx, actor.id);
    const initial = await tx.digitalStudioJob.findUnique({ where: { id: input.jobId }, select: { trackId: true } });
    if (!initial) throw new DigitalError("NOT_FOUND", 404);
    const track = await tx.track.findUniqueOrThrow({ where: { id: initial.trackId }, select: { projectId: true } });
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-project:${track.projectId}`})) IS NULL AS locked`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${initial.trackId}`})) IS NULL AS locked`;
    const source = await approvedSource(tx, input.jobId, input.expectedBinding), current = await currentSnapshot(tx, initial.trackId);
    const intent = assertStudioRestoreRequest(source.job, current.snapshot, input);
    const hasAcquisitions = await tx.digitalEntitlement.count({ where: { masterId: current.master.id, status: "ACTIVE" } });
    if (hasAcquisitions && !input.confirmExistingPurchases) throw new DigitalError("STUDIO_EXISTING_PURCHASES_CONFIRMATION_REQUIRED", 409);
    const existing = await tx.digitalStudioJob.findFirst({ where: { preparationKey: intent.preparationKey }, orderBy: { attempt: "desc" } });
    if (existing) return { ok: true as const, jobId: existing.id, duplicate: true };
    const report = { studioRestore: { policy: STUDIO_RESTORE_POLICY, sourceJobId: source.job.id, sourceBinding: source.job.binding!, currentBinding: intent.currentBinding,
      currentMasterId: current.master.id, currentVersion: current.master.version, sourcePublishedMasterId: source.job.publishedMasterId!,
      humanApprovalRequired: true, previousApprovalCopied: false } };
    const created = await tx.digitalStudioJob.create({ data: { uploadId: null, preparationKey: intent.preparationKey, attempt: 1, actorId: actor.id, trackId: source.job.trackId,
      baseMasterId: current.master.id, expectedVersion: current.master.version, title: current.snapshot.title, album: current.snapshot.album,
      metadata: current.snapshot.metadata as Prisma.InputJsonValue, sourceAssetId: source.original.assetId, sourceSha256: source.original.asset.checksumSha256!,
      sourceLossy: false, previewStartMs: source.previewStartMs, status: "QUEUED", phase: "IMPORTED", decision: "PENDING", report } });
    await tx.digitalEvent.create({ data: { actorId: actor.id, kind: "STUDIO_RESTORE_PREPARATION_REQUESTED", externalKey: `studio-restore:${intent.preparationKey}`,
      details: { jobId: created.id, sourceJobId: source.job.id, sourceBinding: source.job.binding, currentBinding: intent.currentBinding,
        currentMasterId: current.master.id, preparationOnly: true, humanListened: false, rightsApproved: false, offerActivated: false, historicalAcquisitionsChanged: false } } });
    return { ok: true as const, jobId: created.id, duplicate: false };
  }, { timeout: 30_000 });
}

function restoreIntent(job: RestoreJob) {
  const intent = record(record(job.report)?.studioRestore);
  if (!intent || intent.policy !== STUDIO_RESTORE_POLICY || typeof intent.sourceJobId !== "string" || typeof intent.sourceBinding !== "string"
    || !/^[a-f0-9]{64}$/.test(intent.sourceBinding) || typeof intent.currentBinding !== "string" || !/^[a-f0-9]{64}$/.test(intent.currentBinding)
    || intent.currentMasterId !== job.baseMasterId || intent.currentVersion !== job.expectedVersion || intent.humanApprovalRequired !== true
    || intent.previousApprovalCopied !== false) throw new DigitalError("STUDIO_RESTORE_INTENT_INVALID", 409);
  assertDigitalUuid(intent.sourceJobId);
  return { ...intent, sourceJobId: intent.sourceJobId, sourceBinding: intent.sourceBinding, currentBinding: intent.currentBinding };
}
async function assertRestoreLease(db: RestoreDB, job: RestoreJob, input: { leaseToken: string; slot: { id: string; leaseToken: string } }) {
  if (job.status !== "PROCESSING" || job.decision !== "PENDING" || job.binding || job.leaseToken !== input.leaseToken || !job.leaseUntil || job.leaseUntil.getTime() <= Date.now()
    || !await db.digitalWorkSlot.findFirst({ where: { id: input.slot.id, jobId: job.id, leaseToken: input.slot.leaseToken, leaseUntil: { gt: new Date() } } })) throw new DigitalError("LEASE_LOST", 409);
  await requireDigitalExcerptAdmin(db, job.actorId);
}
export async function processStudioRestoreJob(job: { id: string }, input: { leaseToken: string; signal: AbortSignal; slot: { id: string; leaseToken: string } }) {
  requireStudioEnvironment(); active(input.signal);
  const { prisma } = await import("@/lib/prisma"), storage = await dependencies();
  const currentJob = await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: job.id }, include: restoreInclude });
  await assertRestoreLease(prisma, currentJob, input);
  const intent = restoreIntent(currentJob), source = await approvedSource(prisma, intent.sourceJobId, intent.sourceBinding), current = await currentSnapshot(prisma, currentJob.trackId);
  assertStudioRestoreRequest(source.job, current.snapshot, { expectedBinding: intent.sourceBinding, expectedCurrentBinding: intent.currentBinding, confirmReplacement: true });
  if (currentJob.sourceAssetId !== source.original.assetId || currentJob.sourceSha256 !== source.original.asset.checksumSha256 || currentJob.sourceLossy
    || currentJob.title !== source.job.title || currentJob.album !== source.job.album || studioHash(currentJob.metadata) !== studioHash(source.job.metadata)
    || currentJob.previewStartMs !== source.previewStartMs || currentJob.artifacts.length) throw new DigitalError("STUDIO_RESTORE_INTENT_INVALID", 409);
  const originalSize = Number(source.original.asset.sizeBytes);
  if (!Number.isSafeInteger(originalSize) || originalSize < 1 || originalSize > 512 * 1024 * 1024) throw new DigitalError("STUDIO_RESTORE_ASSET_INVALID", 409);
  await verifyObject(await storage.get(source.original.asset), originalSize, source.original.asset.checksumSha256!, input.signal);
  if (!(await prisma.digitalStudioJob.updateMany({ where: { id: job.id, status: "PROCESSING", leaseToken: input.leaseToken }, data: { phase: "VERIFYING" } })).count) throw new DigitalError("LEASE_LOST", 409);
  const copied: Array<{ source: RestoreJob["artifacts"][number]; result: Awaited<ReturnType<typeof copyStudioRestoreArtifact>> }> = [];
  for (const file of source.job.artifacts) {
    if (!(STUDIO_RESTORE_COPY_ROLES as readonly string[]).includes(file.role)) continue;
    const result = await copyStudioRestoreArtifact({ source: file.asset, jobId: job.id, assetId: randomUUID(), role: file.role, signal: input.signal }, storage);
    copied.push({ source: file, result });
  }
  active(input.signal);
  await prisma.$transaction(async tx => {
    const track = await tx.track.findUniqueOrThrow({ where: { id: currentJob.trackId }, select: { projectId: true } });
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-project:${track.projectId}`})) IS NULL AS locked`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${currentJob.trackId}`})) IS NULL AS locked`;
    const pending = await tx.digitalStudioJob.findUniqueOrThrow({ where: { id: job.id }, include: restoreInclude });
    await assertRestoreLease(tx, pending, input);
    const finalIntent = restoreIntent(pending), old = await approvedSource(tx, finalIntent.sourceJobId, finalIntent.sourceBinding), latest = await currentSnapshot(tx, pending.trackId);
    assertStudioRestoreRequest(old.job, latest.snapshot, { expectedBinding: finalIntent.sourceBinding, expectedCurrentBinding: finalIntent.currentBinding, confirmReplacement: true });
    if (pending.baseMasterId !== latest.master.id || pending.expectedVersion !== latest.master.version || pending.artifacts.length
      || pending.sourceAssetId !== old.original.assetId || pending.sourceSha256 !== old.original.asset.checksumSha256) throw new DigitalError("MASTER_VERSION_CONFLICT", 409);
    await tx.digitalStudioArtifact.create({ data: { jobId: job.id, role: "ORIGINAL", assetId: old.original.assetId, sampleRate: old.original.sampleRate, bitDepth: old.original.bitDepth,
      bitrateKbps: old.original.bitrateKbps, integratedLufs: old.original.integratedLufs, truePeakDbtp: old.original.truePeakDbtp, metadataVerified: old.original.metadataVerified } });
    for (const file of copied) {
      await tx.asset.create({ data: { id: file.result.assetId, type: file.source.asset.type, storageKey: file.result.storageKey, storageBackend: file.result.storageBackend,
        storageProvider: file.result.storageProvider, visibility: "PRIVATE", filename: file.source.asset.filename, mimeType: file.result.mimeType,
        sizeBytes: BigInt(file.result.sizeBytes), durationMs: file.source.asset.durationMs, checksumSha256: file.result.sha256, rightsStatus: "PENDING", confidence: "CONFIRMED" } });
      await tx.digitalStudioArtifact.create({ data: { jobId: job.id, role: file.source.role, assetId: file.result.assetId, sampleRate: file.source.sampleRate, bitDepth: file.source.bitDepth,
        bitrateKbps: file.source.bitrateKbps, integratedLufs: file.source.integratedLufs, truePeakDbtp: file.source.truePeakDbtp, metadataVerified: file.source.metadataVerified } });
    }
    const complete = await tx.digitalStudioJob.findUniqueOrThrow({ where: { id: job.id }, include: restoreInclude });
    const report = { ...record(old.job.report), studioRestore: { ...finalIntent, copyEvidence: copied.map(file => ({ role: file.source.role, previousAssetId: file.source.assetId,
      assetId: file.result.assetId, sha256: file.result.sha256, sizeBytes: file.result.sizeBytes, evidence: file.result.evidence })),
      humanApprovalRequired: true, previousApprovalCopied: false, newHumanListening: "NOT_PERFORMED" } } as Prisma.InputJsonValue;
    const binding = studioBinding({ ...complete, report }, complete.artifacts);
    await tx.digitalStudioJob.update({ where: { id: job.id }, data: { status: "READY", phase: "READY", binding, report, leaseToken: null, leaseUntil: null, errorCode: null } });
    await tx.digitalEvent.create({ data: { actorId: pending.actorId, kind: "STUDIO_RESTORE_CANDIDATE_READY", externalKey: `studio-restore-ready:${job.id}`,
      details: { jobId: job.id, sourceJobId: old.job.id, binding, sourceBinding: old.job.binding, previousMasterId: pending.baseMasterId,
        preparationOnly: true, humanListened: false, rightsApproved: false, offerActivated: false, historicalAcquisitionsChanged: false } } });
  }, { timeout: 30_000 });
  return { processed: true, ready: true, studio: true, restoreCandidate: true, jobId: job.id, commercialActivation: false };
}
