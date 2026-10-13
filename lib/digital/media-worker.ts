import "server-only";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "@/lib/prisma";
import { deleteMediaObject, getMediaObject, putMediaObject, sha256Hex, type MediaStorageReference } from "@/lib/media/storage";
import { activeMediaStorage } from "@/lib/media/storage/config";
import { DigitalError, requireDigitalEnvironment, signatureMatches } from "./domain";
import { trackLock, recoverDigitalCompletion } from "./upload";
import { validateDigitalAudio } from "./audio";
import { claimDigitalSlot, releaseDigitalSlot, renewDigitalSlot, checkDigitalDisk, DIGITAL_WORK_LIMITS } from "./work-slots";

export async function processDigitalMedia(hooks:{afterSource?:()=>Promise<void>}={}) {
  requireDigitalEnvironment(); const now=new Date();
  const recovery=await prisma.digitalUpload.findFirst({where:{status:"COMPLETING",leaseUntil:{lte:now}},orderBy:{createdAt:"asc"}});
  if(recovery) { const c=await prisma.digitalUpload.updateMany({where:{id:recovery.id,status:"COMPLETING",leaseUntil:{lte:now}},data:{leaseUntil:new Date(Date.now()+60000)}});
    if(c.count) await recoverDigitalCompletion(recovery).catch(()=>undefined); }
  const s=await prisma.digitalUpload.findFirst({where:{OR:[{status:"QUARANTINE",OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},{status:"VALIDATING",leaseUntil:{lte:now}}]},orderBy:{createdAt:"asc"}});
  if(!s) return {processed:false};
  const slot=await claimDigitalSlot("audio",s.id); if(!slot)return{processed:false};
  const leaseUntil=new Date(Date.now()+15*60000);
  const claim=await prisma.digitalUpload.updateMany({where:{id:s.id,OR:[{status:"QUARANTINE",OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},{status:"VALIDATING",leaseUntil:{lte:now}}]},data:{status:"VALIDATING",leaseUntil,leaseToken:slot.leaseToken}});
  if(!claim.count){await releaseDigitalSlot(slot);return{processed:false};}
  let root:string|null=null; const stop=new AbortController();let renewing=false;
  const heartbeat=setInterval(()=>{if(renewing)return;renewing=true;void (async()=>{if(!await renewDigitalSlot(slot)||!(await prisma.digitalUpload.updateMany({where:{id:s.id,status:"VALIDATING",leaseToken:slot.leaseToken,leaseUntil:{gt:new Date()}},data:{leaseUntil:new Date(Date.now()+15*60000)}})).count)stop.abort();})().catch(()=>stop.abort()).finally(()=>{renewing=false;});},10000);
  const driver=activeMediaStorage(); const ref: MediaStorageReference={storageKey:s.storageKey,storageBackend:driver.backend,storageProvider:driver.provider,visibility:"PRIVATE"};
  let generatedRef: MediaStorageReference|null=null;
  try {
    if(Number(s.sizeBytes)>DIGITAL_WORK_LIMITS.masterBytes)throw new DigitalError("MASTER_SIZE_LIMIT");
    root=path.join(await checkDigitalDisk(Number(s.sizeBytes)+3*1024*1024),`${s.id}.${slot.leaseToken}`);await mkdir(root,{mode:0o700});
    const extension=s.filename.split(".").pop()!.toLowerCase(),source=path.join(root,`source.${extension}`),preview=path.join(root,"preview.mp3");
    const object=await getMediaObject(ref); if(object.contentLength!==Number(s.sizeBytes)) throw new DigitalError("SIZE_MISMATCH",409);
    const hash=createHash("sha256"); let size=0;
    await pipeline(Readable.fromWeb(object.body as never),new Transform({transform(chunk,_,cb){ if(process.memoryUsage().rss>DIGITAL_WORK_LIMITS.nodeRssBytes)return cb(new DigitalError("WORKER_MEMORY_LIMIT"));size+=chunk.length; if(size>Number(s.sizeBytes)) return cb(new DigitalError("SIZE_MISMATCH",409)); hash.update(chunk); cb(null,chunk); }}),createWriteStream(source,{flags:"wx",mode:0o600}),{signal:AbortSignal.any([stop.signal,AbortSignal.timeout(5*60000)])});
    if(size!==Number(s.sizeBytes)) throw new DigitalError("SIZE_MISMATCH",409);
    const checksum=hash.digest("hex");
    const fd=await open(source,"r"); const header=Buffer.alloc(12); try { await fd.read(header,0,12,0); } finally { await fd.close(); }
    if(!signatureMatches(header,extension)) throw new DigitalError("INVALID_SIGNATURE");
    await hooks.afterSource?.();
    const decoded=await validateDigitalAudio(source,preview,s.previewStartMs,stop.signal),metadata=await stat(preview);
    if(metadata.size>3*1024*1024||metadata.size<1) throw new DigitalError("INVALID_PREVIEW_DURATION");
    const bytes=await readFile(preview); const previewId=slot.leaseToken, key=`catalog/audio-previews/${previewId}.mp3`;
    const stored=await putMediaObject({scope:"public",key,body:bytes,contentLength:bytes.length,contentType:"audio/mpeg",checksumSha256:sha256Hex(bytes)});
    generatedRef={storageKey:key,storageBackend:stored.storageBackend,storageProvider:stored.storageProvider,visibility:"PUBLIC"};
    await trackLock(s.trackId,async tx=>{
      if(!await tx.digitalUpload.findFirst({where:{id:s.id,status:"VALIDATING",leaseToken:slot.leaseToken,leaseUntil:{gt:new Date()}}})||!await tx.digitalWorkSlot.findFirst({where:{id:slot.id,leaseToken:slot.leaseToken,leaseUntil:{gt:new Date()}}})) throw new DigitalError("LEASE_LOST",409);
      const admin=await tx.user.findUnique({where:{id:s.actorId},select:{role:true,status:true,emailVerified:true}});
      if(admin?.role!=="ADMIN"||admin.status!=="ACTIVE"||!admin.emailVerified) throw new DigitalError("ADMIN_REQUIRED",403);
      const latest=await tx.digitalMaster.findFirst({where:{trackId:s.trackId},orderBy:{version:"desc"}});
      if((latest?.version??0)!==s.expectedVersion) throw new DigitalError("MASTER_VERSION_CONFLICT",409);
      if(await tx.digitalMaster.findFirst({where:{masterAsset:{checksumSha256:checksum}}})) throw new DigitalError("DUPLICATE_MASTER_REVIEW_REQUIRED",409);
      await tx.asset.create({data:{id:s.id,type:"AUDIO",storageKey:s.storageKey,storageBackend:driver.backend,storageProvider:driver.provider,visibility:"PRIVATE",filename:s.filename,
        mimeType:s.mimeType,sizeBytes:s.sizeBytes,durationMs:decoded.durationMs,checksumSha256:checksum,rightsStatus:"PENDING",confidence:"CONFIRMED"}});
      await tx.asset.create({data:{id:previewId,type:"AUDIO_PREVIEW",storageKey:key,storageBackend:stored.storageBackend,storageProvider:stored.storageProvider,visibility:"PUBLIC",filename:"preview.mp3",
        mimeType:"audio/mpeg",sizeBytes:BigInt(bytes.length),durationMs:decoded.previewDurationMs,checksumSha256:sha256Hex(bytes),rightsStatus:"PENDING",confidence:"CONFIRMED"}});
      await tx.digitalMaster.create({data:{trackId:s.trackId,version:s.expectedVersion+1,masterAssetId:s.id,previewAssetId:previewId,previewStartMs:s.previewStartMs,previewDurationMs:decoded.previewDurationMs,codec:extension,status:"READY"}});
      await tx.digitalUpload.update({where:{id:s.id},data:{status:"READY",leaseUntil:null,leaseToken:null}});
      await tx.digitalEvent.create({data:{actorId:s.actorId,kind:"MASTER_VALIDATED",details:{trackId:s.trackId,version:s.expectedVersion+1,checksum,durationMs:decoded.durationMs,previewDurationMs:decoded.previewDurationMs,rightsReview:"PENDING"}}});
    });
    generatedRef=null; return {processed:true,ready:true,ffmpegRssPeak:decoded.ffmpegRssPeak,ffmpegSamples:decoded.ffmpegSamples,tempSourceBytes:size,tempJobBytesObserved:size+metadata.size};
  } catch(e) { const code=e instanceof DigitalError?e.code:"VALIDATION_FAILED";const retry=["INSUFFICIENT_TEMP_DISK","WORKER_MEMORY_LIMIT","LEASE_LOST"].includes(code);
    await prisma.digitalUpload.updateMany({where:{id:s.id,status:"VALIDATING",leaseToken:slot.leaseToken},data:{status:retry?"QUARANTINE":"REJECTED",leaseUntil:retry?new Date(Date.now()+60000):null,leaseToken:null,errorCode:code}}); return {processed:true,ready:false}; }
  finally { clearInterval(heartbeat);stop.abort();if(generatedRef&&!await prisma.asset.findFirst({where:{storageKey:generatedRef.storageKey}})) await deleteMediaObject(generatedRef).catch(()=>undefined);if(root)await rm(root,{recursive:true,force:true});await releaseDigitalSlot(slot); }
}
