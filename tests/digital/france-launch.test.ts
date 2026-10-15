import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {DIGITAL_FRANCE_LAUNCH_DRAFT_RULE,DIGITAL_FRANCE_LAUNCH_POLICY_HASH,assertDigitalFranceResidencePrepared,
  digitalFrancePostalScope,digitalFranceResidenceReviewHash,evaluateDigitalFranceLaunch,loadDigitalFranceLaunchAssessment,
  parseDigitalFranceDeclaration,revalidateDigitalFranceResidenceSnapshot,type DigitalFranceResidenceReview} from "@/lib/digital/france-launch-policy";
import {evaluateDigitalJurisdiction} from "@/lib/digital/jurisdictions";

const now=new Date("2026-10-15T12:00:00.000Z");
function fixture(){
  const subjectUserId=randomUUID(),actorId=randomUUID(),declaration={countryCode:"FR",postalCode:"75001",billingPostalCode:"69001",postalRouting:"ORDINARY" as const};
  const review:DigitalFranceResidenceReview={eventId:randomUUID(),eventKind:"FR_RESIDENCE_REVIEWED",subjectUserId,actorId,actor:{id:actorId,role:"ADMIN",status:"ACTIVE",emailVerified:true},
    status:"VERIFIED",countryCode:"FR",postalCode:"75001",postalRouting:"ORDINARY",sourceKind:"INDEPENDENT_RESIDENCE_EVIDENCE",
    privateEvidenceReference:`private:dcn-france-review/${randomUUID()}`,evidenceSha256:"a".repeat(64),reviewedAt:"2026-10-15T10:00:00.000Z",createdAt:"2026-10-15T10:01:00.000Z",expiresAt:"2026-11-15T10:00:00.000Z",recordHash:""};
  review.recordHash=digitalFranceResidenceReviewHash(review);return{subjectUserId,declaration,review};
}
const reseal=(r:DigitalFranceResidenceReview)=>({...r,recordHash:digitalFranceResidenceReviewHash(r)});
test("France scope: mainland and Corsica candidate codes retain leading zero, but are not proof of residence",()=>{
  for(const postalCode of["01000","07100","20000","20999","75001","95000"]){const result=digitalFrancePostalScope("FR",postalCode);assert.equal(result?.postalCode,postalCode);assert.equal(result?.area,postalCode.startsWith("20")?"CORSICA":"MAINLAND");}
  const f=fixture(),value=evaluateDigitalFranceLaunch(f.declaration,f.subjectUserId,null,now);
  assert.equal(value.status,"PREPARED");assert.equal(value.residenceVerified,false);assert.equal(value.paymentAllowed,false);assert.equal(value.snapshot,undefined);
});
test("France scope: overseas, Monaco, 96/97/98/99, foreign countries and ambiguous syntax are rejected",()=>{
  for(const postalCode of["00000","96000","97100","97200","97300","97400","97500","97600","97700","97800","98000","98400","98600","98700","98800","99000","99999",
    "7501","075001","75 001"," 75001","75001 ","75001\n","75001\r","75001\t","７５００１","2A000","CEDEX","75001 CEDEX"])
    assert.equal(digitalFrancePostalScope("FR",postalCode),null,postalCode);
  for(const country of["fr"," FR","FR ","MC","GP","RE","US",null])assert.equal(digitalFrancePostalScope(country,"75001"),null);
});
test("France declaration cannot grant proof, accept CEDEX or let an overseas billing address through",()=>{
  const f=fixture();assert.throws(()=>parseDigitalFranceDeclaration({...f.declaration,residenceVerified:true}),{code:"FRANCE_TERRITORY_DECLARATION_INVALID"});
  assert.throws(()=>parseDigitalFranceDeclaration({...f.declaration,postalRouting:"CEDEX"}),{code:"FRANCE_CEDEX_REQUIRES_REVIEW"});
  for(const billingPostalCode of[undefined,"97100","98000","75001\n"])assert.throws(()=>parseDigitalFranceDeclaration({...f.declaration,billingPostalCode}));
  // A numeric routing code can look metropolitan while being CEDEX: syntax alone never approves it.
  const numericCedex=evaluateDigitalFranceLaunch({...f.declaration,postalCode:"75050"},f.subjectUserId,null,now);
  assert.equal(numericCedex.residenceVerified,false);assert.equal(numericCedex.paymentAllowed,false);
});
test("France valid independent server review binds the account, residence and separate metropolitan billing code, but launch remains closed",()=>{
  const f=fixture(),value=evaluateDigitalFranceLaunch(f.declaration,f.subjectUserId,f.review,now);
  assert.equal(value.status,"PREPARED");assert.equal(value.residenceVerified,true);assert.equal(value.paymentAllowed,false);
  const snapshot=assertDigitalFranceResidencePrepared(value);assert.equal(snapshot.subjectUserId,f.subjectUserId);assert.equal(snapshot.residencePostalCode,"75001");assert.equal(snapshot.billingPostalCode,"69001");
  assert.equal(snapshot.policyHash,DIGITAL_FRANCE_LAUNCH_POLICY_HASH);assert.equal("privateEvidenceReference" in snapshot,false);assert.equal("evidenceSha256" in snapshot,false);
});
test("France proof: wrong user, event origin, inactive/unverified/non-admin reviewer or mismatched reviewer fail closed",()=>{
  for(const variant of["user","event","role","inactive","unverified","actor","source"]){const f=fixture();
    if(variant==="user")f.review.subjectUserId=randomUUID();if(variant==="event")f.review.eventKind="UNTRUSTED_API" as never;
    if(variant==="role")f.review.actor.role="MEMBER";if(variant==="inactive")f.review.actor.status="DISABLED";if(variant==="unverified")f.review.actor.emailVerified=false;
    if(variant==="actor")f.review.actor.id=randomUUID();if(variant==="source")f.review.sourceKind="IP_OR_CARD_COUNTRY" as never;
    const value=evaluateDigitalFranceLaunch(f.declaration,f.subjectUserId,reseal(f.review),now);assert.equal(value.residenceVerified,false,variant);assert.equal(value.status,"BLOCKED");
  }
});
test("France proof: residence/postcode conflict, CEDEX/unknown routing and overseas source are never silently accepted",()=>{
  for(const patch of[{countryCode:"GP"},{postalCode:"97100"},{postalCode:"69001"},{postalRouting:"CEDEX"},{postalRouting:"UNKNOWN"}]){
    const f=fixture(),review=reseal({...f.review,...patch} as DigitalFranceResidenceReview);assert.equal(evaluateDigitalFranceLaunch(f.declaration,f.subjectUserId,review,now).residenceVerified,false);
  }
});
test("France proof: missing private reference/hash, changed fields and malicious whitespace fail integrity validation",()=>{
  for(const patch of[{privateEvidenceReference:""},{privateEvidenceReference:"https://public.invalid/proof"},{privateEvidenceReference:"private:qa\n"},
    {evidenceSha256:""},{evidenceSha256:"a".repeat(64)+"\n"},{recordHash:"b".repeat(64)},{postalCode:"69001"}]){
    const f=fixture(),value=evaluateDigitalFranceLaunch(f.declaration,f.subjectUserId,{...f.review,...patch},now);assert.equal(value.residenceVerified,false);assert.equal(value.status,"BLOCKED");
  }
});
test("France proof: future, expired, malformed or chronologically inconsistent dates fail closed",()=>{
  for(const patch of[{reviewedAt:"2026-10-16T10:00:00.000Z"},{createdAt:"2026-10-16T10:01:00.000Z"},{expiresAt:now.toISOString()},
    {expiresAt:"2026-10-14T10:00:00.000Z"},{reviewedAt:"2026-10-15T10:02:00.000Z"},{reviewedAt:"2026-02-30T10:00:00.000Z"},{reviewedAt:"15/10/2026"}]){
    const f=fixture(),value=evaluateDigitalFranceLaunch(f.declaration,f.subjectUserId,reseal({...f.review,...patch}),now);assert.equal(value.residenceVerified,false);assert.equal(value.status,"BLOCKED");
  }
});
test("France proof: latest REVOKED/REVIEW record cannot fall back to a former VERIFIED review",async()=>{
  for(const status of["REVOKED","REVIEW"] as const){const f=fixture();let reads=0;
    const value=await loadDigitalFranceLaunchAssessment(f.declaration,f.subjectUserId,async userId=>{reads++;assert.equal(userId,f.subjectUserId);return reseal({...f.review,status});},now);
    assert.equal(reads,1);assert.equal(value.residenceVerified,false);assert.equal(value.status,"BLOCKED");
  }
});
test("France repository boundary: no request for invalid declaration/user, no retries/fallback when loader fails",async()=>{
  const f=fixture();let reads=0;const loader=async()=>{reads++;throw Error("repository unavailable");};
  assert.equal((await loadDigitalFranceLaunchAssessment({...f.declaration,postalCode:"97100"},f.subjectUserId,loader,now)).status,"BLOCKED");assert.equal(reads,0);
  assert.equal((await loadDigitalFranceLaunchAssessment(f.declaration,"invalid-user",loader,now)).status,"BLOCKED");assert.equal(reads,0);
  assert.equal((await loadDigitalFranceLaunchAssessment(f.declaration,f.subjectUserId,loader,now)).code,"FRANCE_RESIDENCE_REPOSITORY_UNAVAILABLE");assert.equal(reads,1);
});
test("France immutable snapshot must match fresh repository evidence, owner and postal declarations",()=>{
  const f=fixture(),original=evaluateDigitalFranceLaunch(f.declaration,f.subjectUserId,f.review,now),snapshot=assertDigitalFranceResidencePrepared(original);
  assert.deepEqual(revalidateDigitalFranceResidenceSnapshot(snapshot,original),snapshot);
  const changed=evaluateDigitalFranceLaunch({...f.declaration,billingPostalCode:"20000"},f.subjectUserId,f.review,now);
  assert.equal(changed.residenceVerified,true);assert.throws(()=>revalidateDigitalFranceResidenceSnapshot(snapshot,changed),{code:"FRANCE_RESIDENCE_PROOF_CHANGED_REQUIRES_REVIEW"});
  const replaced=evaluateDigitalFranceLaunch(f.declaration,f.subjectUserId,reseal({...f.review,eventId:randomUUID()}),now);
  assert.throws(()=>revalidateDigitalFranceResidenceSnapshot(snapshot,replaced),{code:"FRANCE_RESIDENCE_PROOF_CHANGED_REQUIRES_REVIEW"});
  assert.throws(()=>revalidateDigitalFranceResidenceSnapshot(snapshot,evaluateDigitalFranceLaunch(f.declaration,f.subjectUserId,null,now)));
});
test("France DRAFT registry plan grants no tax/legal/payment approval and cannot allow TEST or LIVE",()=>{
  const rule=DIGITAL_FRANCE_LAUNCH_DRAFT_RULE;assert.equal(rule.countryCode,"FR");assert.equal(rule.subdivisionCode,"FR-MET");assert.equal(rule.status,"DRAFT");
  assert.equal(rule.approvalScope,"NONE");assert.equal(rule.taxRule,null);assert.equal(rule.fiscalApproved,false);assert.equal(rule.legalApproved,false);assert.equal(rule.paymentApproved,false);
  assert.equal(JSON.parse(rule.notes).territory,"METROPOLITAN_CORSICA");
  for(const mode of["TEST","LIVE"] as const){const value=evaluateDigitalJurisdiction({countryCode:"FR",subdivisionCode:"FR-MET",residenceCountryCode:"FR",billingCountryCode:"FR",customerType:"B2C",mode,
    termsVersion:"draft-not-approved",locale:"fr",providerAllowed:true,rightsApproved:true,formatsReady:true},rule,now);assert.notEqual(value.decision,"ALLOW");}
});
