import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import type {Prisma} from "@/generated/prisma/client";
import {parseDigitalCustomerTerritory,reserveDigitalJurisdiction,checkDigitalAcquiredJurisdiction} from "@/lib/digital/checkout-jurisdiction";
import {digitalFranceResidenceReviewHash,type DigitalFranceResidenceReview,DIGITAL_FRANCE_LAUNCH_DRAFT_RULE,evaluateDigitalFranceLaunch} from "@/lib/digital/france-launch-policy";
import {loadDigitalFranceResidenceReview} from "@/lib/digital/france-residence-service";
import {DIGITAL_TERMS_VERSION} from "@/lib/digital/domain";
import {localQaDigitalCountryRule,evaluateDigitalJurisdiction,type DigitalCountryTaxRuleView} from "@/lib/digital/jurisdictions";

const declaration={countryCode:"FR",residenceCountryCode:"FR",billingCountryCode:"FR",customerType:"B2C",residencePostalCode:"20000",billingPostalCode:"75001",residenceConfirmed:true};
async function local<T>(fn:()=>Promise<T>){const saved={...process.env};
  try{for(const k of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|RAILWAY|MEDIA_DEPLOYMENT_ENV|PAYMENT_DEPLOYMENT_ENV/.test(k))delete process.env[k];
    Object.assign(process.env,{DCN_ENABLED:"true",DCN_MODE:"TEST",DCN_NEW_PAYMENTS_ENABLED:"false",DCN_EXTERNAL_TEST_AUTHORIZED:"false"});return await fn();
  }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}}
function fixture(){
  const subjectUserId=randomUUID(),actorId=randomUUID(),at=new Date(Date.now()-60000).toISOString();
  const review:DigitalFranceResidenceReview={eventId:randomUUID(),eventKind:"FR_RESIDENCE_REVIEWED",subjectUserId,actorId,actor:{id:actorId,role:"ADMIN",status:"ACTIVE",emailVerified:true},
    status:"VERIFIED",countryCode:"FR",postalCode:"20000",postalRouting:"ORDINARY",sourceKind:"INDEPENDENT_RESIDENCE_EVIDENCE",privateEvidenceReference:"private:synthetic/no-real-document",
    evidenceSha256:"a".repeat(64),reviewedAt:at,createdAt:at,expiresAt:new Date(Date.now()+86400000).toISOString(),recordHash:""};
  const seal=()=>review.recordHash=digitalFranceResidenceReviewHash(review);seal();
  const base=localQaDigitalCountryRule(DIGITAL_TERMS_VERSION);
  let rule:Record<string,unknown>|null={...base,subdivisionCode:"FR-MET",approvalScope:"LIVE",taxRule:{...base.taxRule!,treatment:"EXEMPT_APPROVED",regimeCode:"SYNTHETIC_NOT_A_FISCAL_APPROVAL"}};
  const snapshot={...evaluateDigitalJurisdiction({...declaration,subdivisionCode:"FR-MET",mode:"TEST",termsVersion:DIGITAL_TERMS_VERSION,locale:"fr",providerAllowed:true,rightsApproved:true,formatsReady:true},rule as unknown as DigitalCountryTaxRuleView).snapshot!,
    franceResidence:evaluateDigitalFranceLaunch({countryCode:"FR",postalCode:"20000",billingPostalCode:"75001"},subjectUserId,review).snapshot!};
  let available=true,reviewReads=0,actorReads=0,policyReads=0;
  const tx={
    digitalEvent:{async findFirst(args:{where:{kind:string;details:{path:string[];equals:string}};orderBy:unknown}){
      reviewReads++;assert.equal(args.where.kind,"FR_RESIDENCE_REVIEWED");assert.equal(args.where.details.equals,subjectUserId);assert.deepEqual(args.orderBy,[{createdAt:"desc"},{id:"desc"}]);
      if(!available)return null;return{id:review.eventId,actorId:review.actorId,kind:review.eventKind,createdAt:new Date(review.createdAt),details:{...review,actor:{id:actorId,role:"FAKE_REQUEST_ROLE"}}};}},
    user:{async findUnique(){actorReads++;return review.actor;}},
    digitalCountryTaxRule:{async findFirst(args:{where:{countryCode:string;subdivisionCode:string}}){policyReads++;assert.equal(args.where.countryCode,"FR");assert.equal(args.where.subdivisionCode,"FR-MET");
      return rule?{...rule,reviewedAt:rule.reviewedAt?new Date(rule.reviewedAt as string):null,validFrom:rule.validFrom?new Date(rule.validFrom as string):null,expiresAt:rule.expiresAt?new Date(rule.expiresAt as string):null}:null;}},
  } as unknown as Prisma.TransactionClient;
  return{subjectUserId,review,tx,snapshot,seal,missing:()=>available=false,setRule:(r:Record<string,unknown>|null)=>rule=r,reads:()=>({reviewReads,actorReads,policyReads})};
}
test("France checkout parser accepts only declarations, never browser proof or approval material",()=>{
  assert.deepEqual(parseDigitalCustomerTerritory(declaration),declaration);
  for(const injected of[{franceResidence:{}},{residenceVerified:true},{reviewEventId:randomUUID()},{recordHash:"a".repeat(64)},{actor:{role:"ADMIN"}},{localQaFixtureAuthorized:true}])assert.throws(()=>parseDigitalCustomerTerritory({...declaration,...injected}),{code:"INVALID_TERRITORY_INPUT"});
  for(const patch of[{residencePostalCode:75001},{billingPostalCode:"75001\n"},{residenceConfirmed:"true"}])assert.throws(()=>parseDigitalCustomerTerritory({...declaration,...patch}));
});
test("non-QA pre-payment gate refuses missing declaration, overseas and unverified residence before policy/provider work",async()=>local(async()=>{
  const f=fixture();
  await assert.rejects(()=>reserveDigitalJurisdiction({...declaration,residenceConfirmed:false},f.tx,false,f.subjectUserId),{code:"FRANCE_RESIDENCE_DECLARATION_REQUIRED"});
  for(const patch of[{residencePostalCode:"97100"},{billingPostalCode:"98000"},{countryCode:"DE",residenceCountryCode:"DE",billingCountryCode:"DE"}])await assert.rejects(()=>reserveDigitalJurisdiction({...declaration,...patch},f.tx,false,f.subjectUserId));
  assert.deepEqual(f.reads(),{reviewReads:0,actorReads:0,policyReads:0});
  f.missing();await assert.rejects(()=>reserveDigitalJurisdiction(declaration,f.tx,false,f.subjectUserId),{code:"FRANCE_ADDRESS_DECLARATION_REQUIRED"});
  assert.deepEqual(f.reads(),{reviewReads:0,actorReads:0,policyReads:0});
}));
test("server loader replaces JSON actor claims with a fresh authoritative actor and never falls back to a prior review",async()=>local(async()=>{
  const f=fixture(),loaded=await loadDigitalFranceResidenceReview(f.subjectUserId,f.tx);assert.equal(loaded!.actor.role,"ADMIN");
  f.review.actor.role="MEMBER";await assert.rejects(()=>checkDigitalAcquiredJurisdiction(f.snapshot,f.tx,"synthetic-provider",f.subjectUserId),{code:"FRANCE_RESIDENCE_REVIEW_PROVENANCE_INVALID"});
  f.review.actor.role="ADMIN";f.review.status="REVOKED";f.seal();await assert.rejects(()=>checkDigitalAcquiredJurisdiction(f.snapshot,f.tx,"synthetic-provider",f.subjectUserId),{code:"FRANCE_RESIDENCE_REVIEW_REVOKED"});
  assert.equal(f.reads().policyReads,0);
}));
test("independent residence proof alone never opens the prepared France policy or falls back to generic FR",async()=>local(async()=>{
  const f=fixture();f.setRule({...DIGITAL_FRANCE_LAUNCH_DRAFT_RULE});
  await assert.rejects(()=>checkDigitalAcquiredJurisdiction(f.snapshot,f.tx,"synthetic-provider",f.subjectUserId),{code:"TERRITORY_REVIEW_REQUIRED"});
  assert.equal(f.reads().policyReads,1);f.setRule(null);
  await assert.rejects(()=>checkDigitalAcquiredJurisdiction(f.snapshot,f.tx,"synthetic-provider",f.subjectUserId),{code:"TERRITORY_POLICY_MISSING"});
}));
test("in-memory synthetic approval snapshots only necessary residence binding; current legal/PSP configuration is not activated",async()=>local(async()=>{
  const f=fixture(),s=f.snapshot;
  // Frozen V1 fixture remains recoverable; new checkouts now require address-bound V2.
  await assert.rejects(()=>reserveDigitalJurisdiction(declaration,f.tx,false,f.subjectUserId),{code:"FRANCE_ADDRESS_DECLARATION_REQUIRED"});
  assert.equal(s.subdivisionCode,"FR-MET");assert.equal(s.franceResidence!.subjectUserId,f.subjectUserId);assert.equal(s.franceResidence!.residencePostalCode,"20000");
  assert.equal(JSON.stringify(s).includes("private:synthetic"),false);assert.equal(JSON.stringify(s).includes("evidenceSha256"),false);
  assert.equal(process.env.DCN_MODE,"TEST");assert.equal(process.env.DCN_NEW_PAYMENTS_ENABLED,"false");
  await checkDigitalAcquiredJurisdiction(JSON.parse(JSON.stringify(s)),f.tx,"synthetic-provider",f.subjectUserId);
  await assert.rejects(()=>checkDigitalAcquiredJurisdiction(s,f.tx,"synthetic-provider",randomUUID()),{code:"FRANCE_RESIDENCE_PROOF_BINDING_INVALID"});
  const missing={...s} as Partial<typeof s>;delete missing.franceResidence;
  await assert.rejects(()=>checkDigitalAcquiredJurisdiction(missing,f.tx,"synthetic-provider",f.subjectUserId),{code:"FRANCE_RESIDENCE_PROOF_BINDING_INVALID"});
  f.review.status="REVOKED";f.seal();await assert.rejects(()=>checkDigitalAcquiredJurisdiction(s,f.tx,"synthetic-provider",f.subjectUserId),{code:"FRANCE_RESIDENCE_REVIEW_REVOKED"});
}));
test("old acquired jurisdiction snapshots are not rewritten or retrofitted with residence proof",async()=>local(async()=>{
  const f=fixture();assert.equal(await checkDigitalAcquiredJurisdiction(null,f.tx),undefined);assert.equal(await checkDigitalAcquiredJurisdiction(undefined,f.tx),undefined);
  assert.deepEqual(f.reads(),{reviewReads:0,actorReads:0,policyReads:0});
}));
test("France checks stay before order/provider creation and capture; completed historical downloads do not gain a residency gate",async()=>{
  const commerce=await readFile(new URL("../../lib/digital/commerce.ts",import.meta.url),"utf8"),library=await readFile(new URL("../../lib/digital/library.ts",import.meta.url),"utf8");
  assert.ok(commerce.indexOf("await reserveDigitalJurisdiction(")<commerce.indexOf("await tx.digitalOrder.create("));
  assert.ok(commerce.indexOf("await reserveDigitalJurisdiction(")<commerce.indexOf("await gateway.create("));
  const capture=commerce.slice(commerce.indexOf("export async function captureDigitalPaypal"));assert.ok(capture.indexOf("await checkDigitalAcquiredJurisdiction(")<capture.indexOf("await gateway.capture!"));
  assert.doesNotMatch(library,/franceResidence|assessDigitalFranceResidence|FR_RESIDENCE_REVIEWED/);
});
