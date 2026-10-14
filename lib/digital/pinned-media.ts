import "server-only";
import type {Prisma} from "@/generated/prisma/client";
import {DigitalError,type DigitalSelection} from "./domain";
import {assertDigitalPinnedMedia} from "./pinned-media-policy";
export async function verifyDigitalPinnedMedia(tx:Prisma.TransactionClient,lines:Array<{trackSnapshot:unknown}>){
  const tracks=lines.flatMap(l=>l.trackSnapshot as DigitalSelection["tracks"]);
  if(!tracks.length)throw new DigitalError("ACQUIRED_MEDIA_REQUIRES_REVIEW",409);
  const masters=await tx.digitalMaster.findMany({where:{id:{in:tracks.map(t=>t.masterId)}},include:{masterAsset:true,mp3Asset:true,track:{include:{project:{select:{status:true,publicVisible:true}}}}}});
  assertDigitalPinnedMedia(tracks,masters);
}
