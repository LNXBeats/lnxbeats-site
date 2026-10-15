import "server-only";
import type {Prisma} from "@/generated/prisma/client";
import type {OrderActor} from "@/lib/orders/domain";
import {prisma} from "@/lib/prisma";
import {billingSnapshotHash} from "@/lib/billing/domain";
import {DigitalError,assertDigitalUuid,requireDigitalEnvironment} from "./domain";
import {digitalRightsEvidenceReference,digitalRightsEvidenceSha} from "./rights-review-policy";
import {localDigitalReviewAvailable} from "./local-review-policy";
import {assertDigitalDatabaseUtc} from "./database-time-policy";
import {DIGITAL_MASTER_EQUIVALENCE_EVENT,DIGITAL_MASTER_EQUIVALENCE_POLICY,assertDigitalMasterEquivalence,digitalEquivalentMasterBinding,
  type DigitalMasterEquivalenceDetails} from "./master-equivalence-policy";
type Tx=Prisma.TransactionClient;
function local(){requireDigitalEnvironment();if(!localDigitalReviewAvailable())throw new DigitalError("EQUIVALENCE_LOCAL_ONLY",503);}
const include={masterAsset:{select:{id:true,checksumSha256:true}},mp3Asset:{select:{id:true,checksumSha256:true}}} as const;
async function reviewer(tx:Tx,id:string){return tx.user.findUnique({where:{id},select:{id:true,role:true,status:true,emailVerified:true}});}
async function admin(tx:Tx,id:string){const a=await reviewer(tx,id);if(a?.role!=="ADMIN"||a.status!=="ACTIVE"||!a.emailVerified)throw new DigitalError("ADMIN_REQUIRED",403);}
async function lock(tx:Tx,source:string,target:string){await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-equivalence:${source}:${target}`})) IS NULL AS locked`;}
async function readLock(tx:Tx,source:string,target:string){await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`digital-equivalence:${source}:${target}`})) IS NULL AS locked`;}
async function latest(tx:Tx,source:string,target:string){return tx.digitalEvent.findFirst({where:{kind:DIGITAL_MASTER_EQUIVALENCE_EVENT,details:{path:["pairKey"],equals:`${source}:${target}`}},orderBy:[{createdAt:"desc"},{id:"desc"}]});}
/** Exact direction only: no title matching, reverse mapping, traversal or new entitlement. */
export async function digitalMasterEquivalenceProof(tx:Tx,sourceId:string,targetId:string,trackId:string){
  local();
  await readLock(tx,sourceId,targetId);
  const masters=await tx.digitalMaster.findMany({where:{id:{in:[sourceId,targetId]}},include}),source=masters.find(m=>m.id===sourceId),target=masters.find(m=>m.id===targetId);
  if(!source||!target||source.trackId!==trackId||target.trackId!==trackId)throw new DigitalError("COMPLETION_EQUIVALENCE_REQUIRES_REVIEW",409);
  const event=await latest(tx,sourceId,targetId);
  return assertDigitalMasterEquivalence(source,target,event,event?.actorId?await reviewer(tx,event.actorId):null);
}
async function list(tx:Tx,trackId:string){
  const masters=await tx.digitalMaster.findMany({where:{trackId},orderBy:[{version:"asc"},{id:"asc"}],take:101,select:{id:true,version:true,status:true}}),
    events=await tx.digitalEvent.findMany({where:{kind:DIGITAL_MASTER_EQUIVALENCE_EVENT,details:{path:["trackId"],equals:trackId}},orderBy:[{createdAt:"desc"},{id:"desc"}],take:51});
  return{masters:masters.slice(0,100),reviews:events.slice(0,50).map(e=>{const d=e.details as DigitalMasterEquivalenceDetails;return{id:e.id,sourceMasterId:d.sourceMasterId,targetMasterId:d.targetMasterId,
    status:d.status,reviewedAt:e.createdAt.toISOString(),reviewerId:e.actorId};}),truncated:events.length>50||masters.length>100};
}
export async function listDigitalMasterEquivalences(actor:OrderActor,trackId:string){local();assertDigitalUuid(trackId);
  return prisma.$transaction(async tx=>{await admin(tx,actor.id);return list(tx,trackId);});}
/** Exact bounded lookup, so an older pair never disappears behind history's 50-row window. */
export async function getDigitalMasterEquivalencePair(actor:OrderActor,trackId:string,sourceMasterId:string,targetMasterId:string){
  local();for(const id of[trackId,sourceMasterId,targetMasterId])assertDigitalUuid(id);
  if(sourceMasterId===targetMasterId)throw new DigitalError("INVALID_EQUIVALENCE");
  return prisma.$transaction(async tx=>{await admin(tx,actor.id);await readLock(tx,sourceMasterId,targetMasterId);
    const masters=await tx.digitalMaster.findMany({where:{id:{in:[sourceMasterId,targetMasterId]}},select:{id:true,trackId:true}});
    if(masters.length!==2||masters.some(m=>m.trackId!==trackId))throw new DigitalError("EQUIVALENCE_SAME_TRACK_REQUIRED",409);
    const e=await latest(tx,sourceMasterId,targetMasterId);if(!e)return{current:null};const d=e.details as DigitalMasterEquivalenceDetails;
    return{current:{id:e.id,sourceMasterId:d.sourceMasterId,targetMasterId:d.targetMasterId,status:d.status,reviewedAt:e.createdAt.toISOString(),reviewerId:e.actorId}};
  });
}
export function digitalMasterEquivalenceInput(raw:unknown){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new DigitalError("INVALID_EQUIVALENCE");const v=raw as Record<string,unknown>;
  if(Object.keys(v).some(k=>!["trackId","sourceMasterId","targetMasterId","status","expectedReviewId","privateEvidenceReference","evidenceSha256","attested","reason","idempotencyKey"].includes(k)))throw new DigitalError("INVALID_EQUIVALENCE");
  for(const id of[v.trackId,v.sourceMasterId,v.targetMasterId,v.idempotencyKey])assertDigitalUuid(id);
  if(v.expectedReviewId!==null)assertDigitalUuid(v.expectedReviewId);
  if(v.sourceMasterId===v.targetMasterId||!["APPROVED","REVOKED"].includes(String(v.status))||typeof v.attested!=="boolean"
    ||typeof v.reason!=="string"||!v.reason.trim()||v.reason.length>500||/[\x00-\x1f]/.test(v.reason))throw new DigitalError("INVALID_EQUIVALENCE");
  const evidence=v.privateEvidenceReference===null?null:digitalRightsEvidenceReference(v.privateEvidenceReference),sha=v.evidenceSha256===null?null:digitalRightsEvidenceSha(v.evidenceSha256);
  if(v.status==="APPROVED"&&(!evidence||!sha||v.attested!==true))throw new DigitalError("EQUIVALENCE_EVIDENCE_REQUIRED",409);
  return{trackId:v.trackId as string,sourceMasterId:v.sourceMasterId as string,targetMasterId:v.targetMasterId as string,status:v.status as "APPROVED"|"REVOKED",
    expectedReviewId:v.expectedReviewId as string|null,privateEvidenceReference:evidence,evidenceSha256:sha,attested:v.attested,reason:v.reason.trim(),idempotencyKey:v.idempotencyKey as string};
}
export async function recordDigitalMasterEquivalence(actor:OrderActor,raw:unknown){local();const input=digitalMasterEquivalenceInput(raw);
  return prisma.$transaction(async tx=>{
    await admin(tx,actor.id);await assertDigitalDatabaseUtc(tx);await lock(tx,input.sourceMasterId,input.targetMasterId);
    const requestHash=billingSnapshotHash(input),externalKey=`master-equivalence:${input.idempotencyKey}`,duplicate=await tx.digitalEvent.findUnique({where:{externalKey}});
    if(duplicate){if(duplicate.actorId!==actor.id||(duplicate.details as {requestHash?:string}).requestHash!==requestHash)throw new DigitalError("IDEMPOTENCY_CONFLICT",409);return{equivalences:await list(tx,input.trackId),duplicate:true};}
    const previous=await latest(tx,input.sourceMasterId,input.targetMasterId);if((previous?.id??null)!==input.expectedReviewId)throw new DigitalError("EQUIVALENCE_REVIEW_CHANGED",409);
    const masters=await tx.digitalMaster.findMany({where:{id:{in:[input.sourceMasterId,input.targetMasterId]}},include}),source=masters.find(m=>m.id===input.sourceMasterId),target=masters.find(m=>m.id===input.targetMasterId);
    if(!source||!target||source.trackId!==input.trackId||target.trackId!==input.trackId)throw new DigitalError("EQUIVALENCE_SAME_TRACK_REQUIRED",409);
    const createdAt=new Date(Math.max(Date.now(),previous?previous.createdAt.getTime()+1:0));
    const proof={policy:DIGITAL_MASTER_EQUIVALENCE_POLICY,pairKey:`${source.id}:${target.id}`,trackId:input.trackId,sourceMasterId:source.id,targetMasterId:target.id,
      source:digitalEquivalentMasterBinding(source),target:digitalEquivalentMasterBinding(target),status:input.status,privateEvidenceReference:input.privateEvidenceReference,evidenceSha256:input.evidenceSha256,
      attested:input.attested,reason:input.reason,reviewedAt:createdAt.toISOString(),requestHash};
    await tx.digitalEvent.create({data:{actorId:actor.id,externalKey,kind:DIGITAL_MASTER_EQUIVALENCE_EVENT,createdAt,details:{...proof,recordHash:billingSnapshotHash({actorId:actor.id,...proof})}}});
    return{equivalences:await list(tx,input.trackId),duplicate:false};
  });
}
