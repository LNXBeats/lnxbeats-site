import {digitalActor,digitalBody,digitalHttpError,digitalJson,digitalRateLimit} from "@/lib/digital/http";
import {recordDigitalFranceResidenceReviewV2} from "@/lib/digital/france-residence-v2-service";
export const dynamic="force-dynamic";
export async function POST(request:Request){try{const actor=await digitalActor(request,true);await digitalRateLimit(actor.id,"residence-review",20);
  const body=await digitalBody(request,["subjectUserId","declarationId","expectedReviewId","status","reviewSource","reason","attested","conflictResolved","privateReference","validDays","idempotencyKey"]);
  return digitalJson(await recordDigitalFranceResidenceReviewV2(actor,body));
}catch(e){return digitalHttpError(e);}}
