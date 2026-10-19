import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Asset, DigitalUpload, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { activeMediaStorage } from "@/lib/media/storage/config";
import { putMediaObject } from "@/lib/media/storage";
import { DigitalError } from "./domain";
import { processStudioAudio } from "./studio-audio";
import { requireStudioEnvironment, studioBinding } from "./studio-policy";
import { requireDigitalExcerptAdmin } from "./excerpt-service";

/** Called by the existing bounded audio child with its existing slot/lease and
 * AbortSignal. It does not poll, start a competing queue, publish or change an offer. */
export async function processStudioImport(input: { upload: DigitalUpload; source: string; outputDirectory: string; checksum: string; signal: AbortSignal; leaseToken: string }) {
  requireStudioEnvironment();
  const upload = input.upload;
  const job = await prisma.digitalStudioJob.findFirst({ where: { uploadId: upload.id, status: { in: ["QUEUED", "PROCESSING"] } }, orderBy: { attempt: "desc" } });
  if (!job) throw new DigitalError("STUDIO_JOB_NOT_READY", 409);
  await requireDigitalExcerptAdmin(prisma, job.actorId);
  const claimed = await prisma.digitalStudioJob.updateMany({ where: { id: job.id, status: { in: ["QUEUED", "PROCESSING"] } },
    data: { status: "PROCESSING", phase: "ANALYZING", leaseToken: input.leaseToken, leaseUntil: new Date(Date.now() + 15 * 60_000), errorCode: null } });
  if (!claimed.count) throw new DigitalError("LEASE_LOST", 409);
  return processStudioBoundSource({ ...input, jobId: job.id });
}

/** Reuses the exact preparation/storage engine for an upload or an existing
 * immutable private asset. The caller owns the bounded audio slot and temp root. */
export async function processStudioBoundSource(input: { jobId: string; upload?: DigitalUpload; sourceAsset?: Asset; source: string;
  outputDirectory: string; checksum: string; previewStartMs?: number; signal: AbortSignal; leaseToken: string;
  slot?: { id: string; leaseToken: string }; validateCurrent?: (tx: Prisma.TransactionClient) => Promise<void> }) {
  requireStudioEnvironment();
  const upload = input.upload;
  const job = await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: input.jobId } });
  try {
    if (input.signal.aborted) throw new DigitalError("WORKER_SHUTDOWN");
    if (job.status !== "PROCESSING" || job.leaseToken !== input.leaseToken || !job.leaseUntil || job.leaseUntil <= new Date()
      || job.binding || (upload ? job.uploadId !== upload.id : job.uploadId !== null)) throw new DigitalError("LEASE_LOST", 409);
    await requireDigitalExcerptAdmin(prisma, job.actorId);
    await input.validateCurrent?.(prisma);
    const savedMetadata = job.metadata as Record<string, unknown>, metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(savedMetadata)) if (typeof value === "string") metadata[key === "date" ? "release_date" : key] = value;
    if (Array.isArray(savedMetadata.credits)) {
      const credits = savedMetadata.credits;
      const names = (role: string) => credits.filter((value): value is { role: string; name: string } => !!value && typeof value === "object" && "role" in value && value.role === role && "name" in value && typeof value.name === "string").map(value => value.name).join("; ");
      if (names("COMPOSER")) metadata.composer = names("COMPOSER");
      if (names("WRITER")) metadata.lyricist = names("WRITER");
      if (names("PRODUCER")) metadata.producer = names("PRODUCER");
      if (names("FEATURING")) metadata.featuring = names("FEATURING");
      if (names("ENGINEER")) metadata.engineer = names("ENGINEER");
      if (names("OTHER")) metadata.additional_credits = names("OTHER");
    }
    const previewStartMs = upload?.previewStartMs ?? input.previewStartMs;
    if (!Number.isSafeInteger(previewStartMs) || Number(previewStartMs) < 0) throw new DigitalError("STUDIO_PREVIEW_CHANGED", 409);
    const result = await processStudioAudio({ source: input.source, outputDirectory: input.outputDirectory, title: job.title, album: job.album ?? undefined, previewStartMs,
      metadata, signal: input.signal,
      onProgress: async phase => {
        const value = String(phase).toUpperCase();
        const mapped = ["ANALYZING", "MASTERING", "CONVERTING", "VERIFYING"].includes(value) ? value : "ANALYZING";
        if (!(await prisma.digitalStudioJob.updateMany({ where: { id: job.id, status: "PROCESSING", leaseToken: input.leaseToken },
          data: { phase: mapped, leaseUntil: new Date(Date.now() + 15 * 60_000) } })).count) throw new DigitalError("LEASE_LOST", 409);
      } });
    if (result.source.sha256 !== input.checksum) throw new DigitalError("STUDIO_SOURCE_CHANGED", 409);
    const driver = upload ? activeMediaStorage() : null;
    // Original bytes have their own immutable Asset. No conversion ever changes it.
    const sourceAsset = upload ? await prisma.asset.upsert({ where: { id: upload.id }, update: {}, create: { id: upload.id, type: "AUDIO", storageKey: upload.storageKey,
      storageBackend: driver!.backend, storageProvider: driver!.provider, visibility: "PRIVATE", filename: upload.filename, mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes, durationMs: result.source.durationMs, checksumSha256: input.checksum, rightsStatus: "PENDING", confidence: "CONFIRMED" } }) : input.sourceAsset;
    if (!sourceAsset || sourceAsset.checksumSha256 !== input.checksum || sourceAsset.visibility !== "PRIVATE"
      || sourceAsset.sizeBytes !== BigInt(result.source.sizeBytes)
      || (upload && (sourceAsset.storageKey !== upload.storageKey || sourceAsset.sizeBytes !== upload.sizeBytes || sourceAsset.mimeType !== upload.mimeType))
      || (!upload && (sourceAsset.id !== job.sourceAssetId || input.checksum !== job.sourceSha256))) throw new DigitalError("STUDIO_SOURCE_CHANGED", 409);
    const files = result.artifacts;
    const prepared: Array<{ id: string; role: string; file: typeof files[number]; key: string; stored: Awaited<ReturnType<typeof putMediaObject>> }> = [];
    for (const file of files) {
      if (input.signal.aborted) throw new DigitalError("WORKER_SHUTDOWN");
      const id = randomUUID(), extension = file.mimeType === "audio/wav" ? "wav" : "mp3", key = `digital/studio/${job.id}/${id}.${extension}`;
      const stored = await putMediaObject({ scope: "private", key, body: createReadStream(file.path, { signal: input.signal }), contentLength: file.sizeBytes, contentType: file.mimeType, checksumSha256: file.sha256 });
      prepared.push({ id, role: file.role === "AUDITION_24" ? "AUDITION_WAV_24" : file.role, file, key, stored });
    }
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${job.trackId}`})) IS NULL AS locked`;
      await requireDigitalExcerptAdmin(tx, job.actorId);
      if (upload && !await tx.digitalUpload.findFirst({ where: { id: upload.id, status: "VALIDATING", leaseToken: input.leaseToken, leaseUntil: { gt: new Date() } } })) throw new DigitalError("LEASE_LOST", 409);
      if (input.slot && !await tx.digitalWorkSlot.findFirst({ where: { id: input.slot.id, leaseToken: input.slot.leaseToken, leaseUntil: { gt: new Date() } } })) throw new DigitalError("LEASE_LOST", 409);
      const current = await tx.digitalStudioJob.findUniqueOrThrow({ where: { id: job.id } });
      if (input.signal.aborted || current.leaseToken !== input.leaseToken || current.status !== "PROCESSING" || current.binding
        || !current.leaseUntil || current.leaseUntil <= new Date()) throw new DigitalError("LEASE_LOST", 409);
      await input.validateCurrent?.(tx);
      await tx.digitalStudioArtifact.create({ data: { jobId: job.id, role: "ORIGINAL", assetId: sourceAsset.id,
        sampleRate: result.source.sampleRate, bitDepth: result.source.bitsPerSample, bitrateKbps: result.source.bitrateKbps,
        integratedLufs: result.source.measurements.integratedLufs, truePeakDbtp: result.source.measurements.truePeakDbtp, metadataVerified: false } });
      for (const { id, role, file, key, stored } of prepared) {
        await tx.asset.create({ data: { id, type: role === "PREVIEW" ? "AUDIO_PREVIEW" : "AUDIO", storageKey: key, storageBackend: stored.storageBackend,
          storageProvider: stored.storageProvider, visibility: "PRIVATE", filename: `${job.title}.${file.mimeType === "audio/wav" ? "wav" : "mp3"}`,
          mimeType: file.mimeType, sizeBytes: BigInt(file.sizeBytes), durationMs: file.durationMs, checksumSha256: file.sha256, rightsStatus: "PENDING", confidence: "CONFIRMED" } });
        await tx.digitalStudioArtifact.create({ data: { jobId: job.id, role, assetId: id, sampleRate: file.sampleRate ?? null, bitDepth: file.bitDepth ?? null,
          bitrateKbps: file.bitrateKbps ?? null, integratedLufs: file.integratedLufs ?? null, truePeakDbtp: file.truePeakDbtp ?? null, metadataVerified: file.metadataVerified } });
      }
      const complete = await tx.digitalStudioJob.findUniqueOrThrow({ where: { id: job.id }, include: { artifacts: { include: { asset: true } } } });
      const { path: sourcePath, ...sourceReport } = result.source; void sourcePath;
      const report = JSON.parse(JSON.stringify({ ...result.report, processingVersion: result.version, originalFilename: sourceAsset.filename, source: sourceReport, plan: result.plan,
        preview: { sha256: result.preview.sha256, startMs: result.preview.startMs, durationMs: result.preview.durationMs, basedOnFormat: result.preview.basedOnFormat },
        formats: Object.fromEntries(Object.entries(result.formats).map(([key, value]) => { const { path: privatePath, ...descriptor } = value; void privatePath; return [key, descriptor]; })) })) as Prisma.InputJsonValue;
      const bound = { ...complete, report, sourceAssetId: sourceAsset.id, sourceSha256: input.checksum };
      const binding = studioBinding(bound, complete.artifacts);
      await tx.digitalStudioJob.update({ where: { id: job.id }, data: { sourceAssetId: sourceAsset.id, sourceSha256: input.checksum, sourceLossy: result.source.format === "MP3",
        status: "READY", phase: "READY", binding, report, leaseUntil: null, leaseToken: null } });
      if (upload) await tx.digitalUpload.update({ where: { id: upload.id }, data: { status: "READY", leaseUntil: null, leaseToken: null, errorCode: null } });
      await tx.digitalEvent.create({ data: { actorId: job.actorId, kind: "STUDIO_PREPARATION_READY", externalKey: `studio-ready:${job.id}`, details: {
        jobId: job.id, trackId: job.trackId, binding, sourceSha256: input.checksum, sourceLossy: result.source.format === "MP3", rightsApproved: false, artisticApproval: false, commercialActivation: false } } });
    });
    return { processed: true, ready: true, studio: true, jobId: job.id, commercialActivation: false, errorCode: undefined };
  } catch (error) {
    const code = error instanceof DigitalError ? error.code : error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : "STUDIO_PROCESSING_FAILED";
    await prisma.digitalStudioJob.updateMany({ where: { id: job.id, status: "PROCESSING", leaseToken: input.leaseToken },
      data: { status: "FAILED", phase: "ERROR", errorCode: code, leaseToken: null, leaseUntil: null } });
    throw error;
  }
}
