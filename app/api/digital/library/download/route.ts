import { createDigitalDownload } from "@/lib/digital/library";
import { digitalBody,digitalJson,withDigitalApi } from "@/lib/digital/http";
import { DigitalError } from "@/lib/digital/domain";
import { DIGITAL_DOWNLOAD_TTL_MS } from "@/lib/digital/download-policy";
import { digitalAudioFormat } from "@/lib/digital/formats";
export const dynamic="force-dynamic";
export async function POST(request:Request){return withDigitalApi(request,async actor=>{const b=await digitalBody(request,["lineId","masterId","format"]);if(typeof b.lineId!=="string"||b.masterId!==null&&typeof b.masterId!=="string")throw new DigitalError("INVALID_DOWNLOAD");
  const t=await createDigitalDownload(actor.id,b.lineId,b.masterId as string|null,digitalAudioFormat(b.format??"WAV"));const response=digitalJson({url:t.url});response.cookies.set(`dcn_download_${t.ticketId}`,t.token,{httpOnly:true,sameSite:"strict",secure:new URL(request.url).protocol==="https:",maxAge:DIGITAL_DOWNLOAD_TTL_MS/1000,path:t.url});return response;});}
