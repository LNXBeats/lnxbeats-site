import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { loadDigitalExcerptSelection, recordDigitalExcerptSelection } from "@/lib/digital/excerpt-service";
import { DIGITAL_EXCERPT_EVENT, type DigitalExcerptEvent } from "@/lib/digital/excerpt-policy";
import { MP3_ONLY_SOURCE } from "@/lib/digital/mp3-only-policy";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";

/** LIVE policy exercised with repository doubles only: no server, DB, media or payment is contacted. */
function fixture(){
  const sourceId=randomUUID(),previewId=randomUUID(),masterId=randomUUID();
  const source={id:sourceId,type:"AUDIO",visibility:"PRIVATE",rightsStatus:"PENDING",mimeType:"audio/mpeg",sizeBytes:BigInt(MP3_ONLY_SOURCE.sourceBytes),
    checksumSha256:String(MP3_ONLY_SOURCE.sourceSha256),durationMs:233830,storageBackend:"OBJECT",storageProvider:"r2",storageKey:`digital/masters/${MP3_ONLY_SOURCE.trackId}/${sourceId}.mp3`};
  const preview={id:previewId,type:"AUDIO_PREVIEW",visibility:"PUBLIC",rightsStatus:"PENDING",mimeType:"audio/mpeg",sizeBytes:1440000n,
    checksumSha256:"a".repeat(64),durationMs:59904,storageBackend:"OBJECT",storageProvider:"r2",storageKey:`catalog/audio-previews/${previewId}.mp3`};
  const master={id:masterId,trackId:String(MP3_ONLY_SOURCE.trackId),version:1,status:"READY",codec:"mp3",masterAssetId:sourceId,
    mp3AssetId:null as string|null,mp3Asset:null as typeof source|null,mp3BitrateKbps:null as number|null,encoderVersion:null as string|null,
    previewAssetId:previewId,previewAsset:preview as typeof preview|null,masterAsset:source,previewStartMs:0,previewDurationMs:59904,
    track:{projectId:String(MP3_ONLY_SOURCE.projectId),title:"Synthetic exact MP3"}};
  const actor:OrderActor={id:randomUUID(),role:"ADMIN",status:"ACTIVE",emailVerified:true,name:"Synthetic Admin",email:"qa@example.invalid"};
  let currentId=master.id;
  const events:Array<DigitalExcerptEvent&{externalKey:string}>=[];
  const db={$queryRaw:async()=>[],user:{async findUnique(){return{id:actor.id,role:"ADMIN",status:"ACTIVE",emailVerified:true};}},
    digitalMaster:{async findUnique(){return master;},async findFirst(){return{id:currentId};}},
    digitalEvent:{async findFirst(){return events.at(-1)??null;},async findUnique({where}:{where:{externalKey:string}}){return events.find(e=>e.externalKey===where.externalKey)??null;},
      async create({data}:{data:Omit<DigitalExcerptEvent&{externalKey:string},"id">}){const event={...data,id:randomUUID()};events.push(event);return event;}}} as unknown as Prisma.TransactionClient;
  const input=()=>({action:"validate-current",startMs:0,expectedRevisionId:null,idempotencyKey:randomUUID(),attested:true});
  return{master,actor,db,events,input,replace(){currentId=randomUUID();}};
}
async function live<T>(run:()=>Promise<T>){
  const env={...process.env};
  try{
    for(const key of Object.keys(process.env))if(/^DCN_(?:R4_|LOCAL_QA_)/.test(key))delete process.env[key];
    for(const key of ["RAILWAY_ENVIRONMENT","DCN_EXTERNAL_TEST_AUTHORIZED","DCN_LOCAL_REVIEW_AUTHORIZED","DCN_RECOVERY_EXCERPTS_REVIEW_ONLY"])delete process.env[key];
    Object.assign(process.env,{DCN_ENABLED:"true",DCN_MODE:"LIVE",NODE_ENV:"production",RAILWAY_ENVIRONMENT_NAME:"production",MEDIA_DEPLOYMENT_ENV:"production",
      PAYMENT_DEPLOYMENT_ENV:"production",DCN_STORAGE_MODE:"OBJECT",PAYMENT_PRODUCTION_CONFIRM:"payments-production-live-approved"});
    return await run();
  }finally{for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
}

test("LIVE exact MP3-only current excerpt needs an explicit artistic action, appends once and never changes rights/media",async()=>{
  const f=fixture(),before=structuredClone(f.master);
  await live(async()=>{
    assert.equal((await loadDigitalExcerptSelection(f.db,f.master)).status,"TO_LISTEN");assert.equal(f.events.length,0);
    await assert.rejects(()=>recordDigitalExcerptSelection(f.actor,f.master.id,{...f.input(),attested:false},f.db),{code:"EXCERPT_ATTESTATION_REQUIRED"});
    assert.equal(f.events.length,0);
    const input=f.input(),result=await recordDigitalExcerptSelection(f.actor,f.master.id,input,f.db);
    assert.equal(result.selection.status,"VALIDATED");assert.equal(result.selection.candidateUrl,`/api/admin/digital/previews/${f.master.previewAssetId}`);
    assert.deepEqual(await recordDigitalExcerptSelection(f.actor,f.master.id,input,f.db),result);
    assert.equal(f.events.length,1);assert.equal(f.events[0].kind,DIGITAL_EXCERPT_EVENT);assert.deepEqual(f.master,before);
    assert.equal(f.master.masterAsset.rightsStatus,"PENDING");assert.equal(f.master.previewAsset!.rightsStatus,"PENDING");
  });
});

test("LIVE MP3-only artistic validation refuses another track/hash/size/project/master or unavailable object without an event",async()=>{
  await live(async()=>{
    for(const change of ["track","hash","size","project","newerMaster","missingPreview","localSource","wrongProvider","missingSourceKey","localPreview","missingPreviewKey"]){
      const f=fixture();
      if(change==="track")f.master.trackId=randomUUID();
      if(change==="hash")f.master.masterAsset.checksumSha256="b".repeat(64);
      if(change==="size")f.master.masterAsset.sizeBytes--;
      if(change==="project")f.master.track.projectId=randomUUID();
      if(change==="newerMaster")f.replace();
      if(change==="missingPreview")f.master.previewAsset=null;
      if(change==="localSource")f.master.masterAsset.storageBackend="LOCAL";
      if(change==="wrongProvider")f.master.masterAsset.storageProvider="other";
      if(change==="missingSourceKey")f.master.masterAsset.storageKey="";
      if(change==="localPreview")f.master.previewAsset!.storageBackend="LOCAL";
      if(change==="missingPreviewKey")f.master.previewAsset!.storageKey="";
      await assert.rejects(()=>recordDigitalExcerptSelection(f.actor,f.master.id,f.input(),f.db));assert.equal(f.events.length,0,change);
    }
  });
});

test("LIVE WAV artistic validation still requires its separate private MP3 object",async()=>{
  await live(async()=>{
    for(const missing of [false,true]){
      const f=fixture(),mp3Id=randomUUID();
      Object.assign(f.master,{codec:"wav",trackId:randomUUID(),mp3AssetId:mp3Id,mp3BitrateKbps:320,encoderVersion:DIGITAL_MP3_ENCODER_VERSION,
        masterAsset:{...f.master.masterAsset,mimeType:"audio/wav"},mp3Asset:{...f.master.masterAsset,id:mp3Id}});
      if(missing)f.master.mp3Asset!.storageKey="";
      if(missing){await assert.rejects(()=>recordDigitalExcerptSelection(f.actor,f.master.id,f.input(),f.db),{code:"LIVE_MEDIA_STORAGE_NOT_READY"});assert.equal(f.events.length,0);}
      else{assert.equal((await recordDigitalExcerptSelection(f.actor,f.master.id,f.input(),f.db)).selection.status,"VALIDATED");assert.equal(f.events.length,1);}
    }
  });
});
