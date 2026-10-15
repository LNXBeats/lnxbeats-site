import "server-only";
import {billingSnapshotHash} from "@/lib/billing/domain";
import {DigitalError,digitalUuid} from "./domain";
import {digitalFrancePostalScope} from "./france-launch-policy";

export const DIGITAL_FRANCE_RESIDENCE_V2_POLICY="DCN-FR-RESIDENCE-2" as const;
export const DIGITAL_FRANCE_RESIDENCE_DECLARATION_EVENT="FR_RESIDENCE_DECLARED_V2";
export const DIGITAL_FRANCE_RESIDENCE_REVIEW_EVENT="FR_RESIDENCE_REVIEWED_V2";
export const DIGITAL_FRANCE_RESIDENCE_V2_POLICY_HASH=billingSnapshotHash({policy:DIGITAL_FRANCE_RESIDENCE_V2_POLICY,countryCode:"FR",territory:"METROPOLITAN_CORSICA",
  address:"MINIMAL_LINE1_POSTCODE_CITY",basis:"MANUAL_PROPORTIONATE_REVIEW_NOT_SYSTEMATIC_KYC",billing:"LOCAL_FROZEN_DECLARATIVE_CONTEXT_NOT_PSP_PROOF"});
export const DIGITAL_FRANCE_RESIDENCE_ATTESTATION="J’ai examiné de manière proportionnée l’adresse déclarée et les informations de facturation réellement disponibles pour ce compte. J’ai traité les incohérences connues, vérifié le périmètre France métropolitaine/Corse et le routage hors CEDEX. Je ne présente ni deux déclarations, ni une IP, une nationalité ou le pays d’une carte comme une preuve indépendante. Aucune pièce d’identité systématique n’est requise.";
export type DigitalFranceMinimalAddress={countryCode:"FR";line1:string;postalCode:string;city:string};
export type DigitalFranceResidenceDeclarationV2={eventId:string;subjectUserId:string;actorId:string;createdAt:string;policy:typeof DIGITAL_FRANCE_RESIDENCE_V2_POLICY;
  address:DigitalFranceMinimalAddress;addressHash:string;billingPostalCode:string;residenceConfirmed:true;requestHash:string;recordHash:string};
export type DigitalFranceBillingDocument={id:string;snapshotHash:string;countryCode:string|null;postalCode:string|null;addressAvailable:boolean};
export type DigitalFranceBillingContext={source:"LOCAL_FROZEN_INVOICE_DECLARATION";status:"ABSENT"|"DECLARED_LOCAL_CONSISTENT"|"CONFLICT";documents:DigitalFranceBillingDocument[];hash:string};
export type DigitalFranceResidenceReviewV2={eventId:string;subjectUserId:string;actorId:string;createdAt:string;policy:typeof DIGITAL_FRANCE_RESIDENCE_V2_POLICY;
  declarationId:string;addressHash:string;billingPostalCode:string;billingContext:DigitalFranceBillingContext;status:"VERIFIED"|"REVIEW"|"REVOKED";
  basis:"MANUAL_PROPORTIONATE_REVIEW";reviewSource:"CUSTOMER_CONTACT_AND_CONTEXT"|"EXISTING_BUSINESS_RECORDS"|"PROPORTIONATE_EXTERNAL_REVIEW";
  reason:string;attestation:string|null;conflictResolved:boolean;privateReference:string|null;reviewedAt:string;expiresAt:string;requestHash:string;recordHash:string;
  actor:{id:string;role:string;status:string;emailVerified:boolean}};
export type DigitalFranceResidenceSnapshotV2={policy:typeof DIGITAL_FRANCE_RESIDENCE_V2_POLICY;policyHash:string;territory:"METROPOLITAN_CORSICA";subjectUserId:string;countryCode:"FR";
  residenceDeclarationId:string;addressHash:string;residencePostalCode:string;billingPostalCode:string;billingContextHash:string;billingDocumentIds:string[];
  reviewEventId:string;reviewRecordHash:string;reviewedAt:string;expiresAt:string};
export type DigitalFranceResidenceAssessmentV2={status:"PREPARED"|"BLOCKED";code:string;residenceVerified:boolean;paymentAllowed:false;billingContextStatus:DigitalFranceBillingContext["status"]|null;snapshot?:DigitalFranceResidenceSnapshotV2};
export const digitalFranceResidenceV2Result=(code:string,status:DigitalFranceResidenceAssessmentV2["status"]="BLOCKED",billingContextStatus:DigitalFranceResidenceAssessmentV2["billingContextStatus"]=null):DigitalFranceResidenceAssessmentV2=>({status,code,residenceVerified:false,paymentAllowed:false,billingContextStatus});
export const digitalFranceResidenceHash=(v:unknown)=>billingSnapshotHash(v);
export const digitalFranceResidenceDate=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export const digitalFranceResidenceSha=(v:unknown):v is string=>typeof v==="string"&&v.length===64&&/^[a-f0-9]{64}$/.test(v);
function addressText(v:unknown,max:number){
  if(typeof v!=="string"||/[\u0000-\u001f\u007f<>]/.test(v))throw new DigitalError("FRANCE_RESIDENCE_ADDRESS_INVALID",409);
  const text=v.normalize("NFC").trim().replace(/[ \u00a0\u202f]+/g," ");
  if(!text||text.length>max||/\bCEDEX\b/i.test(text)||/https?:\/\/|@/.test(text))throw new DigitalError("FRANCE_RESIDENCE_ADDRESS_INVALID",409);
  return text;
}
export function normalizeDigitalFranceResidenceAddress(value:unknown):DigitalFranceMinimalAddress{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new DigitalError("FRANCE_RESIDENCE_ADDRESS_INVALID",409);
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!["line1","postalCode","city","countryCode"].includes(k))||!digitalFrancePostalScope(v.countryCode,v.postalCode))throw new DigitalError("FRANCE_RESIDENCE_ADDRESS_INVALID",409);
  const line1=addressText(v.line1,160),city=addressText(v.city,100);if(line1.length<4)throw new DigitalError("FRANCE_RESIDENCE_ADDRESS_INVALID",409);
  return{countryCode:"FR",line1,postalCode:v.postalCode as string,city};
}
export function digitalFranceResidenceDeclarationHash(declaration:Omit<DigitalFranceResidenceDeclarationV2,"recordHash">){return digitalFranceResidenceHash(declaration);}
export function digitalFranceResidenceReviewV2Hash(review:Omit<DigitalFranceResidenceReviewV2,"recordHash"|"actor">){return digitalFranceResidenceHash(review);}
export function digitalFranceBillingContext(documents:DigitalFranceBillingDocument[],billingPostalCode:string):DigitalFranceBillingContext{
  if(!digitalFrancePostalScope("FR",billingPostalCode)||!Array.isArray(documents)||documents.length>10||new Set(documents.map(d=>d?.id)).size!==documents.length
    ||documents.some(d=>!d||!digitalUuid(d.id)||!digitalFranceResidenceSha(d.snapshotHash)||typeof d.addressAvailable!=="boolean"
      ||d.countryCode!==null&&typeof d.countryCode!=="string"||d.postalCode!==null&&typeof d.postalCode!=="string"))throw new DigitalError("FRANCE_BILLING_CONTEXT_INVALID",409);
  // The most recent available address is context, not a residence certificate.
  const latest=documents.find(d=>d.addressAvailable),status:DigitalFranceBillingContext["status"]=!latest?"ABSENT":
    latest.countryCode==="FR"&&latest.postalCode===billingPostalCode&&digitalFrancePostalScope(latest.countryCode,latest.postalCode)?"DECLARED_LOCAL_CONSISTENT":"CONFLICT";
  const source="LOCAL_FROZEN_INVOICE_DECLARATION" as const;
  return{source,status,documents,hash:digitalFranceResidenceHash({source,status,documents})};
}
/** The declaration and review must originate from the authenticated server repository.
 * No callback to a PSP or automatic residence/KYC assertion occurs here.
 */
export function evaluateDigitalFranceResidenceV2(input:{residenceDeclarationId:string;addressHash:string;billingPostalCode:string},subjectUserId:string,
  declaration:DigitalFranceResidenceDeclarationV2|null,review:DigitalFranceResidenceReviewV2|null,billing:DigitalFranceBillingContext,now=new Date()):DigitalFranceResidenceAssessmentV2{
  const result=(code:string,status:DigitalFranceResidenceAssessmentV2["status"]="BLOCKED")=>digitalFranceResidenceV2Result(code,status,billing?.status??null);
  if(!digitalUuid(subjectUserId)||!digitalUuid(input.residenceDeclarationId)||!digitalFranceResidenceSha(input.addressHash)||!digitalFrancePostalScope("FR",input.billingPostalCode)||!Number.isFinite(now.getTime()))return result("FRANCE_RESIDENCE_BINDING_INVALID");
  if(!declaration||declaration.eventId!==input.residenceDeclarationId||declaration.addressHash!==input.addressHash||declaration.billingPostalCode!==input.billingPostalCode||declaration.subjectUserId!==subjectUserId||declaration.actorId!==subjectUserId
    ||declaration.policy!==DIGITAL_FRANCE_RESIDENCE_V2_POLICY||declaration.residenceConfirmed!==true)return result("FRANCE_RESIDENCE_DECLARATION_CHANGED");
  let address:DigitalFranceMinimalAddress;
  try{address=normalizeDigitalFranceResidenceAddress(declaration.address);}catch{return result("FRANCE_RESIDENCE_ADDRESS_INVALID");}
  const {recordHash:declarationHash,...declarationProof}=declaration;
  if(!digitalFranceResidenceDate(declaration.createdAt)||Date.parse(declaration.createdAt)>now.getTime()||digitalFranceResidenceHash(address)!==declaration.addressHash
    ||!digitalFranceResidenceSha(declaration.requestHash)||declarationHash!==digitalFranceResidenceDeclarationHash(declarationProof))return result("FRANCE_RESIDENCE_DECLARATION_INTEGRITY_INVALID");
  try{const context=digitalFranceBillingContext(billing.documents,input.billingPostalCode);if(context.hash!==billing.hash||context.status!==billing.status||context.source!==billing.source)return result("FRANCE_BILLING_CONTEXT_INVALID");}catch{return result("FRANCE_BILLING_CONTEXT_INVALID");}
  if(!review)return result("FRANCE_RESIDENCE_MANUAL_REVIEW_REQUIRED","PREPARED");
  try{const context=digitalFranceBillingContext(review.billingContext.documents,input.billingPostalCode);if(context.hash!==review.billingContext.hash||context.status!==review.billingContext.status||context.source!==review.billingContext.source)return result("FRANCE_RESIDENCE_REVIEW_INTEGRITY_INVALID");}catch{return result("FRANCE_RESIDENCE_REVIEW_INTEGRITY_INVALID");}
  if(review.policy!==DIGITAL_FRANCE_RESIDENCE_V2_POLICY||review.subjectUserId!==subjectUserId||review.declarationId!==declaration.eventId||review.addressHash!==declaration.addressHash
    ||review.billingPostalCode!==input.billingPostalCode||review.billingContext.hash!==billing.hash)return result("FRANCE_RESIDENCE_REVIEW_CHANGED");
  if(!digitalUuid(review.eventId)||!digitalUuid(review.actorId)||review.actor?.id!==review.actorId||review.actor.role!=="ADMIN"||review.actor.status!=="ACTIVE"||review.actor.emailVerified!==true)return result("FRANCE_RESIDENCE_REVIEW_PROVENANCE_INVALID");
  const {recordHash,actor:_,...proof}=review;void _;
  if(recordHash!==digitalFranceResidenceReviewV2Hash(proof)||!digitalFranceResidenceSha(review.requestHash)||review.basis!=="MANUAL_PROPORTIONATE_REVIEW"
    ||!["CUSTOMER_CONTACT_AND_CONTEXT","EXISTING_BUSINESS_RECORDS","PROPORTIONATE_EXTERNAL_REVIEW"].includes(review.reviewSource))return result("FRANCE_RESIDENCE_REVIEW_INTEGRITY_INVALID");
  if(review.status==="REVOKED")return result("FRANCE_RESIDENCE_REVIEW_REVOKED");if(review.status!=="VERIFIED")return result("FRANCE_RESIDENCE_MANUAL_REVIEW_REQUIRED");
  if(!digitalFranceResidenceDate(review.reviewedAt)||!digitalFranceResidenceDate(review.createdAt)||!digitalFranceResidenceDate(review.expiresAt)
    ||review.reviewedAt!==review.createdAt||Date.parse(review.createdAt)<Date.parse(declaration.createdAt)||Date.parse(review.createdAt)>now.getTime()
    ||Date.parse(review.expiresAt)<=now.getTime()||Date.parse(review.expiresAt)<=Date.parse(review.createdAt))return result("FRANCE_RESIDENCE_REVIEW_EXPIRED_OR_INVALID");
  if(review.attestation!==DIGITAL_FRANCE_RESIDENCE_ATTESTATION||typeof review.reason!=="string"||review.reason.trim().length<10||review.reason.length>500||/[\u0000-\u001f\u007f]/.test(review.reason)
    ||billing.status==="CONFLICT"&&review.conflictResolved!==true)return result("FRANCE_RESIDENCE_BILLING_CONFLICT_REVIEW_REQUIRED");
  return{status:"PREPARED",code:"FRANCE_RESIDENCE_REVIEWED_LAUNCH_STILL_CLOSED",residenceVerified:true,paymentAllowed:false,billingContextStatus:billing.status,
    snapshot:{policy:DIGITAL_FRANCE_RESIDENCE_V2_POLICY,policyHash:DIGITAL_FRANCE_RESIDENCE_V2_POLICY_HASH,territory:"METROPOLITAN_CORSICA",subjectUserId,countryCode:"FR",
      residenceDeclarationId:declaration.eventId,addressHash:declaration.addressHash,residencePostalCode:address.postalCode,billingPostalCode:input.billingPostalCode,
      billingContextHash:billing.hash,billingDocumentIds:billing.documents.map(d=>d.id),reviewEventId:review.eventId,reviewRecordHash:review.recordHash,reviewedAt:review.reviewedAt,expiresAt:review.expiresAt}};
}
export function assertDigitalFranceResidenceV2Prepared(value:DigitalFranceResidenceAssessmentV2){if(value.status!=="PREPARED"||!value.residenceVerified||value.snapshot?.policy!==DIGITAL_FRANCE_RESIDENCE_V2_POLICY||value.snapshot.policyHash!==DIGITAL_FRANCE_RESIDENCE_V2_POLICY_HASH)throw new DigitalError(value.code,409);return value.snapshot;}
