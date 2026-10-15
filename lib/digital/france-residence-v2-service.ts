import "server-only";
import {randomUUID} from "node:crypto";
import type {Prisma} from "@/generated/prisma/client";
import type {OrderActor} from "@/lib/orders/domain";
import {prisma} from "@/lib/prisma";
import {DigitalError,assertDigitalUuid,requireDigitalEnvironment} from "./domain";
import {digitalFrancePostalScope} from "./france-launch-policy";
import {assertDigitalDatabaseUtc} from "./database-time-policy";
import {DIGITAL_FRANCE_RESIDENCE_V2_POLICY,DIGITAL_FRANCE_RESIDENCE_DECLARATION_EVENT,DIGITAL_FRANCE_RESIDENCE_REVIEW_EVENT,DIGITAL_FRANCE_RESIDENCE_ATTESTATION,
  normalizeDigitalFranceResidenceAddress,digitalFranceResidenceHash,digitalFranceResidenceDeclarationHash,digitalFranceResidenceReviewV2Hash,digitalFranceResidenceSha,
  digitalFranceResidenceV2Result,digitalFranceBillingContext,evaluateDigitalFranceResidenceV2,assertDigitalFranceResidenceV2Prepared,
  type DigitalFranceResidenceDeclarationV2,type DigitalFranceResidenceReviewV2,type DigitalFranceResidenceSnapshotV2,type DigitalFranceBillingDocument,type DigitalFranceMinimalAddress} from "./france-residence-v2-policy";
type Tx=Prisma.TransactionClient;
type EventRow={id:string;actorId:string|null;createdAt:Date;details:unknown};
const eventSelect={id:true,actorId:true,createdAt:true,details:true} as const;
const text=(v:Record<string,unknown>,key:string)=>typeof v[key]==="string"?v[key] as string:"";
const object=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
async function lock(db:Tx,userId:string){await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-user:${userId}`})) IS NULL AS locked`;}
async function activeUser(db:Tx,userId:string,admin=false){const u=await db.user.findUnique({where:{id:userId},select:{id:true,role:true,status:true,emailVerified:true}});
  if(!u||u.status!=="ACTIVE"||!u.emailVerified||admin&&u.role!=="ADMIN")throw new DigitalError(admin?"ADMIN_REQUIRED":"VERIFIED_ACCOUNT_REQUIRED",403);return u;}
async function latest(db:Tx,userId:string,kind:string){return db.digitalEvent.findFirst({where:{kind,details:{path:["subjectUserId"],equals:userId}},orderBy:[{createdAt:"desc"},{id:"desc"}],select:eventSelect});}
function declaration(row:EventRow|null):DigitalFranceResidenceDeclarationV2|null{
  const d=row&&object(row.details);if(!row||!d||!row.actorId)return null;
  return{eventId:row.id,actorId:row.actorId,subjectUserId:text(d,"subjectUserId"),createdAt:row.createdAt.toISOString(),policy:text(d,"policy") as typeof DIGITAL_FRANCE_RESIDENCE_V2_POLICY,
    address:d.address as DigitalFranceMinimalAddress,addressHash:text(d,"addressHash"),billingPostalCode:text(d,"billingPostalCode"),residenceConfirmed:d.residenceConfirmed as true,requestHash:text(d,"requestHash"),recordHash:text(d,"recordHash")};
}
async function review(db:Tx,row:EventRow|null):Promise<DigitalFranceResidenceReviewV2|null>{
  const d=row&&object(row.details);if(!row||!d||!row.actorId)return null;
  const actor=await db.user.findUnique({where:{id:row.actorId},select:{id:true,role:true,status:true,emailVerified:true}});if(!actor)return null;
  return{eventId:row.id,actorId:row.actorId,subjectUserId:text(d,"subjectUserId"),createdAt:row.createdAt.toISOString(),policy:text(d,"policy") as typeof DIGITAL_FRANCE_RESIDENCE_V2_POLICY,
    declarationId:text(d,"declarationId"),addressHash:text(d,"addressHash"),billingPostalCode:text(d,"billingPostalCode"),billingContext:d.billingContext as DigitalFranceResidenceReviewV2["billingContext"],
    status:text(d,"status") as DigitalFranceResidenceReviewV2["status"],basis:text(d,"basis") as "MANUAL_PROPORTIONATE_REVIEW",reviewSource:text(d,"reviewSource") as DigitalFranceResidenceReviewV2["reviewSource"],
    reason:text(d,"reason"),attestation:typeof d.attestation==="string"?d.attestation:null,conflictResolved:d.conflictResolved===true,privateReference:typeof d.privateReference==="string"?d.privateReference:null,
    reviewedAt:text(d,"reviewedAt"),expiresAt:text(d,"expiresAt"),requestHash:text(d,"requestHash"),recordHash:text(d,"recordHash"),actor};
}
/** Only this user's immutable DCN invoices, never Shop/Rights/private media or PSP calls.
 * The address in an old invoice remains declarative context, not independent proof.
 */
export async function loadDigitalFranceBillingContextV2(userId:string,billingPostalCode:string,db:Tx,documentIds?:string[]){
  assertDigitalUuid(userId);
  if(documentIds!==undefined&&(!Array.isArray(documentIds)||documentIds.length>10||new Set(documentIds).size!==documentIds.length))throw new DigitalError("FRANCE_BILLING_CONTEXT_INVALID",409);
  documentIds?.forEach(assertDigitalUuid);
  const rows=documentIds?.length===0?[]:await db.digitalDocument.findMany({where:{kind:"INVOICE",order:{userId,mode:"TEST"},...(documentIds?{id:{in:documentIds}}:{})},
    orderBy:[{createdAt:"desc"},{id:"desc"}],take:10,select:{id:true,snapshot:true,snapshotHash:true}});
  if(documentIds&&rows.length!==documentIds.length)throw new DigitalError("FRANCE_BILLING_CONTEXT_CHANGED",409);
  const documents:DigitalFranceBillingDocument[]=rows.map(row=>{
    if(!digitalFranceResidenceSha(row.snapshotHash)||digitalFranceResidenceHash(row.snapshot)!==row.snapshotHash)throw new DigitalError("FRANCE_BILLING_CONTEXT_INVALID",409);
    const snapshot=object(row.snapshot),customer=object(snapshot?.customerSnapshot),address=object(customer?.billingAddress);
    return{id:row.id,snapshotHash:row.snapshotHash,addressAvailable:!!address,countryCode:address&&typeof address.countryCode==="string"?address.countryCode:null,postalCode:address&&typeof address.postalCode==="string"?address.postalCode:null};
  });
  return digitalFranceBillingContext(documents,billingPostalCode);
}
export async function assessDigitalFranceResidenceV2(input:{residenceDeclarationId:string;addressHash:string;billingPostalCode:string},subjectUserId:string,db:Tx,now=new Date(),options?:{billingDocumentIds:string[]}){
  try{
    await assertDigitalDatabaseUtc(db);
    assertDigitalUuid(subjectUserId);assertDigitalUuid(input.residenceDeclarationId);
    const declared=declaration(await latest(db,subjectUserId,DIGITAL_FRANCE_RESIDENCE_DECLARATION_EVENT));
    const reviewed=await review(db,await latest(db,subjectUserId,DIGITAL_FRANCE_RESIDENCE_REVIEW_EVENT));
    const billing=await loadDigitalFranceBillingContextV2(subjectUserId,input.billingPostalCode,db,options?.billingDocumentIds);
    return evaluateDigitalFranceResidenceV2(input,subjectUserId,declared,reviewed,billing,now);
  }catch(e){return digitalFranceResidenceV2Result(e instanceof DigitalError?e.code:"FRANCE_RESIDENCE_REPOSITORY_UNAVAILABLE");}
}
export async function revalidateDigitalFranceResidenceV2(snapshot:DigitalFranceResidenceSnapshotV2,subjectUserId:string,db:Tx,now=new Date()){
  if(!snapshot||snapshot.subjectUserId!==subjectUserId||!Array.isArray(snapshot.billingDocumentIds))throw new DigitalError("FRANCE_RESIDENCE_BINDING_INVALID",409);
  const fresh=assertDigitalFranceResidenceV2Prepared(await assessDigitalFranceResidenceV2({residenceDeclarationId:snapshot.residenceDeclarationId,addressHash:snapshot.addressHash,billingPostalCode:snapshot.billingPostalCode},subjectUserId,db,now,{billingDocumentIds:snapshot.billingDocumentIds}));
  if(digitalFranceResidenceHash(fresh)!==digitalFranceResidenceHash(snapshot))throw new DigitalError("FRANCE_RESIDENCE_PROOF_CHANGED_REQUIRES_REVIEW",409);return fresh;
}
function closed(v:unknown,keys:string[]){const o=object(v);if(!o||Object.keys(o).some(k=>!keys.includes(k)))throw new DigitalError("FRANCE_RESIDENCE_REQUEST_INVALID",400);return o;}
export function digitalFranceResidenceDeclarationInput(value:unknown){
  const v=closed(value,["address","billingPostalCode","residenceConfirmed","expectedDeclarationId","idempotencyKey"]);assertDigitalUuid(v.idempotencyKey);if(v.expectedDeclarationId!==null)assertDigitalUuid(v.expectedDeclarationId);
  if(v.residenceConfirmed!==true||!digitalFrancePostalScope("FR",v.billingPostalCode))throw new DigitalError("FRANCE_RESIDENCE_DECLARATION_REQUIRED",409);
  return{address:normalizeDigitalFranceResidenceAddress(v.address),billingPostalCode:v.billingPostalCode as string,residenceConfirmed:true as const,expectedDeclarationId:v.expectedDeclarationId as string|null,idempotencyKey:v.idempotencyKey};
}
export async function saveDigitalFranceResidenceDeclarationV2(actor:OrderActor,raw:unknown){
  requireDigitalEnvironment();const input=digitalFranceResidenceDeclarationInput(raw);assertDigitalUuid(actor.id);
  return prisma.$transaction(async db=>{
    await assertDigitalDatabaseUtc(db);
    await lock(db,actor.id);await activeUser(db,actor.id);
    const requestHash=digitalFranceResidenceHash({subjectUserId:actor.id,input}),externalKey=`dcn-fr-residence:${actor.id}:${input.idempotencyKey}`;
    const previous=await db.digitalEvent.findUnique({where:{externalKey},select:eventSelect});
    if(previous){const d=object(previous.details);if(previous.actorId!==actor.id||d?.requestHash!==requestHash)throw new DigitalError("IDEMPOTENCY_CONFLICT",409);return ownerCurrentSummary(db,actor.id);}
    const last=await latest(db,actor.id,DIGITAL_FRANCE_RESIDENCE_DECLARATION_EVENT);
    if((last?.id??null)!==input.expectedDeclarationId)throw new DigitalError("FRANCE_RESIDENCE_DECLARATION_CHANGED",409);
    if(await db.digitalOrder.findFirst({where:{userId:actor.id,status:{in:["PENDING","REQUIRES_REVIEW","DISPUTED"]}},select:{id:true}}))throw new DigitalError("PAYMENT_ALREADY_ENGAGED",409);
    const createdAt=new Date(Math.max(Date.now(),(last?.createdAt.getTime()??0)+1)),id=randomUUID();
    const proof:Omit<DigitalFranceResidenceDeclarationV2,"recordHash">={eventId:id,actorId:actor.id,subjectUserId:actor.id,createdAt:createdAt.toISOString(),policy:DIGITAL_FRANCE_RESIDENCE_V2_POLICY,
      address:input.address,addressHash:digitalFranceResidenceHash(input.address),billingPostalCode:input.billingPostalCode,residenceConfirmed:true,requestHash};
    const full={...proof,recordHash:digitalFranceResidenceDeclarationHash(proof)};
    await db.digitalEvent.create({data:{id,actorId:actor.id,kind:DIGITAL_FRANCE_RESIDENCE_DECLARATION_EVENT,externalKey,createdAt,details:full}});
    return ownerSummary(full,null);
  });
}
function ownerSummary(d:DigitalFranceResidenceDeclarationV2|null,r:DigitalFranceResidenceReviewV2|null,verified=false){return{declaration:d?{id:d.eventId,address:d.address,addressHash:d.addressHash,billingPostalCode:d.billingPostalCode,createdAt:d.createdAt}:null,
  reviewStatus:verified?"VERIFIED" as const:r&&d&&r.declarationId===d.eventId&&r.status==="REVOKED"?"REVOKED" as const:"REVIEW" as const,reviewId:r?.eventId??null,reviewedAt:r?.reviewedAt??null,expiresAt:r?.expiresAt??null,paymentAllowed:false};}
async function ownerCurrentSummary(db:Tx,userId:string){
  const d=declaration(await latest(db,userId,DIGITAL_FRANCE_RESIDENCE_DECLARATION_EVENT)),r=await review(db,await latest(db,userId,DIGITAL_FRANCE_RESIDENCE_REVIEW_EVENT));
  if(!d)return ownerSummary(null,r);
  try{const billing=await loadDigitalFranceBillingContextV2(userId,d.billingPostalCode,db),assessment=evaluateDigitalFranceResidenceV2({residenceDeclarationId:d.eventId,addressHash:d.addressHash,billingPostalCode:d.billingPostalCode},userId,d,r,billing);return ownerSummary(d,r,assessment.residenceVerified);}catch{return ownerSummary(d,r);}
}
export async function getDigitalFranceResidenceV2(actor:OrderActor){requireDigitalEnvironment();return prisma.$transaction(async db=>{await assertDigitalDatabaseUtc(db);await activeUser(db,actor.id);
  return ownerCurrentSummary(db,actor.id);});}

export function digitalFranceResidenceReviewInput(value:unknown){
  const v=closed(value,["subjectUserId","declarationId","expectedReviewId","status","reviewSource","reason","attested","conflictResolved","privateReference","validDays","idempotencyKey"]);
  for(const id of[v.subjectUserId,v.declarationId,v.idempotencyKey])assertDigitalUuid(id);if(v.expectedReviewId!==null)assertDigitalUuid(v.expectedReviewId);
  if(!["VERIFIED","REVIEW","REVOKED"].includes(String(v.status))||!["CUSTOMER_CONTACT_AND_CONTEXT","EXISTING_BUSINESS_RECORDS","PROPORTIONATE_EXTERNAL_REVIEW"].includes(String(v.reviewSource))
    ||typeof v.reason!=="string"||v.reason.trim().length<10||v.reason.length>500||/[\u0000-\u001f\u007f]/.test(v.reason)||typeof v.attested!=="boolean"||typeof v.conflictResolved!=="boolean"
    ||!Number.isSafeInteger(v.validDays)||Number(v.validDays)<1||Number(v.validDays)>365)throw new DigitalError("FRANCE_RESIDENCE_REVIEW_INVALID",400);
  if(v.privateReference!==null&&(typeof v.privateReference!=="string"||!/^private:[A-Za-z0-9][A-Za-z0-9._/-]{0,179}$/.test(v.privateReference)||v.privateReference.includes("..")))throw new DigitalError("FRANCE_RESIDENCE_REVIEW_INVALID",400);
  if(v.status==="VERIFIED"&&v.attested!==true)throw new DigitalError("FRANCE_RESIDENCE_ATTESTATION_REQUIRED",409);
  return{subjectUserId:v.subjectUserId as string,declarationId:v.declarationId as string,expectedReviewId:v.expectedReviewId as string|null,status:v.status as DigitalFranceResidenceReviewV2["status"],reviewSource:v.reviewSource as DigitalFranceResidenceReviewV2["reviewSource"],
    reason:v.reason.trim(),attested:v.attested,conflictResolved:v.conflictResolved,privateReference:v.privateReference as string|null,validDays:Number(v.validDays),idempotencyKey:v.idempotencyKey as string};
}
export async function recordDigitalFranceResidenceReviewV2(actor:OrderActor,raw:unknown){
  requireDigitalEnvironment();const input=digitalFranceResidenceReviewInput(raw);
  return prisma.$transaction(async db=>{
    await assertDigitalDatabaseUtc(db);
    await lock(db,input.subjectUserId);await activeUser(db,actor.id,true);await activeUser(db,input.subjectUserId);
    const last=await latest(db,input.subjectUserId,DIGITAL_FRANCE_RESIDENCE_REVIEW_EVENT),d=declaration(await latest(db,input.subjectUserId,DIGITAL_FRANCE_RESIDENCE_DECLARATION_EVENT));
    if(!d||d.eventId!==input.declarationId)throw new DigitalError("FRANCE_RESIDENCE_DECLARATION_CHANGED",409);
    const billing=await loadDigitalFranceBillingContextV2(input.subjectUserId,d.billingPostalCode,db),requestHash=digitalFranceResidenceHash({actorId:actor.id,input,addressHash:d.addressHash,billingContextHash:billing.hash}),externalKey=`dcn-fr-residence-review:${input.subjectUserId}:${input.idempotencyKey}`;
    const declarationAssessment=evaluateDigitalFranceResidenceV2({residenceDeclarationId:d.eventId,addressHash:d.addressHash,billingPostalCode:d.billingPostalCode},input.subjectUserId,d,null,billing);
    if(declarationAssessment.code!=="FRANCE_RESIDENCE_MANUAL_REVIEW_REQUIRED")throw new DigitalError(declarationAssessment.code,409);
    const previous=await db.digitalEvent.findUnique({where:{externalKey},select:eventSelect});
    if(previous){const data=object(previous.details);if(previous.actorId!==actor.id||data?.requestHash!==requestHash)throw new DigitalError("IDEMPOTENCY_CONFLICT",409);return ownerCurrentSummary(db,input.subjectUserId);}
    if((last?.id??null)!==input.expectedReviewId)throw new DigitalError("FRANCE_RESIDENCE_REVIEW_CHANGED",409);
    if(input.status==="VERIFIED"&&billing.status==="CONFLICT"&&!input.conflictResolved)throw new DigitalError("FRANCE_RESIDENCE_BILLING_CONFLICT_REVIEW_REQUIRED",409);
    const createdAt=new Date(Math.max(Date.now(),Date.parse(d.createdAt),(last?.createdAt.getTime()??0)+1)),eventId=randomUUID();
    const proof:Omit<DigitalFranceResidenceReviewV2,"recordHash"|"actor">={eventId,subjectUserId:input.subjectUserId,actorId:actor.id,createdAt:createdAt.toISOString(),policy:DIGITAL_FRANCE_RESIDENCE_V2_POLICY,
      declarationId:d.eventId,addressHash:d.addressHash,billingPostalCode:d.billingPostalCode,billingContext:billing,status:input.status,basis:"MANUAL_PROPORTIONATE_REVIEW",reviewSource:input.reviewSource,
      reason:input.reason,attestation:input.attested?DIGITAL_FRANCE_RESIDENCE_ATTESTATION:null,conflictResolved:input.conflictResolved,privateReference:input.privateReference,
      reviewedAt:createdAt.toISOString(),expiresAt:new Date(createdAt.getTime()+input.validDays*86400000).toISOString(),requestHash};
    await db.digitalEvent.create({data:{id:eventId,actorId:actor.id,kind:DIGITAL_FRANCE_RESIDENCE_REVIEW_EVENT,externalKey,createdAt,details:{...proof,recordHash:digitalFranceResidenceReviewV2Hash(proof)}}});
    return ownerCurrentSummary(db,input.subjectUserId);
  });
}
export async function getDigitalFranceResidenceAdminPanelV2(actor:OrderActor,subjectUserId:string){
  requireDigitalEnvironment();assertDigitalUuid(subjectUserId);return prisma.$transaction(async db=>{await assertDigitalDatabaseUtc(db);await activeUser(db,actor.id,true);
    const d=declaration(await latest(db,subjectUserId,DIGITAL_FRANCE_RESIDENCE_DECLARATION_EVENT)),r=await review(db,await latest(db,subjectUserId,DIGITAL_FRANCE_RESIDENCE_REVIEW_EVENT));
    const billing=d?await loadDigitalFranceBillingContextV2(subjectUserId,d.billingPostalCode,db):null;
    return{...await ownerCurrentSummary(db,subjectUserId),subjectUserId,billing,review:r?{id:r.eventId,status:r.status,reviewedAt:r.reviewedAt,expiresAt:r.expiresAt,reviewSource:r.reviewSource,reason:r.reason,conflictResolved:r.conflictResolved}:null};
  });
}
export async function listDigitalFranceResidenceQueueV2(actor:OrderActor){requireDigitalEnvironment();return prisma.$transaction(async db=>{await assertDigitalDatabaseUtc(db);await activeUser(db,actor.id,true);
  const rows=await db.digitalEvent.findMany({where:{kind:DIGITAL_FRANCE_RESIDENCE_DECLARATION_EVENT},orderBy:[{createdAt:"desc"},{id:"desc"}],take:51,select:eventSelect}),seen=new Set<string>();
  return{truncated:rows.length>50,entries:rows.slice(0,50).flatMap(row=>{const d=declaration(row);if(!d||seen.has(d.subjectUserId))return[];seen.add(d.subjectUserId);try{const address=normalizeDigitalFranceResidenceAddress(d.address);return[{subjectUserId:d.subjectUserId,declarationId:d.eventId,postalCode:address.postalCode,city:address.city,createdAt:d.createdAt}];}catch{return[];}})};
});}
