import test, { after, before, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { digitalCommercialFiscalNotice, DIGITAL_QA_FISCAL_NOTICE } from "@/lib/digital/document-policy";
import { digitalCompletionJurisdictionAllowed } from "@/lib/digital/live-commerce-policy";
import { digitalContractSnapshot, digitalContractTerms, digitalEmailTemplate, verifyContractSnapshot,
  DIGITAL_FRANCE_CONTRACT_POLICY, DIGITAL_FRANCE_LIVE_CONTRACT_POLICY } from "@/lib/digital/fulfillment-policy";
import { DIGITAL_FRANCE_TERMS_VERSION, DIGITAL_FRANCE_TERMS_TEXT_HASH, digitalFranceTermsDraft } from "@/lib/digital/france-legal";
import { digitalFranceLiveContractCandidate as candidate, DIGITAL_FRANCE_LIVE_CONTRACT_VERSION as version,
  DIGITAL_FRANCE_LIVE_CONTRACT_SCOPE as scope, DIGITAL_FRANCE_LIVE_CONTRACT_TEXT_HASH as textHash,
  DIGITAL_FRANCE_LIVE_CONTRACT_CONSENTS_HASH as consentsHash,
  digitalFranceLiveContractApprovalHash as approvalHash, snapshotDigitalFranceLiveContractApproval as approvalSnapshot,
  type DigitalFranceLiveContractApproval } from "@/lib/digital/france-live-contract";
import { evaluateDigitalJurisdiction, type DigitalCountryTaxRuleView, type DigitalJurisdictionSnapshot } from "@/lib/digital/jurisdictions";

// Pure policy tests only. No DB module or provider adapter is imported. Network
// entry points are trapped, so a future accidental external dependency fails.
let networkAttempts=0;
before(()=>{
  const deny=()=>{networkAttempts++;throw new Error("NETWORK_FORBIDDEN_IN_LOCAL_FULFILLMENT_TEST");};
  mock.method(globalThis,"fetch",deny);
  mock.method(http,"request",deny); mock.method(http,"get",deny);
  mock.method(https,"request",deny); mock.method(https,"get",deny);
  mock.method(net,"connect",deny); mock.method(net,"createConnection",deny);
});
after(()=>{mock.restoreAll();assert.equal(networkAttempts,0,"No external or local network call is part of these pure tests");});

const now=new Date("2026-10-16T17:00:00.000Z"),acceptedAt=new Date("2026-10-16T17:00:01.000Z");
const actor={id:"11111111-1111-4111-8111-111111111111",role:"ADMIN",status:"ACTIVE",emailVerified:true};
const customer={name:"Acheteur synthétique",email:"synthetic@example.invalid",billingAddressConfirmedAsResidence:true,billingAddress:{countryCode:"FR" as const,line1:"1 rue des Tests",postalCode:"75001",city:"Paris"}};
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
// Same synthetic evidence pattern as france-live-contract.test.ts. It is not a
// real seller approval, fiscal decision, customer or historical acquisition.
function approval():DigitalFranceLiveContractApproval {
  const body={id:"22222222-2222-4222-8222-222222222222",kind:"DIGITAL_FRANCE_LIVE_CONTRACT_APPROVAL" as const,status:"APPROVED" as const,
    version,documentHashSha256:candidate.hashSha256,textHashSha256:textHash,consentsHashSha256:consentsHash,scope,
    approvedAt:"2026-10-16T16:00:00.000Z",createdAt:"2026-10-16T16:01:00.000Z",approvedBy:actor.id,
    evidenceReference:"private-evidence:synthetic-fixture-not-real-approval",evidenceSha256:"a".repeat(64)};
  return{...body,recordHash:approvalHash(body)};
}
function approved(){return approvalSnapshot(approval(),actor,now);}
function liveContract(){return digitalContractSnapshot(customer,acceptedAt,version,{mode:"LIVE",approval:approved()});}
test("LIVE never guesses a billing address from a matching residence postcode",()=>{
  for(const confirmation of[false,undefined])assert.throws(()=>digitalContractSnapshot({...customer,billingAddressConfirmedAsResidence:confirmation},acceptedAt,version,{mode:"LIVE",approval:approved()}),{code:"FRANCE_BILLING_ADDRESS_REQUIRED"});
  const s=liveContract();assert.equal(s.billingAddressSource,"BUYER_CONFIRMED_SAME_AS_REVIEWED_RESIDENCE");
  assert.throws(()=>verifyContractSnapshot({...s,billingAddressSource:undefined},version,s.terms.hashSha256!));
});
function liveJurisdiction():DigitalJurisdictionSnapshot {
  const rule:DigitalCountryTaxRuleView={id:"33333333-3333-4333-8333-333333333333",countryCode:"FR",subdivisionCode:"FR-MET",version:1,
    customerType:"B2C",decision:"ALLOW",status:"APPROVED",approvalScope:"LIVE",termsVersion:version,languageCode:"fr",
    fiscalApproved:true,legalApproved:true,paymentApproved:true,reviewedBy:actor.id,reviewedAt:"2026-10-16T16:00:00.000Z",
    validFrom:"2026-10-16T16:00:00.000Z",expiresAt:"2027-10-16T16:00:00.000Z",evidenceReference:"SYNTHETIC_TEST_ONLY_NOT_A_FISCAL_APPROVAL",evidenceHash:"b".repeat(64),
    taxRule:{treatment:"EXEMPT_APPROVED",regimeCode:"FRANCHISE_EN_BASE_TVA",rateBasisPoints:0,priceIncludesTax:true,
      legalNotice:"TVA non applicable, article 293 B du CGI",legalBasisReference:"CGI_293_B_SYNTHETIC_FIXTURE",registrationEvidenceReference:null,rounding:"HALF_UP_CENTS"}};
  const value=evaluateDigitalJurisdiction({countryCode:"FR",subdivisionCode:"FR-MET",residenceCountryCode:"FR",billingCountryCode:"FR",
    customerType:"B2C",mode:"LIVE",termsVersion:version,locale:"fr",providerAllowed:true,rightsApproved:true,formatsReady:true},rule,now);
  assert.equal(value.decision,"ALLOW");assert.ok(value.snapshot);return value.snapshot;
}

test("LIVE contract binds the exact approved document, three consent facts, identity, minimal address and timestamp",()=>{
  const s=liveContract(),verified=verifyContractSnapshot(s,version,textHash);
  assert.equal(s.mode,"LIVE");assert.equal(s.policy,DIGITAL_FRANCE_LIVE_CONTRACT_POLICY);
  assert.equal(s.terms.status,"APPROVED");assert.equal(s.approvedForLive,true);assert.equal(s.terms.expresslyAccepted,true);
  assert.equal(s.earlyDelivery.expresslyRequested,true);assert.equal(s.withdrawal.expresslyAcknowledged,true);
  assert.equal(s.terms.documentHashSha256,candidate.hashSha256);assert.equal(s.terms.hashSha256,textHash);
  assert.deepEqual(s.terms.sections,candidate.sections);assert.equal(s.terms.text,digitalContractTerms(version).text);
  assert.deepEqual(s.customer,{type:"INDIVIDUAL",name:customer.name,email:customer.email,billingAddress:customer.billingAddress});assert.equal(s.acceptedAt,acceptedAt.toISOString());
  assert.equal(verified.snapshotHash,billingSnapshotHash(s));assert.equal(s.licenseStatus,"PERSONAL_PRIVATE_USE");
  assert.equal(s.fiscalStatus,"APPROVED_TERRITORY_SNAPSHOT");
});
test("LIVE contract construction refuses missing, revoked, forged or future approvals and never promotes frozen TEST terms",()=>{
  assert.throws(()=>digitalContractSnapshot(customer,acceptedAt,version,{mode:"LIVE"}),{code:"FR_LIVE_CONTRACT_APPROVAL_REQUIRED"});
  for(const patch of [{snapshotHash:"0".repeat(64)},{actorVerifiedAtCapture:false},{approval:{...approval(),status:"REVOKED"}},
    {approval:{...approval(),documentHashSha256:"0".repeat(64)}},{approval:{...approval(),consentsHashSha256:"0".repeat(64)}}]){
    const bad={...approved(),...patch} as ReturnType<typeof approved>;
    assert.throws(()=>digitalContractSnapshot(customer,acceptedAt,version,{mode:"LIVE",approval:bad}),{code:"FR_LIVE_CONTRACT_APPROVAL_REQUIRED"});
  }
  assert.throws(()=>digitalContractSnapshot(customer,new Date("2026-10-16T16:59:59.000Z"),version,{mode:"LIVE",approval:approved()}));
  assert.throws(()=>digitalContractSnapshot(customer,acceptedAt,DIGITAL_FRANCE_TERMS_VERSION,{mode:"LIVE",approval:approved()}));
  assert.throws(()=>digitalContractSnapshot(customer,acceptedAt,version,{mode:"TEST"}));
});
test("LIVE snapshot verifier rejects changed text, document hash, sections, consents, approved status and approval proof",()=>{
  const s=liveContract();
  const invalid=[{...s,terms:{...s.terms,text:s.terms.text+" changed"}},{...s,terms:{...s.terms,documentHashSha256:"0".repeat(64)}},
    {...s,terms:{...s.terms,status:"DRAFT"}},{...s,terms:{...s.terms,sections:[]}},{...s,terms:{...s.terms,expresslyAccepted:false}},
    {...s,earlyDelivery:{...s.earlyDelivery,expresslyRequested:false}},{...s,earlyDelivery:{...s.earlyDelivery,text:"different"}},
    {...s,withdrawal:{...s.withdrawal,expresslyAcknowledged:false}},{...s,withdrawal:{...s.withdrawal,text:"different"}},
    {...s,approvedForLive:false},{...s,liveApproval:{...approved(),snapshotHash:"0".repeat(64)}},
    {...s,acceptedAt:"2026-10-16T16:59:59.000Z"},{...s,licenseStatus:"PROPOSED_NOT_LIVE_APPROVED"},
    {...s,customer:{...s.customer,name:""}},{...s,customer:{...s.customer,name:"x".repeat(241)}},
    {...s,customer:{...s.customer,email:"invalid-address"}}];
  for(const value of invalid)assert.throws(()=>verifyContractSnapshot(value,version,textHash),{code:"CONTRACT_REQUIRES_REVIEW"});
  assert.throws(()=>verifyContractSnapshot(s,version,"0".repeat(64)));
});
test("LIVE contract requires usable customer identity before persistence, not an empty name or malformed e-mail",()=>{
  for(const patch of [{name:""},{name:"   "},{name:"x".repeat(241)},{email:""},{email:"invalid-address"},{email:"x".repeat(321)}]){
    assert.throws(()=>digitalContractSnapshot({...customer,...patch},acceptedAt,version,{mode:"LIVE",approval:approved()}));
  }
});
test("LIVE contract rejects missing, overseas, foreign, CEDEX or expanded identity-document address payloads",()=>{
  for(const address of [undefined,{},null,{...customer.billingAddress,countryCode:"BE"},{...customer.billingAddress,postalCode:"97100"},
    {...customer.billingAddress,city:"Paris CEDEX"},{...customer.billingAddress,line1:""},{...customer.billingAddress,identityDocument:"not-permitted"}]){
    assert.throws(()=>digitalContractSnapshot({...customer,billingAddress:address as typeof customer.billingAddress},acceptedAt,version,{mode:"LIVE",approval:approved()}));
  }
  const corsica=digitalContractSnapshot({...customer,billingAddress:{countryCode:"FR",line1:"1 rue des Tests",postalCode:"20000",city:"Ajaccio"}},acceptedAt,version,{mode:"LIVE",approval:approved()});
  assert.equal(verifyContractSnapshot(corsica,version,textHash).snapshot.customer.billingAddress?.postalCode,"20000");
});
test("frozen France TEST snapshot and hashes are unchanged and remain explicitly non-commercial",()=>{
  const s=digitalContractSnapshot(customer,acceptedAt,DIGITAL_FRANCE_TERMS_VERSION),terms=digitalContractTerms(DIGITAL_FRANCE_TERMS_VERSION);
  assert.deepEqual(s,{mode:"TEST",policy:DIGITAL_FRANCE_CONTRACT_POLICY,customer:{type:"INDIVIDUAL",name:customer.name,email:customer.email},
    acceptedAt:acceptedAt.toISOString(),terms:{version:DIGITAL_FRANCE_TERMS_VERSION,text:terms.text,hashSha256:terms.hash,
      documentHashSha256:digitalFranceTermsDraft.hashSha256,status:"DRAFT",expresslyAccepted:true,sections:digitalFranceTermsDraft.sections},
    earlyDelivery:{expresslyRequested:true,text:terms.earlyDeliveryText},withdrawal:{expresslyAcknowledged:true,text:terms.withdrawalText},
    approvedForLive:false,licenseStatus:"PROPOSED_NOT_LIVE_APPROVED",fiscalStatus:"LOCAL_REVIEW_ONLY"});
  assert.equal(DIGITAL_FRANCE_TERMS_TEXT_HASH,"5e350e6bddb003b6ff0d2cd0236aa6876857b2d0376f8c99dd8362e8a1babe48");
  assert.equal(digitalFranceTermsDraft.hashSha256,"30c7ac06586dad083f13c334affd4763ba4c9b215b3c8f4cc28522e400ef042c");
  assert.equal(verifyContractSnapshot(s,DIGITAL_FRANCE_TERMS_VERSION,DIGITAL_FRANCE_TERMS_TEXT_HASH).snapshot.mode,"TEST");
});
test("LIVE fiscal notice comes only from the approved acquired France snapshot, never a seller-wide assumption",()=>{
  const j=liveJurisdiction();assert.equal(digitalCommercialFiscalNotice(j,"LIVE"),j.tax.legalNotice);
  for(const value of [null,{}, {...j,policy:"wrong"},{...j,approvalScope:"LOCAL_QA"},{...j,countryCode:"GP"},{...j,subdivisionCode:""},
    {...j,ruleId:""},{...j,ruleHash:""},{...j,tax:{...j.tax,treatment:"QA_ONLY"}},{...j,tax:{...j.tax,treatment:"TAXED_APPROVED"}},
    {...j,tax:{...j.tax,rateBasisPoints:2000}},{...j,tax:{...j.tax,priceIncludesTax:false}},{...j,tax:{...j.tax,legalNotice:" "}}]){
    assert.throws(()=>digitalCommercialFiscalNotice(value,"LIVE"),{code:"FISCAL_DOCUMENT_POLICY_REQUIRES_REVIEW"});
  }
  assert.equal(digitalCommercialFiscalNotice(null,"TEST"),DIGITAL_QA_FISCAL_NOTICE);
  assert.equal(digitalCommercialFiscalNotice(j,"TEST"),DIGITAL_QA_FISCAL_NOTICE);
});
test("completion keeps QA and LIVE tax scopes separate; foreign, QA, unknown-rate and not-TTC snapshots remain closed",()=>{
  const j=liveJurisdiction();assert.equal(digitalCompletionJurisdictionAllowed(j,"LIVE"),true);
  const qa={...j,approvalScope:"LOCAL_QA" as const};assert.equal(digitalCompletionJurisdictionAllowed(qa,"TEST"),true);
  assert.equal(digitalCompletionJurisdictionAllowed(j,"TEST"),false);
  for(const value of [qa,{...j,countryCode:"BE"},{...j,subdivisionCode:"FR-GP"},{...j,tax:{...j.tax,treatment:"QA_ONLY"}},
    {...j,tax:{...j.tax,treatment:"TAXED_APPROVED"}},{...j,tax:{...j.tax,rateBasisPoints:1}},{...j,tax:{...j.tax,priceIncludesTax:false}}]){
    assert.equal(digitalCompletionJurisdictionAllowed(value as DigitalJurisdictionSnapshot,"LIVE"),false);
  }
});
test("LIVE transaction e-mails are escaped and account-only, without TEST/QA accounting disclaimers",()=>{
  for(const kind of ["CONTRACT_AVAILABLE","ACCESS_READY","REFUND_CONFIRMED","INCIDENT","FREE_COMPLETION_AVAILABLE"]){
    const mail=digitalEmailTemplate({kind,orderId:"44444444-4444-4444-8444-444444444444",totalCents:990,
      titles:['Album <script>alert("synthetic")</script>'],base:"https://www.lnxbeats.fr",documentNumber:"SYNTHETIC-EXAMPLE",mode:"LIVE"});
    assert.doesNotMatch(mail.subject,/^TEST/);assert.doesNotMatch(mail.text,/DCN local TEST|conditions QA|parcours QA|fourniture QA|sans valeur comptable/);
    assert.match(mail.text,/9,90 EUR/);assert.match(mail.text,/https:\/\/www\.lnxbeats\.fr\/musique\/confirmation\//);
    assert.doesNotMatch(mail.html,/<script>/);assert.match(mail.html,/&lt;script&gt;/);
    assert.doesNotMatch(mail.text+mail.html,/digital\/masters\/|storageKey|access_token|Authorization:/);
    if(kind==="FREE_COMPLETION_AVAILABLE")assert.doesNotMatch(mail.text,/Votre paiement est confirmé/);
  }
});
test("TEST confirmation email keeps its frozen text and no real accounting or durable-receipt claim",()=>{
  const mail=digitalEmailTemplate({kind:"CONTRACT_AVAILABLE",orderId:"44444444-4444-4444-8444-444444444444",totalCents:990,titles:["Album synthétique"],base:"http://127.0.0.1:3140",mode:"TEST"});
  assert.equal(mail.subject,"TEST — Confirmation de votre achat numérique");
  assert.equal(mail.text,["LNX Beats · DCN local TEST","Votre paiement est confirmé. Téléchargez la confirmation contractuelle puis accusez réception dans votre compte avant le commencement de la fourniture QA. Cet email d’information seul ne prouve pas la remise.",
    "Album synthétique","9,90 EUR","http://127.0.0.1:3140/musique/confirmation/44444444-4444-4444-8444-444444444444",
    "Prix et conditions QA, sans valeur comptable. Aucun droit de publication, de distribution ou de monétisation accordé."].join("\n\n"));
  assert.equal(digitalEmailTemplate({kind:"CONTRACT_AVAILABLE",orderId:"44444444-4444-4444-8444-444444444444",totalCents:990,titles:[],base:"http://127.0.0.1:3140"}).subject,mail.subject);
});
test("LIVE transaction links refuse cleartext HTTP and every mode refuses URL credentials, paths or secret parameters",()=>{
  const args={kind:"CONTRACT_AVAILABLE",orderId:"44444444-4444-4444-8444-444444444444",totalCents:990,titles:[]};
  assert.throws(()=>digitalEmailTemplate({...args,base:"http://qa.example.invalid",mode:"LIVE"}));
  assert.throws(()=>digitalEmailTemplate({...args,base:"https://qa.example.invalid",mode:"LIVE"}));
  for(const base of ["https://a:b@example.invalid","https://example.invalid/private","https://example.invalid/?token=synthetic","https://example.invalid/#secret"]){
    for(const mode of ["LIVE","TEST"] as const)assert.throws(()=>digitalEmailTemplate({...args,base,mode}));
  }
});
test("verified acquired LIVE snapshots remain unchanged by checks and do not depend on today's mutable candidate status",()=>{
  const s=liveContract(),before=copy(s);
  verifyContractSnapshot(s,version,textHash);assert.deepEqual(s,before);
  assert.equal(candidate.status,"DRAFT");assert.equal(candidate.approvedForLive,false);
  // A private saved exact approval is explicit, not approval inferred by import.
  assert.equal(s.liveApproval?.approval.documentHashSha256,candidate.hashSha256);
});
