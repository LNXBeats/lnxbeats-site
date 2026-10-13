import { prisma } from "@/lib/prisma";
import { catalogAudioResponse } from "@/lib/catalog/audio-response";
import { digitalEnabled,assertDigitalUuid } from "@/lib/digital/domain";
export const dynamic="force-dynamic";
async function response(request:Request,id:string,head=false){try{if(!digitalEnabled())return new Response(null,{status:404});assertDigitalUuid(id);
  const m=await prisma.digitalMaster.findFirst({where:{previewAssetId:id,status:"READY",previewDurationMs:{lte:60000},track:{status:"RELEASED",project:{publicVisible:true,status:"PUBLISHED"}},previewAsset:{visibility:"PUBLIC",rightsStatus:"CLEARED"}},include:{previewAsset:true}});
  if(!m?.previewAsset)return new Response(null,{status:404});return catalogAudioResponse(request,m.previewAsset,"public, max-age=300",head);}catch{return new Response(null,{status:404});}}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return response(request,(await params).id);}
export async function HEAD(request:Request,{params}:{params:Promise<{id:string}>}){return response(request,(await params).id,true);}
