import test from "node:test";
import assert from "node:assert/strict";
import { DIGITAL_TERMS_VERSION, type DigitalSelection } from "@/lib/digital/domain";
import { MP3_ONLY_SOURCE, MP3_ONLY_SOURCE_POLICY } from "@/lib/digital/mp3-only-policy";
import { DIGITAL_MP3_ONLY_FORMAT_SUPPLEMENT, requiredDigitalFormatSupplement, digitalFormatSupplementSnapshot,
  validateSavedDigitalFormatSupplement, assertDigitalOrderFormatSupplement } from "@/lib/digital/format-supplement";
import { digitalContractSnapshot, digitalContractTerms, verifyContractSnapshot } from "@/lib/digital/fulfillment-policy";

const at=new Date("2026-10-19T12:00:00.000Z");
const track:DigitalSelection["tracks"][number]={trackId:MP3_ONLY_SOURCE.trackId,masterId:"10000000-0000-4000-8000-000000000001",title:"Lentement",position:1,
  formats:["MP3"],mp3AssetId:"10000000-0000-4000-8000-000000000002",sourceSha256:MP3_ONLY_SOURCE.sourceSha256,sourceFormat:"MP3_LOSSY",formatPolicy:MP3_ONLY_SOURCE_POLICY};
const both:DigitalSelection["tracks"][number]={trackId:"20000000-0000-4000-8000-000000000001",masterId:"20000000-0000-4000-8000-000000000002",title:"Autre titre",position:1,
  formats:["WAV","MP3"],wavAssetId:"20000000-0000-4000-8000-000000000003",mp3AssetId:"20000000-0000-4000-8000-000000000004"};
const accepted=()=>digitalFormatSupplementSnapshot([track],at,DIGITAL_MP3_ONLY_FORMAT_SUPPLEMENT.hashSha256)!;
const lines=(tracks:DigitalSelection["tracks"])=>[{trackSnapshot:tracks}];

test("format supplement is required only for the exact approved MP3 source, not historic purchases",()=>{
  assert.equal(requiredDigitalFormatSupplement([track]),DIGITAL_MP3_ONLY_FORMAT_SUPPLEMENT);
  assert.equal(requiredDigitalFormatSupplement([both]),null);
  assert.equal(requiredDigitalFormatSupplement([{...both,formats:undefined,wavAssetId:undefined,mp3AssetId:undefined}]),null);
  assert.equal(digitalFormatSupplementSnapshot([both],at),null);
  assert.throws(()=>digitalFormatSupplementSnapshot([both],at,DIGITAL_MP3_ONLY_FORMAT_SUPPLEMENT.hashSha256));
});
test("MP3 supplement cannot be accepted by missing, stale or invented hashes",()=>{
  for(const hash of [undefined,"a".repeat(64),"", "not-a-hash"])assert.throws(()=>digitalFormatSupplementSnapshot([track],at,hash));
  assert.throws(()=>digitalFormatSupplementSnapshot([track],new Date(NaN),DIGITAL_MP3_ONLY_FORMAT_SUPPLEMENT.hashSha256));
  assert.equal(accepted().expresslyAccepted,true);
  assert.equal(accepted().acceptedAt,at.toISOString());
});
test("saved MP3 supplement freezes the source/master/asset/version, survives JSONB key order and rejects tampering",()=>{
  const s=accepted();assert.equal(validateSavedDigitalFormatSupplement(s),true);
  assert.equal(validateSavedDigitalFormatSupplement(Object.fromEntries(Object.entries(s).reverse())),true);
  for(const changed of [{...s,text:s.text+" WAV inclus"},{...s,version:"unknown"},{...s,hashSha256:"b".repeat(64)},
    {...s,expresslyAccepted:false},{...s,tracks:[{...s.tracks[0],sourceSha256:"c".repeat(64)}]},
    {...s,snapshotHashSha256:"d".repeat(64)},{...s,unexpected:true}])assert.equal(validateSavedDigitalFormatSupplement(changed),false);
});
test("foreign MP3 sources and duplicate exceptions fail closed",()=>{
  for(const changed of [{...track,trackId:both.trackId},{...track,sourceSha256:"f".repeat(64)},{...track,formatPolicy:"unknown"},
    {...track,wavAssetId:both.wavAssetId},{...track,mp3AssetId:undefined}])assert.throws(()=>requiredDigitalFormatSupplement([changed]));
  assert.throws(()=>requiredDigitalFormatSupplement([track,track]));
});
test("first delivery requires the exact accepted MP3 supplement but does not invalidate any WAV acquisition",()=>{
  const s=accepted(),contract={acceptedAt:at.toISOString(),formatSupplement:s};
  assert.doesNotThrow(()=>assertDigitalOrderFormatSupplement(contract,lines([track,both])));
  assert.throws(()=>assertDigitalOrderFormatSupplement(null,lines([track])));
  assert.throws(()=>assertDigitalOrderFormatSupplement({acceptedAt:at.toISOString()},lines([track])));
  assert.throws(()=>assertDigitalOrderFormatSupplement({...contract,acceptedAt:"2026-10-19T12:00:01.000Z"},lines([track])));
  assert.throws(()=>assertDigitalOrderFormatSupplement(contract,lines([{...track,masterId:both.masterId}])));
  assert.throws(()=>assertDigitalOrderFormatSupplement(contract,lines([both])));
  assert.doesNotThrow(()=>assertDigitalOrderFormatSupplement(null,lines([both])));
});
test("historic contract text/hash remains exact; only new MP3 contracts carry a supplemental snapshot",()=>{
  const base=digitalContractSnapshot({name:"Client synthétique",email:"mp3-format@example.test"},at);
  const terms=digitalContractTerms(DIGITAL_TERMS_VERSION),before=JSON.stringify(base);
  assert.doesNotThrow(()=>verifyContractSnapshot(base,DIGITAL_TERMS_VERSION,terms.hash));
  const next={...base,formatSupplement:accepted()};
  assert.doesNotThrow(()=>verifyContractSnapshot(next,DIGITAL_TERMS_VERSION,terms.hash));
  assert.equal(next.terms,base.terms);assert.equal(JSON.stringify(base),before);
  assert.throws(()=>verifyContractSnapshot({...next,formatSupplement:{...next.formatSupplement,text:"WAV offert"}},DIGITAL_TERMS_VERSION,terms.hash));
});
