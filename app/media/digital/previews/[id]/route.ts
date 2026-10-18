import { prisma } from "@/lib/prisma";
import { catalogAudioResponse } from "@/lib/catalog/audio-response";
import { digitalEnabled,assertDigitalUuid } from "@/lib/digital/domain";
import { digitalPublicPreviewAllowed } from "@/lib/digital/public-preview";
import { loadDiscographyPreparation } from "@/lib/digital/discography-preparation";
import { discographyPreparationEnabled } from "@/lib/digital/discography-preparation-policy";
export const dynamic="force-dynamic";
async function response(request:Request,id:string,head=false){try{if(!digitalEnabled())return new Response(null,{status:404});assertDigitalUuid(id);
  const presentation = discographyPreparationEnabled() ? await loadDiscographyPreparation() : null;
  const asset=await prisma.$transaction(async db=>{
    const m=await db.digitalMaster.findFirst({where:{previewAssetId:id,status:"READY",previewDurationMs:{lte:60000},track:{status:"RELEASED",project:{publicVisible:true,status:"PUBLISHED"}},previewAsset:{visibility:"PUBLIC",rightsStatus:"CLEARED"}},include:{masterAsset:true,mp3Asset:true,previewAsset:true}});
    if (presentation && (!m || !presentation.some(p => p.metadataPublicAllowed && p.tracks.some(t => t.masterId === m.id && t.publicPreviewAllowed)))) return null;
    return await digitalPublicPreviewAllowed(db,m)?m!.previewAsset:null;
  });
  if(!asset)return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
  // Recheck approval on every request, including HEAD/Range/conditional reads;
  // a browser cache must not mask a subsequent rights or artistic revocation.
  return catalogAudioResponse(request,asset,"no-store",head);}catch{return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});}}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return response(request,(await params).id);}
export async function HEAD(request:Request,{params}:{params:Promise<{id:string}>}){return response(request,(await params).id,true);}
