import { digitalActor,digitalHttpError,digitalRateLimit } from "@/lib/digital/http";
import { writeDigitalLocalPart } from "@/lib/digital/upload";
export const dynamic="force-dynamic";
export async function PUT(request:Request,{params}:{params:Promise<{id:string;sessionId:string;partNumber:string}>}){try{const actor=await digitalActor(request,true);const{id,sessionId,partNumber}=await params;
  await digitalRateLimit(actor.id,"upload-local-part",180);
  const etag=await writeDigitalLocalPart(actor,id,request.headers.get("x-dcn-upload-token")??"",sessionId,Number(partNumber),request);return new Response(null,{headers:{ETag:etag,"Cache-Control":"no-store"}});
}catch(e){return digitalHttpError(e);}}
