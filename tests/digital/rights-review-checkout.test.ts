import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import type {Prisma} from "@/generated/prisma/client";
import {checkDigitalAcquiredRightsReview} from "@/lib/digital/rights-review-checkout";
import {DIGITAL_RIGHTS_REVIEW_POLICY,DIGITAL_RIGHTS_REVIEW_EVENT,DIGITAL_RIGHTS_ATTESTATION,digitalRightsMasterBinding,digitalRightsReviewHash,type DigitalRightsMaster} from "@/lib/digital/rights-review-policy";
import {DIGITAL_MP3_ENCODER_VERSION} from "@/lib/digital/formats";
function fixture(){
  const actorId=randomUUID(),masterId=randomUUID(),wavId=randomUUID(),mp3Id=randomUUID(),previewId=randomUUID(),at=new Date();
  const asset={visibility:"PRIVATE",mimeType:"audio/wav",durationMs:3000,sizeBytes:100000n,checksumSha256:"a".repeat(64)};
  const master:DigitalRightsMaster={id:masterId,trackId:randomUUID(),version:1,status:"READY",codec:"wav",encoderVersion:DIGITAL_MP3_ENCODER_VERSION,mp3BitrateKbps:320,previewDurationMs:3000,
    masterAssetId:wavId,mp3AssetId:mp3Id,previewAssetId:previewId,masterAsset:{...asset,id:wavId},mp3Asset:{...asset,id:mp3Id,mimeType:"audio/mpeg"},previewAsset:{...asset,id:previewId,mimeType:"audio/mpeg",visibility:"PUBLIC"}};
  let status="APPROVED",reads=0;
  const tx={async $queryRaw(){return[];},digitalMaster:{async findMany(){reads++;return[master];},async findFirst(){throw Error("A newer edition must not replace a pinned acquisition");}},
    user:{async findUnique(){return{id:actorId,role:"ADMIN",status:"ACTIVE",emailVerified:true};}},
    digitalEvent:{async findFirst(){reads++;const proof={policy:DIGITAL_RIGHTS_REVIEW_POLICY,binding:digitalRightsMasterBinding(master),status,privateEvidenceReference:"private-evidence:synthetic/dossier",
      evidenceSha256:"b".repeat(64),attestation:DIGITAL_RIGHTS_ATTESTATION,reason:null,reviewedAt:at.toISOString(),requestHash:"c".repeat(64)};
      return{id:randomUUID(),kind:DIGITAL_RIGHTS_REVIEW_EVENT,actorId,createdAt:at,details:{...proof,recordHash:digitalRightsReviewHash({actorId,...proof})}};}},
  } as unknown as Prisma.TransactionClient;
  return{tx,master,reads:()=>reads,revoke:()=>status="REVOKED",snapshot:{rightsReviewPolicy:DIGITAL_RIGHTS_REVIEW_POLICY},lines:[{trackSnapshot:[{masterId}]}]};
}
test("historic acquired contracts do not acquire a new review requirement or database rewrite",async()=>{
  const f=fixture();for(const snapshot of[null,undefined,{terms:{version:"previous-frozen-qa"}}])await checkDigitalAcquiredRightsReview(snapshot,f.lines,f.tx);
  assert.equal(f.reads(),0);
});
test("new marked contracts require fresh approvals of exact pinned editions, not current replacement masters",async()=>{
  const f=fixture();await checkDigitalAcquiredRightsReview(f.snapshot,f.lines,f.tx);assert.equal(f.reads(),2);
  f.revoke();await assert.rejects(()=>checkDigitalAcquiredRightsReview(f.snapshot,f.lines,f.tx),{code:"RIGHTS_REVIEW_REQUIRED"});
});
test("unknown markers and malformed/empty acquired contents fail closed",async()=>{
  const f=fixture();for(const snapshot of[{}, {rightsReviewPolicy:null},{rightsReviewPolicy:"unknown"}]){
    if(!("rightsReviewPolicy" in snapshot))continue;
    await assert.rejects(()=>checkDigitalAcquiredRightsReview(snapshot,f.lines,f.tx),{code:"RIGHTS_REVIEW_POLICY_INVALID"});
  }
  for(const lines of[[],[{trackSnapshot:[]}],[{trackSnapshot:[{}]}]])await assert.rejects(()=>checkDigitalAcquiredRightsReview(f.snapshot,lines,f.tx));
});
test("new policy is stamped at checkout and rechecked before confirmation, PayPal capture and first delivery, not redownload",async()=>{
  const commerce=await readFile(new URL("../../lib/digital/commerce.ts",import.meta.url),"utf8"),docs=await readFile(new URL("../../lib/digital/documents.ts",import.meta.url),"utf8"),library=await readFile(new URL("../../lib/digital/library.ts",import.meta.url),"utf8");
  assert.match(commerce,/rightsReviewPolicy:DIGITAL_RIGHTS_REVIEW_POLICY/);
  assert.ok(commerce.includes("checkDigitalAcquiredRightsReview(order.contractSnapshot,order.lines,tx)"));
  assert.ok(docs.includes("checkDigitalAcquiredRightsReview(o.contractSnapshot,acquiredLines,tx)"));
  const capture=commerce.slice(commerce.indexOf("export async function captureDigitalPaypal"));assert.ok(capture.indexOf("checkDigitalAcquiredRightsReview(")<capture.indexOf("await gateway.capture!"));
  assert.doesNotMatch(library,/checkDigitalAcquiredRightsReview|assertDigitalRightsReviews/);
});
