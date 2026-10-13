import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "@/lib/prisma";
import { validateCompleteAudioSource, analyzeAudioSource, generateCatalogMp3Preview } from "@/lib/catalog/ffmpeg";
import { deleteMediaObject, getMediaObject, putMediaObject, sha256Hex, type MediaStorageReference } from "@/lib/media/storage";
import { activeMediaStorage } from "@/lib/media/storage/config";
import { DigitalError, previewWindow, requireDigitalEnvironment, signatureMatches } from "./domain";
import { trackLock, recoverDigitalCompletion } from "./upload";

export async function processDigitalMedia() {
  requireDigitalEnvironment(); const now=new Date();
  const recovery=await prisma.digitalUpload.findFirst({where:{status:"COMPLETING",leaseUntil:{lte:now}},orderBy:{createdAt:"asc"}});
  if(recovery) { const c=await prisma.digitalUpload.updateMany({where:{id:recovery.id,status:"COMPLETING",leaseUntil:{lte:now}},data:{leaseUntil:new Date(Date.now()+60000)}});
    if(c.count) await recoverDigitalCompletion(recovery).catch(()=>undefined); }
  const s=await prisma.digitalUpload.findFirst({where:{OR:[{status:"QUARANTINE"},{status:"VALIDATING",leaseUntil:{lte:now}}]},orderBy:{createdAt:"asc"}});
  if(!s) return {processed:false};
  const leaseUntil=new Date(Date.now()+15*60000);
  const claim=await prisma.digitalUpload.updateMany({where:{id:s.id,OR:[{status:"QUARANTINE"},{status:"VALIDATING",leaseUntil:{lte:now}}]},data:{status:"VALIDATING",leaseUntil}});
  if(!claim.count) return {processed:false};
  const root=await mkdtemp(path.join(tmpdir(),"lnx-dcn-audio-"));
  const extension=s.filename.split(".").pop()!.toLowerCase(); const source=path.join(root,`source.${extension}`), preview=path.join(root,"preview.mp3");
  const driver=activeMediaStorage(); const ref: MediaStorageReference={storageKey:s.storageKey,storageBackend:driver.backend,storageProvider:driver.provider,visibility:"PRIVATE"};
  let generatedRef: MediaStorageReference|null=null;
  try {
    const object=await getMediaObject(ref); if(object.contentLength!==Number(s.sizeBytes)) throw new DigitalError("SIZE_MISMATCH",409);
    const hash=createHash("sha256"); let size=0;
    await pipeline(Readable.fromWeb(object.body as never),new Transform({transform(chunk,_,cb){ size+=chunk.length; if(size>Number(s.sizeBytes)) return cb(new DigitalError("SIZE_MISMATCH",409)); hash.update(chunk); cb(null,chunk); }}),createWriteStream(source,{flags:"wx",mode:0o600}),{signal:AbortSignal.timeout(5*60000)});
    if(size!==Number(s.sizeBytes)) throw new DigitalError("SIZE_MISMATCH",409);
    const checksum=hash.digest("hex");
    const fd=await open(source,"r"); const header=Buffer.alloc(12); try { await fd.read(header,0,12,0); } finally { await fd.close(); }
    if(!signatureMatches(header,extension)) throw new DigitalError("INVALID_SIGNATURE");
    const decoded=await validateCompleteAudioSource(source); const window=previewWindow(decoded.durationMs,s.previewStartMs);
    await generateCatalogMp3Preview({sourcePath:source,outputPath:preview,offsetMs:window.startMs,durationMs:window.durationMs});
    const verified=await analyzeAudioSource(preview), metadata=await stat(preview);
    if(verified.durationMs>60000||verified.durationMs<1||metadata.size>3*1024*1024||metadata.size<1) throw new DigitalError("INVALID_PREVIEW_DURATION");
    const bytes=await readFile(preview); const previewId=randomUUID(), key=`catalog/audio-previews/${previewId}.mp3`;
    const stored=await putMediaObject({scope:"public",key,body:bytes,contentLength:bytes.length,contentType:"audio/mpeg",checksumSha256:sha256Hex(bytes)});
    generatedRef={storageKey:key,storageBackend:stored.storageBackend,storageProvider:stored.storageProvider,visibility:"PUBLIC"};
    await trackLock(s.trackId,async tx=>{
      if(!await tx.digitalUpload.findFirst({where:{id:s.id,status:"VALIDATING",leaseUntil}})) throw new DigitalError("LEASE_LOST",409);
      const admin=await tx.user.findUnique({where:{id:s.actorId},select:{role:true,status:true,emailVerified:true}});
      if(admin?.role!=="ADMIN"||admin.status!=="ACTIVE"||!admin.emailVerified) throw new DigitalError("ADMIN_REQUIRED",403);
      const latest=await tx.digitalMaster.findFirst({where:{trackId:s.trackId},orderBy:{version:"desc"}});
      if((latest?.version??0)!==s.expectedVersion) throw new DigitalError("MASTER_VERSION_CONFLICT",409);
      if(await tx.digitalMaster.findFirst({where:{masterAsset:{checksumSha256:checksum}}})) throw new DigitalError("DUPLICATE_MASTER_REVIEW_REQUIRED",409);
      await tx.asset.create({data:{id:s.id,type:"AUDIO",storageKey:s.storageKey,storageBackend:driver.backend,storageProvider:driver.provider,visibility:"PRIVATE",filename:s.filename,
        mimeType:s.mimeType,sizeBytes:s.sizeBytes,durationMs:decoded.durationMs,checksumSha256:checksum,rightsStatus:"PENDING",confidence:"CONFIRMED"}});
      await tx.asset.create({data:{id:previewId,type:"AUDIO_PREVIEW",storageKey:key,storageBackend:stored.storageBackend,storageProvider:stored.storageProvider,visibility:"PUBLIC",filename:"preview.mp3",
        mimeType:"audio/mpeg",sizeBytes:BigInt(bytes.length),durationMs:verified.durationMs,checksumSha256:sha256Hex(bytes),rightsStatus:"PENDING",confidence:"CONFIRMED"}});
      await tx.digitalMaster.create({data:{trackId:s.trackId,version:s.expectedVersion+1,masterAssetId:s.id,previewAssetId:previewId,previewStartMs:s.previewStartMs,previewDurationMs:verified.durationMs,codec:extension,status:"READY"}});
      await tx.digitalUpload.update({where:{id:s.id},data:{status:"READY",leaseUntil:null}});
      await tx.digitalEvent.create({data:{actorId:s.actorId,kind:"MASTER_VALIDATED",details:{trackId:s.trackId,version:s.expectedVersion+1,checksum,durationMs:decoded.durationMs,previewDurationMs:verified.durationMs,rightsReview:"PENDING"}}});
    });
    generatedRef=null; return {processed:true,ready:true};
  } catch(e) { await prisma.digitalUpload.updateMany({where:{id:s.id,status:"VALIDATING",leaseUntil},data:{status:"REJECTED",leaseUntil:null,errorCode:e instanceof DigitalError?e.code:"VALIDATION_FAILED"}}); return {processed:true,ready:false}; }
  finally { if(generatedRef) await deleteMediaObject(generatedRef).catch(()=>undefined); await rm(root,{recursive:true,force:true}); }
}
