import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {completeDigitalAlbum,digitalCompletionSourceAmounts} from "@/lib/digital/completion-policy";
import {normalizeDigitalCart,type DigitalSelection,type DigitalCompletionSource} from "@/lib/digital/domain";
import {selectionFingerprint} from "@/lib/digital/catalog";
const tracks=Array.from({length:12},(_,i)=>({trackId:randomUUID(),masterId:randomUUID(),title:`QA ${i+1}`,position:i+1}));
const album=(priceCents=2000):DigitalSelection=>({id:randomUUID(),scope:"ALBUM",title:"Album QA — prix fictif",version:1,priceCents,tracks});
const source=(i=0,paidCents=129,refundedCents=0):DigitalCompletionSource=>({trackId:tracks[i].trackId,masterId:tracks[i].masterId,sourceLineId:randomUUID(),
  paidCents,refundedCents,availableCents:paidCents-refundedCents,creditCents:paidCents-refundedCents,proofHash:"a".repeat(64)});
test("completion: no singles preserves the independently priced album without invented discount",()=>{const a=album();assert.equal(completeDigitalAlbum(a,new Set(),[]),a);});
test("completion: 1 / 11 / 12 canonical singles are credited once using exact paid cents",()=>{
  for(const n of [1,11,12]){const a=album(),ss=Array.from({length:n},(_,i)=>source(i));const q=completeDigitalAlbum(a,new Set(ss.map(s=>s.trackId)),ss);
    assert.equal(q.priceCents,2000-n*129);assert.equal(q.completion?.creditCents,n*129);assert.equal(q.completion?.sources.length,n);assert.equal(a.priceCents,2000);}
});
test("completion: partial refund is deducted, never current catalogue track price",()=>{const s=source(0,137,31),q=completeDigitalAlbum(album(),new Set([s.trackId]),[s]);
  assert.equal(q.priceCents,1894);assert.equal(q.completion?.creditCents,106);assert.equal(q.completion?.sources[0].refundedCents,31);});
test("completion: independently changed album price yields a new exact quote",()=>{const s=source(),owned=new Set([s.trackId]);assert.equal(completeDigitalAlbum(album(990),owned,[s]).priceCents,861);assert.equal(completeDigitalAlbum(album(1000),owned,[s]).priceCents,871);});
test("completion: zero or over-price eligible amounts produce an explicit free snapshot, not negative price or residual cash",()=>{
  for(const p of [129,100]){const s=source(),q=completeDigitalAlbum(album(p),new Set([s.trackId]),[s]);
    assert.equal(q.priceCents,0);assert.equal(q.completion?.version,2);assert.equal(q.completion?.creditCents,p);assert.equal(q.completion?.eligibleCents,129);
    assert.equal(normalizeDigitalCart([q],new Set([s.trackId])).totalCents,0);}
});
test("completion: free, over-refunded, fractional, negative or fabricated source math is blocked",()=>{
  const s=source(),owned=new Set([s.trackId]);for(const patch of [{paidCents:0,availableCents:0,creditCents:0},{refundedCents:130,availableCents:-1,creditCents:-1},
    {refundedCents:-1},{availableCents:999},{creditCents:0.5},{paidCents:NaN},{proofHash:"bad"}])assert.throws(()=>completeDigitalAlbum(album(),owned,[{...s,...patch}]));
});
test("completion: fully refunded price reduction proves retained ownership but contributes zero cents and no free album",()=>{
  const s=source(0,129,129),q=completeDigitalAlbum(album(990),new Set([s.trackId]),[s]);
  assert.equal(q.priceCents,990);assert.equal(q.completion?.creditCents,0);assert.equal(normalizeDigitalCart([q],new Set([s.trackId])).totalCents,990);
});
test("completion: different historical promotional prices and refunds sum in exact integer cents",()=>{
  const ss=[source(0,137,31),source(1,49,0),source(2,201,17)],q=completeDigitalAlbum(album(990),new Set(ss.map(s=>s.trackId)),ss);
  assert.equal(q.completion?.creditCents,339);assert.equal(q.priceCents,651);
});
test("completion: content removal ignores unrelated purchases; addition is priced from current album, master replacement never inferred",()=>{
  const a=album(),s=source(0,137),owned=new Set([s.trackId,randomUUID()]);
  assert.equal(completeDigitalAlbum(a,owned,[s]).priceCents,1863);
  const added={...a,tracks:[...a.tracks,{trackId:randomUUID(),masterId:randomUUID(),title:"New title",position:13}]};
  assert.equal(completeDigitalAlbum(added,owned,[s]).priceCents,1863);
  const removed={...a,tracks:a.tracks.slice(1)};assert.equal(completeDigitalAlbum(removed,owned,[]),removed);
  assert.throws(()=>completeDigitalAlbum({...a,tracks:[{...a.tracks[0],masterId:randomUUID()},...a.tracks.slice(1)]},owned,[s]),{code:"COMPLETION_SOURCE_REQUIRES_REVIEW"});
});

function allocatedOrder(){
  const lines=[0,1,2].map((i)=>({id:randomUUID(),scope:"TRACK",priceCents:[137,49,201][i],trackSnapshot:[tracks[i]],completionSnapshot:null}));
  return{lines,order:{mode:"TEST",currency:"EUR",status:"PAID",totalCents:387,lines,
    refunds:[] as Array<{id:string;providerReference:string;status:string;allocationStatus:string;purpose:string;amountCents:number;targets:Array<{lineId:string;amountCents:number}>}>}};
}
test("source allocations: ordinary multi-title promotional cart uses immutable paid line amounts, not current prices",()=>{
  const f=allocatedOrder();assert.deepEqual(f.lines.map(l=>digitalCompletionSourceAmounts(l,f.order).paidCents),[137,49,201]);
  f.order.totalCents=300;assert.throws(()=>digitalCompletionSourceAmounts(f.lines[0],f.order),{code:"COMPLETION_SOURCE_REQUIRES_REVIEW"});
});
test("source allocations: partial refund over several lines plus unrelated resolution remains exact per title",()=>{
  const f=allocatedOrder();f.order.status="PARTIALLY_REFUNDED";
  f.order.refunds.push({id:randomUUID(),providerReference:"re_qa_partial",status:"SUCCEEDED",allocationStatus:"MATCHED",purpose:"PRICE_REDUCTION",amountCents:48,
    targets:[{lineId:f.lines[0].id,amountCents:31},{lineId:f.lines[2].id,amountCents:17}]},
    {id:randomUUID(),providerReference:"re_qa_resolution_other",status:"SUCCEEDED",allocationStatus:"MATCHED",purpose:"RESOLUTION",amountCents:49,targets:[{lineId:f.lines[1].id,amountCents:49}]});
  assert.equal(digitalCompletionSourceAmounts(f.lines[0],f.order).availableCents,106);
  assert.equal(digitalCompletionSourceAmounts(f.lines[2],f.order).availableCents,184);
  assert.throws(()=>digitalCompletionSourceAmounts(f.lines[1],f.order),{code:"COMPLETION_REFUND_REQUIRES_REVIEW"});
});
test("source allocations: full price reduction with active rights is zero; terminal amount/status inconsistency is blocked",()=>{
  const f=allocatedOrder();f.order.status="REFUNDED";
  f.order.refunds.push({id:randomUUID(),providerReference:"re_qa_full",status:"SUCCEEDED",allocationStatus:"MATCHED",purpose:"PRICE_REDUCTION",amountCents:387,targets:f.lines.map(l=>({lineId:l.id,amountCents:l.priceCents}))});
  assert.equal(digitalCompletionSourceAmounts(f.lines[0],f.order).availableCents,0);
  f.order.status="PARTIALLY_REFUNDED";assert.throws(()=>digitalCompletionSourceAmounts(f.lines[0],f.order),{code:"COMPLETION_REFUND_REQUIRES_REVIEW"});
});
test("source allocations: duplicate refund rows/references do not count twice; failed attempts never consume paid balance",()=>{
  const f=allocatedOrder();f.order.status="PARTIALLY_REFUNDED";const refund={id:randomUUID(),providerReference:"re_qa_once",status:"SUCCEEDED",allocationStatus:"MATCHED",purpose:"PRICE_REDUCTION",amountCents:31,targets:[{lineId:f.lines[0].id,amountCents:31}]};
  f.order.refunds.push(refund,{...refund,id:randomUUID(),providerReference:"re_qa_failed",status:"FAILED"});
  assert.equal(digitalCompletionSourceAmounts(f.lines[0],f.order).availableCents,106);
  f.order.refunds.push({...refund,id:randomUUID()});assert.throws(()=>digitalCompletionSourceAmounts(f.lines[0],f.order),{code:"COMPLETION_REFUND_REQUIRES_REVIEW"});
});
test("source allocations: ambiguous promotion, bundle, gift, failed payment accounting and bad refund allocations fail closed",()=>{
  for(const variant of ["bundle","gift","unallocated","duplicate-target","over-refund","fractional","wrong-sum","unknown-line","pending"]){
    const f=allocatedOrder();
    if(variant==="bundle")f.lines[1].scope="ALBUM";if(variant==="gift")f.lines[1].priceCents=0;
    if(!["bundle","gift"].includes(variant)){f.order.status="PARTIALLY_REFUNDED";f.order.refunds.push({id:randomUUID(),providerReference:"re_qa",status:variant==="pending"?"PENDING":"SUCCEEDED",allocationStatus:variant==="unallocated"?"REVIEW":"MATCHED",purpose:"PRICE_REDUCTION",amountCents:31,targets:[{lineId:f.lines[0].id,amountCents:31}]});
      const r=f.order.refunds[0];if(variant==="duplicate-target")r.targets.push({...r.targets[0]});if(variant==="over-refund")r.targets[0].amountCents=138;
      if(variant==="fractional")r.targets[0].amountCents=30.5;if(variant==="wrong-sum")r.amountCents=32;if(variant==="unknown-line")r.targets[0].lineId=randomUUID();}
    assert.throws(()=>digitalCompletionSourceAmounts(f.lines[0],f.order));
  }
});
test("completion: duplicate track, duplicate source, absent eligible source and cross-master are not inferred",()=>{
  const s=source(),other=source(1),owned=new Set([s.trackId,other.trackId]);for(const ss of [[s,s],[s,{...other,sourceLineId:s.sourceLineId}],[s],[s,{...other,masterId:randomUUID()}]])
    assert.throws(()=>completeDigitalAlbum(album(),owned,ss),{code:"COMPLETION_SOURCE_REQUIRES_REVIEW"});
});
test("completion: source proof ordering is stable but financial/version changes invalidate cart fingerprint",()=>{
  const ss=[source(),source(1)],owned=new Set(ss.map(s=>s.trackId)),a=album();const q=completeDigitalAlbum(a,owned,ss),reverse=completeDigitalAlbum(a,owned,[...ss].reverse());
  assert.equal(selectionFingerprint(q),selectionFingerprint(reverse));
  const refunded=completeDigitalAlbum(a,owned,[ss[0],{...ss[1],refundedCents:1,availableCents:128,creditCents:128,proofHash:"b".repeat(64)}]);assert.notEqual(selectionFingerprint(q),selectionFingerprint(refunded));
});
test("completion: normal cart admits verified completion but retains provisional guard on unproved ownership",()=>{
  const s=source(),owned=new Set([s.trackId]),a=album(),q=completeDigitalAlbum(a,owned,[s]);assert.equal(normalizeDigitalCart([q],owned).totalCents,1871);
  assert.throws(()=>normalizeDigitalCart([a],owned),{code:"ALBUM_PARTIALLY_OWNED"});assert.throws(()=>normalizeDigitalCart([q],new Set()),{code:"INVALID_COMPLETION"});
});
test("completion: multi-line payable cart fails closed while redundant album-covered title is removed",()=>{
  const s=source(),owned=new Set([s.trackId]),q=completeDigitalAlbum(album(),owned,[s]);
  const covered:DigitalSelection={id:randomUUID(),scope:"TRACK",title:"Covered",priceCents:129,version:1,tracks:[tracks[1]]};
  assert.equal(normalizeDigitalCart([q,covered],owned).lines.length,1);
  const unrelated:DigitalSelection={...covered,tracks:[{...tracks[1],trackId:randomUUID(),masterId:randomUUID()}]};
  assert.throws(()=>normalizeDigitalCart([q,unrelated],owned),{code:"COMPLETION_MULTI_CART_REQUIRES_REVIEW"});
});
test("completion: browser-forged base price, credit, repeated or unowned sources are rejected",()=>{
  const s=source(),owned=new Set([s.trackId]),q=completeDigitalAlbum(album(),owned,[s]),c=q.completion!;
  for(const completion of [{...c,creditCents:130},{...c,basePriceCents:2001},{...c,sources:[...c.sources,...c.sources]},
    {...c,sources:[{...s,trackId:randomUUID()}]}])assert.throws(()=>normalizeDigitalCart([{...q,completion}],owned));
});
