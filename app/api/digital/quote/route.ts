import { isAllowedOrderMutation, orderActorFromHeaders } from "@/lib/orders/request";
import { quote, publicQuote } from "@/lib/digital/catalog";
import { digitalBody,digitalJson,digitalHttpError,digitalRateLimit } from "@/lib/digital/http";
import { DigitalError,requireDigitalEnvironment } from "@/lib/digital/domain";
export const dynamic="force-dynamic";
export async function POST(request:Request){try{requireDigitalEnvironment();if(!isAllowedOrderMutation(request))throw new DigitalError("ORIGIN_REFUSED",403);
  await digitalRateLimit(request.headers.get("x-forwarded-for")??"anonymous","quote",60);const b=await digitalBody(request,["offerIds"]);
  if(!Array.isArray(b.offerIds)||b.offerIds.some(v=>typeof v!=="string"))throw new DigitalError("INVALID_CART");const actor=await orderActorFromHeaders(request.headers);
  return digitalJson(publicQuote(await quote(b.offerIds,actor?.id)));}catch(e){return digitalHttpError(e);}}
