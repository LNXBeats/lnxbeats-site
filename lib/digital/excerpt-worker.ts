import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "@/lib/prisma";
import { deleteMediaObject, getMediaObject, putMediaObject, sha256Hex, type MediaStorageReference } from "@/lib/media/storage";
import { assertDigitalUuid, DigitalError, requireDigitalEnvironment } from "./domain";
import { validateDigitalAudio } from "./audio";
import { checkDigitalDisk, DIGITAL_WORK_LIMITS, releaseDigitalSlot, renewDigitalSlot } from "./work-slots";
import { DIGITAL_EXCERPT_EVENT, DIGITAL_EXCERPT_POLICY, digitalExcerptBinding, digitalExcerptDetails, digitalExcerptHash, type DigitalExcerptEvent } from "./excerpt-policy";
import { appendDigitalExcerptEvent, getCurrentDigitalExcerptMaster, latestDigitalExcerptEvent, lockDigitalExcerpt, requireDigitalExcerptAdmin } from "./excerpt-service";

type Scope = { projectId?: string; requestId?: string };
async function queuedRequest(scope: Scope) {
  if (!scope.projectId && !scope.requestId) throw new DigitalError("EXCERPT_SCOPE_REQUIRED");
  if (scope.projectId) assertDigitalUuid(scope.projectId); if (scope.requestId) assertDigitalUuid(scope.requestId);
  if (scope.requestId) {
    const event = await prisma.digitalEvent.findUnique({ where: { id: scope.requestId } });
    if (!event || event.kind !== DIGITAL_EXCERPT_EVENT) return null;
    return event;
  }
  // Scope by this explicit album, never the historical upload or document queues.
  const tracks = await prisma.track.findMany({ where: { projectId: scope.projectId }, orderBy: [{ position: "asc" }, { id: "asc" }], take: 101,
    select: { digitalMasters: { orderBy: { version: "desc" }, take: 1, select: { id: true } } } });
  if (tracks.length > 100) throw new DigitalError("EXCERPT_SCOPE_LIMIT");
  for (const track of tracks) {
    const id = track.digitalMasters[0]?.id; if (!id) continue;
    const event = await latestDigitalExcerptEvent(prisma, id);
    if (event?.details && typeof event.details === "object" && !Array.isArray(event.details) && event.details.status === "QUEUED") return event;
  }
  return null;
}
function requestMasterId(event: DigitalExcerptEvent) {
  if (!event.details || typeof event.details !== "object" || Array.isArray(event.details)) throw new DigitalError("EXCERPT_REVIEW_REQUIRED");
  const binding = (event.details as Record<string, unknown>).binding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new DigitalError("EXCERPT_REVIEW_REQUIRED");
  const id = (binding as Record<string, unknown>).masterId; assertDigitalUuid(id); return id;
}
/** One existing audio semaphore slot per request, claimed atomically under a job lock. */
async function claim(event: DigitalExcerptEvent, scope: Scope) {
  return prisma.$transaction(async db => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-excerpt-job:${event.id}`})) IS NULL AS locked`;
    const master = await getCurrentDigitalExcerptMaster(db, requestMasterId(event));
    if (scope.projectId && master.track.projectId !== scope.projectId) throw new DigitalError("EXCERPT_SCOPE_MISMATCH", 403);
    await lockDigitalExcerpt(db, master); const latest = await latestDigitalExcerptEvent(db, master.id);
    if (latest?.id !== event.id || digitalExcerptDetails(event, master).status !== "QUEUED") return null;
    await requireDigitalExcerptAdmin(db, event.actorId!);
    const now = new Date();
    if (await db.digitalWorkSlot.findFirst({ where: { jobId: event.id, leaseUntil: { gt: now } }, select: { id: true } })) return null;
    for (let i = 0; i < DIGITAL_WORK_LIMITS.audioConcurrency; i++) {
      const id = `audio-${i}`, leaseToken = randomUUID();
      const updated = await db.digitalWorkSlot.updateMany({ where: { id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
        data: { jobId: event.id, leaseToken, leaseUntil: new Date(Date.now() + DIGITAL_WORK_LIMITS.leaseMs) } });
      if (updated.count) return { master, slot: { id, jobId: event.id, leaseToken } };
    }
    return null;
  });
}
/** Bounded excerpt-only derivation. No WAV/MP3 reimport, master mutation or acquisition work. */
export async function processDigitalExcerpt(scope: Scope) {
  requireDigitalEnvironment(); const event = await queuedRequest(scope); if (!event) return { processed: false };
  const claimed = await claim(event, scope); if (!claimed) return { processed: false };
  const { master, slot } = claimed, details = digitalExcerptDetails(event, master), stop = new AbortController();
  let root: string | null = null, candidate: MediaStorageReference | null = null, adopted = false, renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing) return; renewing = true;
    void (async () => {
      if (!await renewDigitalSlot(slot) || (await latestDigitalExcerptEvent(prisma, master.id))?.id !== event.id) stop.abort();
    })().catch(() => stop.abort()).finally(() => { renewing = false; });
  }, 10_000);
  try {
    const sizeExpected = Number(master.masterAsset.sizeBytes);
    root = path.join(await checkDigitalDisk(sizeExpected + 3 * 1024 * 1024), `excerpt-${event.id}.${slot.leaseToken}`);
    await mkdir(root, { mode: 0o700 }); const source = path.join(root, "source.wav"), output = path.join(root, "preview.mp3");
    const object = await getMediaObject(master.masterAsset);
    if (object.contentLength !== sizeExpected) throw new DigitalError("SIZE_MISMATCH", 409);
    const hash = createHash("sha256"); let received = 0;
    await pipeline(Readable.fromWeb(object.body as never), new Transform({ transform(chunk, _, callback) {
      received += chunk.length;
      if (received > sizeExpected || process.memoryUsage().rss > DIGITAL_WORK_LIMITS.nodeRssBytes) return callback(new DigitalError("WORKER_MEMORY_LIMIT"));
      hash.update(chunk); callback(null, chunk);
    } }), createWriteStream(source, { flags: "wx", mode: 0o600 }), { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(5 * 60_000)]) });
    if (received !== sizeExpected || hash.digest("hex") !== details.binding.sourceSha256) throw new DigitalError("EXCERPT_SOURCE_CHANGED", 409);
    const decoded = await validateDigitalAudio(source, output, details.startMs, stop.signal), metadata = await stat(output);
    if (decoded.durationMs !== details.binding.durationMs || metadata.size < 1 || metadata.size > 3 * 1024 * 1024 || decoded.previewDurationMs > 60_000) throw new DigitalError("INVALID_PREVIEW_DURATION");
    // Only the bounded excerpt is buffered; the full WAV is always streamed.
    const bytes = await readFile(output), candidateId = randomUUID(), checksum = sha256Hex(bytes), key = `digital/derived/${master.id}/${candidateId}.mp3`;
    const stored = await putMediaObject({ scope: "private", key, body: bytes, contentLength: bytes.length, contentType: "audio/mpeg", checksumSha256: checksum });
    candidate = { storageKey: key, storageBackend: stored.storageBackend, storageProvider: stored.storageProvider, visibility: "PRIVATE" };
    const committed = await prisma.$transaction(async db => {
      await lockDigitalExcerpt(db, master); await requireDigitalExcerptAdmin(db, event.actorId!);
      const current = await getCurrentDigitalExcerptMaster(db, master.id), latest = await latestDigitalExcerptEvent(db, master.id);
      if (latest?.id !== event.id || digitalExcerptHash(digitalExcerptBinding(current)) !== digitalExcerptHash(details.binding)
        || !await db.digitalWorkSlot.findFirst({ where: { id: slot.id, leaseToken: slot.leaseToken, jobId: event.id, leaseUntil: { gt: new Date() } }, select: { id: true } })) return false;
      await db.asset.create({ data: { id: candidateId, type: "AUDIO_PREVIEW", storageKey: key, storageBackend: stored.storageBackend, storageProvider: stored.storageProvider,
        visibility: "PRIVATE", filename: "extrait-prive.mp3", mimeType: "audio/mpeg", sizeBytes: BigInt(bytes.length), durationMs: decoded.previewDurationMs,
        checksumSha256: checksum, rightsStatus: "PENDING", confidence: "CONFIRMED" } });
      await appendDigitalExcerptEvent(db, event.actorId!, `dcn-excerpt-result:${event.id}`, event, {
        policy: DIGITAL_EXCERPT_POLICY, binding: details.binding, status: "READY", startMs: details.startMs, candidateAssetId: candidateId,
        candidateSha256: checksum, previewDurationMs: decoded.previewDurationMs, requestId: event.id, previousRevisionId: event.id,
        errorCode: null, attested: false, requestHash: details.requestHash,
      });
      return true;
    });
    adopted = committed;
    return { processed: true, ready: committed, superseded: !committed, requestId: event.id,
      ...(committed ? { previewDurationMs: decoded.previewDurationMs, ffmpegRssPeak: decoded.ffmpegRssPeak, ffmpegSamples: decoded.ffmpegSamples } : {}) };
  } catch (error) {
    const code = error instanceof DigitalError ? error.code : "EXCERPT_GENERATION_FAILED";
    // An intervening edit wins. Never overwrite a newer draft or artistic approval.
    await prisma.$transaction(async db => {
      await lockDigitalExcerpt(db, master);
      if ((await latestDigitalExcerptEvent(db, master.id))?.id !== event.id) return;
      const existing = await db.digitalEvent.findUnique({ where: { externalKey: `dcn-excerpt-result:${event.id}` }, select: { id: true } }); if (existing) return;
      await appendDigitalExcerptEvent(db, event.actorId!, `dcn-excerpt-result:${event.id}`, event, {
        policy: DIGITAL_EXCERPT_POLICY, binding: details.binding, status: "FAILED", startMs: details.startMs, candidateAssetId: null,
        candidateSha256: null, previewDurationMs: null, requestId: event.id, previousRevisionId: event.id,
        errorCode: /^[A-Z0-9_]{1,80}$/.test(code) ? code : "EXCERPT_GENERATION_FAILED", attested: false, requestHash: details.requestHash,
      });
    });
    return { processed: true, ready: false, requestId: event.id, errorCode: code };
  } finally {
    clearInterval(heartbeat); stop.abort();
    if (candidate && !adopted && !await prisma.asset.findFirst({ where: { storageKey: candidate.storageKey }, select: { id: true } })) await deleteMediaObject(candidate).catch(() => undefined);
    if (root) await rm(root, { recursive: true, force: true });
    await releaseDigitalSlot(slot);
  }
}
