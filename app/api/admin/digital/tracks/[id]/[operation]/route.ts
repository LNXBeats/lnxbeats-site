import { digitalActor,digitalBody,digitalHttpError,digitalJson,digitalRateLimit } from "@/lib/digital/http";
import { initDigitalUpload,digitalPartUrl,digitalUploadStatus,completeDigitalUpload,abortDigitalUpload } from "@/lib/digital/upload";
import { DigitalError } from "@/lib/digital/domain";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{id:string;operation:string}>}){try{const actor=await digitalActor(request,true);const{id,operation}=await params;
  const limits:Record<string,number>={init:10,"part-url":180,status:120,complete:20,abort:20};
  if(!Object.hasOwn(limits,operation))throw new DigitalError("NOT_FOUND",404);
  await digitalRateLimit(actor.id,`upload-${operation}`,limits[operation]);
  if(operation==="init")return digitalJson(await initDigitalUpload(actor,id,await digitalBody(request,["filename","mimeType","sizeBytes","expectedVersion","previewStartMs","replaceConfirmed"])));
  const b=await digitalBody(request,operation==="part-url"?["sessionToken","partNumber"]:["sessionToken"]);if(typeof b.sessionToken!=="string")throw new DigitalError("INVALID_UPLOAD");
  if(operation==="part-url")return digitalJson(await digitalPartUrl(actor,id,b.sessionToken,Number(b.partNumber)));
  if(operation==="status")return digitalJson(await digitalUploadStatus(actor,id,b.sessionToken));
  if(operation==="complete")return digitalJson(await completeDigitalUpload(actor,id,b.sessionToken));
  if(operation==="abort")return digitalJson(await abortDigitalUpload(actor,id,b.sessionToken));throw new DigitalError("NOT_FOUND",404);
}catch(e){return digitalHttpError(e);}}
