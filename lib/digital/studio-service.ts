import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getMediaObject, putMediaObject } from "@/lib/media/storage";
import type { OrderActor } from "@/lib/orders/domain";
import { assertDigitalUuid, DigitalError } from "./domain";
import { requireDigitalExcerptAdmin } from "./excerpt-service";
import { expressDurationSeconds } from "./express-policy";
import { studioExistingMasterInclude, studioExistingSourceSnapshot } from "./studio-existing-source";
import { studioExistingMetadataHash, studioExistingPreparationKey } from "./studio-existing-source-policy";
import { studioRestoreAvailability } from "./studio-restore-policy";
import { requireStudioEnvironment, studioBinding, studioEnabled, studioHash, studioMutation, STUDIO_ROLES } from "./studio-policy";

export const STUDIO_MASTER_ENCODER = "lnx-beats-studio-v1";
const include = { artifacts: { include: { asset: true }, orderBy: { role: "asc" as const } } } as const;
type Job = Prisma.DigitalStudioJobGetPayload<{ include: typeof include }>;
function binding(job: Job) { return job.binding ?? studioBinding(job, job.artifacts); }
function projection(job: Job) {
  return { id: job.id, trackId: job.trackId, title: job.title, status: job.status, phase: job.phase, decision: job.decision,
    errorCode: job.errorCode, binding: binding(job), sourceLossy: job.sourceLossy, baseMasterId: job.baseMasterId,
    publishedMasterId: job.publishedMasterId, allowExistingPurchases: job.allowExistingPurchases, approved: job.decision === "APPROVED", attempt: job.attempt,
    createdAt: job.createdAt.toISOString(), artifacts: job.artifacts.map(item => ({ role: item.role, filename: item.asset.filename,
      mimeType: item.asset.mimeType, sizeBytes: Number(item.asset.sizeBytes), durationMs: item.asset.durationMs, sampleRate: item.sampleRate,
      bitDepth: item.bitDepth, bitrateKbps: item.bitrateKbps, integratedLufs: item.integratedLufs, truePeakDbtp: item.truePeakDbtp,
      sha256: item.asset.checksumSha256, metadataVerified: item.metadataVerified,
      audioUrl: `/api/admin/digital/studio/${job.id}/audio/${item.role}` })), report: job.report };
}
export async function listStudioJobs(actor: OrderActor, projectId: string | null) {
  if (!studioEnabled()) return { enabled: false, jobs: [], existingSources: [] };
  if (projectId) assertDigitalUuid(projectId);
  await requireDigitalExcerptAdmin(prisma, actor.id);
  const tracks = projectId ? await prisma.track.findMany({ where: { projectId }, select: { id: true } }) : null;
  const jobs = await prisma.digitalStudioJob.findMany({ where: tracks ? { trackId: { in: tracks.map(track => track.id) } } : {}, include,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
  // Project-scoped, read-only proposal. An explicit separate Admin action is
  // still required; this projection neither enqueues nor changes a master.
  const currentTrackIds = [...new Set(tracks ? tracks.map(track => track.id) : jobs.map(job => job.trackId))];
  const current = currentTrackIds.length ? await prisma.digitalMaster.findMany({ where: { trackId: { in: currentTrackIds } },
    orderBy: [{ trackId: "asc" }, { version: "desc" }], distinct: ["trackId"], include: studioExistingMasterInclude }) : [];
  const acquired = await prisma.digitalEntitlement.groupBy({ by: ["masterId"], where: { masterId: { in: [...current.map(master => master.id), ...jobs.flatMap(job => job.baseMasterId ? [job.baseMasterId] : [])] }, status: "ACTIVE" }, _count: true });
  const acquiredIds = new Set(acquired.map(row => row.masterId));
  const existingSources = (projectId ? current : []).flatMap(master => {
    try {
      const snapshot = studioExistingSourceSnapshot(master); studioExistingPreparationKey(snapshot);
      return [{ masterId: master.id, expectedVersion: master.version, sourceAssetId: master.masterAssetId, sourceSha256: snapshot.source.checksumSha256!,
        expectedMetadataHash: studioExistingMetadataHash(snapshot), title: snapshot.title, trackId: snapshot.trackId }];
    } catch (error) { if (error instanceof DigitalError) return []; throw error; }
  });
  return { enabled: true, jobs: jobs.map(job => {
    let availability: ReturnType<typeof studioRestoreAvailability> = { restoreAllowed: false, restoreCurrent: null };
    try {
      const latest = current.find(master => master.trackId === job.trackId), snapshot = latest ? studioExistingSourceSnapshot(latest) : null;
      const restoreCurrent = latest && snapshot ? { id: latest.id, trackId: latest.trackId, version: latest.version, masterAssetId: latest.masterAssetId,
        masterSha256: latest.masterAsset.checksumSha256, title: snapshot.title, album: snapshot.album, metadata: snapshot.metadata } : null;
      availability = studioRestoreAvailability(job, restoreCurrent, !!latest && acquiredIds.has(latest.id));
    } catch (error) { if (!(error instanceof DigitalError)) throw error; }
    return { ...projection(job), hasAcquisitions: !!job.baseMasterId && acquiredIds.has(job.baseMasterId), ...availability,
      restoreAllowed: availability.restoreAllowed && !!job.binding && studioBinding(job, job.artifacts) === job.binding };
  }), existingSources };
}
export async function studioAudioAsset(actor: OrderActor, jobId: string, role: string) {
  requireStudioEnvironment(); assertDigitalUuid(jobId);
  if (!(STUDIO_ROLES as readonly string[]).includes(role)) throw new DigitalError("NOT_FOUND", 404);
  await requireDigitalExcerptAdmin(prisma, actor.id);
  const item = await prisma.digitalStudioArtifact.findUnique({ where: { jobId_role: { jobId, role } }, include: { asset: true } });
  if (!item || item.asset.visibility !== "PRIVATE") throw new DigitalError("NOT_FOUND", 404);
  return item.asset;
}
async function checkedJob(actor: OrderActor, id: string, expected: string) {
  await requireDigitalExcerptAdmin(prisma, actor.id);
  const job = await prisma.digitalStudioJob.findUnique({ where: { id }, include });
  if (!job) throw new DigitalError("NOT_FOUND", 404);
  if (binding(job) !== expected || job.binding && studioBinding(job, job.artifacts) !== job.binding) throw new DigitalError("STUDIO_VERSION_CHANGED", 409);
  return job;
}
export async function mutateStudioJob(actor: OrderActor, raw: Record<string, unknown>) {
  requireStudioEnvironment(); const input = studioMutation(raw);
  const job = await checkedJob(actor, input.jobId, input.expectedBinding);
  if (input.action === "restore") {
    // Prepare only a NEW private PENDING candidate with exact old bytes. This
    // does not switch the current master or copy any historical human approval.
    const { prepareStudioRestore } = await import("./studio-restore");
    const prepared = await prepareStudioRestore(actor, input);
    return { ...prepared, preparationOnly: true, ...(await listStudioJobs(actor, null)) };
  }
  if (input.action === "retry") {
    if (!["FAILED", "READY"].includes(job.status)) throw new DigitalError("STUDIO_RETRY_NOT_ALLOWED", 409);
    const next = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${job.trackId}`})) IS NULL AS locked`;
      const current = await tx.digitalStudioJob.findUniqueOrThrow({ where: { id: job.id }, include });
      if (binding(current) !== input.expectedBinding) throw new DigitalError("STUDIO_VERSION_CHANGED", 409);
      const newer = await tx.digitalStudioJob.findFirst({ where: { ...(job.uploadId ? { uploadId: job.uploadId } : { preparationKey: job.preparationKey }), attempt: { gt: job.attempt } }, orderBy: { attempt: "desc" } });
      if (newer) return newer;
      if (!job.uploadId) {
        const { assertStudioExistingJobCurrent } = await import("./studio-existing-source");
        await assertStudioExistingJobCurrent(tx, job);
      }
      const latest = await tx.digitalMaster.findFirst({ where: { trackId: job.trackId }, orderBy: { version: "desc" } });
      const track = await tx.track.findUniqueOrThrow({ where: { id: job.trackId }, include: { credits: { orderBy: { id: "asc" } }, project: { include: { credits: { orderBy: { id: "asc" } } } } } });
      const metadata = { credits: [...track.project.credits, ...track.credits].map(credit => ({ name: credit.name, role: credit.role, note: credit.note })),
        ...(track.project.releaseDate ? { date: track.project.releaseDate.toISOString().slice(0, 10) } : {}) };
      const created = await tx.digitalStudioJob.create({ data: { uploadId: job.uploadId, attempt: job.attempt + 1, actorId: actor.id, trackId: job.trackId,
        baseMasterId: latest?.id ?? null, expectedVersion: latest?.version ?? 0, title: track.title, album: track.project.type === "ALBUM" ? track.project.title : null, metadata,
        sourceSha256: job.sourceSha256, ...(!job.uploadId ? { preparationKey: job.preparationKey, previewStartMs: job.previewStartMs, sourceAssetId: job.sourceAssetId,
          sourceLossy: job.sourceLossy, ...(job.report && typeof job.report === "object" && !Array.isArray(job.report) && "studioRestore" in job.report
            ? { report: { studioRestore: job.report.studioRestore } as Prisma.InputJsonValue } : {}) } : {}) } });
      if (job.uploadId) await tx.digitalUpload.update({ where: { id: job.uploadId }, data: { status: "QUARANTINE", leaseToken: null, leaseUntil: null, errorCode: null } });
      await tx.digitalEvent.create({ data: { actorId: actor.id, kind: "STUDIO_RETRY_REQUESTED", externalKey: `studio-retry:${job.id}`, details: { previousJobId: job.id, jobId: created.id, originalPreserved: true } } });
      return created;
    });
    return { ok: true, jobId: next.id, ...(await listStudioJobs(actor, null)) };
  }
  if (input.action === "reject") {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${job.trackId}`})) IS NULL AS locked`;
      const current = await tx.digitalStudioJob.findUniqueOrThrow({ where: { id: job.id }, include });
      if (binding(current) !== input.expectedBinding || current.decision === "APPROVED") throw new DigitalError("STUDIO_VERSION_CHANGED", 409);
      if (current.decision === "REJECTED") return;
      if (current.status !== "READY" && current.status !== "FAILED") throw new DigitalError("STUDIO_NOT_READY", 409);
      await tx.digitalStudioJob.update({ where: { id: job.id }, data: { decision: "REJECTED" } });
      await tx.digitalEvent.create({ data: { actorId: actor.id, kind: "STUDIO_FILES_REJECTED", externalKey: `studio-rejected:${job.id}`, details: { jobId: job.id, binding: input.expectedBinding, originalPreserved: true } } });
    });
    return { ok: true, ...(await listStudioJobs(actor, null)) };
  }
  if (!input.humanListened) throw new DigitalError("STUDIO_HUMAN_LISTENING_REQUIRED", 409);
  if (job.status !== "READY" || job.decision === "REJECTED" || !job.binding) throw new DigitalError("STUDIO_NOT_READY", 409);
  if (job.decision === "APPROVED") return { ok: true, ...(await listStudioJobs(actor, null)) };
  const required = ["MP3", "WAV_CD", "WAV_24"].map(role => job.artifacts.find(item => item.role === role));
  if (required.some(item => !item || !item.metadataVerified || item.asset.visibility !== "PRIVATE" || !/^[a-f0-9]{64}$/.test(item.asset.checksumSha256 ?? ""))) throw new DigitalError("STUDIO_VERIFICATION_REQUIRED", 409);
  if (job.baseMasterId && !input.confirmReplacement) throw new DigitalError("STUDIO_REPLACEMENT_CONFIRMATION_REQUIRED", 409);
  const existing = job.baseMasterId ? await prisma.digitalEntitlement.count({ where: { masterId: job.baseMasterId, status: "ACTIVE" } }) : 0;
  if (existing && !input.confirmExistingPurchases) throw new DigitalError("STUDIO_EXISTING_PURCHASES_CONFIRMATION_REQUIRED", 409);
  // Lossy-derived WAVs remain honest private candidates; the historical WAV
  // commercial contract is not silently extended or relabelled by this module.
  const promotable = !job.sourceLossy && required[0]!.bitrateKbps === 320;
  const previewStartMs = job.uploadId ? (await prisma.digitalUpload.findUniqueOrThrow({ where: { id: job.uploadId }, select: { previewStartMs: true } })).previewStartMs : job.previewStartMs;
  const report = job.report && typeof job.report === "object" && !Array.isArray(job.report) ? job.report as Record<string, unknown> : null;
  const previewProof = report?.preview && typeof report.preview === "object" && !Array.isArray(report.preview) ? report.preview as Record<string, unknown> : null;
  if (!Number.isSafeInteger(previewStartMs) || Number(previewStartMs) < 0 || !previewProof || previewProof.startMs !== previewStartMs) throw new DigitalError("STUDIO_PREVIEW_CHANGED", 409);
  const currentTrack = await prisma.track.findUniqueOrThrow({ where: { id: job.trackId }, include: { credits: { orderBy: { id: "asc" } }, project: { include: { credits: { orderBy: { id: "asc" } } } } } });
  const metadata = { credits: [...currentTrack.project.credits, ...currentTrack.credits].map(credit => ({ name: credit.name, role: credit.role, note: credit.note })),
    ...(currentTrack.project.releaseDate ? { date: currentTrack.project.releaseDate.toISOString().slice(0, 10) } : {}) };
  if (currentTrack.title !== job.title || (currentTrack.project.type === "ALBUM" ? currentTrack.project.title : null) !== job.album || studioHash(metadata) !== studioHash(job.metadata)) throw new DigitalError("STUDIO_METADATA_CHANGED", 409);
  const preview = job.artifacts.find(item => item.role === "PREVIEW");
  let publicPreview: { id: string; storageKey: string; storageBackend: "LOCAL" | "OBJECT"; storageProvider: string } | null = null;
  if (promotable) {
    if (!preview || !preview.asset.durationMs || preview.asset.durationMs > 60_000 || preview.asset.sizeBytes > 3n * 1024n * 1024n) throw new DigitalError("STUDIO_PREVIEW_INVALID", 409);
    const object = await getMediaObject(preview.asset);
    if (object.contentLength !== Number(preview.asset.sizeBytes)) throw new DigitalError("STUDIO_VERIFICATION_REQUIRED", 409);
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    const { createHash } = await import("node:crypto");
    if (createHash("sha256").update(bytes).digest("hex") !== preview.asset.checksumSha256) throw new DigitalError("STUDIO_VERIFICATION_REQUIRED", 409);
    const id = randomUUID(), key = `digital/studio/${job.id}/${id}.mp3`;
    // Logical PUBLIC visibility satisfies the existing short-preview relation;
    // the namespace is physically private and cannot receive a public signature.
    // Only the existing rights/artistic-gated application route can stream it.
    const stored = await putMediaObject({ scope: "private", key, body: bytes, contentLength: bytes.length, contentType: "audio/mpeg", checksumSha256: preview.asset.checksumSha256! });
    publicPreview = { id, storageKey: key, storageBackend: stored.storageBackend, storageProvider: stored.storageProvider };
  }
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-project:${currentTrack.projectId}`})) IS NULL AS locked`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${job.trackId}`})) IS NULL AS locked`;
    await requireDigitalExcerptAdmin(tx, actor.id);
    const current = await tx.digitalStudioJob.findUniqueOrThrow({ where: { id: job.id }, include });
    if (binding(current) !== input.expectedBinding || current.status !== "READY" || current.decision !== "PENDING") throw new DigitalError("STUDIO_VERSION_CHANGED", 409);
    const latest = await tx.digitalMaster.findFirst({ where: { trackId: job.trackId }, orderBy: { version: "desc" }, include: { masterAsset: true } });
    if ((latest?.id ?? null) !== job.baseMasterId || (latest?.version ?? 0) !== job.expectedVersion) throw new DigitalError("MASTER_VERSION_CONFLICT", 409);
    const hasAcquisitions = latest ? await tx.digitalEntitlement.count({ where: { masterId: latest.id, status: "ACTIVE" } }) : 0;
    if (hasAcquisitions && !input.confirmExistingPurchases) throw new DigitalError("STUDIO_EXISTING_PURCHASES_CONFIRMATION_REQUIRED", 409);
    const track = await tx.track.findUniqueOrThrow({ where: { id: job.trackId }, include: { credits: { orderBy: { id: "asc" } }, project: { include: { credits: { orderBy: { id: "asc" } } } } } });
    const currentMetadata = { credits: [...track.project.credits, ...track.credits].map(credit => ({ name: credit.name, role: credit.role, note: credit.note })),
      ...(track.project.releaseDate ? { date: track.project.releaseDate.toISOString().slice(0, 10) } : {}) };
    if (track.title !== job.title || (track.project.type === "ALBUM" ? track.project.title : null) !== job.album || studioHash(currentMetadata) !== studioHash(job.metadata)) throw new DigitalError("STUDIO_METADATA_CHANGED", 409);
    let masterId: string | null = null;
    if (promotable && publicPreview && preview) {
      await tx.asset.create({ data: { ...publicPreview, type: "AUDIO_PREVIEW", visibility: "PUBLIC", filename: `${job.title}.mp3`, mimeType: "audio/mpeg",
        sizeBytes: preview.asset.sizeBytes, durationMs: preview.asset.durationMs, checksumSha256: preview.asset.checksumSha256, rightsStatus: "PENDING", confidence: "CONFIRMED" } });
      const master = await tx.digitalMaster.create({ data: { trackId: job.trackId, version: job.expectedVersion + 1, masterAssetId: required[2]!.assetId,
        mp3AssetId: required[0]!.assetId, mp3BitrateKbps: 320, encoderVersion: STUDIO_MASTER_ENCODER, previewAssetId: publicPreview.id, previewStartMs: previewStartMs!,
        previewDurationMs: preview.asset.durationMs, codec: "wav", status: "READY" } });
      masterId = master.id;
      if (required[2]!.asset.durationMs) await tx.track.update({ where: { id: job.trackId }, data: { durationSeconds: expressDurationSeconds(required[2]!.asset.durationMs!) } });
    }
    // Existing contracts remain frozen. An additive format grant is permitted
    // only for the exact same immutable source, never merely the same title.
    const allowExistingPurchases = !!(input.confirmExistingPurchases && latest && latest.masterAsset.checksumSha256 === job.sourceSha256 && !job.sourceLossy);
    await tx.digitalStudioJob.update({ where: { id: job.id }, data: { decision: "APPROVED", publishedMasterId: masterId, allowExistingPurchases,
      errorCode: !promotable ? "STUDIO_LOSSY_COMMERCIAL_POLICY_REQUIRED" : null } });
    await tx.digitalEvent.create({ data: { actorId: actor.id, kind: "STUDIO_FILES_APPROVED", externalKey: `studio-approved:${job.id}`, details: { jobId: job.id,
      binding: job.binding, humanListened: true, publishedMasterId: masterId, baseMasterId: job.baseMasterId, confirmReplacement: input.confirmReplacement,
      confirmExistingPurchases: input.confirmExistingPurchases, allowExistingPurchases, rightsApproved: false, offerActivated: false,
      historicalAcquisitionsChanged: false, ...(promotable ? {} : { commercialBlocker: "STUDIO_LOSSY_COMMERCIAL_POLICY_REQUIRED" }) } } });
  });
  return { ok: true, ...(await listStudioJobs(actor, null)) };
}
