import "server-only";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "@/lib/prisma";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { deleteMediaObject, getMediaObject, putMediaObject, type MediaStorageReference } from "@/lib/media/storage";
import { DigitalError, requireDigitalEnvironment, assertDigitalUuid, type DigitalSelection } from "./domain";
import { digitalZipStream, validateDigitalZip } from "./zip";
import { verifiedDigitalStream } from "./stream-integrity";
import { acquiredAlbumFormats, acquiredDigitalAssetId, type DigitalAudioFormat, type DigitalAcquiredTrack } from "./formats";
import { checkDigitalDisk, claimDigitalSlot, releaseDigitalSlot, renewDigitalSlot,DIGITAL_WORK_LIMITS } from "./work-slots";
export async function ensureDigitalArchive(lineId: string, format: DigitalAudioFormat = "WAV") {
  requireDigitalEnvironment();
  const l = await prisma.digitalOrderLine.findUniqueOrThrow({ where: { id: lineId }, include: { order: true } });
  if (l.scope !== "ALBUM" || !["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED", "GRANTED"].includes(l.order.status)) throw new DigitalError("ARCHIVE_UNAVAILABLE");
  if (!acquiredAlbumFormats(l.trackSnapshot as unknown as DigitalAcquiredTrack[]).includes(format)) throw new DigitalError("FORMAT_NOT_ACQUIRED", 409);
  return prisma.digitalArchive.upsert({ where: { lineId_format: { lineId, format } }, create: { lineId, format, snapshotHash: billingSnapshotHash(l.trackSnapshot) }, update: {} });
}
/** ZIP work is queued and streamed in this worker, never built by the Next download route. */
export async function processDigitalArchives(options: { afterChunk?: () => Promise<void>; lineIds?:string[] } = {}) {
  requireDigitalEnvironment();
  if(options.lineIds){if(!options.lineIds.length||options.lineIds.length>50)throw new DigitalError("INVALID_ARCHIVE_SCOPE");options.lineIds.forEach(assertDigitalUuid);}
  const row = await prisma.digitalArchive.findFirst({ where: { ...(options.lineIds?{lineId:{in:options.lineIds}}:{}),OR: [{ status: "PENDING" }, { status: "PROCESSING", leaseUntil: { lte: new Date() } }] }, orderBy: { createdAt: "asc" } });
  if (!row) return { processed: false };
  const slot = await claimDigitalSlot("zip", row.id); if (!slot) return { processed: false };
  if (row.attempts >= 3) { await prisma.digitalArchive.update({ where: { id: row.id }, data: { status: "REQUIRES_REVIEW", errorCode: "ARCHIVE_RETRY_LIMIT" } }); await releaseDigitalSlot(slot); return { processed: true, ready: false }; }
  const c = await prisma.digitalArchive.updateMany({ where: { id: row.id, attempts: row.attempts, OR: [{ status: "PENDING" }, { status: "PROCESSING", leaseUntil: { lte: new Date() } }] }, data: { status: "PROCESSING", attempts: { increment: 1 }, leaseToken: slot.leaseToken, leaseUntil: new Date(Date.now() + 300000) } });
  if (!c.count) { await releaseDigitalSlot(slot); return { processed: false }; }
  const stop = new AbortController(); let renewing = false, root: string | null = null, stored: MediaStorageReference | null = null;
  const heartbeat = setInterval(() => { if (renewing) return; renewing = true; void (async () => {
    if (!await renewDigitalSlot(slot) || !(await prisma.digitalArchive.updateMany({ where: { id: row.id, status: "PROCESSING", leaseToken: slot.leaseToken, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + 300000) } })).count) stop.abort();
  })().catch(() => stop.abort()).finally(() => { renewing = false; }); }, 10000);
  try {
    const l = await prisma.digitalOrderLine.findUniqueOrThrow({ where: { id: row.lineId }, include: { entitlements: { include: { master: { include: { masterAsset: true, mp3Asset: true } } } } } });
    if (billingSnapshotHash(l.trackSnapshot) !== row.snapshotHash) throw new DigitalError("ARCHIVE_SNAPSHOT_CHANGED");
    const snapshot = l.trackSnapshot as unknown as DigitalSelection["tracks"];
    if (!acquiredAlbumFormats(snapshot).includes(row.format as DigitalAudioFormat)) throw new DigitalError("FORMAT_NOT_ACQUIRED", 409);
    const entries = snapshot.map((t, i) => {
      const master = l.entitlements.find(e => e.masterId === t.masterId)?.master;
      if (!master) throw new DigitalError("ARCHIVE_INTEGRITY");
      const id = acquiredDigitalAssetId(t, row.format as DigitalAudioFormat, master), a = row.format === "MP3" ? master.mp3Asset : master.masterAsset;
      if (!a || a.id !== id || a.visibility !== "PRIVATE") throw new DigitalError("ARCHIVE_INTEGRITY");
      return { name: `${String(i + 1).padStart(2, "0")}-${t.title}.${a.filename.split(".").pop()}`, size: Number(a.sizeBytes), open: async () => {
        const object = await getMediaObject(a); if (object.contentLength !== Number(a.sizeBytes)) throw new DigitalError("ARCHIVE_INTEGRITY"); return verifiedDigitalStream(object.body, Number(a.sizeBytes), a.checksumSha256 ?? "");
      } };
    });
    validateDigitalZip(entries);
    root = path.join(await checkDigitalDisk(entries.reduce((s, e) => s + e.size, 0) + 100000), `${row.id}.${slot.leaseToken}`); await mkdir(root, { mode: 0o700 });
    const file = path.join(root, "archive.zip"), hash = createHash("sha256"); let size = 0;
    await pipeline(Readable.fromWeb(digitalZipStream(entries) as never), new Transform({ transform(chunk, _, cb) { if(process.memoryUsage().rss>DIGITAL_WORK_LIMITS.nodeRssBytes)return cb(new DigitalError("WORKER_MEMORY_LIMIT"));size += chunk.length; hash.update(chunk); if(options.afterChunk)void options.afterChunk().then(()=>cb(null,chunk),cb);else cb(null, chunk); } }), createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(15 * 60000)]) });
    const checksum = hash.digest("hex"); if (size !== (await stat(file)).size) throw new DigitalError("ARCHIVE_INTEGRITY");
    const key = `digital/archives/${l.id}/${row.format.toLowerCase()}/${slot.leaseToken}.zip`;
    const result = await putMediaObject({ scope: "private", key, body: createReadStream(file), contentLength: size, contentType: "application/zip", checksumSha256: checksum });
    stored = { storageKey: key, storageBackend: result.storageBackend, storageProvider: result.storageProvider, visibility: "PRIVATE" };
    await prisma.$transaction(async tx => {
      if (!await tx.digitalWorkSlot.findFirst({ where: { id: slot.id, leaseToken: slot.leaseToken, leaseUntil: { gt: new Date() } } })) throw new DigitalError("LEASE_LOST");
      if (!(await tx.digitalArchive.updateMany({ where: { id: row.id, status: "PROCESSING", leaseToken: slot.leaseToken, leaseUntil: { gt: new Date() } }, data: { status: "READY", storageKey: key, storageBackend: result.storageBackend, storageProvider: result.storageProvider, sizeBytes: BigInt(size), checksum, leaseToken: null, leaseUntil: null, errorCode: null } })).count) throw new DigitalError("LEASE_LOST");
      await tx.digitalEvent.create({ data: { orderId: l.orderId, kind: "ARCHIVE_READY", details: { archiveId: row.id, format: row.format, snapshotHash: row.snapshotHash, sizeBytes: size, checksum } } });
    }); stored = null; return { processed: true, ready: true, sizeBytes: size, tempJobBytesObserved: size };
  } catch (e) {
    await prisma.digitalArchive.updateMany({ where: { id: row.id, status: "PROCESSING", leaseToken: slot.leaseToken }, data: { status: "REQUIRES_REVIEW", errorCode: e instanceof DigitalError ? e.code : "ARCHIVE_FAILED", leaseToken: null, leaseUntil: null } });
    return { processed: true, ready: false };
  } finally { clearInterval(heartbeat); stop.abort(); if (stored && !await prisma.digitalArchive.findFirst({ where: { storageKey: stored.storageKey } })) await deleteMediaObject(stored).catch(() => undefined); if (root) await rm(root, { recursive: true, force: true }); await releaseDigitalSlot(slot); }
}
