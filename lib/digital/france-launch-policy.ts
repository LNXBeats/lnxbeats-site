import "server-only";
import {createHash} from "node:crypto";
import {billingSnapshotHash} from "@/lib/billing/domain";
import {DigitalError,digitalUuid} from "./domain";
import type {DigitalCountryTaxRuleView} from "./jurisdictions";

/** Scope classifier, not a tax approval, address database or residence-proof collector. */
export const DIGITAL_FRANCE_LAUNCH_POLICY=Object.freeze({
  policy:"DCN-FR-METROPOLITAN-CORSICA-1",territory:"METROPOLITAN_CORSICA",countryCode:"FR",registrySubdivision:"FR-MET",
  postalAlgorithm:"ASCII_5_DIGITS_DEPARTMENTS_01_TO_95_INCLUDING_20",evidenceKind:"FR_RESIDENCE_REVIEWED",ordinaryPostalRoutingRequired:true,
  foreignTerritoriesExcluded:true,liveEnabled:false,
} as const);
export const DIGITAL_FRANCE_LAUNCH_POLICY_HASH=createHash("sha256").update(JSON.stringify(DIGITAL_FRANCE_LAUNCH_POLICY)).digest("hex");

export type DigitalFranceDeclaration={countryCode:string;postalCode:string;billingPostalCode:string;postalRouting?:"ORDINARY"|"CEDEX"|"UNKNOWN"};
export type DigitalFranceResidenceReview={
  eventId:string;eventKind:"FR_RESIDENCE_REVIEWED";subjectUserId:string;actorId:string;
  /** Loaded freshly from the server repository, never an actor copied from request JSON. */
  actor:{id:string;role:string;status:string;emailVerified:boolean};
  status:"VERIFIED"|"REVOKED"|"REVIEW";countryCode:string;postalCode:string;postalRouting:"ORDINARY"|"CEDEX"|"UNKNOWN";
  sourceKind:"INDEPENDENT_RESIDENCE_EVIDENCE";
  /** Private reference + digest only; no identity-document contents in order snapshots. */
  privateEvidenceReference:string;evidenceSha256:string;reviewedAt:string;expiresAt:string;createdAt:string;recordHash:string;
};
export type DigitalFranceResidenceSnapshot={
  policy:"DCN-FR-METROPOLITAN-CORSICA-1";policyHash:string;territory:"METROPOLITAN_CORSICA";subjectUserId:string;
  countryCode:"FR";residencePostalCode:string;billingPostalCode:string;postalRouting:"ORDINARY";reviewEventId:string;reviewRecordHash:string;reviewedAt:string;expiresAt:string;
};
export type DigitalFranceAssessment={
  status:"PREPARED"|"BLOCKED";code:string;paymentAllowed:false;residenceVerified:boolean;
  residenceEvidence:"MISSING"|"VERIFIED_SERVER_REVIEW"|"INVALID"|"REVOKED"|"REVIEW_REQUIRED";
  snapshot?:DigitalFranceResidenceSnapshot;
};

/** Latest append-only review by createdAt/id, loaded solely by authenticated subject ID.
 * A repository adapter must establish event origin and reload the current actor.
 * An API object with a correct hash is NOT equivalent to this repository lookup.
 */
export type DigitalFranceResidenceRepository=(subjectUserId:string)=>Promise<DigitalFranceResidenceReview|null>;
const assessment=(code:string,residenceEvidence:DigitalFranceAssessment["residenceEvidence"]="INVALID",status:DigitalFranceAssessment["status"]="BLOCKED"):DigitalFranceAssessment=>({status,code,paymentAllowed:false,residenceVerified:false,residenceEvidence});
const canonicalDate=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;

/** A five-digit mainland-looking code does not prove that it exists or is non-CEDEX. */
export function digitalFrancePostalScope(countryCode:unknown,postalCode:unknown){
  if(countryCode!=="FR"||typeof postalCode!=="string"||postalCode.length!==5||!/^\d{5}$/.test(postalCode))return null;
  const department=Number(postalCode.slice(0,2));
  return department>=1&&department<=95?{countryCode:"FR" as const,postalCode,territory:"METROPOLITAN_CORSICA" as const,area:department===20?"CORSICA" as const:"MAINLAND" as const}:null;
}

/** Parse only declarative routing fields. Verification/approval fields are forbidden. */
export function parseDigitalFranceDeclaration(value:unknown):DigitalFranceDeclaration{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new DigitalError("FRANCE_TERRITORY_DECLARATION_INVALID",409);
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!["countryCode","postalCode","billingPostalCode","postalRouting"].includes(k))||!digitalFrancePostalScope(v.countryCode,v.postalCode)
    ||!digitalFrancePostalScope(v.countryCode,v.billingPostalCode)
    ||v.postalRouting!==undefined&&!["ORDINARY","CEDEX","UNKNOWN"].includes(String(v.postalRouting)))throw new DigitalError("FRANCE_TERRITORY_DECLARATION_INVALID",409);
  if(v.postalRouting==="CEDEX")throw new DigitalError("FRANCE_CEDEX_REQUIRES_REVIEW",409);
  return{countryCode:"FR",postalCode:v.postalCode as string,billingPostalCode:v.billingPostalCode as string,...(v.postalRouting!==undefined?{postalRouting:v.postalRouting as DigitalFranceDeclaration["postalRouting"]}:{})};
}

/** Hash seals immutable review fields. Provenance still comes from the repository,
 * not from this public hash, the requester, an IP, nationality or card country.
 */
export function digitalFranceResidenceReviewHash(review:Omit<DigitalFranceResidenceReview,"recordHash">){
  return billingSnapshotHash({eventId:review.eventId,eventKind:review.eventKind,subjectUserId:review.subjectUserId,actorId:review.actorId,status:review.status,
    countryCode:review.countryCode,postalCode:review.postalCode,postalRouting:review.postalRouting,sourceKind:review.sourceKind,
    privateEvidenceReference:review.privateEvidenceReference,evidenceSha256:review.evidenceSha256,reviewedAt:review.reviewedAt,expiresAt:review.expiresAt,createdAt:review.createdAt});
}

/** Pure evaluation of a SERVER-loaded review. Never feed browser JSON as review. */
export function evaluateDigitalFranceLaunch(declaration:unknown,subjectUserId:string,review:DigitalFranceResidenceReview|null,now=new Date()):DigitalFranceAssessment{
  if(!digitalUuid(subjectUserId)||!Number.isFinite(now.getTime()))return assessment("FRANCE_TERRITORY_CONTEXT_INVALID");
  let declared:DigitalFranceDeclaration;
  try{declared=parseDigitalFranceDeclaration(declaration);}catch(e){return assessment(e instanceof DigitalError?e.code:"FRANCE_TERRITORY_DECLARATION_INVALID");}
  if(!review)return assessment("FRANCE_INDEPENDENT_RESIDENCE_PROOF_REQUIRED","MISSING","PREPARED");
  if(review.eventKind!=="FR_RESIDENCE_REVIEWED"||!digitalUuid(review.eventId)||!digitalUuid(review.actorId)||review.subjectUserId!==subjectUserId
    ||review.actor?.id!==review.actorId||review.actor.role!=="ADMIN"||review.actor.status!=="ACTIVE"||review.actor.emailVerified!==true
    ||review.sourceKind!=="INDEPENDENT_RESIDENCE_EVIDENCE")return assessment("FRANCE_RESIDENCE_REVIEW_PROVENANCE_INVALID");
  if(!["VERIFIED","REVOKED","REVIEW"].includes(review.status))return assessment("FRANCE_RESIDENCE_REVIEW_INVALID");
  if(typeof review.privateEvidenceReference!=="string"||/\s/.test(review.privateEvidenceReference)||!/^private:[A-Za-z0-9][A-Za-z0-9/_:.-]{0,254}$/.test(review.privateEvidenceReference)
    ||typeof review.evidenceSha256!=="string"||review.evidenceSha256.length!==64||!/^[a-f0-9]{64}$/.test(review.evidenceSha256)
    ||typeof review.recordHash!=="string"||review.recordHash.length!==64||!/^[a-f0-9]{64}$/.test(review.recordHash)||digitalFranceResidenceReviewHash(review)!==review.recordHash)return assessment("FRANCE_RESIDENCE_REVIEW_INTEGRITY_INVALID");
  if(review.status==="REVOKED")return assessment("FRANCE_RESIDENCE_REVIEW_REVOKED","REVOKED");
  if(review.status!=="VERIFIED")return assessment("FRANCE_RESIDENCE_REVIEW_REQUIRED","REVIEW_REQUIRED");
  if(!canonicalDate(review.reviewedAt)||!canonicalDate(review.createdAt)||!canonicalDate(review.expiresAt)
    ||Date.parse(review.reviewedAt)>Date.parse(review.createdAt)||Date.parse(review.createdAt)>now.getTime()
    ||Date.parse(review.expiresAt)<=Date.parse(review.createdAt)||Date.parse(review.expiresAt)<=now.getTime())return assessment("FRANCE_RESIDENCE_REVIEW_EXPIRED_OR_INVALID");
  if(review.countryCode!==declared.countryCode||review.postalCode!==declared.postalCode||review.postalRouting!=="ORDINARY"
    ||!digitalFrancePostalScope(review.countryCode,review.postalCode))return assessment("FRANCE_RESIDENCE_EVIDENCE_CONFLICT");
  return{status:"PREPARED",code:"FRANCE_RESIDENCE_REVIEW_VERIFIED_LAUNCH_STILL_CLOSED",residenceEvidence:"VERIFIED_SERVER_REVIEW",residenceVerified:true,paymentAllowed:false,
    snapshot:{policy:DIGITAL_FRANCE_LAUNCH_POLICY.policy,policyHash:DIGITAL_FRANCE_LAUNCH_POLICY_HASH,territory:"METROPOLITAN_CORSICA",subjectUserId,countryCode:"FR",residencePostalCode:declared.postalCode,billingPostalCode:declared.billingPostalCode,
      postalRouting:"ORDINARY",reviewEventId:review.eventId,reviewRecordHash:review.recordHash,reviewedAt:review.reviewedAt,expiresAt:review.expiresAt}};
}

/** Database provenance boundary. No network, credential, lookup or write is performed here. */
export async function loadDigitalFranceLaunchAssessment(declaration:unknown,subjectUserId:string,loadReview:DigitalFranceResidenceRepository,now=new Date()){
  const prepared=evaluateDigitalFranceLaunch(declaration,subjectUserId,null,now);
  if(prepared.status!=="PREPARED")return prepared;
  let review:DigitalFranceResidenceReview|null;
  try{review=await loadReview(subjectUserId);}catch{return assessment("FRANCE_RESIDENCE_REPOSITORY_UNAVAILABLE");}
  return evaluateDigitalFranceLaunch(declaration,subjectUserId,review,now);
}

/** Necessary residence gate, not sufficient legal/fiscal/payment approval. */
export function assertDigitalFranceResidencePrepared(value:DigitalFranceAssessment){
  if(value.status!=="PREPARED"||value.residenceVerified!==true||value.residenceEvidence!=="VERIFIED_SERVER_REVIEW"||!value.snapshot)throw new DigitalError(value.code,409);
  return value.snapshot;
}
export function revalidateDigitalFranceResidenceSnapshot(snapshot:DigitalFranceResidenceSnapshot,current:DigitalFranceAssessment){
  const fresh=assertDigitalFranceResidencePrepared(current);
  if(!snapshot||billingSnapshotHash(snapshot)!==billingSnapshotHash(fresh))throw new DigitalError("FRANCE_RESIDENCE_PROOF_CHANGED_REQUIRES_REVIEW",409);
  return fresh;
}

/** A planning value only. FR-MET is an internal registry slot, not an ISO subdivision.
 * Do not INSERT this example or infer a tax rate/approval from it.
 */
export const DIGITAL_FRANCE_LAUNCH_DRAFT_RULE=Object.freeze({
  id:"00000000-0000-4000-8000-00000000f001",countryCode:"FR",subdivisionCode:"FR-MET",version:1,customerType:"B2C",decision:"REVIEW",status:"DRAFT",approvalScope:"NONE",
  termsVersion:null,languageCode:"fr",fiscalApproved:false,legalApproved:false,paymentApproved:false,reviewedBy:null,reviewedAt:null,validFrom:null,expiresAt:null,evidenceReference:null,evidenceHash:null,taxRule:null,
  notes:JSON.stringify({territory:"METROPOLITAN_CORSICA",policy:DIGITAL_FRANCE_LAUNCH_POLICY.policy,policyHash:DIGITAL_FRANCE_LAUNCH_POLICY_HASH,
    futureBinding:"jurisdictionSnapshot.franceResidence: subjectUserId, postalCode, reviewEventId, reviewRecordHash, reviewedAt, expiresAt",state:"PREPARED_NOT_APPROVED_NO_LIVE"}),
} satisfies DigitalCountryTaxRuleView&{notes:string});
