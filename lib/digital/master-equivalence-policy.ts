import {billingSnapshotHash} from "@/lib/billing/domain";
import {DigitalError,assertDigitalUuid} from "./domain";
import {digitalRightsEvidenceReference,digitalRightsEvidenceSha} from "./rights-review-policy";

export const DIGITAL_MASTER_EQUIVALENCE_EVENT="DIGITAL_MASTER_EQUIVALENCE";
export const DIGITAL_MASTER_EQUIVALENCE_POLICY="DCN_DIRECTIONAL_COMPLETION_EQUIVALENCE_V1";
export type DigitalEquivalentMaster={id:string;trackId:string;version:number;status:string;masterAssetId:string;mp3AssetId:string|null;
  masterAsset:{id:string;checksumSha256:string|null};mp3Asset:{id:string;checksumSha256:string|null}|null};
export function digitalEquivalentMasterBinding(m:DigitalEquivalentMaster){
  for(const id of[m.id,m.trackId,m.masterAssetId])assertDigitalUuid(id);
  if(m.status!=="READY"||!Number.isSafeInteger(m.version)||m.version<1||m.masterAsset.id!==m.masterAssetId
    ||!/^[a-f0-9]{64}$/.test(m.masterAsset.checksumSha256??"")||m.mp3AssetId!==null&&(!m.mp3Asset||m.mp3Asset.id!==m.mp3AssetId||!/^[a-f0-9]{64}$/.test(m.mp3Asset.checksumSha256??"")))throw new DigitalError("EQUIVALENCE_MASTER_REQUIRES_REVIEW",409);
  return{masterId:m.id,trackId:m.trackId,version:m.version,wavAssetId:m.masterAssetId,wavSha256:m.masterAsset.checksumSha256,
    mp3AssetId:m.mp3AssetId,mp3Sha256:m.mp3Asset?.checksumSha256??null};
}
export type DigitalMasterEquivalenceProof={reviewId:string;sourceMasterId:string;targetMasterId:string;recordHash:string};
export type DigitalMasterEquivalenceEvent={id:string;actorId:string|null;kind:string;details:unknown;createdAt:Date};
export type DigitalMasterEquivalenceDetails={policy:string;pairKey:string;trackId:string;sourceMasterId:string;targetMasterId:string;
  source:ReturnType<typeof digitalEquivalentMasterBinding>;target:ReturnType<typeof digitalEquivalentMasterBinding>;status:"APPROVED"|"REVOKED";
  privateEvidenceReference:string|null;evidenceSha256:string|null;attested:boolean;reason:string;reviewedAt:string;requestHash:string;recordHash:string};
export function assertDigitalMasterEquivalence(source:DigitalEquivalentMaster,target:DigitalEquivalentMaster,event:DigitalMasterEquivalenceEvent|null,
  actor:{id:string;role:string;status:string;emailVerified:boolean}|null):DigitalMasterEquivalenceProof{
  const invalid=()=>{throw new DigitalError("COMPLETION_EQUIVALENCE_REQUIRES_REVIEW",409);};
  if(!event||event.kind!==DIGITAL_MASTER_EQUIVALENCE_EVENT||!event.actorId||!actor||actor.id!==event.actorId||actor.role!=="ADMIN"||actor.status!=="ACTIVE"||!actor.emailVerified)invalid();
  const details=event!.details as DigitalMasterEquivalenceDetails;
  if(!details||details.policy!==DIGITAL_MASTER_EQUIVALENCE_POLICY||details.status!=="APPROVED"||source.id===target.id||source.trackId!==target.trackId
    ||details.trackId!==source.trackId||details.sourceMasterId!==source.id||details.targetMasterId!==target.id||details.pairKey!==`${source.id}:${target.id}`
    ||details.attested!==true||typeof details.reason!=="string"||!details.reason.trim()||details.reviewedAt!==event!.createdAt.toISOString()
    ||!/^[a-f0-9]{64}$/.test(details.requestHash??""))invalid();
  const {recordHash,...proof}=details;
  if(recordHash!==billingSnapshotHash({actorId:event!.actorId,...proof})||billingSnapshotHash(details.source)!==billingSnapshotHash(digitalEquivalentMasterBinding(source))
    ||billingSnapshotHash(details.target)!==billingSnapshotHash(digitalEquivalentMasterBinding(target)))invalid();
  try{digitalRightsEvidenceReference(details.privateEvidenceReference);digitalRightsEvidenceSha(details.evidenceSha256);}catch{invalid();}
  return{reviewId:event!.id,sourceMasterId:source.id,targetMasterId:target.id,recordHash};
}
