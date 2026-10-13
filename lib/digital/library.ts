import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getMediaObject, safeContentDisposition } from "@/lib/media/storage";
import { DigitalError, assertDigitalUuid, requireDigitalEnvironment, type DigitalSelection } from "./domain";
import { digitalZipStream } from "./zip";
async function ownedLine(userId:string,id:string){assertDigitalUuid(id);
  const line = await prisma.digitalOrderLine.findFirst({
    where: { id, order: { userId, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } } },
    include: { entitlements: { where: { userId, status: "ACTIVE" }, include: {
      master: { include: { masterAsset: true, track: { select: { title: true, position: true } } } },
    } } },
  });
  if(!line||!line.entitlements.length)throw new DigitalError("NOT_FOUND",404);return line;
}
export async function library(userId:string){requireDigitalEnvironment();
  const rows=await prisma.digitalOrder.findMany({where:{userId},orderBy:{createdAt:"desc"},take:100,select:{id:true,status:true,totalCents:true,mode:true,createdAt:true,lines:{select:{id:true,title:true,scope:true,priceCents:true,trackSnapshot:true,entitlements:{select:{id:true,masterId:true,status:true,master:{select:{version:true,track:{select:{title:true}}}}}}}}}});
  return rows.map(o=>({...o,createdAt:o.createdAt.toISOString(),lines:o.lines.map(line=>{const snapshot=line.trackSnapshot as unknown as DigitalSelection["tracks"];
    return{...line,entitlements:line.entitlements.map(e=>({...e,master:{...e.master,track:{title:snapshot.find(t=>t.masterId===e.masterId)?.title??e.master.track.title}}}))};})}));
}
export async function createDigitalDownload(userId:string,lineId:string,masterId:string|null){requireDigitalEnvironment();const line=await ownedLine(userId,lineId);
  if(masterId&&!line.entitlements.some(e=>e.masterId===masterId))throw new DigitalError("NOT_FOUND",404);
  if(!masterId&&line.scope!=="ALBUM")throw new DigitalError("INVALID_DOWNLOAD");
  if(!masterId&&line.entitlements.length!==(line.trackSnapshot as unknown[]).length)throw new DigitalError("PARTIAL_ACCESS",409);
  const token=randomBytes(32).toString("hex");
  const ticket=await prisma.digitalDownloadTicket.create({data:{userId,lineId,masterId,tokenHash:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+120000)}});
  return {ticketId:ticket.id,token,url:`/api/digital/download/${ticket.id}`};
}
export async function digitalDownloadResponse(userId:string,id:string,token:string){requireDigitalEnvironment();assertDigitalUuid(id);
  if(!/^[a-f0-9]{64}$/.test(token))throw new DigitalError("NOT_FOUND",404);
  const hash=createHash("sha256").update(token).digest("hex");
  const ticket=await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-user:${userId}`})) IS NULL AS locked`;
    const t=await tx.digitalDownloadTicket.findFirst({where:{id,userId,tokenHash:hash,expiresAt:{gt:new Date()},usesLeft:{gt:0}}});if(!t)throw new DigitalError("NOT_FOUND",404);
    const owner=await tx.user.findUnique({where:{id:userId},select:{status:true,emailVerified:true}});if(owner?.status!=="ACTIVE"||!owner.emailVerified)throw new DigitalError("NOT_FOUND",404);
    const line=await tx.digitalOrderLine.findFirst({where:{id:t.lineId,order:{userId,status:{in:["PAID","PARTIALLY_REFUNDED"]}}},include:{entitlements:{where:{status:"ACTIVE",userId,...(t.masterId?{masterId:t.masterId}:{})}}}});
    if(!line||!line.entitlements.length||!t.masterId&&line.entitlements.length!==(line.trackSnapshot as unknown[]).length)throw new DigitalError("NOT_FOUND",404);
    await tx.digitalDownloadTicket.update({where:{id},data:{usesLeft:{decrement:1}}});
    await tx.digitalEvent.create({data:{orderId:line.orderId,actorId:userId,kind:"DOWNLOAD_AUTHORIZED",details:{ticketId:id,scope:t.masterId?"TRACK":"ALBUM"}}});return t;});
  const line=await ownedLine(userId,ticket.lineId);const selected=line.entitlements.filter(e=>!ticket.masterId||e.masterId===ticket.masterId);
  const headers={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
  if(ticket.masterId){const asset=selected[0]?.master.masterAsset;if(!asset||asset.visibility!=="PRIVATE")throw new DigitalError("NOT_FOUND",404);
    const obj=await getMediaObject(asset);if(obj.contentLength!==Number(asset.sizeBytes))throw new DigitalError("INTEGRITY",503);
    return new Response(obj.body,{headers:{...headers,"Content-Type":asset.mimeType,"Content-Length":String(obj.contentLength),"Content-Disposition":safeContentDisposition("attachment",asset.filename)}});}
  // Archive order and names come from the paid snapshot, not the current catalogue.
  const snapshot = line.trackSnapshot as unknown as DigitalSelection["tracks"];
  const entries=snapshot.map((track,i)=>{const e=selected.find(e=>e.masterId===track.masterId);if(!e)throw new DigitalError("INTEGRITY",503);
    const asset=e.master.masterAsset;if(asset.visibility!=="PRIVATE")throw new DigitalError("INTEGRITY",503);return{name:`${String(i+1).padStart(2,"0")}-${track.title}.${asset.filename.split(".").pop()}`,size:Number(asset.sizeBytes),
    open:async()=>{const o=await getMediaObject(asset);if(o.contentLength!==Number(asset.sizeBytes))throw new DigitalError("INTEGRITY",503);return o.body;}};});
  return new Response(digitalZipStream(entries),{headers:{...headers,"Content-Type":"application/zip","Content-Disposition":safeContentDisposition("attachment",`${line.title}.zip`)}});
}
