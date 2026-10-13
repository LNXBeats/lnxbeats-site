import { NextRequest } from "next/server";
import { orderActorFromHeaders } from "@/lib/orders/request";
import { digitalDownloadResponse } from "@/lib/digital/library";
import { digitalHttpError,digitalRateLimit } from "@/lib/digital/http";
import { DigitalError,assertDigitalUuid } from "@/lib/digital/domain";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;assertDigitalUuid(id);const actor=await orderActorFromHeaders(request.headers);if(!actor)throw new DigitalError("NOT_FOUND",404);
  await digitalRateLimit(actor.id,"download",120);return await digitalDownloadResponse(actor.id,id,request.cookies.get(`dcn_download_${id}`)?.value??"",{method:request.method,range:request.headers.get("range"),ifRange:request.headers.get("if-range")});}catch(e){return digitalHttpError(e);}}
export const HEAD=GET;
