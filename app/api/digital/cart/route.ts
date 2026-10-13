import { prisma } from "@/lib/prisma";
import { syncCart } from "@/lib/digital/catalog";
import { digitalBody,digitalJson,withDigitalApi } from "@/lib/digital/http";
import { DigitalError } from "@/lib/digital/domain";
export const dynamic="force-dynamic";
export async function POST(request:Request){return withDigitalApi(request,async actor=>{const b=await digitalBody(request,["offerIds","revision"]);
  if(!Array.isArray(b.offerIds)||b.offerIds.some(v=>typeof v!=="string")||!Number.isSafeInteger(b.revision))throw new DigitalError("INVALID_CART");
  return digitalJson(await syncCart(actor.id,b.offerIds,Number(b.revision)));});}
export async function GET(request:Request){return withDigitalApi(request,async actor=>{const cart=await prisma.digitalCart.findUnique({where:{userId:actor.id},select:{revision:true,lines:{where:{removed:false},select:{offerId:true}}}});return digitalJson({revision:cart?.revision??0,offerIds:cart?.lines.map(l=>l.offerId)??[]});});}
