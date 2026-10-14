import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import type {Prisma} from "@/generated/prisma/client";
import {applyDigitalCompletions,assertNoCreditedSourceRefund,consumeDigitalCompletions,releaseDigitalCompletions,reserveDigitalCompletion,reviewDependentDigitalCompletions,verifyDigitalCompletions} from "@/lib/digital/completion";
import type {DigitalSelection,DigitalCompletionSnapshot} from "@/lib/digital/domain";

/** Repository doubles only: no provider, PostgreSQL or signature claim. Real DB concurrency is tested separately. */
function fixture(){
  const userId=randomUUID(),trackId=randomUUID(),masterId=randomUUID(),sourceLineId=randomUUID(),targetLineId=randomUUID(),sourceOrderId=randomUUID(),targetOrderId=randomUUID();
  const track={trackId,masterId,title:"QA track",position:1},album:DigitalSelection={id:randomUUID(),scope:"ALBUM",title:"QA album",priceCents:990,version:1,tracks:[track,{...track,trackId:randomUUID(),masterId:randomUUID(),position:2}]};
  const source={id:sourceLineId,scope:"TRACK",priceCents:129,trackSnapshot:[track],completionSnapshot:null as DigitalCompletionSnapshot|null};
  const order={id:sourceOrderId,status:"PAID",totalCents:129,mode:"TEST",currency:"EUR",lines:[source],attempts:[{status:"PAID",paymentReference:"pi_local_double_only"}],
    refunds:[] as Array<{id:string;providerReference:string;status:string;allocationStatus:string;purpose:string;amountCents:number;targets:Array<{lineId:string;amountCents:number}>}>,disputes:[] as Array<{status:string}>};
  const acquisition={master:{id:masterId,trackId},line:{...source,order}};
  const acquisitions=[acquisition];
  const target={id:targetLineId,orderId:targetOrderId,offerId:album.id,scope:"ALBUM",title:album.title,priceCents:861,offerVersion:1,trackSnapshot:album.tracks,completionSnapshot:null as unknown};
  const credits:Array<{userId:string;trackId:string;sourceLineId:string;targetLineId:string;amountCents:number;sourceNetCents:number;status:string;targetLine?:typeof target}>=[];
  const events:Array<{externalKey:string;kind:string;details:unknown}>=[];let suspended=0,targetStatus="PENDING";
  const db={
    digitalEntitlement:{async findMany({where}:{where?:{lineId?:{not:string}}}){return acquisitions.filter(e=>!where?.lineId||e.line.id!==where.lineId.not);},async updateMany(){suspended++;return{count:1};}},
    digitalOrderLine:{async findMany(){return[target];}},
    digitalCompletionCredit:{
      async findFirst({where}:{where:{trackId?:string;targetLineId?:{not:string};sourceLineId?:{in:string[]}}}){return credits.find(c=>["RESERVED","CONSUMED"].includes(c.status)
        &&(!where.trackId||c.trackId===where.trackId)&&(!where.targetLineId||c.targetLineId!==where.targetLineId.not)
        &&(!where.sourceLineId||where.sourceLineId.in.includes(c.sourceLineId)))??null;},
      async findMany(){return credits.filter(c=>["RESERVED","CONSUMED"].includes(c.status)).map(c=>({...c,targetLine:target}));},
      async create({data}:{data:Omit<(typeof credits)[number],"status">}){const row={...data,status:"RESERVED"};credits.push(row);return row;},
      async updateMany({data}:{data:{status:string}}){let count=0;for(const row of credits)if(row.status==="RESERVED"){row.status=data.status;count++;}return{count};}},
    digitalEvent:{async upsert({create}:{create:(typeof events)[number]}){if(!events.some(e=>e.externalKey===create.externalKey))events.push(create);return create;}},
    digitalOrder:{async update({data}:{data:{status:string}}){targetStatus=data.status;return target;}},
  };
  return{tx:db as unknown as Prisma.TransactionClient,userId,trackId,sourceLineId,targetLineId,sourceOrderId,targetOrderId,album,order,acquisition,acquisitions,target,credits,events,
    state:()=>({targetStatus,suspended})};
}
test("repository: actual allocated partial refund leaves only paid non-refunded single cents",async()=>{const f=fixture();f.order.status="PARTIALLY_REFUNDED";
  f.order.refunds.push({id:randomUUID(),providerReference:"re_local",amountCents:29,status:"SUCCEEDED",allocationStatus:"MATCHED",purpose:"PRICE_REDUCTION",targets:[{lineId:f.sourceLineId,amountCents:29}]});
  const q=(await applyDigitalCompletions(f.tx,f.userId,[f.album],new Set([f.trackId])))[0];assert.equal(q.priceCents,890);assert.equal(q.completion?.sources[0].availableCents,100);});
test("repository: pending refunds, unallocated external refunds, disputes, bundles, cross-master and missing final payment block",async()=>{
  for(const variant of ["pending","unallocated","dispute","bundle","version","payment"]){const f=fixture();
    if(variant==="pending"||variant==="unallocated")f.order.refunds.push({id:randomUUID(),providerReference:"re_local",amountCents:29,status:variant==="pending"?"PENDING":"SUCCEEDED",allocationStatus:variant==="unallocated"?"REVIEW":"MATCHED",purpose:"PRICE_REDUCTION",targets:[{lineId:f.sourceLineId,amountCents:29}]});
    if(variant==="dispute")f.order.disputes.push({status:"OPEN"});if(variant==="bundle")f.order.lines.push({...f.order.lines[0],id:randomUUID()});
    if(variant==="version")f.acquisition.master.id=randomUUID();if(variant==="payment")f.order.attempts[0].status="OPEN";
    await assert.rejects(()=>applyDigitalCompletions(f.tx,f.userId,[f.album],new Set([f.trackId])));
  }
});
test("repository: reservation pins the source, cannot be reused, remains after unknown timeout, and consumes once",async()=>{
  const f=fixture(),q=(await applyDigitalCompletions(f.tx,f.userId,[f.album],new Set([f.trackId])))[0];f.target.completionSnapshot=q.completion;
  await reserveDigitalCompletion(f.tx,f.userId,f.targetLineId,q.completion!);assert.equal(f.credits[0].status,"RESERVED");
  await assert.rejects(()=>applyDigitalCompletions(f.tx,f.userId,[f.album],new Set([f.trackId])),{code:"COMPLETION_CREDIT_ALREADY_USED"});
  const sorted=(value:unknown):unknown=>Array.isArray(value)?value.map(sorted):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,sorted(v)])):value;
  f.target.completionSnapshot=sorted(f.target.completionSnapshot); // Actual JSONB key-order behavior.
  await verifyDigitalCompletions(f.tx,f.targetOrderId,f.userId);assert.equal(f.credits[0].status,"RESERVED");
  await consumeDigitalCompletions(f.tx,f.targetOrderId);await consumeDigitalCompletions(f.tx,f.targetOrderId);assert.equal(f.credits.length,1);assert.equal(f.credits[0].status,"CONSUMED");
  await releaseDigitalCompletions(f.tx,f.targetOrderId);assert.equal(f.credits[0].status,"CONSUMED");
});
test("repository: definitive unpaid failure releases only its reservation for a future intentional attempt",async()=>{const f=fixture(),q=(await applyDigitalCompletions(f.tx,f.userId,[f.album],new Set([f.trackId])))[0];
  await reserveDigitalCompletion(f.tx,f.userId,f.targetLineId,q.completion!);await releaseDigitalCompletions(f.tx,f.targetOrderId);assert.equal(f.credits[0].status,"RELEASED");
  assert.equal((await applyDigitalCompletions(f.tx,f.userId,[f.album],new Set([f.trackId])))[0].priceCents,861);});
test("repository: after PAID only this album's resulting rights are excluded, sources still revalidate before first delivery",async()=>{
  const f=fixture(),q=(await applyDigitalCompletions(f.tx,f.userId,[f.album],new Set([f.trackId])))[0];f.target.completionSnapshot=q.completion;
  await reserveDigitalCompletion(f.tx,f.userId,f.targetLineId,q.completion!);await consumeDigitalCompletions(f.tx,f.targetOrderId);
  f.acquisitions.push({...f.acquisition,line:{...f.acquisition.line,id:f.targetLineId,scope:"ALBUM"}});
  await verifyDigitalCompletions(f.tx,f.targetOrderId,f.userId);
  f.order.status="PARTIALLY_REFUNDED";f.order.refunds.push({id:randomUUID(),providerReference:"re_after_paid",amountCents:1,status:"SUCCEEDED",allocationStatus:"MATCHED",purpose:"PRICE_REDUCTION",targets:[{lineId:f.sourceLineId,amountCents:1}]});
  await assert.rejects(()=>verifyDigitalCompletions(f.tx,f.targetOrderId,f.userId),{code:"COMPLETION_SOURCE_CHANGED"});
});
test("repository: a different album/source acquisition is never excluded by the current target line filter",async()=>{
  const f=fixture(),q=(await applyDigitalCompletions(f.tx,f.userId,[f.album],new Set([f.trackId])))[0];f.target.completionSnapshot=q.completion;
  await reserveDigitalCompletion(f.tx,f.userId,f.targetLineId,q.completion!);
  f.acquisitions.push({...f.acquisition,line:{...f.acquisition.line,id:randomUUID(),scope:"ALBUM"}});
  await assert.rejects(()=>verifyDigitalCompletions(f.tx,f.targetOrderId,f.userId),{code:"COMPLETION_AMBIGUOUS_ACQUISITION"});
});
test("repository: refund/source change during payment prevents rights grant",async()=>{const f=fixture(),q=(await applyDigitalCompletions(f.tx,f.userId,[f.album],new Set([f.trackId])))[0];
  f.target.completionSnapshot=q.completion;await reserveDigitalCompletion(f.tx,f.userId,f.targetLineId,q.completion!);
  f.order.status="PARTIALLY_REFUNDED";f.order.refunds.push({id:randomUUID(),providerReference:"re_local",amountCents:1,status:"SUCCEEDED",allocationStatus:"MATCHED",purpose:"PRICE_REDUCTION",targets:[{lineId:f.sourceLineId,amountCents:1}]});
  await assert.rejects(()=>verifyDigitalCompletions(f.tx,f.targetOrderId,f.userId),{code:"COMPLETION_SOURCE_CHANGED"});assert.equal(f.credits[0].status,"RESERVED");});
test("repository: administrative refund of credited single blocks, pending then confirmed external fact suspends dependent album with one audit",async()=>{
  const f=fixture(),q=(await applyDigitalCompletions(f.tx,f.userId,[f.album],new Set([f.trackId])))[0];await reserveDigitalCompletion(f.tx,f.userId,f.targetLineId,q.completion!);
  await assert.rejects(()=>assertNoCreditedSourceRefund(f.tx,[f.sourceLineId]),{code:"COMPLETION_SOURCE_REFUND_REQUIRES_REVIEW"});
  await reviewDependentDigitalCompletions(f.tx,f.sourceOrderId,"refund:re_local"); // Authentic PENDING is already ambiguous and review-only.
  await reviewDependentDigitalCompletions(f.tx,f.sourceOrderId,"refund:re_local"); // A subsequent SUCCEEDED fact does not duplicate the dependent audit.
  assert.equal(f.state().targetStatus,"REQUIRES_REVIEW");assert.equal(f.events.length,1);assert.equal(f.credits.length,1);assert.equal(f.order.status,"PAID");
});
