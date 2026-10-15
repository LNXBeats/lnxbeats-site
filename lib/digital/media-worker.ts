import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "@/lib/prisma";
import { deleteMediaObject, getMediaObject, putMediaObject, sha256Hex, type MediaStorageReference } from "@/lib/media/storage";
import { activeMediaStorage } from "@/lib/media/storage/config";
import { DigitalError, requireDigitalEnvironment, signatureMatches } from "./domain";
import { trackLock, recoverDigitalCompletion } from "./upload";
import { generateDigitalMp3, validateDigitalAudio, DIGITAL_MP3_LIMIT_BYTES } from "./audio";
import { planDigitalMasterImport } from "./master-import-policy";
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
  const generatedRefs: MediaStorageReference[]=[];
  try {
    if(Number(s.sizeBytes)>DIGITAL_WORK_LIMITS.masterBytes)throw new DigitalError("MASTER_SIZE_LIMIT");
    root=path.join(await checkDigitalDisk(Number(s.sizeBytes)+3*1024*1024+DIGITAL_MP3_LIMIT_BYTES),`${s.id}.${slot.leaseToken}`);await mkdir(root,{mode:0o700});
    const extension=s.filename.split(".").pop()!.toLowerCase(),source=path.join(root,`source.${extension}`),preview=path.join(root,"preview.mp3"),mp3=path.join(root,"full.mp3");
    if(extension!=="wav"||s.mimeType!=="audio/wav")throw new DigitalError("WAV_SOURCE_REQUIRED");
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
    generatedRefs.push({storageKey:key,storageBackend:stored.storageBackend,storageProvider:stored.storageProvider,visibility:"PUBLIC"});
    const rendition=await generateDigitalMp3(source,mp3,decoded.durationMs,stop.signal),mp3Metadata=await stat(mp3);
    if(mp3Metadata.size<1||mp3Metadata.size>=DIGITAL_MP3_LIMIT_BYTES)throw new DigitalError("MP3_RENDITION_INTEGRITY");
    const mp3Hash=createHash("sha256");for await(const chunk of createReadStream(mp3))mp3Hash.update(chunk);
    const mp3Checksum=mp3Hash.digest("hex"),mp3Id=randomUUID(),mp3Key=`digital/derived/${s.id}/${mp3Id}.mp3`;
    const mp3Stored=await putMediaObject({scope:"private",key:mp3Key,body:createReadStream(mp3),contentLength:mp3Metadata.size,contentType:"audio/mpeg",checksumSha256:mp3Checksum});
    generatedRefs.push({storageKey:mp3Key,storageBackend:mp3Stored.storageBackend,storageProvider:mp3Stored.storageProvider,visibility:"PRIVATE"});
    await trackLock(s.trackId,async tx=>{
      if(!await tx.digitalUpload.findFirst({where:{id:s.id,status:"VALIDATING",leaseToken:slot.leaseToken,leaseUntil:{gt:new Date()}}})||!await tx.digitalWorkSlot.findFirst({where:{id:slot.id,leaseToken:slot.leaseToken,leaseUntil:{gt:new Date()}}})) throw new DigitalError("LEASE_LOST",409);
      const admin=await tx.user.findUnique({where:{id:s.actorId},select:{role:true,status:true,emailVerified:true}});
      if(admin?.role!=="ADMIN"||admin.status!=="ACTIVE"||!admin.emailVerified) throw new DigitalError("ADMIN_REQUIRED",403);
      const latest=await tx.digitalMaster.findFirst({where:{trackId:s.trackId},orderBy:{version:"desc"}});
      if((latest?.version??0)!==s.expectedVersion) throw new DigitalError("MASTER_VERSION_CONFLICT",409);
      // Serialise only identical hashes after all file/network work, without holding a DB transaction during decoding or storage calls.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-master-sha:${checksum}`})) IS NULL AS locked`;
      const duplicates=await tx.digitalMaster.findMany({where:{masterAsset:{checksumSha256:checksum}},take:2,select:{id:true,trackId:true,version:true,status:true,codec:true,encoderVersion:true,masterAssetId:true,
        masterAsset:{select:{checksumSha256:true,storageKey:true,visibility:true,mimeType:true}}}});
      const importPlan=planDigitalMasterImport({trackId:s.trackId,expectedVersion:s.expectedVersion,latestMasterId:latest?.id??null,checksum,newAssetId:s.id,newStorageKey:s.storageKey,encoderVersion:rendition.encoderVersion,duplicates});
      await tx.asset.create({data:{id:s.id,type:"AUDIO",storageKey:s.storageKey,storageBackend:driver.backend,storageProvider:driver.provider,visibility:"PRIVATE",filename:s.filename,
        mimeType:s.mimeType,sizeBytes:s.sizeBytes,durationMs:decoded.durationMs,checksumSha256:checksum,rightsStatus:"PENDING",confidence:"CONFIRMED"}});
      await tx.asset.create({data:{id:previewId,type:"AUDIO_PREVIEW",storageKey:key,storageBackend:stored.storageBackend,storageProvider:stored.storageProvider,visibility:"PUBLIC",filename:"preview.mp3",
        mimeType:"audio/mpeg",sizeBytes:BigInt(bytes.length),durationMs:decoded.previewDurationMs,checksumSha256:sha256Hex(bytes),rightsStatus:"PENDING",confidence:"CONFIRMED"}});
      await tx.asset.create({data:{id:mp3Id,type:"AUDIO",storageKey:mp3Key,storageBackend:mp3Stored.storageBackend,storageProvider:mp3Stored.storageProvider,visibility:"PRIVATE",filename:s.filename.replace(/\.wav$/i,".mp3"),
        mimeType:"audio/mpeg",sizeBytes:BigInt(mp3Metadata.size),durationMs:rendition.durationMs,checksumSha256:mp3Checksum,rightsStatus:"PENDING",confidence:"CONFIRMED"}});
      await tx.digitalMaster.create({data:{trackId:s.trackId,version:s.expectedVersion+1,masterAssetId:s.id,previewAssetId:previewId,mp3AssetId:mp3Id,mp3BitrateKbps:rendition.bitrateKbps,encoderVersion:rendition.encoderVersion,previewStartMs:s.previewStartMs,previewDurationMs:decoded.previewDurationMs,codec:extension,status:"READY"}});
      await tx.digitalUpload.update({where:{id:s.id},data:{status:"READY",leaseUntil:null,leaseToken:null}});
      await tx.digitalEvent.create({data:{actorId:s.actorId,kind:"MASTER_VALIDATED",details:{trackId:s.trackId,version:s.expectedVersion+1,checksum,durationMs:decoded.durationMs,previewDurationMs:decoded.previewDurationMs,mp3Checksum,mp3BitrateKbps:rendition.bitrateKbps,encoderVersion:rendition.encoderVersion,probe:rendition.probe,sourceProbe:"RIFF_CHUNKS_AND_FFMPEG_STRICT_DECODE",mp3Probe:"MPEG_LAYER_III_FRAMES_AND_FFMPEG_STRICT_DECODE",revalidation:importPlan.revalidation,rightsReview:"PENDING"}}});
    });
    generatedRefs.length=0; return {processed:true,ready:true,ffmpegRssPeak:decoded.ffmpegRssPeak,ffmpegSamples:decoded.ffmpegSamples,tempSourceBytes:size,tempJobBytesObserved:size+metadata.size+mp3Metadata.size,mp3Checksum,mp3BitrateKbps:rendition.bitrateKbps};
  } catch(e) { const code=e instanceof DigitalError?e.code:"VALIDATION_FAILED";const retry=["INSUFFICIENT_TEMP_DISK","WORKER_MEMORY_LIMIT","WORKER_MONITOR_UNAVAILABLE","LEASE_LOST"].includes(code);
    await prisma.digitalUpload.updateMany({where:{id:s.id,status:"VALIDATING",leaseToken:slot.leaseToken},data:{status:retry?"QUARANTINE":"REJECTED",leaseUntil:retry?new Date(Date.now()+60000):null,leaseToken:null,errorCode:code}});
    const failureType=e instanceof Error?e.name:"UNKNOWN",providerCode=e&&typeof e==="object"&&"code" in e&&typeof e.code==="string"&&/^[A-Z0-9_]{1,40}$/.test(e.code)?e.code:null;
    return {processed:true,ready:false,errorCode:code,failureType,providerCode}; }
  finally { clearInterval(heartbeat);stop.abort();for(const generatedRef of generatedRefs)if(!await prisma.asset.findFirst({where:{storageKey:generatedRef.storageKey}}))await deleteMediaObject(generatedRef).catch(()=>undefined);if(root)await rm(root,{recursive:true,force:true});await releaseDigitalSlot(slot); }
}
