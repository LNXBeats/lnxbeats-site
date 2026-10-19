import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getMediaObject, headMediaObject, type MediaStorageReference } from "@/lib/media/storage";
import { DigitalError, assertDigitalUuid, requireDigitalEnvironment, type DigitalSelection } from "./domain";
import { ensureDigitalArchive } from "./archive-worker";
import { digitalAttachment, digitalByteRange, DIGITAL_DOWNLOAD_TTL_MS } from "./download-policy";
import { digitalLibraryPagination } from "./presentation";
import { acquiredAlbumFormats, acquiredDigitalFormats, acquiredDigitalAssetId, acquiredDigitalAsset, type DigitalAudioFormat, type DigitalAcquiredTrack } from "./formats";
import { DIGITAL_ACTIVE_RIGHTS_ORDER_STATES } from "./library-policy";
export async function ownedDigitalLine(userId:string,id:string){assertDigitalUuid(id);
  const line = await prisma.digitalOrderLine.findFirst({
    where: { id, order: { userId, mode: requireDigitalEnvironment(), status: { in: [...DIGITAL_ACTIVE_RIGHTS_ORDER_STATES] } } },
    include: { order:{include:{fulfillment:true}},entitlements: { where: { userId, status: "ACTIVE" }, include: {
      master: { include: { masterAsset: true, mp3Asset: true, track: { select: { title: true, position: true } } } },
    } } },
  });
  if(!line||!line.entitlements.length)throw new DigitalError("NOT_FOUND",404);
  if(line.order.contractSnapshot&&!line.order.fulfillment?.accessReadyAt)throw new DigitalError("CONTRACT_RECEIPT_REQUIRED",409);return line;
}
export async function library(userId:string,requestedPage=1){const mode=requireDigitalEnvironment();assertDigitalUuid(userId);
  const pagination=digitalLibraryPagination(requestedPage,await prisma.digitalOrder.count({where:{userId,mode}}));
  const rows=await prisma.digitalOrder.findMany({where:{userId,mode},orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(pagination.page-1)*pagination.pageSize,take:pagination.pageSize,select:{id:true,status:true,totalCents:true,mode:true,createdAt:true,contractSnapshot:true,fulfillment:{select:{accessReadyAt:true,confirmationStatus:true}},documents:{select:{id:true,number:true,kind:true,status:true,snapshotHash:true}},lines:{select:{id:true,title:true,scope:true,priceCents:true,trackSnapshot:true,
    offer:{select:{project:{select:{title:true,assets:{where:{role:"COVER",asset:{visibility:"PUBLIC"}},orderBy:[{position:"asc"},{createdAt:"desc"}],take:1,select:{asset:{select:{id:true,alt:true}}}}}}}},
    archives:{select:{format:true,status:true,sizeBytes:true}},
    entitlements:{select:{id:true,masterId:true,status:true,master:{select:{version:true,masterAsset:{select:{mimeType:true,sizeBytes:true,durationMs:true}},mp3Asset:{select:{mimeType:true,sizeBytes:true,durationMs:true}},track:{select:{title:true}}}}}}}}}});
  const {studioFormatsForMasters}=await import("./studio-client");
  const studioFormats=await studioFormatsForMasters(rows.flatMap(o=>o.lines.flatMap(l=>l.entitlements.filter(e=>e.status==="ACTIVE").map(e=>e.masterId))));
  return {pagination,orders:rows.map(({contractSnapshot,...o})=>({...o,legacy:!contractSnapshot,accessReady:!contractSnapshot||!!o.fulfillment?.accessReadyAt,createdAt:o.createdAt.toISOString(),lines:o.lines.map(line=>{const snapshot=line.trackSnapshot as unknown as DigitalSelection["tracks"];
    const {offer,archives,...safeLine}=line,cover=offer.project.assets[0]?.asset;
    return{...safeLine,acquiredTrackCount:snapshot.length,coverUrl:cover?`/media/catalog/${cover.id}`:null,coverAlt:cover?.alt??null,
      formats:acquiredAlbumFormats(snapshot),archives:archives.map(archive=>({format:archive.format,status:archive.status,sizeBytes:archive.sizeBytes!=null&&archive.sizeBytes<=BigInt(Number.MAX_SAFE_INTEGER)?Number(archive.sizeBytes):null})),
      entitlements:line.entitlements.map(e=>({...e,studioFormats:studioFormats.get(e.masterId)??[],formats:acquiredDigitalFormats(snapshot.find(t=>t.masterId===e.masterId)??(()=>{throw new DigitalError("ACQUIRED_FORMAT_INTEGRITY",409);})()),acquiredPosition:snapshot.findIndex(t=>t.masterId===e.masterId)+1,master:{...e.master,
        masterAsset:{...e.master.masterAsset,sizeBytes:e.master.masterAsset.sizeBytes<=BigInt(Number.MAX_SAFE_INTEGER)?Number(e.master.masterAsset.sizeBytes):null},
        mp3Asset:e.master.mp3Asset?{...e.master.mp3Asset,sizeBytes:e.master.mp3Asset.sizeBytes<=BigInt(Number.MAX_SAFE_INTEGER)?Number(e.master.mp3Asset.sizeBytes):null}:null,
        track:{title:snapshot.find(t=>t.masterId===e.masterId)?.title??e.master.track.title}}})).sort((a,b)=>a.acquiredPosition-b.acquiredPosition)};})}))};
}
export type DigitalLibraryOrder = Awaited<ReturnType<typeof library>>["orders"][number];
export async function createDigitalDownload(userId:string,lineId:string,masterId:string|null,format:DigitalAudioFormat="WAV"){requireDigitalEnvironment();
  if(!await prisma.user.findFirst({where:{id:userId,status:"ACTIVE",emailVerified:true}}))throw new DigitalError("NOT_FOUND",404);
  const line=await ownedDigitalLine(userId,lineId);
  if(masterId&&!line.entitlements.some(e=>e.masterId===masterId))throw new DigitalError("NOT_FOUND",404);
  const snapshot=line.trackSnapshot as unknown as DigitalAcquiredTrack[];
  if(masterId){const track=snapshot.find(t=>t.masterId===masterId),master=line.entitlements.find(e=>e.masterId===masterId)?.master;if(!track||!master)throw new DigitalError("NOT_FOUND",404);acquiredDigitalAssetId(track,format,master);}
  else if(!acquiredAlbumFormats(snapshot).includes(format))throw new DigitalError("FORMAT_NOT_ACQUIRED",409);
  if(!masterId&&line.scope!=="ALBUM")throw new DigitalError("INVALID_DOWNLOAD");
  if(!masterId&&line.entitlements.length!==(line.trackSnapshot as unknown[]).length)throw new DigitalError("PARTIAL_ACCESS",409);
  if(!masterId&&(await ensureDigitalArchive(lineId,format)).status!=="READY")throw new DigitalError("ARCHIVE_PREPARING",409);
  const token=randomBytes(32).toString("hex");
  const ticket=await prisma.digitalDownloadTicket.create({data:{userId,lineId,masterId,format,tokenHash:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+DIGITAL_DOWNLOAD_TTL_MS)}});
  return {ticketId:ticket.id,token,url:`/api/digital/download/${ticket.id}`};
}
export async function digitalDownloadResponse(userId:string,id:string,token:string,options:{method?:string;range?:string|null;ifRange?:string|null}={}){requireDigitalEnvironment();assertDigitalUuid(id);
  if(!/^[a-f0-9]{64}$/.test(token))throw new DigitalError("NOT_FOUND",404);
  const hash=createHash("sha256").update(token).digest("hex");
  const ticket=await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-user:${userId}`})) IS NULL AS locked`;
    const t=await tx.digitalDownloadTicket.findFirst({where:{id,userId,tokenHash:hash,expiresAt:{gt:new Date()},usesLeft:{gt:0}}});if(!t)throw new DigitalError("NOT_FOUND",404);
    const owner=await tx.user.findUnique({where:{id:userId},select:{status:true,emailVerified:true}});if(owner?.status!=="ACTIVE"||!owner.emailVerified)throw new DigitalError("NOT_FOUND",404);
    const line=await tx.digitalOrderLine.findFirst({where:{id:t.lineId,order:{userId,mode:requireDigitalEnvironment(),status:{in:[...DIGITAL_ACTIVE_RIGHTS_ORDER_STATES]}}},include:{order:{include:{fulfillment:true}},entitlements:{where:{status:"ACTIVE",userId,...(t.masterId?{masterId:t.masterId}:{})}}}});
    if(!line||!line.entitlements.length||!t.masterId&&line.entitlements.length!==(line.trackSnapshot as unknown[]).length)throw new DigitalError("NOT_FOUND",404);
    if(line.order.contractSnapshot&&!line.order.fulfillment?.accessReadyAt)throw new DigitalError("CONTRACT_RECEIPT_REQUIRED",409);
    if(options.method!=="HEAD")await tx.digitalDownloadTicket.update({where:{id},data:{usesLeft:{decrement:1}}});
    await tx.digitalEvent.create({data:{orderId:line.orderId,actorId:userId,kind:options.method==="HEAD"?"DOWNLOAD_METADATA_READ":"DOWNLOAD_AUTHORIZED",details:{ticketId:id,format:t.format,scope:t.masterId?"TRACK":"ALBUM"}}});return t;});
  const line=await ownedDigitalLine(userId,ticket.lineId);const selected=line.entitlements.filter(e=>!ticket.masterId||e.masterId===ticket.masterId);
  const headers={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
  let ref:MediaStorageReference,size:number,filename:string,mime:string,checksum:string|null;
  if(ticket.masterId){const master=selected[0]?.master,track=(line.trackSnapshot as unknown as DigitalAcquiredTrack[]).find(t=>t.masterId===ticket.masterId);if(!master||!track)throw new DigitalError("NOT_FOUND",404);
    const asset=acquiredDigitalAsset(track,ticket.format as DigitalAudioFormat,master);ref=asset;size=Number(asset.sizeBytes);mime=asset.mimeType;checksum=asset.checksumSha256;
    filename=`${track.title??"piste"}.${asset.filename.split(".").pop()}`;
  }else{if(!acquiredAlbumFormats(line.trackSnapshot as unknown as DigitalAcquiredTrack[]).includes(ticket.format as DigitalAudioFormat))throw new DigitalError("FORMAT_NOT_ACQUIRED",409);
    const archive=await prisma.digitalArchive.findUnique({where:{lineId_format:{lineId:line.id,format:ticket.format}}});if(!archive||archive.status!=="READY"||!archive.storageKey||!archive.storageBackend||!archive.storageProvider||!archive.sizeBytes)throw new DigitalError("ARCHIVE_PREPARING",409);
    ref={storageKey:archive.storageKey,storageBackend:archive.storageBackend as "LOCAL"|"OBJECT",storageProvider:archive.storageProvider,visibility:"PRIVATE"};size=Number(archive.sizeBytes);filename=`${line.title} — ${ticket.format}.zip`;mime="application/zip";checksum=archive.checksum;}
  const meta=await headMediaObject(ref);if(meta.contentLength!==size)throw new DigitalError("INTEGRITY",503);
  const etag=checksum?`"${checksum}"`:meta.etag;
  const range=digitalByteRange(options.ifRange&&options.ifRange!==etag?null:options.range??null,size);
  const responseHeaders={...headers,"Content-Type":mime,"Content-Length":String(range?range.end-range.start+1:size),"Content-Disposition":digitalAttachment(filename),"Accept-Ranges":"bytes",...(etag?{ETag:etag}:{}),...(range?{"Content-Range":`bytes ${range.start}-${range.end}/${size}`}:{})};
  if(options.method==="HEAD")return new Response(null,{status:range?206:200,headers:responseHeaders});
  const obj=await getMediaObject(ref,range??undefined);if(obj.contentLength!==Number(responseHeaders["Content-Length"]))throw new DigitalError("INTEGRITY",503);
  await prisma.digitalEvent.create({data:{orderId:line.orderId,actorId:userId,kind:"DOWNLOAD_STARTED",details:{ticketId:id,range:range??null}}});
  const reader=obj.body.getReader();let bytes=0,terminal=false,terminalWrite:Promise<unknown>|null=null;
  // Next may cancel a completed source while its asynchronous audit is finishing.
  // One terminal event per transfer; a finished source is not a second interruption.
  async function end(kind:"DOWNLOAD_TRANSFER_FINISHED"|"DOWNLOAD_INTERRUPTED"){
    if(terminal){if(terminalWrite)await terminalWrite;return;}terminal=true;
    terminalWrite=prisma.digitalEvent.create({data:{orderId:line.orderId,actorId:userId,kind,details:{ticketId:id,bytes,...(kind==="DOWNLOAD_TRANSFER_FINISHED"?{evidence:"SERVER_STREAM_COMPLETED_NOT_DEVICE_STORAGE"}:{})}}});await terminalWrite;
  }
  const stream=new ReadableStream<Uint8Array>({async pull(controller){try{const{done,value}=await reader.read();if(done){if(bytes!==Number(responseHeaders["Content-Length"]))throw new DigitalError("INTEGRITY",503);await end("DOWNLOAD_TRANSFER_FINISHED");reader.releaseLock();controller.close();}else{bytes+=value.byteLength;controller.enqueue(value);}}catch(e){await end("DOWNLOAD_INTERRUPTED").catch(()=>undefined);await reader.cancel().catch(()=>undefined);controller.error(e);}},async cancel(){await end("DOWNLOAD_INTERRUPTED").catch(()=>undefined);await reader.cancel().catch(()=>undefined);}});
  return new Response(stream,{status:range?206:200,headers:responseHeaders});
}
