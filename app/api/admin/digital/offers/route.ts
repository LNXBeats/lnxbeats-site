import { saveOffer } from "@/lib/digital/catalog";
import { digitalBody,digitalJson,withDigitalApi } from "@/lib/digital/http";
import { DigitalError } from "@/lib/digital/domain";
export const dynamic="force-dynamic";
export async function POST(request:Request){return withDigitalApi(request,async actor=>{const b=await digitalBody(request,["projectId","trackId","priceCents","active","rightsConfirmed","expectedVersion","distribution"]);
  if(typeof b.projectId!=="string"||b.trackId!==null&&typeof b.trackId!=="string"||typeof b.distribution!=="string"||!Number.isSafeInteger(b.expectedVersion))throw new DigitalError("INVALID_OFFER");
  return digitalJson({id:await saveOffer(actor,{projectId:b.projectId,trackId:b.trackId as string|null,priceCents:b.priceCents===null?null:Number(b.priceCents),active:b.active===true,rightsConfirmed:b.rightsConfirmed===true,expectedVersion:Number(b.expectedVersion),distribution:b.distribution})});},true);}
