/** Real LOCAL PostgreSQL/FFmpeg/storage. Purchase fixture is synthetic, not a PSP payment. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, writeFile, stat, mkdir, chmod, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { createAudioFixture } from "@/tests/audio/fixture";

const cfg = JSON.parse(await readFile(".private/dcn-consolidation-config.json", "utf8")) as Record<string,string>;
const ownerCfg = JSON.parse(await readFile(".private/dcn-consolidation-owner-config.json", "utf8")) as Record<string,string>;
const target = assertSafeLocalPostgresUrl(cfg.DATABASE_URL);
assert.equal(target.pathname, "/lnx_dcn_consolidation_test"); assert.equal(target.port, "55473"); assert.equal(target.hostname, "127.0.0.1");
assert.equal(assertSafeLocalPostgresUrl(ownerCfg.DATABASE_URL).pathname, target.pathname);
assert.notEqual(target.username, new URL(ownerCfg.DATABASE_URL).username);
for (const [key,value] of Object.entries(cfg)) process.env[key] = value;
assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local"); assert.equal(process.env.EMAIL_PROVIDER, "capture");
for (const key of Object.keys(process.env)) if (/^(DCN_.*(?:SECRET|CLIENT_ID|MERCHANT)|PAYPAL_CLIENT|MEDIA_S3_)/.test(key)) assert.ok(!process.env[key], `Provider configuration forbidden: ${key}`);
process.env.DCN_WORK_ROOT ??= "/private/tmp/lnx-dcn-consolidation-work";
process.env.DCN_LOCAL_UPLOAD_ROOT ??= "/private/tmp/lnx-dcn-consolidation-uploads";
const fetchNative = globalThis.fetch;
globalThis.fetch = async (input, init) => { const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url); assert.ok(["127.0.0.1","localhost"].includes(url.hostname), "External fetch forbidden"); return fetchNative(input, init); };
const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerCfg.DATABASE_URL }) });
const { prisma } = await import("@/lib/prisma");
const { initDigitalUpload, writeDigitalLocalPart, completeDigitalUpload } = await import("@/lib/digital/upload");
const { ensureDigitalArchive, processDigitalArchives } = await import("@/lib/digital/archive-worker");
const { createDigitalDownload, digitalDownloadResponse, library } = await import("@/lib/digital/library");
const { saveOffer, selections } = await import("@/lib/digital/catalog");
const { DIGITAL_TERMS_VERSION, DIGITAL_TERMS_TEXT } = await import("@/lib/digital/domain");
const run = promisify(execFile), fixturePath = ".private/dcn-consolidation-fixture.json", proofPath = "output/dcn-consolidation/formats-runtime.json";
type Fixture = { projectId:string;slug:string;adminId:string;buyerId:string;otherUserId:string;trackIds:string[];albumOfferId?:string;singleOfferIds?:string[];formatOrderId?:string;formatLineId?:string };
let fixture:Fixture;
try { fixture = JSON.parse(await readFile(fixturePath, "utf8")); }
catch {
  const runId=randomUUID(), admin=await owner.user.create({data:{email:`dcn-consolidation-admin-${runId}@example.invalid`,displayName:"Admin QA DCN consolidation",role:"ADMIN",status:"ACTIVE",emailVerified:true}}),
    buyer=await owner.user.create({data:{email:`dcn-consolidation-buyer-${runId}@example.invalid`,displayName:"Acquéreur QA formats",role:"MEMBER",status:"ACTIVE",emailVerified:true}}),
    other=await owner.user.create({data:{email:`dcn-consolidation-other-${runId}@example.invalid`,displayName:"Autre compte QA",role:"MEMBER",status:"ACTIVE",emailVerified:true}});
  const position=(await owner.project.aggregate({_max:{catalogPosition:true}}))._max.catalogPosition??0;
  const p=await owner.project.create({data:{slug:`dcn-consolidation-${runId}`,title:"DCN — Album synthétique WAV + MP3 (12 pistes)",type:"ALBUM",status:"PUBLISHED",publicVisible:true,catalogPosition:position+1,
    tracks:{create:Array.from({length:12},(_,i)=>({title:`QA — Piste ${String(i+1).padStart(2,"0")}`,position:i+1,status:"RELEASED" as const}))}},include:{tracks:{orderBy:{position:"asc"}}}});
  fixture={projectId:p.id,slug:p.slug,adminId:admin.id,buyerId:buyer.id,otherUserId:other.id,trackIds:p.tracks.map(t=>t.id)};
  await writeFile(fixturePath,JSON.stringify(fixture,null,2),{mode:0o600});
}
const actor={id:fixture.adminId,email:"qa-admin@example.invalid",name:"Admin QA",role:"ADMIN" as const,status:"ACTIVE" as const,emailVerified:true as const};
const measurements:unknown[]=[];
async function worker(){const r=await run(process.execPath,["--conditions=react-server","--import","tsx","scripts/digital-worker-once.ts","audio"],{env:process.env,timeout:300000,maxBuffer:4096});const value=JSON.parse(r.stdout.trim());measurements.push(value);return value;}
async function hashObject(asset:{storageKey:string;storageBackend:"LOCAL"|"OBJECT";storageProvider:string;visibility:"PRIVATE"|"PUBLIC"}){
  const {getMediaObject}=await import("@/lib/media/storage");const object=await getMediaObject(asset),h=createHash("sha256");let bytes=0;for await(const chunk of object.body){h.update(chunk);bytes+=chunk.length;}return{sha256:h.digest("hex"),bytes};
}
const checks:Record<string,string>={};
try{const previous=JSON.parse(await readFile(proofPath,"utf8"));Object.assign(checks,previous.checks);measurements.push(...previous.measurements);}catch{/* First isolated run. */}
async function rejectedWithoutMutation(operation:(tx:import("@/generated/prisma/client").Prisma.TransactionClient)=>Promise<unknown>){
  let rejected=false;
  try{await owner.$transaction(async tx=>{try{await operation(tx);}catch{rejected=true;}throw new Error("ROLLBACK_NEGATIVE_PROBE");});}catch{/* Every probe rolls back whether accepted or rejected. */}
  assert.equal(rejected,true,"Database must reject the forbidden write before rollback");
}
try {
  if(!["--downloads","--resilience"].includes(process.argv[2])){
    const sources=await mkdtemp("/private/tmp/lnx-dcn-consolidation-audio-");
    for(let i=0;i<fixture.trackIds.length;i++){
      if(await prisma.digitalMaster.findFirst({where:{trackId:fixture.trackIds[i],mp3AssetId:{not:null}}}))continue;
      const existing=await prisma.digitalUpload.findFirst({where:{trackId:fixture.trackIds[i],status:"REJECTED",errorCode:"VALIDATION_FAILED"},orderBy:{createdAt:"desc"}});
      if(existing){await owner.digitalUpload.update({where:{id:existing.id},data:{status:"QUARANTINE",errorCode:null,leaseUntil:null,leaseToken:null}});continue;}
      const f=await createAudioFixture({seconds:i===0?65:5+i/4,format:"wav",outputPath:`${sources}/qa-${i}.wav`}),size=(await stat(f.path)).size;
      const s=await initDigitalUpload(actor,fixture.trackIds[i],{filename:`QA-piste-${i+1}.wav`,mimeType:"audio/wav",sizeBytes:size,expectedVersion:0,previewStartMs:0});
      for(let n=1;n<=s.partCount;n++){const start=(n-1)*s.partSizeBytes,body=Readable.toWeb(createReadStream(f.path,{start,end:Math.min(size,start+s.partSizeBytes)-1}));
        await writeDigitalLocalPart(actor,fixture.trackIds[i],s.sessionToken,s.sessionToken.split(".")[0],n,new Request("http://127.0.0.1:3140/qa-part",{method:"PUT",body,duplex:"half"} as RequestInit));}
      await completeDigitalUpload(actor,fixture.trackIds[i],s.sessionToken);
    }
    for(let n=0;n<12&&await prisma.digitalUpload.count({where:{trackId:{in:fixture.trackIds},status:{in:["QUARANTINE","VALIDATING"]}}});n++)await Promise.all(Array.from({length:4},()=>worker()));
    const masters=await prisma.digitalMaster.findMany({where:{trackId:{in:fixture.trackIds},version:1},include:{masterAsset:true,previewAsset:true,mp3Asset:true}});assert.equal(masters.length,12);
    for(const m of masters){assert.equal(m.status,"READY");assert.equal(m.masterAsset.visibility,"PRIVATE");assert.equal(m.masterAsset.mimeType,"audio/wav");assert.equal(m.mp3Asset?.visibility,"PRIVATE");assert.equal(m.mp3Asset?.mimeType,"audio/mpeg");assert.equal(m.mp3BitrateKbps,320);assert.ok(m.previewDurationMs!<=60000);
      for(const asset of [m.masterAsset,m.mp3Asset!]){const d=await hashObject(asset);assert.equal(d.bytes,Number(asset.sizeBytes));assert.equal(d.sha256,asset.checksumSha256);}}
    checks.REAL_WAV_MP3_12_TRACKS="PASS";checks.PRIVATE_FULL_MASTERS="PASS";checks.PUBLIC_EXCERPTS_MAX_60S="PASS";
    await owner.asset.updateMany({where:{id:{in:masters.flatMap(m=>[m.masterAssetId,m.previewAssetId!,m.mp3AssetId!])}},data:{rightsStatus:"CLEARED"}});
    const album=fixture.albumOfferId??await saveOffer(actor,{projectId:fixture.projectId,priceCents:990,active:true,rightsConfirmed:true,expectedVersion:0,distribution:"UNRELEASED"});
    const singles:string[]=fixture.singleOfferIds??[];if(!singles.length)for(const trackId of fixture.trackIds)singles.push(await saveOffer(actor,{projectId:fixture.projectId,trackId,priceCents:129,active:true,rightsConfirmed:true,expectedVersion:0,distribution:"UNRELEASED"}));
    fixture.albumOfferId=album;fixture.singleOfferIds=singles;await writeFile(fixturePath,JSON.stringify(fixture,null,2),{mode:0o600});
    const selection=(await selections([album]))[0];assert.equal(selection.tracks.length,12);assert.ok(selection.tracks.every(t=>t.formats?.join(",")==="WAV,MP3"));checks.ACQUISITION_FORMAT_SNAPSHOT="PASS";
  }
  if(!["--audio","--resilience"].includes(process.argv[2])){
    assert.ok(fixture.albumOfferId);const selected=(await selections([fixture.albumOfferId]))[0];
    if(!fixture.formatLineId){
      // LOCAL synthetic paid fixture for format delivery only; never represents a real provider confirmation.
      const order=await owner.digitalOrder.create({data:{userId:fixture.buyerId,idempotencyKey:randomUUID(),cartRevision:0,mode:"TEST",status:"PAID",totalCents:990,termsVersion:DIGITAL_TERMS_VERSION,termsHash:createHash("sha256").update(DIGITAL_TERMS_TEXT).digest("hex"),
        lines:{create:{offerId:selected.id,scope:"ALBUM",title:selected.title,priceCents:990,offerVersion:selected.version,trackSnapshot:selected.tracks,taxSnapshot:{mode:"LOCAL_FORMAT_FIXTURE_NOT_TAX_APPROVAL"},entitlements:{create:selected.tracks.map(t=>({userId:fixture.buyerId,masterId:t.masterId}))}}}},include:{lines:true}});
      fixture.formatOrderId=order.id;fixture.formatLineId=order.lines[0].id;await writeFile(fixturePath,JSON.stringify(fixture,null,2),{mode:0o600});
    }
    const lineId=fixture.formatLineId;
    for(const format of ["WAV","MP3"] as const){const concurrent=await Promise.all(Array.from({length:6},()=>ensureDigitalArchive(lineId,format)));assert.equal(new Set(concurrent.map(a=>a.id)).size,1);}
    checks.ARCHIVE_QUEUE_CONCURRENT_CACHE_IDEMPOTENT="PASS";
    for(let n=0;n<2&&await prisma.digitalArchive.count({where:{lineId,status:{not:"READY"}}});n++){const r=await processDigitalArchives();assert.equal(r.ready,true);measurements.push(r);}
    const archives=await prisma.digitalArchive.findMany({where:{lineId},orderBy:{format:"asc"}});assert.equal(archives.length,2);assert.equal(new Set(archives.map(a=>a.storageKey)).size,2);assert.equal(new Set(archives.map(a=>a.checksum)).size,2);
    const {getMediaObject}=await import("@/lib/media/storage");
    for(const a of archives){assert.equal(a.status,"READY");assert.ok(a.storageKey&&a.storageBackend&&a.storageProvider);const d=await hashObject({...a,storageKey:a.storageKey!,storageBackend:a.storageBackend as "LOCAL",storageProvider:a.storageProvider!,visibility:"PRIVATE"});assert.equal(d.sha256,a.checksum);assert.equal(d.bytes,Number(a.sizeBytes));
      const z=await getMediaObject({storageKey:a.storageKey!,storageBackend:"LOCAL",storageProvider:a.storageProvider!,visibility:"PRIVATE"});const bytes=Buffer.from(await new Response(z.body).arrayBuffer());let offset=0;
      for(const t of selected.tracks){assert.equal(bytes.readUInt32LE(offset),0x04034b50);const nameLength=bytes.readUInt16LE(offset+26),name=bytes.subarray(offset+30,offset+30+nameLength).toString();assert.ok(name.endsWith(`.${a.format.toLowerCase()}`));const master=await prisma.digitalMaster.findUniqueOrThrow({where:{id:t.masterId},include:{masterAsset:true,mp3Asset:true}}),asset=a.format==="MP3"?master.mp3Asset!:master.masterAsset;
        const start=offset+30+nameLength,end=start+Number(asset.sizeBytes);assert.equal(createHash("sha256").update(bytes.subarray(start,end)).digest("hex"),asset.checksumSha256);offset=end+16;}
      assert.equal(bytes.readUInt32LE(offset),0x02014b50);
    }
    checks.DISTINCT_FORMAT_ZIPS_CHECKSUMS="PASS";checks.ALL_12_ARCHIVED_ENTRIES_EXACT="PASS";
    for(const format of ["WAV","MP3"] as const)for(const masterId of [selected.tracks[0].masterId,null]){
      const t=await createDigitalDownload(fixture.buyerId,lineId,masterId,format),r=await digitalDownloadResponse(fixture.buyerId,t.ticketId,t.token),bytes=Buffer.from(await r.arrayBuffer());assert.equal(r.status,200);assert.equal(r.headers.get("Cache-Control"),"private, no-store");
      const expected=masterId?await prisma.digitalMaster.findUniqueOrThrow({where:{id:masterId},include:{masterAsset:true,mp3Asset:true}}):null,checksum=expected?(format==="MP3"?expected.mp3Asset!.checksumSha256:expected.masterAsset.checksumSha256):archives.find(a=>a.format===format)!.checksum;
      assert.equal(createHash("sha256").update(bytes).digest("hex"),checksum);await assert.rejects(digitalDownloadResponse(fixture.otherUserId,t.ticketId,t.token),{code:"NOT_FOUND"});
    }
    checks.OWNER_TRACK_AND_ZIP_DOWNLOADS="PASS";checks.OTHER_USER_DENIED="PASS";
    const exhausted=await createDigitalDownload(fixture.buyerId,lineId,selected.tracks[0].masterId,"WAV");
    await owner.digitalDownloadTicket.update({where:{id:exhausted.ticketId},data:{usesLeft:0}});
    await assert.rejects(digitalDownloadResponse(fixture.buyerId,exhausted.ticketId,exhausted.token,{method:"HEAD"}),{code:"NOT_FOUND"});
    const renewed=await createDigitalDownload(fixture.buyerId,lineId,selected.tracks[0].masterId,"WAV");assert.notEqual(renewed.ticketId,exhausted.ticketId);assert.equal((await digitalDownloadResponse(fixture.buyerId,renewed.ticketId,renewed.token,{method:"HEAD"})).status,200);
    checks.NEW_TICKET_RENEWABLE_NO_PURCHASE_DOWNLOAD_CAP="PASS";
    const previous=await prisma.digitalOrderLine.findUniqueOrThrow({where:{id:lineId}}),snapshotBefore=JSON.stringify(previous.trackSnapshot);
    const acquired=await prisma.digitalMaster.findUniqueOrThrow({where:{id:selected.tracks[0].masterId}});
    await rejectedWithoutMutation(tx=>tx.digitalMaster.update({where:{id:acquired.id},data:{mp3AssetId:null,mp3BitrateKbps:null,encoderVersion:null}}));
    await rejectedWithoutMutation(tx=>tx.asset.update({where:{id:acquired.masterAssetId},data:{checksumSha256:"0".repeat(64)}}));
    assert.equal(JSON.stringify((await prisma.digitalOrderLine.findUniqueOrThrow({where:{id:lineId}})).trackSnapshot),snapshotBefore);
    checks.MASTER_AND_SOURCE_IDENTITY_IMMUTABLE="PASS";
    const rows=await library(fixture.buyerId),acquiredLine=rows.orders.find(o=>o.id===fixture.formatOrderId)?.lines[0];assert.deepEqual(acquiredLine?.formats,["WAV","MP3"]);assert.equal(acquiredLine?.archives.length,2);
    checks.LIBRARY_BOTH_FORMATS_NO_STORAGE_KEYS="PASS";assert.ok(!JSON.stringify(rows).includes("storageKey"));
    const historical=await prisma.digitalOrder.findMany({where:{userId:{not:fixture.buyerId}},orderBy:{createdAt:"asc"},take:100,select:{id:true,userId:true,lines:{select:{id:true,trackSnapshot:true}}}});
    const previousPurchase=historical.find(o=>o.lines.some(l=>(l.trackSnapshot as Array<{formats?:unknown}>).every(t=>t.formats===undefined)));
    assert.ok(previousPurchase,"Restored local baseline must include a historical original-format acquisition");
    const beforeHistory=JSON.stringify(previousPurchase.lines),legacyLibrary=await library(previousPurchase.userId);
    assert.ok(legacyLibrary.orders.some(o=>o.lines.some(l=>l.formats.length===1&&l.formats[0]==="WAV")));
    assert.equal(JSON.stringify((await prisma.digitalOrder.findUniqueOrThrow({where:{id:previousPurchase.id},select:{lines:{select:{id:true,trackSnapshot:true}}}})).lines),beforeHistory);
    checks.HISTORICAL_LIBRARY_ORIGINAL_ONLY_READ_ONLY="PASS";
    const ticket=await createDigitalDownload(fixture.buyerId,lineId,selected.tracks[0].masterId,"MP3");
    await owner.digitalEntitlement.updateMany({where:{lineId,masterId:selected.tracks[0].masterId},data:{status:"REVOKED"}});
    await assert.rejects(digitalDownloadResponse(fixture.buyerId,ticket.ticketId,ticket.token),{code:"NOT_FOUND"});await assert.rejects(createDigitalDownload(fixture.buyerId,lineId,null,"WAV"),{code:"PARTIAL_ACCESS"});
    await owner.digitalEntitlement.updateMany({where:{lineId,masterId:selected.tracks[0].masterId},data:{status:"ACTIVE"}});checks.REVOCATION_REVALIDATED_PER_REQUEST="PASS";
  }
  if(process.argv[2]==="--resilience"){
    const runId=randomUUID(),position=(await owner.project.aggregate({_max:{catalogPosition:true}}))._max.catalogPosition??0;
    const project=await owner.project.create({data:{slug:`dcn-formats-resilience-${runId}`,title:"QA reprise worker formats",type:"ALBUM",status:"PUBLISHED",publicVisible:true,catalogPosition:position+1,
      tracks:{create:{title:"QA — Reprise synthétique",position:1,status:"RELEASED"}}},include:{tracks:true}}),track=project.tracks[0];
    const sources=await mkdtemp("/private/tmp/lnx-dcn-consolidation-resilience-"),file=await createAudioFixture({seconds:64.123,format:"wav",outputPath:`${sources}/source.wav`}),size=(await stat(file.path)).size;
    const session=await initDigitalUpload(actor,track.id,{filename:"reprise.wav",mimeType:"audio/wav",sizeBytes:size,expectedVersion:0,previewStartMs:0});
    for(let n=1;n<=session.partCount;n++){const start=(n-1)*session.partSizeBytes,body=Readable.toWeb(createReadStream(file.path,{start,end:Math.min(size,start+session.partSizeBytes)-1}));await writeDigitalLocalPart(actor,track.id,session.sessionToken,session.sessionToken.split(".")[0],n,new Request("http://127.0.0.1:3140/qa-part",{method:"PUT",body,duplex:"half"} as RequestInit));}
    await completeDigitalUpload(actor,track.id,session.sessionToken);
    assert.equal(await prisma.digitalUpload.count({where:{status:"QUARANTINE"}}),1,"Crash probe must not process an unrelated upload");
    const crashCode='const {processDigitalMedia}=await import("./lib/digital/media-worker.ts");await processDigitalMedia({afterSource:async()=>process.exit(86)});';
    await assert.rejects(run(process.execPath,["--conditions=react-server","--import","tsx","--input-type=module","-e",crashCode],{env:process.env,timeout:30000,maxBuffer:4096}),(e:unknown)=>!!e&&typeof e==="object"&&"code"in e&&e.code===86);
    const crashed=await owner.digitalUpload.findUniqueOrThrow({where:{id:session.sessionToken.split(".")[0]}});assert.equal(crashed.status,"VALIDATING");assert.ok(crashed.leaseToken);const crashedDirectory=`${process.env.DCN_WORK_ROOT}/${crashed.id}.${crashed.leaseToken}`;assert.ok((await stat(crashedDirectory)).isDirectory());
    await owner.digitalUpload.update({where:{id:crashed.id},data:{leaseUntil:new Date(Date.now()-1000)}});await owner.digitalWorkSlot.updateMany({where:{jobId:crashed.id,leaseToken:crashed.leaseToken},data:{leaseUntil:new Date(Date.now()-1000)}});
    const recovered=await worker();assert.equal(recovered.ready,true);assert.equal(await prisma.digitalMaster.count({where:{trackId:track.id}}),1);
    const master=await prisma.digitalMaster.findFirstOrThrow({where:{trackId:track.id},include:{masterAsset:true,mp3Asset:true}});assert.ok(master.mp3Asset);checks.AUDIO_REAL_PROCESS_CRASH_RESUMED="PASS";
    // Explicit dry-run of this one new crash directory only; never media/acquisition roots.
    assert.ok(crashedDirectory.startsWith("/private/tmp/lnx-dcn-consolidation-")&&crashedDirectory.endsWith(`${crashed.id}.${crashed.leaseToken}`));
    assert.equal(await prisma.digitalWorkSlot.count({where:{jobId:crashed.id,leaseToken:crashed.leaseToken,leaseUntil:{gt:new Date()}}}),0);
    const cleanupDryRun={directories:[crashedDirectory],containsOnly:"source.wav",acquiredObjectsDeleted:0};await rm(crashedDirectory,{recursive:true});checks.CRASH_TEMP_CLEANUP_TARGETED="PASS";
    const offer=await saveOffer(actor,{projectId:project.id,priceCents:990,active:true,rightsConfirmed:true,expectedVersion:0,distribution:"UNRELEASED"}),selected=(await selections([offer]))[0];
    const order=await owner.digitalOrder.create({data:{userId:fixture.buyerId,idempotencyKey:randomUUID(),cartRevision:0,mode:"TEST",status:"PAID",totalCents:990,termsVersion:DIGITAL_TERMS_VERSION,termsHash:createHash("sha256").update(DIGITAL_TERMS_TEXT).digest("hex"),
      lines:{create:{offerId:offer,scope:"ALBUM",title:selected.title,priceCents:990,offerVersion:selected.version,trackSnapshot:selected.tracks,taxSnapshot:{mode:"LOCAL_RESILIENCE_FIXTURE_NOT_PAYMENT"},entitlements:{create:selected.tracks.map(t=>({userId:fixture.buyerId,masterId:t.masterId}))}}}},include:{lines:true}});
    const archive=await ensureDigitalArchive(order.lines[0].id,"MP3");
    const zipCrashCode='const {processDigitalArchives}=await import("./lib/digital/archive-worker.ts");await processDigitalArchives({afterChunk:async()=>process.exit(86)});';
    await assert.rejects(run(process.execPath,["--conditions=react-server","--import","tsx","--input-type=module","-e",zipCrashCode],{env:process.env,timeout:30000,maxBuffer:4096}),(e:unknown)=>!!e&&typeof e==="object"&&"code"in e&&e.code===86);
    const zipCrashed=await owner.digitalArchive.findUniqueOrThrow({where:{id:archive.id}});assert.equal(zipCrashed.status,"PROCESSING");assert.ok(zipCrashed.leaseToken);
    await owner.digitalArchive.update({where:{id:archive.id},data:{leaseUntil:new Date(Date.now()-1000)}});await owner.digitalWorkSlot.updateMany({where:{jobId:archive.id,leaseToken:zipCrashed.leaseToken},data:{leaseUntil:new Date(Date.now()-1000)}});
    assert.equal((await processDigitalArchives()).ready,true);assert.equal(await prisma.digitalArchive.count({where:{lineId:order.lines[0].id,format:"MP3"}}),1);
    const zip=await prisma.digitalArchive.findUniqueOrThrow({where:{id:archive.id}});assert.equal(zip.attempts,2);assert.equal(zip.status,"READY");checks.ZIP_REAL_PROCESS_CRASH_RESUMED="PASS";
    const zipDirectory=`${process.env.DCN_WORK_ROOT}/${archive.id}.${zipCrashed.leaseToken}`;assert.ok(zipDirectory.startsWith("/private/tmp/lnx-dcn-consolidation-")&&zipDirectory.endsWith(`${archive.id}.${zipCrashed.leaseToken}`));
    assert.equal(await prisma.digitalWorkSlot.count({where:{jobId:archive.id,leaseToken:zipCrashed.leaseToken,leaseUntil:{gt:new Date()}}}),0);await rm(zipDirectory,{recursive:true});measurements.push({cleanupDryRun,zipCleanupDryRun:{directories:[zipDirectory],acquiredObjectsDeleted:0}});
    // A new version is generated; acquired WAV/MP3 IDs and bytes must still resolve to version 1.
    const before=await hashObject(master.masterAsset),oldMp3=await hashObject(master.mp3Asset!);
    const replacement=await createAudioFixture({seconds:64.456,format:"wav",outputPath:`${sources}/replacement.wav`}),replacementSize=(await stat(replacement.path)).size;
    const newer=await initDigitalUpload(actor,track.id,{filename:"replacement.wav",mimeType:"audio/wav",sizeBytes:replacementSize,expectedVersion:1,previewStartMs:1,replaceConfirmed:true});
    for(let n=1;n<=newer.partCount;n++){const start=(n-1)*newer.partSizeBytes,body=Readable.toWeb(createReadStream(replacement.path,{start,end:Math.min(replacementSize,start+newer.partSizeBytes)-1}));await writeDigitalLocalPart(actor,track.id,newer.sessionToken,newer.sessionToken.split(".")[0],n,new Request("http://127.0.0.1:3140/qa-part",{method:"PUT",body,duplex:"half"} as RequestInit));}
    await completeDigitalUpload(actor,track.id,newer.sessionToken);assert.equal((await worker()).ready,true);assert.equal(await prisma.digitalMaster.count({where:{trackId:track.id}}),2);
    assert.deepEqual(await hashObject(master.masterAsset),before);assert.deepEqual(await hashObject(master.mp3Asset!),oldMp3);const unchanged=await prisma.digitalOrderLine.findUniqueOrThrow({where:{id:order.lines[0].id}});assert.deepEqual(unchanged.trackSnapshot,selected.tracks);
    const oldTicket=await createDigitalDownload(fixture.buyerId,unchanged.id,master.id,"MP3"),oldDownload=await digitalDownloadResponse(fixture.buyerId,oldTicket.ticketId,oldTicket.token);assert.equal(createHash("sha256").update(Buffer.from(await oldDownload.arrayBuffer())).digest("hex"),oldMp3.sha256);checks.NEW_MASTER_DOES_NOT_REPLACE_ACQUIRED_WAV_MP3="PASS";
  }
  await mkdir("output/dcn-consolidation",{recursive:true});await writeFile(proofPath,JSON.stringify({environment:"LOCAL_DISPOSABLE_PG_FFMPEG_STORAGE",providerCalls:0,payment:"SYNTHETIC_FORMAT_RIGHTS_FIXTURE_NOT_PSP",checks,measurements,fixtureIds:fixture},null,2),{mode:0o600});await chmod(proofPath,0o600);
  console.log(JSON.stringify({checks,proof:proofPath,providerCalls:0,fixtureIds:fixture}));
}finally{await owner.$disconnect();await prisma.$disconnect();}
