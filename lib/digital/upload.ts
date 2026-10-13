import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DigitalUpload } from "@/generated/prisma/client";
import { newSessionToken, parseSessionToken, sessionTokenHash, sessionTokenHashMatches } from "@/lib/creations/direct-upload-domain";
import { activeMediaStorage, activeMultipartMediaStorage } from "@/lib/media/storage/config";
import { DELIVERY_PART_BYTES, verifyDeliveryParts } from "@/lib/orders/delivery-direct-contract";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { DigitalError, assertDigitalUuid, requireDigitalEnvironment, uploadMetadata } from "./domain";

async function trackLock<T>(id: string, f: (tx: import("@/generated/prisma/client").Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => { await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-track:${id}`})) IS NULL AS locked`; return f(tx); });
}
function localRoot(id: string) {
  assertDigitalUuid(id); const root = path.resolve(process.env.DCN_LOCAL_UPLOAD_ROOT ?? path.join(process.cwd(), ".private/digital-upload"));
  if (!root.startsWith("/private/tmp/") || process.env.MEDIA_STORAGE_DRIVER !== "local") throw new DigitalError("LOCAL_UPLOAD_DISABLED", 503);
  return path.join(root, id);
}
const identity = (s: DigitalUpload) => ({ scope: "private" as const, key: s.storageKey, uploadId: s.providerUploadId! });
export async function authorizeDigitalUpload(actor: OrderActor, trackId: string, rawToken: unknown) {
  requireDigitalEnvironment(); if (actor.role !== "ADMIN") throw new DigitalError("ADMIN_REQUIRED", 403);
  let token; try { token = parseSessionToken(rawToken); } catch { throw new DigitalError("NOT_FOUND", 404); }
  const s = await prisma.digitalUpload.findUnique({ where: { id: token.id } });
  if (!s || s.actorId !== actor.id || s.trackId !== trackId || !sessionTokenHashMatches(token.token, s.tokenHash)) throw new DigitalError("NOT_FOUND", 404);
  if (["PREPARING", "UPLOADING"].includes(s.status) && s.expiresAt.getTime() <= Date.now()) throw new DigitalError("UPLOAD_EXPIRED", 410);
  return s;
}
export async function digitalUploadParts(s: DigitalUpload) {
  if (s.providerUploadId) return activeMultipartMediaStorage().listMultipartParts(identity(s));
  const root = localRoot(s.id); let names: string[]; try { names = await readdir(root); } catch { return []; }
  const result = [];
  for (const n of names.filter(n => /^part-\d+$/.test(n))) { const meta = await stat(path.join(root, n)); result.push({ partNumber: Number(n.slice(5)), sizeBytes: meta.size, etag: `"local-${meta.size}-${Math.trunc(meta.mtimeMs)}"` }); }
  return result.sort((a,b) => a.partNumber-b.partNumber);
}
export async function digitalUploadStatus(actor: OrderActor, trackId: string, token: string) {
  const s = await authorizeDigitalUpload(actor, trackId, token);
  return { ok: true, sessionToken: token, status: ["PREPARING", "COMPLETING"].includes(s.status) ? "VALIDATING" : s.status,
    state: s.status === "READY" ? "media-enregistre" : "media-upload", expiresAt: s.expiresAt.toISOString(), partSizeBytes: DELIVERY_PART_BYTES,
    partCount: Math.ceil(Number(s.sizeBytes)/DELIVERY_PART_BYTES), completedParts: s.status === "UPLOADING" ? await digitalUploadParts(s) : [],
    errorCode: s.errorCode, currentAssetId: s.status === "READY" ? s.id : null };
}
export async function initDigitalUpload(actor: OrderActor, trackId: string, value: unknown) {
  requireDigitalEnvironment(); if (actor.role !== "ADMIN") throw new DigitalError("ADMIN_REQUIRED", 403); assertDigitalUuid(trackId);
  const m = uploadMetadata(value), id = randomUUID(), token = newSessionToken(id);
  const s = await trackLock(trackId, async tx => {
    if (!await tx.track.findUnique({ where: { id: trackId } })) throw new DigitalError("NOT_FOUND", 404);
    const previous = await tx.digitalMaster.findFirst({ where: { trackId }, orderBy: { version: "desc" } });
    if ((previous?.version ?? 0) !== m.expectedVersion) throw new DigitalError("MASTER_VERSION_CONFLICT", 409);
    const active = await tx.digitalUpload.findFirst({ where: { trackId, status: { in: ["PREPARING", "UPLOADING", "COMPLETING", "QUARANTINE", "VALIDATING"] }, expiresAt: { gt: new Date() } } });
    if (active) throw new DigitalError("UPLOAD_ALREADY_ACTIVE", 409);
    return tx.digitalUpload.create({ data: { id, actorId: actor.id, trackId, tokenHash: sessionTokenHash(token), filename: m.filename, mimeType: m.mimeType,
      sizeBytes: BigInt(m.sizeBytes), storageKey: `digital/masters/${trackId}/${id}.${m.extension}`, expectedVersion: m.expectedVersion, previewStartMs: m.previewStartMs,
      expiresAt: new Date(Date.now()+3600000) } });
  });
  try {
    const storage = activeMediaStorage();
    if (storage.backend === "OBJECT") {
      const u = await activeMultipartMediaStorage().createMultipartUpload({ scope: "private", key: s.storageKey, contentType: s.mimeType,
        metadata: { "lnx-session-id": id, "lnx-track-id": trackId, "lnx-declared-size": String(s.sizeBytes) } });
      await prisma.digitalUpload.update({ where: { id }, data: { providerUploadId: u.uploadId, status: "UPLOADING" } });
    } else { await mkdir(localRoot(id), { recursive: true, mode: 0o700 }); await prisma.digitalUpload.update({ where: { id }, data: { status: "UPLOADING" } }); }
  } catch { await prisma.digitalUpload.update({ where: { id }, data: { status: "REJECTED", errorCode: "STORAGE_UNAVAILABLE" } }); throw new DigitalError("STORAGE_UNAVAILABLE", 503); }
  return digitalUploadStatus(actor, trackId, token);
}
export async function digitalPartUrl(actor: OrderActor, trackId: string, token: string, partNumber: number) {
  const s = await authorizeDigitalUpload(actor, trackId, token);
  if (s.status !== "UPLOADING" || !Number.isSafeInteger(partNumber) || partNumber<1 || partNumber>Math.ceil(Number(s.sizeBytes)/DELIVERY_PART_BYTES)) throw new DigitalError("INVALID_PART", 409);
  const ttl = Math.min(300, Math.floor((s.expiresAt.getTime()-Date.now())/1000)); if (ttl<1) throw new DigitalError("UPLOAD_EXPIRED", 410);
  return { url: s.providerUploadId ? await activeMultipartMediaStorage().createMultipartPartSignedUrl({ ...identity(s), partNumber, expiresInSeconds: ttl })
    : `/api/admin/digital/tracks/${trackId}/parts/${s.id}/${partNumber}` };
}
export async function writeDigitalLocalPart(actor: OrderActor, trackId: string, token: string, sessionId: string, partNumber: number, request: Request) {
  const s = await authorizeDigitalUpload(actor, trackId, token);
  if (s.id !== sessionId || s.providerUploadId || s.status !== "UPLOADING" || !request.body || !Number.isSafeInteger(partNumber) || partNumber<1 || partNumber>Math.ceil(Number(s.sizeBytes)/DELIVERY_PART_BYTES)) throw new DigitalError("INVALID_PART", 409);
  const expected = Math.min(DELIVERY_PART_BYTES, Number(s.sizeBytes)-(partNumber-1)*DELIVERY_PART_BYTES);
  if (request.headers.has("content-length") && Number(request.headers.get("content-length")) !== expected) throw new DigitalError("INVALID_PART");
  const target = path.join(localRoot(s.id), `part-${partNumber}`), temporary = `${target}.${randomUUID()}.tmp`; let bytes=0;
  try { await pipeline(Readable.fromWeb(request.body as never), new Transform({ transform(chunk, _, cb) { bytes+=chunk.length; cb(bytes>expected ? new DigitalError("PART_TOO_LARGE", 413) : null, chunk); } }), createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    if (bytes!==expected) throw new DigitalError("INCOMPLETE_PART");
    // Commit only while the session is still accepting parts.
    await trackLock(trackId, async tx => { const current = await tx.digitalUpload.findUniqueOrThrow({ where: { id: s.id } }); if (current.status!=="UPLOADING") throw new DigitalError("INVALID_STATE",409); await rename(temporary,target); });
    const meta = await stat(target); return `"local-${meta.size}-${Math.trunc(meta.mtimeMs)}"`;
  } finally { await rm(temporary,{force:true}); }
}
export async function recoverDigitalCompletion(s: DigitalUpload) {
  const storage = activeMediaStorage();
  if (s.providerUploadId) {
    let exists=false; try { const head = await storage.head({scope:"private",key:s.storageKey}); exists=head.contentLength===Number(s.sizeBytes) && head.contentType===s.mimeType
      && head.customMetadata?.["lnx-session-id"]===s.id && head.customMetadata?.["lnx-track-id"]===s.trackId; if (!exists) throw new DigitalError("OBJECT_IDENTITY_MISMATCH",409); }
    catch(e) { if (!(e instanceof Error) || !("code" in e) || e.code!=="NOT_FOUND") throw e; }
    if (!exists) { const parts=verifyDeliveryParts(Number(s.sizeBytes),await digitalUploadParts(s)); await activeMultipartMediaStorage().completeMultipartUpload({...identity(s),parts});
      const head=await storage.head({scope:"private",key:s.storageKey}); if(head.contentLength!==Number(s.sizeBytes)||head.customMetadata?.["lnx-session-id"]!==s.id||head.customMetadata?.["lnx-track-id"]!==s.trackId) throw new DigitalError("OBJECT_IDENTITY_MISMATCH",409); }
  } else {
    const parts=verifyDeliveryParts(Number(s.sizeBytes),await digitalUploadParts(s));
    async function* source() { for (const p of parts) { for await (const chunk of createReadStream(path.join(localRoot(s.id),`part-${p.partNumber}`))) yield chunk; } }
    await storage.put({scope:"private",key:s.storageKey,body:Readable.from(source()),contentLength:Number(s.sizeBytes),contentType:s.mimeType,checksumSha256:""});
  }
  await prisma.digitalUpload.updateMany({where:{id:s.id,status:"COMPLETING"},data:{status:"QUARANTINE",leaseUntil:null}});
}
export async function completeDigitalUpload(actor: OrderActor, trackId: string, token: string) {
  const s=await authorizeDigitalUpload(actor,trackId,token);
  if(s.status==="UPLOADING") {
    verifyDeliveryParts(Number(s.sizeBytes),await digitalUploadParts(s));
    const claim=await trackLock(trackId,tx=>tx.digitalUpload.updateMany({where:{id:s.id,status:"UPLOADING"},data:{status:"COMPLETING",leaseUntil:new Date(Date.now()+60000)}}));
    if(claim.count) await recoverDigitalCompletion(s).catch(()=>undefined);
  } else if (!["COMPLETING","QUARANTINE","VALIDATING","READY"].includes(s.status)) throw new DigitalError("INVALID_STATE",409);
  return digitalUploadStatus(actor,trackId,token);
}
export async function abortDigitalUpload(actor: OrderActor, trackId: string, token: string) {
  const s=await authorizeDigitalUpload(actor,trackId,token);
  if(["READY","COMPLETING"].includes(s.status)) throw new DigitalError("INVALID_STATE",409);
  await prisma.digitalUpload.updateMany({where:{id:s.id,status:{in:["PREPARING","UPLOADING","QUARANTINE","VALIDATING"]}},data:{status:"ABORTED"}});
  return digitalUploadStatus(actor,trackId,token);
}
export { trackLock };
