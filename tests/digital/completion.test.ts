import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {completeDigitalAlbum} from "@/lib/digital/completion-policy";
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
test("completion: zero or over-price credit remains safely blocked, no negative or zero PSP payment",()=>{
  for(const p of [129,100]){const s=source();assert.throws(()=>completeDigitalAlbum(album(p),new Set([s.trackId]),[s]),{code:"COMPLETION_ZERO_REQUIRES_REVIEW"});}
});
test("completion: free, fully refunded, fractional, negative or fabricated source math is blocked",()=>{
  const s=source(),owned=new Set([s.trackId]);for(const patch of [{paidCents:0,availableCents:0,creditCents:0},{refundedCents:129,availableCents:0,creditCents:0},
    {refundedCents:-1},{availableCents:999},{creditCents:0.5},{paidCents:NaN},{proofHash:"bad"}])assert.throws(()=>completeDigitalAlbum(album(),owned,[{...s,...patch}]));
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
