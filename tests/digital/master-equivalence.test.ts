import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import type {Prisma} from "@/generated/prisma/client";
import type {OrderActor} from "@/lib/orders/domain";
import {prisma} from "@/lib/prisma";
import {billingSnapshotHash} from "@/lib/billing/domain";
import {applyDigitalCompletions,reserveDigitalCompletion,verifyDigitalCompletions} from "@/lib/digital/completion";
import type {DigitalCompletionSnapshot,DigitalSelection} from "@/lib/digital/domain";
import {digitalMasterEquivalenceInput,digitalMasterEquivalenceProof,getDigitalMasterEquivalencePair,listDigitalMasterEquivalences,recordDigitalMasterEquivalence} from "@/lib/digital/master-equivalence-service";
import {DIGITAL_MASTER_EQUIVALENCE_EVENT,type DigitalEquivalentMaster,type DigitalMasterEquivalenceEvent} from "@/lib/digital/master-equivalence-policy";
const env={DCN_ENABLED:"true",DCN_MODE:"TEST",DCN_NEW_PAYMENTS_ENABLED:"false",DCN_EXTERNAL_TEST_AUTHORIZED:"false",DCN_LOCAL_REVIEW_AUTHORIZED:"true",
  DATABASE_URL:"postgresql://dcn_runtime_a:synthetic_never_connect@127.0.0.1:55473/lnx_dcn_consolidation_test",AUTH_URL:"http://127.0.0.1:3140",MEDIA_STORAGE_DRIVER:"local",EMAIL_PROVIDER:"capture"};
function fixture(){
  const trackId=randomUUID(),buyerId=randomUUID(),sourceLineId=randomUUID(),targetLineId=randomUUID(),targetOrderId=randomUUID(),reviewer={id:randomUUID(),role:"ADMIN",status:"ACTIVE",emailVerified:true};
  const master=(version:number):DigitalEquivalentMaster=>{const id=randomUUID(),wav=randomUUID(),mp3=randomUUID();return{id,trackId,version,status:"READY",masterAssetId:wav,mp3AssetId:mp3,
    masterAsset:{id:wav,checksumSha256:"a".repeat(64)},mp3Asset:{id:mp3,checksumSha256:"b".repeat(64)}};};
  const source=master(1),target=master(2),third=master(3),masters=[source,target,third],events:Array<DigitalMasterEquivalenceEvent&{externalKey:string}>=[],locks:string[]=[],credits:Array<Record<string,unknown>>=[];
  const oldTrack={trackId,masterId:source.id,title:"Earlier acquired edition",position:1},sourceLine={id:sourceLineId,scope:"TRACK",priceCents:129,trackSnapshot:[oldTrack],completionSnapshot:null};
  const sourceOrder={id:randomUUID(),status:"PAID",totalCents:129,mode:"TEST",currency:"EUR",lines:[sourceLine],attempts:[{status:"PAID",paymentReference:"synthetic-original-payment"}],refunds:[],disputes:[]};
  const album:DigitalSelection={id:randomUUID(),scope:"ALBUM",title:"Current edition QA",version:2,priceCents:990,tracks:[{...oldTrack,masterId:target.id}]};
  const targetLine={id:targetLineId,offerId:album.id,scope:"ALBUM",title:album.title,offerVersion:2,priceCents:861,trackSnapshot:album.tracks,completionSnapshot:null as DigitalCompletionSnapshot|null};
  const db={async $queryRaw(...args:unknown[]){locks.push(...args.slice(1).filter((v):v is string=>typeof v==="string"));return[{timezone:"UTC"}];},
    user:{async findUnique(){return reviewer;}},digitalMaster:{async findMany({where}:{where:{id?:{in:string[]};trackId?:string}}){return masters.filter(m=>(!where.id||where.id.in.includes(m.id))&&(!where.trackId||m.trackId===where.trackId));}},
    digitalEvent:{async findFirst({where}:{where:{kind:string;details:{equals:string}}}){assert.equal(where.kind,DIGITAL_MASTER_EQUIVALENCE_EVENT);return events.filter(e=>(e.details as {pairKey:string}).pairKey===where.details.equals).sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||b.id.localeCompare(a.id))[0]??null;},
      async findMany(){return[...events].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||b.id.localeCompare(a.id));},async findUnique({where}:{where:{externalKey:string}}){return events.find(e=>e.externalKey===where.externalKey)??null;},
      async create({data}:{data:Omit<(typeof events)[number],"id">}){const row={...data,id:randomUUID()};events.push(row);return row;}},
    digitalEntitlement:{async findMany(){return[{status:"ACTIVE",master:{id:source.id,trackId},line:{...sourceLine,order:sourceOrder}}];}},
    digitalOrderLine:{async findMany(){return[targetLine];}},digitalCompletionCredit:{async findFirst(){return null;},async findMany(){return credits;},async create({data}:{data:Record<string,unknown>}){credits.push(data);return data;}},
  } as unknown as Prisma.TransactionClient;
  const actor={id:reviewer.id,email:"synthetic-admin@example.invalid",name:"Synthetic Admin",role:"ADMIN",status:"ACTIVE",emailVerified:true} as OrderActor;
  const input=()=>({trackId,sourceMasterId:source.id,targetMasterId:target.id,status:"APPROVED",expectedReviewId:events.at(-1)?.id??null,
    privateEvidenceReference:"private-evidence:synthetic/master-equivalence",evidenceSha256:"c".repeat(64),attested:true,reason:"Explicit same-canonical-title credit only; not an automatic remaster gift.",idempotencyKey:randomUUID()});
  return{db,source,target,third,album,targetLine,actor,reviewer,events,input,buyerId,trackId,targetLineId,targetOrderId,credits,locks,sourceOrder};
}
async function local<T>(f:ReturnType<typeof fixture>,run:()=>Promise<T>){const saved={...process.env},transaction=prisma.$transaction;
  try{for(const key of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|RAILWAY|MEDIA_DEPLOYMENT_ENV|PAYMENT_DEPLOYMENT_ENV/.test(key))delete process.env[key];Object.assign(process.env,env);
    prisma.$transaction=(async(fn:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>fn(f.db)) as typeof transaction;return await run();
  }finally{prisma.$transaction=transaction;for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}}

test("equivalence default is closed; explicit exact directional approval enables credit but does not mutate source or grant rights",async()=>{
  const f=fixture();await local(f,async()=>{const before=billingSnapshotHash(f.sourceOrder);
    await assert.rejects(()=>applyDigitalCompletions(f.db,f.buyerId,[f.album],new Set([f.trackId])),{code:"COMPLETION_EQUIVALENCE_REQUIRES_REVIEW"});
    await recordDigitalMasterEquivalence(f.actor,f.input());const q=(await applyDigitalCompletions(f.db,f.buyerId,[f.album],new Set([f.trackId])))[0];
    assert.equal(q.priceCents,861);assert.equal(q.completion?.sources[0].masterId,f.target.id);assert.equal(q.completion?.sources[0].equivalence?.sourceMasterId,f.source.id);assert.equal(q.completion?.sources[0].equivalence?.reviewId,f.events[0].id);
    assert.ok(f.locks.includes(`digital-equivalence:${f.source.id}:${f.target.id}`));assert.equal(billingSnapshotHash(f.sourceOrder),before);assert.equal(f.events.length,1);
    assert.equal(JSON.stringify(q).includes("private-evidence"),false);assert.equal(JSON.stringify(q).includes("c".repeat(64)),false);
    await assert.rejects(()=>digitalMasterEquivalenceProof(f.db,f.target.id,f.source.id,f.trackId),{code:"COMPLETION_EQUIVALENCE_REQUIRES_REVIEW"});
  });
});
test("equivalence revocation or proof change invalidates a reservation and first-delivery verification, without rewriting the acquired snapshot",async()=>{
  const f=fixture();await local(f,async()=>{
    await recordDigitalMasterEquivalence(f.actor,f.input());const q=(await applyDigitalCompletions(f.db,f.buyerId,[f.album],new Set([f.trackId])))[0];f.targetLine.completionSnapshot=q.completion!;
    await reserveDigitalCompletion(f.db,f.buyerId,f.targetLineId,q.completion!);await verifyDigitalCompletions(f.db,f.targetOrderId,f.buyerId);const before=billingSnapshotHash(q.completion);
    await recordDigitalMasterEquivalence(f.actor,{...f.input(),status:"REVOKED",privateEvidenceReference:null,evidenceSha256:null,attested:false,reason:"Re-examination of this exact pair."});
    await assert.rejects(()=>verifyDigitalCompletions(f.db,f.targetOrderId,f.buyerId),{code:"COMPLETION_EQUIVALENCE_REQUIRES_REVIEW"});assert.equal(billingSnapshotHash(f.targetLine.completionSnapshot),before);assert.equal(f.events.length,2);
  });
});
test("equivalence is never transitive, never cross-track, and binds actual source and target media hashes",async()=>{
  const f=fixture();await local(f,async()=>{
    await recordDigitalMasterEquivalence(f.actor,f.input());await recordDigitalMasterEquivalence(f.actor,{...f.input(),sourceMasterId:f.target.id,targetMasterId:f.third.id,expectedReviewId:null});
    await assert.rejects(()=>digitalMasterEquivalenceProof(f.db,f.source.id,f.third.id,f.trackId));
    f.target.masterAsset.checksumSha256="d".repeat(64);await assert.rejects(()=>digitalMasterEquivalenceProof(f.db,f.source.id,f.target.id,f.trackId));
    f.target.trackId=randomUUID();await assert.rejects(()=>recordDigitalMasterEquivalence(f.actor,{...f.input(),expectedReviewId:f.events[0].id}),{code:"EQUIVALENCE_SAME_TRACK_REQUIRED"});
  });
});
test("equivalence admin and proof requirements are authoritative; strict input cannot fabricate a binding or access",async()=>{
  for(const patch of[{attested:false},{privateEvidenceReference:null},{evidenceSha256:"bad"},{actorId:randomUUID()},{binding:{}},{reason:""},{targetMasterId:"bad"}]){const f=fixture();assert.throws(()=>digitalMasterEquivalenceInput({...f.input(),...patch}));}
  const f=fixture();await local(f,async()=>{await recordDigitalMasterEquivalence(f.actor,f.input());f.reviewer.role="MEMBER";
    await assert.rejects(()=>digitalMasterEquivalenceProof(f.db,f.source.id,f.target.id,f.trackId));await assert.rejects(()=>recordDigitalMasterEquivalence(f.actor,f.input()),{code:"ADMIN_REQUIRED"});assert.equal(f.events.length,1);
  });
});
test("equivalence retry is idempotent, stale decision rejected, same-tick revocation ordered and safe Admin projection excludes private proof",async()=>{
  const f=fixture();await local(f,async()=>{const input=f.input();await recordDigitalMasterEquivalence(f.actor,input);assert.equal((await recordDigitalMasterEquivalence(f.actor,input)).duplicate,true);
    await assert.rejects(()=>recordDigitalMasterEquivalence(f.actor,{...input,reason:"changed"}),{code:"IDEMPOTENCY_CONFLICT"});await assert.rejects(()=>recordDigitalMasterEquivalence(f.actor,{...f.input(),expectedReviewId:null}),{code:"EQUIVALENCE_REVIEW_CHANGED"});
    const before=f.events[0].createdAt;await recordDigitalMasterEquivalence(f.actor,{...f.input(),status:"REVOKED"});assert.ok(f.events[1].createdAt>before);
    const list=await listDigitalMasterEquivalences(f.actor,f.trackId);assert.equal(list.reviews[0].status,"REVOKED");assert.equal(list.masters.length,3);
    assert.equal(JSON.stringify(list).includes("private-evidence"),false);assert.equal(JSON.stringify(list).includes("c".repeat(64)),false);
    process.env.DCN_LOCAL_REVIEW_AUTHORIZED="false";await assert.rejects(()=>recordDigitalMasterEquivalence(f.actor,f.input()),{code:"EQUIVALENCE_LOCAL_ONLY"});
  });
});
test("equivalence selected-pair lookup stays exact beyond the bounded global history and never leaks the private proof",async()=>{
  const f=fixture();await local(f,async()=>{await recordDigitalMasterEquivalence(f.actor,f.input());const original=f.events[0];
    for(let i=1;i<=51;i++){const sourceMasterId=randomUUID(),targetMasterId=randomUUID();f.events.push({...original,id:randomUUID(),externalKey:randomUUID(),createdAt:new Date(original.createdAt.getTime()+i),
      details:{...original.details as object,pairKey:`${sourceMasterId}:${targetMasterId}`,sourceMasterId,targetMasterId}});}
    const list=await listDigitalMasterEquivalences(f.actor,f.trackId);assert.equal(list.reviews.length,50);assert.equal(list.truncated,true);assert.ok(list.reviews.every(r=>r.id!==original.id));
    const pair=await getDigitalMasterEquivalencePair(f.actor,f.trackId,f.source.id,f.target.id);assert.equal(pair.current?.id,original.id);assert.equal(pair.current?.status,"APPROVED");
    assert.equal(JSON.stringify(pair).includes("private-evidence"),false);assert.equal(JSON.stringify(pair).includes("c".repeat(64)),false);
    f.target.trackId=randomUUID();await assert.rejects(()=>getDigitalMasterEquivalencePair(f.actor,f.trackId,f.source.id,f.target.id),{code:"EQUIVALENCE_SAME_TRACK_REQUIRED"});
  });
});
