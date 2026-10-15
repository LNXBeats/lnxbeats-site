import {digitalActor,digitalBody,digitalHttpError,digitalJson,digitalRateLimit} from "@/lib/digital/http";
import {getDigitalFranceResidenceV2,saveDigitalFranceResidenceDeclarationV2} from "@/lib/digital/france-residence-v2-service";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{const actor=await digitalActor(request);await digitalRateLimit(actor.id,"residence-read",30);return digitalJson(await getDigitalFranceResidenceV2(actor));}catch(e){return digitalHttpError(e);}}
export async function POST(request:Request){try{const actor=await digitalActor(request);await digitalRateLimit(actor.id,"residence-declaration",10);
  const body=await digitalBody(request,["address","billingPostalCode","residenceConfirmed","expectedDeclarationId","idempotencyKey"]);
  return digitalJson(await saveDigitalFranceResidenceDeclarationV2(actor,body));
}catch(e){return digitalHttpError(e);}}
