/** Exact new QA copy; new metadata fixtures and real non-owner PostgreSQL credit trigger.
 * No catalogue publication, financial provider, mail, download or real rights claim.
 */
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile,stat,writeFile,mkdir} from "node:fs/promises";
import http from "node:http";import https from "node:https";import tls from "node:tls";import net from "node:net";
import {syncBuiltinESMExports} from "node:module";
import {PrismaPg} from "@prisma/adapter-pg";import {PrismaClient,type Prisma} from "@/generated/prisma/client";
import {assertSafeDigitalLocalPostgresUrl} from "@/lib/digital/local-review-database";
const block=()=>{throw Error("MASTER_EQUIVALENCE_EXTERNAL_NETWORK_FORBIDDEN");};
http.request=block as typeof http.request;http.get=block as typeof http.get;https.request=block as typeof https.request;https.get=block as typeof https.get;tls.connect=block as typeof tls.connect;globalThis.fetch=block as typeof fetch;
const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(this:net.Socket,...args:unknown[]){const a=args[0],host=typeof a==="object"&&a!==null&&"host"in a?a.host:args[1],port=typeof a==="object"&&a!==null&&"port"in a?a.port:a;assert.equal(host,"127.0.0.1");assert.equal(Number(port),55473);return Reflect.apply(connect,this,args) as net.Socket;} as typeof connect;syncBuiltinESMExports();
async function profile(name:string){assert.equal((await stat(name)).mode&0o077,0);return JSON.parse(await readFile(name,"utf8")) as Record<string,string>;}
const config=await profile(".private/dcn-france-commercial-config.json"),url=assertSafeDigitalLocalPostgresUrl(config.DATABASE_URL);assert.equal(url.pathname,"/lnx_dcn_france_commercial_test_20261015");assert.equal(url.username,"dcn_runtime_a");assert.equal(url.searchParams.get("options"),"-c timezone=UTC");
const ownerConfig=await profile(".private/dcn-consolidation-owner-config.json"),ownerUrl=assertSafeDigitalLocalPostgresUrl(ownerConfig.DATABASE_URL);assert.equal(ownerUrl.pathname,"/lnx_dcn_consolidation_test");assert.equal(ownerUrl.username,"dcn_owner");ownerUrl.pathname=url.pathname;ownerUrl.searchParams.set("options","-c timezone=UTC");
for(const key of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|RAILWAY|R2|AWS|S3|SMTP/.test(key))delete process.env[key];Object.assign(process.env,config,{NODE_ENV:"test",DCN_ENABLED:"true",DCN_MODE:"TEST",DCN_LOCAL_REVIEW_AUTHORIZED:"true",DCN_NEW_PAYMENTS_ENABLED:"false",DCN_EXTERNAL_TEST_AUTHORIZED:"false",ADS_ENABLED:"false"});
const owner=new PrismaClient({adapter:new PrismaPg({connectionString:ownerUrl.toString()})}),runtime=(await import("@/lib/prisma")).prisma,runId=randomUUID(),results:Array<{name:string;status:"PASS"}>=[];
const stable=(v:unknown)=>createHash("sha256").update(JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x)).digest("hex"),json=(v:unknown)=>v as Prisma.InputJsonValue;
async function check(name:string,run:()=>Promise<void>){await run();results.push({name,status:"PASS"});console.log(`PASS ${name}`);}
try{
  const before=await owner.digitalOrder.findMany({orderBy:{id:"asc"},select:{id:true,contractSnapshot:true,jurisdictionSnapshot:true,lines:{orderBy:{id:"asc"}},documents:{orderBy:{id:"asc"},select:{id:true,snapshotHash:true,pdfHash:true,snapshot:true}}}}),beforeMasters=await owner.digitalMaster.findMany({orderBy:{id:"asc"}}),beforeRights=await owner.digitalEntitlement.findMany({orderBy:{id:"asc"}}),historyHash=stable({before,beforeMasters,beforeRights});
  const {recordDigitalMasterEquivalence,digitalMasterEquivalenceProof}=await import("@/lib/digital/master-equivalence-service"),{applyDigitalCompletions,reserveDigitalCompletion,verifyDigitalCompletions}=await import("@/lib/digital/completion");
  const admin=await owner.user.create({data:{email:`equivalence-admin-${runId}@example.invalid`,role:"ADMIN",status:"ACTIVE",emailVerified:true}}),buyer=await owner.user.create({data:{email:`equivalence-buyer-${runId}@example.invalid`,status:"ACTIVE",emailVerified:true}}),actor={id:admin.id,email:admin.email,name:"Synthetic equivalence reviewer",role:admin.role,status:"ACTIVE" as const,emailVerified:true as const};
  const max=await owner.project.aggregate({_max:{catalogPosition:true}}),project=await owner.project.create({data:{slug:`equivalence-${runId}`,title:"Synthetic equivalence fixture - not published",type:"ALBUM",status:"DRAFT",publicVisible:false,catalogPosition:(max._max.catalogPosition??0)+1,
    tracks:{create:{title:"Same canonical synthetic track",position:1,status:"DRAFT"}}},include:{tracks:true}}),track=project.tracks[0],masters=[];
  for(const version of[1,2]){const asset={storageBackend:"LOCAL" as const,storageProvider:"local",sizeBytes:100000n,durationMs:1000,checksumSha256:"a".repeat(64),rightsStatus:"PENDING" as const,visibility:"PRIVATE" as const,type:"AUDIO" as const},
    wav=await owner.asset.create({data:{...asset,storageKey:`digital/masters/${track.id}/${randomUUID()}.wav`,filename:"synthetic-no-file.wav",mimeType:"audio/wav"}}),mp3=await owner.asset.create({data:{...asset,storageKey:`digital/masters/${track.id}/${randomUUID()}.mp3`,filename:"synthetic-no-file.mp3",mimeType:"audio/mpeg"}}),
    preview=await owner.asset.create({data:{...asset,type:"AUDIO_PREVIEW",visibility:"PUBLIC",storageKey:`catalog/audio-previews/${randomUUID()}.mp3`,filename:"synthetic-no-file-preview.mp3",mimeType:"audio/mpeg"}});
    masters.push(await owner.digitalMaster.create({data:{trackId:track.id,version,status:"READY",codec:"wav",masterAssetId:wav.id,mp3AssetId:mp3.id,previewAssetId:preview.id,previewDurationMs:1000,encoderVersion:"SYNTHETIC_EQUIVALENCE_NOT_AUDIO",mp3BitrateKbps:320}}));}
  const [sourceMaster,targetMaster]=masters,sourceTrack={trackId:track.id,masterId:sourceMaster.id,title:track.title,position:1},targetTrack={...sourceTrack,masterId:targetMaster.id},
    single=await owner.digitalOffer.create({data:{scope:"TRACK",projectId:project.id,trackId:track.id,priceCents:129}}),offer=await owner.digitalOffer.create({data:{scope:"ALBUM",projectId:project.id,priceCents:990}}),
    source=await owner.digitalOrder.create({data:{userId:buyer.id,idempotencyKey:randomUUID(),cartRevision:0,status:"PAID",totalCents:129,termsVersion:"SYNTHETIC_SOURCE_NO_PSP",termsHash:"b".repeat(64),
      lines:{create:{offerId:single.id,scope:"TRACK",title:track.title,priceCents:129,offerVersion:1,trackSnapshot:json([sourceTrack]),taxSnapshot:{status:"SYNTHETIC_METADATA_FIXTURE"}}},
      attempts:{create:{provider:"STRIPE",status:"PAID",idempotencyKey:`synthetic-${randomUUID()}`,providerReference:`synthetic-session-${randomUUID()}`,paymentReference:`synthetic-payment-${randomUUID()}`}}},include:{lines:true}});
  await owner.digitalEntitlement.create({data:{userId:buyer.id,lineId:source.lines[0].id,masterId:sourceMaster.id}});
  const album={id:offer.id,scope:"ALBUM",title:"Synthetic current edition",version:1,priceCents:990,tracks:[targetTrack]},owned=new Set([track.id]),input={trackId:track.id,sourceMasterId:sourceMaster.id,targetMasterId:targetMaster.id,status:"APPROVED",expectedReviewId:null as string|null,
    privateEvidenceReference:`private-evidence:synthetic/equivalence-${runId}`,evidenceSha256:"c".repeat(64),attested:true,reason:"Synthetic QA explicit credit equivalence only; no rights or remaster grant.",idempotencyKey:randomUUID()};
  await check("default_closed_and_exact_directional_admin_approval_then_quote",async()=>{
    await assert.rejects(()=>applyDigitalCompletions(runtime,buyer.id,[album],owned),{code:"COMPLETION_EQUIVALENCE_REQUIRES_REVIEW"});
    await recordDigitalMasterEquivalence(actor,input);assert.equal((await recordDigitalMasterEquivalence(actor,input)).duplicate,true);
    const q=(await applyDigitalCompletions(runtime,buyer.id,[album],owned))[0];assert.equal(q.priceCents,861);assert.equal(q.completion?.sources[0].equivalence?.sourceMasterId,sourceMaster.id);
    await assert.rejects(()=>digitalMasterEquivalenceProof(runtime,targetMaster.id,sourceMaster.id,track.id));
  });
  const q=(await applyDigitalCompletions(runtime,buyer.id,[album],owned))[0];
  const target=await runtime.digitalOrder.create({data:{userId:buyer.id,idempotencyKey:randomUUID(),cartRevision:1,totalCents:q.priceCents,termsVersion:"SYNTHETIC_TARGET_NO_PAYMENT",termsHash:"d".repeat(64),
    lines:{create:{offerId:offer.id,scope:"ALBUM",title:album.title,priceCents:q.priceCents,offerVersion:1,trackSnapshot:json(album.tracks),completionSnapshot:json(q.completion),taxSnapshot:{status:"SYNTHETIC_METADATA_FIXTURE"}}}},include:{lines:true}});
  await check("actual_non_owner_sql_trigger_admits_exact_approved_mapping_and_reserves_once",async()=>{
    await runtime.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-user:${buyer.id}`})) IS NULL AS locked`;await reserveDigitalCompletion(tx,buyer.id,target.lines[0].id,q.completion!);await verifyDigitalCompletions(tx,target.id,buyer.id);});
    assert.equal(await runtime.digitalCompletionCredit.count({where:{targetLineId:target.lines[0].id}}),1);assert.equal(await runtime.digitalEntitlement.count({where:{lineId:target.lines[0].id}}),0);
  });
  await check("shared_source_read_blocks_revoke_until_transaction_finishes_then_fresh_verification_refuses",async()=>{
    let announce!:()=>void,release!:()=>void;const hasShared=new Promise<void>(r=>announce=r),finishRead=new Promise<void>(r=>release=r);
    const read=runtime.$transaction(async tx=>{await digitalMasterEquivalenceProof(tx,sourceMaster.id,targetMaster.id,track.id);announce();await finishRead;},{timeout:10000});await hasShared;
    const latest=await runtime.digitalEvent.findFirstOrThrow({where:{kind:"DIGITAL_MASTER_EQUIVALENCE",details:{path:["pairKey"],equals:`${sourceMaster.id}:${targetMaster.id}`}},orderBy:{createdAt:"desc"}});
    let completed=false;const revoke=recordDigitalMasterEquivalence(actor,{...input,status:"REVOKED",expectedReviewId:latest.id,idempotencyKey:randomUUID(),attested:false,privateEvidenceReference:null,evidenceSha256:null,reason:"Synthetic revocation after locked read."}).then(()=>{completed=true;});
    await new Promise(r=>setTimeout(r,100));assert.equal(completed,false);release();await read;await revoke;
    await assert.rejects(()=>runtime.$transaction(tx=>verifyDigitalCompletions(tx,target.id,buyer.id)),{code:"COMPLETION_EQUIVALENCE_REQUIRES_REVIEW"});
    assert.equal(await runtime.digitalCompletionCredit.count({where:{targetLineId:target.lines[0].id,status:"RESERVED"}}),1);assert.equal(await runtime.digitalEntitlement.count({where:{lineId:source.lines[0].id,status:"ACTIVE"}}),1);
  });
  await check("all_preexisting_orders_documents_masters_and_rights_remain_identical",async()=>{
    const after=await owner.digitalOrder.findMany({where:{id:{in:before.map(o=>o.id)}},orderBy:{id:"asc"},select:{id:true,contractSnapshot:true,jurisdictionSnapshot:true,lines:{orderBy:{id:"asc"}},documents:{orderBy:{id:"asc"},select:{id:true,snapshotHash:true,pdfHash:true,snapshot:true}}}}),afterMasters=await owner.digitalMaster.findMany({where:{id:{in:beforeMasters.map(m=>m.id)}},orderBy:{id:"asc"}}),afterRights=await owner.digitalEntitlement.findMany({where:{id:{in:beforeRights.map(e=>e.id)}},orderBy:{id:"asc"}});
    assert.equal(stable({before:after,beforeMasters:afterMasters,beforeRights:afterRights}),historyHash);
  });
  await mkdir("output/dcn-france-commercial",{recursive:true});await writeFile("output/dcn-france-commercial/master-equivalence-runtime.json",JSON.stringify({scope:"REAL_NON_OWNER_POSTGRESQL_NEW_QA_COPY_METADATA_FIXTURES_ONLY",database:url.pathname.slice(1),runId,results,ids:{projectId:project.id,sourceOrderId:source.id,targetOrderId:target.id,sourceMasterId:sourceMaster.id,targetMasterId:targetMaster.id},
    externalRequests:0,providerCalls:0,emailsSent:0,newTargetPaymentAttempts:0,newTargetEntitlements:0,publication:false,historicalRowsUnchanged:true,historicalProofHash:historyHash,retained:"All synthetic fixtures, approval, revocation and reserved credit retained; no cleanup or historical rewrite."},null,2));console.log(`MASTER_EQUIVALENCE_RUNTIME_PASS=${results.length}`);
}finally{await runtime.$disconnect();await owner.$disconnect();}
