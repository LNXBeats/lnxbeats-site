import test,{after,before,mock} from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type {Prisma} from "@/generated/prisma/client";
import {billingSnapshotHash} from "@/lib/billing/domain";
import {digitalLiveContractCustomer} from "@/lib/digital/contract-approval-service";
import {parseDigitalCheckoutBillingAddress,resolveDigitalContractBillingAddress,assertDigitalBillingAddressRetry} from "@/lib/digital/billing-address-policy";
import {digitalFranceContractPublication,approvedDigitalFranceContractPublication} from "@/lib/digital/france-contract-publication";
import {DIGITAL_CHECKOUT_CONSENT_PRESENTATION,digitalCheckoutConsentPresentation,parseDigitalCheckoutConsentPresentation,validDigitalCheckoutConsentPresentation,assertDigitalCheckoutConsentRetry} from "@/lib/digital/checkout-consents";
import {digitalContractSnapshot,verifyContractSnapshot} from "@/lib/digital/fulfillment-policy";
import {digitalFranceLiveContractCandidate as candidate,DIGITAL_FRANCE_LIVE_CONTRACT_VERSION as version,DIGITAL_FRANCE_LIVE_CONTRACT_SCOPE as scope,digitalFranceLiveContractApprovalHash,snapshotDigitalFranceLiveContractApproval} from "@/lib/digital/france-live-contract";
import type {DigitalFranceResidenceSnapshotV2} from "@/lib/digital/france-residence-v2-policy";

let calls=0;
before(()=>{const deny=()=>{calls++;throw Error("NETWORK_FORBIDDEN_IN_MOBILE_CONTRACT_TEST");};mock.method(globalThis,"fetch",deny);for(const method of["request","get"] as const){mock.method(http,method,deny);mock.method(https,method,deny);}mock.method(net,"connect",deny);mock.method(net,"createConnection",deny);});
after(()=>{mock.restoreAll();assert.equal(calls,0);});
const userId="11111111-1111-4111-8111-111111111111",declarationId="22222222-2222-4222-8222-222222222222";
const address={countryCode:"FR" as const,line1:"1 rue des Tests",postalCode:"20000",city:"Ajaccio"};
const residence={subjectUserId:userId,residenceDeclarationId:declarationId,addressHash:billingSnapshotHash(address),billingPostalCode:"20000"} as DigitalFranceResidenceSnapshotV2;
const now=new Date("2026-10-16T18:00:00.000Z"),actor={id:userId,role:"ADMIN",status:"ACTIVE",emailVerified:true};
function approval(){const record={id:declarationId,kind:"DIGITAL_FRANCE_LIVE_CONTRACT_APPROVAL" as const,status:"APPROVED" as const,version,
  documentHashSha256:candidate.hashSha256,textHashSha256:candidate.textHashSha256,consentsHashSha256:candidate.consentsHashSha256,scope,
  approvedAt:"2026-10-16T16:00:00.000Z",createdAt:"2026-10-16T16:01:00.000Z",approvedBy:userId,evidenceReference:"private-evidence:synthetic-not-real-approval",evidenceSha256:"a".repeat(64)};
  return snapshotDigitalFranceLiveContractApproval({...record,recordHash:digitalFranceLiveContractApprovalHash(record)},actor,now);}
function db(addressHash=residence.addressHash){let query:unknown;return{db:{digitalEvent:{async findFirst(input:unknown){query=input;return{details:{address,addressHash}};}}} as unknown as Pick<Prisma.TransactionClient,"digitalEvent">,query:()=>query};}

test("published alias pins the approved exact frozen contract without rewriting draft04 identity or hashes",()=>{
  const before=JSON.stringify(candidate),published=approvedDigitalFranceContractPublication(approval());
  assert.equal(published,digitalFranceContractPublication);assert.equal(published?.reference,"digital-music-france-cgv-20261016");assert.equal(published?.contentVersion,version);
  assert.equal(published?.documentHashSha256,"33ae20b540a718cd22d887f72e5651cdce317d9bf60bc3381be2fe06d2d69d41");
  assert.equal(published?.textHashSha256,"868a08be362b2f499e979b996063b435c28a13f973d19d83ec78f072b0c6e41b");
  assert.equal(published?.consentsHashSha256,"f52a7310693970e748d5ec5cbfa534dede96f9d5f72c433424a71e4953c1f100");
  assert.equal(JSON.stringify(candidate),before);assert.equal(candidate.status,"DRAFT");assert.equal(candidate.version,version);
  assert.equal(approvedDigitalFranceContractPublication(null),null);assert.equal(approvedDigitalFranceContractPublication({...approval(),snapshotHash:"0".repeat(64)}),null);
});
test("billing payload is minimal, closed and FR-MET/Corse only; absence preserves old callers",()=>{
  assert.equal(parseDigitalCheckoutBillingAddress(undefined),undefined);assert.deepEqual(parseDigitalCheckoutBillingAddress(address),address);
  for(const value of[null,[],{},"address",{...address,countryCode:"BE"},{...address,postalCode:"97100"},{...address,city:"Ajaccio CEDEX"},{...address,line1:"x"},{...address,identityDocument:"not-allowed"}])assert.throws(()=>parseDigitalCheckoutBillingAddress(value));
});
test("same address is explicit, full-address bound, and never guessed from matching postcodes",()=>{
  assert.deepEqual(resolveDigitalContractBillingAddress(address,residence,true),{billingAddress:address,billingAddressConfirmedAsResidence:true});
  assert.deepEqual(resolveDigitalContractBillingAddress(address,residence,true,{...address,line1:" 1 rue des Tests "}).billingAddress,address);
  assert.throws(()=>resolveDigitalContractBillingAddress(address,residence,true,{...address,line1:"9 rue des Tests"}),{code:"FRANCE_BILLING_ADDRESS_REQUIRED"});
  assert.throws(()=>resolveDigitalContractBillingAddress(address,residence,false),{code:"FRANCE_BILLING_ADDRESS_REQUIRED"});
  assert.throws(()=>resolveDigitalContractBillingAddress(address,{...residence,billingPostalCode:"75001"},true),{code:"FRANCE_RESIDENCE_PROOF_CHANGED_REQUIRES_REVIEW"});
});
test("different billing address remains fail-closed even with the reviewed postcode",()=>{
  for(const postalCode of["20000","75001"]){assert.throws(()=>resolveDigitalContractBillingAddress(address,residence,false,{...address,line1:"9 autre rue",postalCode}),{code:"FRANCE_BILLING_ADDRESS_DIFFERENT_REQUIRES_REVIEW"});}
});
test("customer loader binds the authenticated residence declaration and refuses substitution",async()=>{
  const fixture=db();const result=await digitalLiveContractCustomer(fixture.db,userId,"Acheteur synthétique","synthetic@example.invalid",residence,true);
  assert.deepEqual(result,{type:"INDIVIDUAL",name:"Acheteur synthétique",email:"synthetic@example.invalid",billingAddress:address,billingAddressConfirmedAsResidence:true});
  assert.deepEqual(fixture.query(),{where:{id:declarationId,actorId:userId,kind:"FR_RESIDENCE_DECLARED_V2"},select:{details:true}});
  await assert.rejects(()=>digitalLiveContractCustomer(db("0".repeat(64)).db,userId,"Acheteur synthétique","synthetic@example.invalid",residence,true),{code:"FRANCE_RESIDENCE_PROOF_CHANGED_REQUIRES_REVIEW"});
  await assert.rejects(()=>digitalLiveContractCustomer(fixture.db,"33333333-3333-4333-8333-333333333333","Acheteur synthétique","synthetic@example.invalid",residence,true),{code:"FRANCE_ADDRESS_DECLARATION_REQUIRED"});
  await assert.rejects(()=>digitalLiveContractCustomer(fixture.db,userId,"Acheteur synthétique","synthetic@example.invalid",residence,false,{...address,line1:"9 autre rue"}),{code:"FRANCE_BILLING_ADDRESS_DIFFERENT_REQUIRES_REVIEW"});
});
test("idempotent retry cannot change existing billing address or presentation",()=>{
  const saved={mode:"LIVE",customer:{billingAddress:address},billingAddressSource:"BUYER_CONFIRMED_SAME_AS_REVIEWED_RESIDENCE"};
  assert.doesNotThrow(()=>assertDigitalBillingAddressRetry(saved,true));assert.doesNotThrow(()=>assertDigitalBillingAddressRetry(saved,true,address));
  assert.throws(()=>assertDigitalBillingAddressRetry(saved,false,address),{code:"IDEMPOTENCY_CONFLICT"});assert.throws(()=>assertDigitalBillingAddressRetry(saved,true,{...address,line1:"9 autre rue"}),{code:"IDEMPOTENCY_CONFLICT"});
  assert.doesNotThrow(()=>assertDigitalCheckoutConsentRetry({},undefined));assert.doesNotThrow(()=>assertDigitalCheckoutConsentRetry({checkoutConsentPresentation:digitalCheckoutConsentPresentation(DIGITAL_CHECKOUT_CONSENT_PRESENTATION)},DIGITAL_CHECKOUT_CONSENT_PRESENTATION));
  assert.throws(()=>assertDigitalCheckoutConsentRetry({},DIGITAL_CHECKOUT_CONSENT_PRESENTATION),{code:"IDEMPOTENCY_CONFLICT"});
});
test("two-checkbox presentation supplements separate immutable consent facts and rejects tampering",()=>{
  assert.equal(parseDigitalCheckoutConsentPresentation(undefined),undefined);for(const value of[null,false,"unknown"])assert.throws(()=>parseDigitalCheckoutConsentPresentation(value));
  const presentation=digitalCheckoutConsentPresentation(DIGITAL_CHECKOUT_CONSENT_PRESENTATION)!;assert.equal(validDigitalCheckoutConsentPresentation(presentation),true);
  for(const changed of[{...presentation,withdrawalLossAcknowledged:false},{...presentation,immediateSupplyRequested:false},{...presentation,immediateDeliveryLabel:"changed"},{...presentation,extra:true}])assert.equal(validDigitalCheckoutConsentPresentation(changed as typeof presentation),false);
  const customer={name:"Acheteur synthétique",email:"synthetic@example.invalid",billingAddress:address,billingAddressConfirmedAsResidence:true},options={mode:"LIVE" as const,approval:approval()};
  const old=digitalContractSnapshot(customer,now,version,options),modern=digitalContractSnapshot(customer,now,version,{...options,consentPresentation:DIGITAL_CHECKOUT_CONSENT_PRESENTATION});
  assert.equal(old.checkoutConsentPresentation,undefined);assert.deepEqual(modern.terms,old.terms);assert.deepEqual(modern.earlyDelivery,old.earlyDelivery);assert.deepEqual(modern.withdrawal,old.withdrawal);
  assert.equal(verifyContractSnapshot(modern,version,candidate.textHashSha256).snapshot.checkoutConsentPresentation?.policy,DIGITAL_CHECKOUT_CONSENT_PRESENTATION);
  assert.throws(()=>verifyContractSnapshot({...modern,checkoutConsentPresentation:{...presentation,withdrawalLossAcknowledged:false}},version,candidate.textHashSha256),{code:"CONTRACT_REQUIRES_REVIEW"});
});
