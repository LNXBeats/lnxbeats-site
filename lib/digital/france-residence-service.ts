import "server-only";
import type {Prisma} from "@/generated/prisma/client";
import {DIGITAL_FRANCE_LAUNCH_POLICY,loadDigitalFranceLaunchAssessment,type DigitalFranceResidenceReview} from "./france-launch-policy";

type Repository=Pick<Prisma.TransactionClient,"digitalEvent"|"user">;
/** Read only: no browser proof, approval endpoint, KYC collection or inferred PSP address.
 * The review must already have been recorded by an explicitly authorised server
 * review workflow after examining independent evidence. None is issued by this lot.
 */
export async function loadDigitalFranceResidenceReview(subjectUserId:string,db:Repository):Promise<DigitalFranceResidenceReview|null>{
  const event=await db.digitalEvent.findFirst({where:{kind:DIGITAL_FRANCE_LAUNCH_POLICY.evidenceKind,details:{path:["subjectUserId"],equals:subjectUserId}},
    orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true,actorId:true,kind:true,details:true,createdAt:true}});
  if(!event||!event.actorId||!event.details||typeof event.details!=="object"||Array.isArray(event.details))return null;
  const actor=await db.user.findUnique({where:{id:event.actorId},select:{id:true,role:true,status:true,emailVerified:true}});
  if(!actor)return null;
  const d=event.details as Record<string,unknown>,text=(key:string)=>typeof d[key]==="string"?d[key] as string:"";
  // actor, event identity and creation timestamp are loaded, never taken from JSON.
  return{eventId:event.id,eventKind:event.kind as "FR_RESIDENCE_REVIEWED",subjectUserId:text("subjectUserId"),actorId:event.actorId,actor,
    status:text("status") as DigitalFranceResidenceReview["status"],countryCode:text("countryCode"),postalCode:text("postalCode"),
    postalRouting:text("postalRouting") as DigitalFranceResidenceReview["postalRouting"],sourceKind:text("sourceKind") as DigitalFranceResidenceReview["sourceKind"],
    privateEvidenceReference:text("privateEvidenceReference"),evidenceSha256:text("evidenceSha256"),reviewedAt:text("reviewedAt"),expiresAt:text("expiresAt"),
    createdAt:event.createdAt.toISOString(),recordHash:text("recordHash")};
}
export function assessDigitalFranceResidence(declaration:unknown,subjectUserId:string,db:Repository){
  return loadDigitalFranceLaunchAssessment(declaration,subjectUserId,id=>loadDigitalFranceResidenceReview(id,db));
}
