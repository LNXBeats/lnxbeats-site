import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { acquiredDigitalAsset, acquiredDigitalAssetId, acquiredDigitalFormats, digitalCommercialAudioReady,
  DIGITAL_MP3_ENCODER_VERSION, type DigitalAcquiredTrack } from "@/lib/digital/formats";
import { MP3_ONLY_SOURCE, MP3_ONLY_SOURCE_POLICY } from "@/lib/digital/mp3-only-policy";
import { assertDigitalPinnedMedia } from "@/lib/digital/pinned-media-policy";
import { digitalRightsMasterBinding, digitalRightsReviewHash, assessDigitalRightsReview, DIGITAL_RIGHTS_REVIEW_EVENT,
  DIGITAL_RIGHTS_REVIEW_POLICY, DIGITAL_RIGHTS_ATTESTATION, type DigitalRightsReviewDetails } from "@/lib/digital/rights-review-policy";
import { publicQuote, saveOffer, selectionFingerprint, selections } from "@/lib/digital/catalog";
import type { DigitalSelection } from "@/lib/digital/domain";
import type { Prisma } from "@/generated/prisma/client";
import { syntheticExistingExcerptApproval } from "./fixtures/excerpt-approval";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";

/** In-memory metadata doubles only; no real media, order, rights approval, DB, network or payment. */
function fixture(){
  const masterId=randomUUID(),sourceId=randomUUID(),previewId=randomUUID();
  const source={id:sourceId,type:"AUDIO",visibility:"PRIVATE",rightsStatus:"CLEARED",mimeType:"audio/mpeg",checksumSha256:MP3_ONLY_SOURCE.sourceSha256,
    sizeBytes:BigInt(MP3_ONLY_SOURCE.sourceBytes),durationMs:236000};
  const master={id:masterId,trackId:MP3_ONLY_SOURCE.trackId,version:2,status:"READY",codec:"mp3",masterAssetId:sourceId,
    mp3AssetId:null,mp3Asset:null,mp3BitrateKbps:null,encoderVersion:null,previewAssetId:previewId,previewStartMs:0,previewDurationMs:59900,
    masterAsset:source,previewAsset:{id:previewId,type:"AUDIO_PREVIEW",visibility:"PUBLIC",rightsStatus:"CLEARED",mimeType:"audio/mpeg",checksumSha256:"a".repeat(64),sizeBytes:1400000n,durationMs:59900},
    track:{status:"RELEASED",project:{status:"PUBLISHED",publicVisible:true}}};
  const track:DigitalSelection["tracks"][number]={trackId:master.trackId,masterId,title:"Synthetic MP3 metadata",position:1,formats:["MP3"],
    mp3AssetId:sourceId,formatPolicy:MP3_ONLY_SOURCE_POLICY,sourceFormat:"MP3_LOSSY",sourceSha256:source.checksumSha256};
  return{master,track};
}

test("MP3-only readiness is exact track/source/bytes scoped and never fabricates a WAV or encoder",()=>{
  const f=fixture();assert.equal(digitalCommercialAudioReady(f.master),true);
  for(const master of [{...f.master,trackId:randomUUID()},{...f.master,trackId:undefined},{...f.master,status:"QUARANTINED"},
    {...f.master,masterAsset:{...f.master.masterAsset,checksumSha256:"b".repeat(64)}},
    {...f.master,masterAsset:{...f.master.masterAsset,sizeBytes:f.master.masterAsset.sizeBytes-1n}},
    {...f.master,masterAsset:{...f.master.masterAsset,visibility:"PUBLIC"}},
    {...f.master,mp3BitrateKbps:320},{...f.master,encoderVersion:"invented-320"},{...f.master,mp3AssetId:randomUUID()},
    {...f.master,previewAsset:{...f.master.previewAsset,visibility:"PRIVATE"}},
    {...f.master,previewDurationMs:60001,previewAsset:{...f.master.previewAsset,durationMs:60001}}])assert.equal(digitalCommercialAudioReady(master),false);
});

test("MP3-only acquisition pins only the authorized MP3 and rejects WAV or changed/private source",()=>{
  const f=fixture(),before=JSON.stringify(f.track);assert.deepEqual(acquiredDigitalFormats(f.track),["MP3"]);
  assert.equal(acquiredDigitalAssetId(f.track,"MP3",f.master),f.master.masterAssetId);
  assert.equal(acquiredDigitalAsset(f.track,"MP3",f.master),f.master.masterAsset);
  assert.throws(()=>acquiredDigitalAssetId(f.track,"WAV",f.master),{code:"FORMAT_NOT_ACQUIRED"});
  for(const master of [{...f.master,masterAssetId:randomUUID()},{...f.master,codec:"wav"},{...f.master,mp3AssetId:randomUUID()},
    {...f.master,masterAsset:{...f.master.masterAsset,visibility:"PUBLIC"}},
    {...f.master,masterAsset:{...f.master.masterAsset,checksumSha256:"b".repeat(64)}},
    {...f.master,masterAsset:{...f.master.masterAsset,sizeBytes:1n}}])assert.throws(()=>acquiredDigitalAsset(f.track,"MP3",master),{code:"ACQUIRED_FORMAT_INTEGRITY"});
  assert.equal(JSON.stringify(f.track),before);
});

test("malformed MP3-only snapshots cannot grant another track, hash, format or unbound source",()=>{
  const f=fixture();
  for(const patch of [{trackId:randomUUID()},{sourceSha256:"b".repeat(64)},{formatPolicy:"OTHER"},{sourceFormat:undefined},
    {wavAssetId:randomUUID()},{mp3AssetId:undefined},{formats:undefined},{formats:["WAV","MP3"]}])
    assert.throws(()=>acquiredDigitalFormats({...f.track,...patch} as DigitalAcquiredTrack),{code:"ACQUIRED_FORMAT_INTEGRITY"});
  const legacy={trackId:f.track.trackId,masterId:f.track.masterId,title:"Legacy",position:1};
  assert.throws(()=>acquiredDigitalAssetId(legacy,"WAV",f.master),{code:"ACQUIRED_FORMAT_INTEGRITY"});
});

test("MP3-only first-delivery gate retains exact IDs, clearance and publication checks",()=>{
  const f=fixture();assert.doesNotThrow(()=>assertDigitalPinnedMedia([f.track],[f.master]));
  for(const master of [{...f.master,id:randomUUID()},{...f.master,trackId:randomUUID()},
    {...f.master,masterAsset:{...f.master.masterAsset,rightsStatus:"PENDING"}},
    {...f.master,masterAsset:{...f.master.masterAsset,checksumSha256:"b".repeat(64)}},
    {...f.master,masterAsset:{...f.master.masterAsset,sizeBytes:1n}},
    {...f.master,track:{...f.master.track,status:"ANNOUNCED"}},
    {...f.master,track:{...f.master.track,project:{...f.master.track.project,publicVisible:false}}}])
    assert.throws(()=>assertDigitalPinnedMedia([f.track],[master]));
});

test("MP3-only rights remain separately attested and bind source/preview without a false WAV",()=>{
  const f=fixture(),binding=digitalRightsMasterBinding(f.master),actorId=randomUUID(),createdAt=new Date("2026-10-19T12:00:00.000Z");
  assert.equal("wavAssetId" in binding,false);assert.equal("wavSha256" in binding,false);
  assert.equal(binding.mp3AssetId,f.master.masterAssetId);assert.equal(binding.mp3Sha256,MP3_ONLY_SOURCE.sourceSha256);
  const proof={policy:DIGITAL_RIGHTS_REVIEW_POLICY,binding,status:"APPROVED" as const,privateEvidenceReference:"private-evidence:synthetic/mp3-only",
    evidenceSha256:"b".repeat(64),attestation:DIGITAL_RIGHTS_ATTESTATION,reason:null,reviewedAt:createdAt.toISOString(),requestHash:"c".repeat(64)};
  const details:DigitalRightsReviewDetails={...proof,recordHash:digitalRightsReviewHash({actorId,...proof})};
  const event={id:randomUUID(),kind:DIGITAL_RIGHTS_REVIEW_EVENT,actorId,createdAt,details},reviewer={id:actorId,role:"ADMIN",status:"ACTIVE",emailVerified:true};
  assert.equal(assessDigitalRightsReview(f.master,null,reviewer).status,"REVIEW_REQUIRED");
  assert.equal(assessDigitalRightsReview(f.master,event,reviewer).status,"APPROVED");
  assert.equal(assessDigitalRightsReview({...f.master,previewAsset:{...f.master.previewAsset,checksumSha256:"d".repeat(64)}},event,reviewer).status,"REVIEW_REQUIRED");
});

test("format DTO and fingerprint bind the MP3 policy while WAV fingerprints remain byte-identical",()=>{
  const f=fixture(),offer:DigitalSelection={id:randomUUID(),scope:"TRACK",title:f.track.title,priceCents:129,version:1,tracks:[f.track]};
  assert.deepEqual(publicQuote({totalCents:129,removed:[],lines:[offer]}).lines[0].formats,["MP3"]);
  assert.notEqual(selectionFingerprint(offer),selectionFingerprint({...offer,tracks:[{...f.track,sourceSha256:"b".repeat(64)}]}));
  const wav:DigitalSelection={...offer,tracks:[{trackId:randomUUID(),masterId:randomUUID(),title:"Original WAV",position:1,formats:["WAV","MP3"],wavAssetId:randomUUID(),mp3AssetId:randomUUID()}]};
  const old=createHash("sha256").update(JSON.stringify([wav.id,wav.scope,wav.title,wav.version,wav.priceCents,wav.tracks.map(t=>[t.trackId,t.masterId,t.title,t.position,t.formats??null,t.wavAssetId??null,t.mp3AssetId??null]),wav.completion??null])).digest("hex");
  assert.equal(selectionFingerprint(wav),old);
});

test("WAV rights binding retains its exact historical structure and hash",()=>{
  const f=fixture(),mp3Id=randomUUID();
  const wav={...f.master,trackId:randomUUID(),codec:"wav",mp3AssetId:mp3Id,mp3BitrateKbps:320,encoderVersion:DIGITAL_MP3_ENCODER_VERSION,
    masterAsset:{...f.master.masterAsset,mimeType:"audio/wav",checksumSha256:"b".repeat(64)},
    mp3Asset:{...f.master.masterAsset,id:mp3Id,checksumSha256:"c".repeat(64)}};
  const historical={masterId:wav.id,trackId:wav.trackId,version:wav.version,wavAssetId:wav.masterAssetId,wavSha256:wav.masterAsset.checksumSha256,
    mp3AssetId:mp3Id,mp3Sha256:wav.mp3Asset.checksumSha256,previewAssetId:wav.previewAssetId,previewSha256:wav.previewAsset.checksumSha256};
  assert.deepEqual(digitalRightsMasterBinding(wav),historical);
  assert.equal(digitalRightsReviewHash(digitalRightsMasterBinding(wav)),digitalRightsReviewHash(historical));
});

test("MP3-only catalogue selection requires the exact independent single, rights and artistic proofs",async()=>{
  const f=fixture(),reviewer={id:randomUUID(),role:"ADMIN",status:"ACTIVE",emailVerified:true};
  const at=new Date("2026-10-19T12:00:00.000Z"),proof={policy:DIGITAL_RIGHTS_REVIEW_POLICY,binding:digitalRightsMasterBinding(f.master),status:"APPROVED",
    privateEvidenceReference:"private-evidence:synthetic/mp3-sale",evidenceSha256:"b".repeat(64),attestation:DIGITAL_RIGHTS_ATTESTATION,
    reason:null,reviewedAt:at.toISOString(),requestHash:"c".repeat(64)};
  const rights={id:randomUUID(),kind:DIGITAL_RIGHTS_REVIEW_EVENT,actorId:reviewer.id,createdAt:at,
    details:{...proof,recordHash:digitalRightsReviewHash({actorId:reviewer.id,...proof})}};
  const art=syntheticExistingExcerptApproval(f.master,reviewer.id);
  const offer={id:randomUUID(),scope:"TRACK",trackId:f.master.trackId,active:true,rightsConfirmed:true,priceCents:129,version:1,
    project:{id:String(MP3_ONLY_SOURCE.projectId),type:"SINGLE",title:"Synthetic scoped single",status:"PUBLISHED",publicVisible:true,
      tracks:[{id:f.master.trackId,title:f.track.title,position:1,status:"RELEASED",digitalMasters:[f.master]}]}};
  let hasRights=true,hasArt=true;
  const db={digitalOffer:{async findMany(){return[offer];}},digitalMaster:{async findMany(){return[f.master];}},
    digitalEvent:{async findFirst(){return hasRights?rights:null;}},user:{async findUnique(){return reviewer;},async findMany(){return[reviewer];}},
    async $queryRaw(parts:TemplateStringsArray){const sql=parts.join("?");
      if(sql.includes("dcn-excerpt-current-masters"))return[{id:f.master.id,trackId:f.master.trackId}];
      if(sql.includes("dcn-excerpt-latest-artistic-events"))return hasArt?[art]:[];
      return[];}} as unknown as Prisma.TransactionClient;
  const selected=(await selections([offer.id],db))[0];
  assert.deepEqual(selected.tracks[0].formats,["MP3"]);assert.equal(selected.tracks[0].wavAssetId,undefined);
  assert.equal(selected.tracks[0].mp3AssetId,f.master.masterAssetId);assert.equal(selected.priceCents,129);
  hasRights=false;await assert.rejects(()=>selections([offer.id],db),{code:"RIGHTS_REVIEW_REQUIRED"});hasRights=true;
  hasArt=false;await assert.rejects(()=>selections([offer.id],db),{code:"EXCERPT_ARTISTIC_VALIDATION_REQUIRED"});hasArt=true;
  offer.scope="ALBUM";await assert.rejects(()=>selections([offer.id],db),{code:"NO_READY_MASTER"});offer.scope="TRACK";
  offer.project.type="ALBUM";await assert.rejects(()=>selections([offer.id],db),{code:"NO_READY_MASTER"});offer.project.type="SINGLE";
  offer.project.id=randomUUID();await assert.rejects(()=>selections([offer.id],db),{code:"NO_READY_MASTER"});
});

test("legacy Admin cannot activate the MP3-only offer when a second real project track is hidden by its filtered query",async()=>{
  const f=fixture(),actor:OrderActor={id:randomUUID(),role:"ADMIN",status:"ACTIVE",emailVerified:true,email:"synthetic@example.invalid",name:"Synthetic Admin"};
  let counts=0;
  const db={$queryRaw:async()=>[],project:{async findUnique(){return{id:MP3_ONLY_SOURCE.projectId,type:"SINGLE",status:"PUBLISHED",publicVisible:true,
    tracks:[{id:f.master.trackId,status:"RELEASED",digitalMasters:[f.master]}]};}},
    track:{async findFirst(){return{id:f.master.trackId};},async count({where}:{where:{projectId:string}}){assert.equal(where.projectId,MP3_ONLY_SOURCE.projectId);counts++;return 2;}},
    digitalOffer:{async findFirst(){throw new Error("No offer read/write before actual single scope passes");}}} as unknown as Prisma.TransactionClient;
  const oldTransaction=prisma.$transaction,env={...process.env};
  try{
    Object.assign(process.env,{DCN_ENABLED:"true",DCN_MODE:"TEST"});
    for(const key of ["RAILWAY_ENVIRONMENT_NAME","RAILWAY_ENVIRONMENT","MEDIA_DEPLOYMENT_ENV","PAYMENT_DEPLOYMENT_ENV"])delete process.env[key];
    prisma.$transaction=(async(callback:(tx:Prisma.TransactionClient)=>unknown)=>callback(db)) as unknown as typeof oldTransaction;
    await assert.rejects(()=>saveOffer(actor,{projectId:MP3_ONLY_SOURCE.projectId,trackId:f.master.trackId,priceCents:129,active:true,
      rightsConfirmed:true,expectedVersion:0,distribution:"UNRELEASED"}),{code:"NO_READY_MASTER"});
    assert.equal(counts,1);
  }finally{
    prisma.$transaction=oldTransaction;
    for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);
  }
});
