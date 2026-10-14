import "server-only";
import { billingSnapshotHash } from "@/lib/billing/domain";
import type { Prisma } from "@/generated/prisma/client";
import { DigitalError, type DigitalCompletionSnapshot, type DigitalCompletionSource, type DigitalSelection } from "./domain";
import { completeDigitalAlbum } from "./completion-policy";
type Tx = Prisma.TransactionClient;
const activeCredit = ["RESERVED","CONSUMED"];
// PostgreSQL JSONB reorders keys: use the existing canonical immutable-document hash.
const jsonHash = billingSnapshotHash;

/** Repository proof, never amounts submitted by the client. Calls run under the user lock at checkout. */
async function completionSources(tx:Tx,userId:string,album:DigitalSelection,targetLineId?:string):Promise<DigitalCompletionSource[]> {
  const entitlements = await tx.digitalEntitlement.findMany({where:{userId,status:"ACTIVE",master:{trackId:{in:album.tracks.map(t=>t.trackId)}},
    // After PAID, this album legitimately has its own entitlements. They are the
    // result being verified, not an additional source credit. Exclude ONLY this line.
    ...(targetLineId?{lineId:{not:targetLineId}}:{})},
    include:{master:{select:{id:true,trackId:true}},line:{include:{order:{include:{lines:true,attempts:true,refunds:true,disputes:true}}}}}});
  const sources:DigitalCompletionSource[]=[];
  for(const track of album.tracks){
    const acquisitions=entitlements.filter(e=>e.master.trackId===track.trackId);
    if(!acquisitions.length)continue;
    // Multiple active acquisitions (including an owned album) are not silently interpreted as single credit.
    if(acquisitions.length!==1)throw new DigitalError("COMPLETION_AMBIGUOUS_ACQUISITION",409);
    const e=acquisitions[0],line=e.line,o=line.order;
    const acquired=line.trackSnapshot as unknown as DigitalSelection["tracks"];
    const paid=o.attempts.filter(a=>a.status==="PAID");
    if(line.scope!=="TRACK"||o.lines.length!==1||o.totalCents!==line.priceCents||o.mode!=="TEST"||o.currency!=="EUR"
      ||!["PAID","PARTIALLY_REFUNDED"].includes(o.status)||paid.length!==1||!paid[0].paymentReference
      ||!Array.isArray(acquired)||acquired.length!==1||acquired[0].trackId!==track.trackId
      ||e.master.id!==track.masterId||acquired[0].masterId!==track.masterId
      ||line.completionSnapshot||o.disputes.some(d=>d.status!=="WON"))throw new DigitalError("COMPLETION_SOURCE_REQUIRES_REVIEW",409);
    if(o.refunds.some(r=>["REQUESTED","PENDING","REQUIRES_REVIEW"].includes(r.status)
      ||r.status==="SUCCEEDED"&&(r.allocationStatus!=="MATCHED"||r.purpose!=="PRICE_REDUCTION")))throw new DigitalError("COMPLETION_REFUND_REQUIRES_REVIEW",409);
    let refundedCents=0;
    for(const refund of o.refunds.filter(r=>r.status==="SUCCEEDED")){
      const targets=refund.targets as unknown as Array<{lineId:string;amountCents:number}>;
      if(!Array.isArray(targets)||targets.length!==1||targets[0].lineId!==line.id
        ||targets[0].amountCents!==refund.amountCents||!Number.isSafeInteger(refund.amountCents)||refund.amountCents<1)
        throw new DigitalError("COMPLETION_REFUND_REQUIRES_REVIEW",409);
      refundedCents+=refund.amountCents;
    }
    const used=await tx.digitalCompletionCredit.findFirst({where:{userId,trackId:track.trackId,status:{in:activeCredit},...(targetLineId?{targetLineId:{not:targetLineId}}:{})}});
    if(used)throw new DigitalError("COMPLETION_CREDIT_ALREADY_USED",409);
    const availableCents=line.priceCents-refundedCents;
    if(availableCents<1)throw new DigitalError("COMPLETION_ZERO_SOURCE_REQUIRES_REVIEW",409);
    const proofHash=jsonHash({sourceLineId:line.id,trackId:track.trackId,masterId:track.masterId,paidCents:line.priceCents,
      orderId:o.id,mode:o.mode,currency:o.currency,status:o.status,paymentReference:paid[0].paymentReference,
      refundedCents,refunds:o.refunds.map(r=>[r.id,r.providerReference,r.amountCents,r.status,r.allocationStatus,r.purpose,r.targets]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))});
    sources.push({trackId:track.trackId,masterId:track.masterId,sourceLineId:line.id,paidCents:line.priceCents,refundedCents,
      availableCents,creditCents:availableCents,proofHash});
  }
  return sources;
}

export async function applyDigitalCompletions(tx:Tx,userId:string,selected:DigitalSelection[],owned:Set<string>){
  const result:DigitalSelection[]=[];
  for(const offer of selected)result.push(offer.scope==="ALBUM"&&offer.tracks.some(t=>owned.has(t.trackId))
    ?completeDigitalAlbum(offer,owned,await completionSources(tx,userId,offer)):offer);
  return result;
}
export async function reserveDigitalCompletion(tx:Tx,userId:string,lineId:string,snapshot:DigitalCompletionSnapshot){
  for(const s of snapshot.sources)await tx.digitalCompletionCredit.create({data:{userId,trackId:s.trackId,sourceLineId:s.sourceLineId,
    targetLineId:lineId,amountCents:s.creditCents,sourceNetCents:s.availableCents}});
}
export async function verifyDigitalCompletions(tx:Tx,orderId:string,userId:string){
  const lines=await tx.digitalOrderLine.findMany({where:{orderId}});
  for(const line of lines){
    if(!line.completionSnapshot)continue;
    const snapshot=line.completionSnapshot as unknown as DigitalCompletionSnapshot;
    const album:DigitalSelection={id:line.offerId,scope:line.scope,title:line.title,version:line.offerVersion,
      priceCents:snapshot.basePriceCents,tracks:line.trackSnapshot as unknown as DigitalSelection["tracks"]};
    const sources=await completionSources(tx,userId,album,line.id);
    const current=completeDigitalAlbum(album,new Set(snapshot.sources.map(s=>s.trackId)),sources);
    if(jsonHash(current.completion)!==jsonHash(snapshot)||current.priceCents!==line.priceCents)throw new DigitalError("COMPLETION_SOURCE_CHANGED",409);
    const reservations=await tx.digitalCompletionCredit.findMany({where:{targetLineId:line.id,status:{in:activeCredit}}});
    if(reservations.length!==snapshot.sources.length||snapshot.sources.some(s=>!reservations.some(r=>r.sourceLineId===s.sourceLineId
      &&r.trackId===s.trackId&&r.amountCents===s.creditCents&&r.sourceNetCents===s.availableCents)))throw new DigitalError("COMPLETION_RESERVATION_CHANGED",409);
  }
}
export async function consumeDigitalCompletions(tx:Tx,orderId:string){
  await tx.digitalCompletionCredit.updateMany({where:{targetLine:{orderId},status:"RESERVED"},data:{status:"CONSUMED"}});
}
/** Only definitive unpaid terminal evidence may release a reservation; never an ambiguous timeout. */
export async function releaseDigitalCompletions(tx:Tx,orderId:string){
  await tx.digitalCompletionCredit.updateMany({where:{targetLine:{orderId},status:"RESERVED"},data:{status:"RELEASED"}});
}
export async function assertNoCreditedSourceRefund(tx:Tx,sourceLineIds:string[]){
  if(await tx.digitalCompletionCredit.findFirst({where:{sourceLineId:{in:sourceLineIds},status:{in:activeCredit}}}))
    throw new DigitalError("COMPLETION_SOURCE_REFUND_REQUIRES_REVIEW",409);
}
/** Real external financial facts must remain recorded. Dependent albums suspend for human review, not auto-refund. */
export async function reviewDependentDigitalCompletions(tx:Tx,sourceOrderId:string,reason:string){
  const credits=await tx.digitalCompletionCredit.findMany({where:{sourceLine:{orderId:sourceOrderId},status:{in:activeCredit}},include:{targetLine:true}});
  for(const orderId of new Set(credits.map(c=>c.targetLine.orderId))){
    const key=`completion-source:${sourceOrderId}:${orderId}:${reason}`;
    await tx.digitalEvent.upsert({where:{externalKey:key},update:{},create:{orderId,externalKey:key,kind:"COMPLETION_SOURCE_FINANCIAL_INCIDENT",details:{sourceOrderId,reason}}});
    await tx.digitalOrder.update({where:{id:orderId},data:{status:"REQUIRES_REVIEW"}});
    await tx.digitalEntitlement.updateMany({where:{line:{orderId},status:"ACTIVE"},data:{status:"SUSPENDED"}});
  }
}
