import { DigitalError, digitalPrice, digitalUuid, type DigitalCompletionSnapshot, type DigitalCompletionSource, type DigitalSelection } from "./domain";

type SourceLine = {id:string;scope:string;priceCents:number;trackSnapshot:unknown;completionSnapshot?:unknown};
type SourceRefund = {id:string;providerReference:string|null;status:string;allocationStatus:string;purpose:string;amountCents:number;targets:unknown};
type SourceOrder = {totalCents:number;mode:string;currency:string;status:string;lines:SourceLine[];refunds:SourceRefund[]};

/** Frozen line allocations, not today's catalogue or a reconstructed promotion percentage.
 * A multi-title cart is admissible only when its positive TRACK line amounts sum
 * exactly to the captured order total. Bundles, free gifts and unallocated order
 * discounts cannot be inferred. This does not approve the tax treatment of credit.
 */
export function digitalCompletionSourceAmounts(line:SourceLine,order:SourceOrder) {
  const invalid=()=>{throw new DigitalError("COMPLETION_SOURCE_REQUIRES_REVIEW",409);};
  const refundInvalid=()=>{throw new DigitalError("COMPLETION_REFUND_REQUIRES_REVIEW",409);};
  if(order.mode!=="TEST"||order.currency!=="EUR"||!["PAID","PARTIALLY_REFUNDED","REFUNDED"].includes(order.status)
    ||!Number.isSafeInteger(order.totalCents)||order.totalCents<1||!order.lines.length||order.lines.length>50)invalid();
  const lines=new Map<string,SourceLine>(),tracks=new Set<string>();let allocated=0;
  for(const entry of order.lines){
    const snapshot=entry.trackSnapshot as DigitalSelection["tracks"];
    if(lines.has(entry.id)||entry.scope!=="TRACK"||entry.completionSnapshot||!Number.isSafeInteger(entry.priceCents)
      ||entry.priceCents<1||entry.priceCents>100_000||!Array.isArray(snapshot)||snapshot.length!==1
      ||!snapshot[0]||typeof snapshot[0].trackId!=="string"||typeof snapshot[0].masterId!=="string"||tracks.has(snapshot[0].trackId))invalid();
    lines.set(entry.id,entry);tracks.add(snapshot[0].trackId);allocated+=entry.priceCents;
  }
  const frozen=lines.get(line.id);
  if(!Number.isSafeInteger(allocated)||allocated!==order.totalCents||!frozen||frozen.priceCents!==line.priceCents
    ||frozen.scope!==line.scope||line.scope!=="TRACK")invalid();
  const refundedByLine=new Map<string,number>(),refundIds=new Set<string>(),refundReferences=new Set<string>();let refundedTotal=0;
  const sourceRefunds:Array<{id:string;reference:string;amountCents:number;sourceCents:number;purpose:string}>=[];
  for(const refund of order.refunds){
    if(["REQUESTED","PENDING","REQUIRES_REVIEW"].includes(refund.status))refundInvalid();
    if(refund.status==="FAILED")continue;
    if(refund.status!=="SUCCEEDED"||refund.allocationStatus!=="MATCHED"||!["PRICE_REDUCTION","RESOLUTION"].includes(refund.purpose)
      ||!refund.providerReference||refundIds.has(refund.id)||refundReferences.has(refund.providerReference)
      ||!Number.isSafeInteger(refund.amountCents)||refund.amountCents<1)refundInvalid();
    refundIds.add(refund.id);refundReferences.add(refund.providerReference!);
    const targets=refund.targets as Array<{lineId:string;amountCents:number}>;
    if(!Array.isArray(targets)||!targets.length||targets.length>order.lines.length)refundInvalid();
    const seen=new Set<string>();let targetTotal=0,sourceCents=0;
    for(const target of targets){
      const targetLine=target&&lines.get(target.lineId);
      if(!targetLine||seen.has(target.lineId)||!Number.isSafeInteger(target.amountCents)||target.amountCents<1)refundInvalid();
      seen.add(target.lineId);targetTotal+=target.amountCents;
      const cumulative=(refundedByLine.get(target.lineId)??0)+target.amountCents;
      if(!Number.isSafeInteger(cumulative)||cumulative>targetLine!.priceCents)refundInvalid();
      refundedByLine.set(target.lineId,cumulative);
      if(target.lineId===line.id){
        // RESOLUTION is supposed to revoke this line; ACTIVE is contradictory.
        if(refund.purpose!=="PRICE_REDUCTION")refundInvalid();
        sourceCents+=target.amountCents;
      }
    }
    if(!Number.isSafeInteger(targetTotal)||targetTotal!==refund.amountCents)refundInvalid();
    refundedTotal+=refund.amountCents;
    if(sourceCents)sourceRefunds.push({id:refund.id,reference:refund.providerReference!,amountCents:refund.amountCents,sourceCents,purpose:refund.purpose});
  }
  if(!Number.isSafeInteger(refundedTotal)||refundedTotal>order.totalCents
    ||(order.status==="PAID"?refundedTotal!==0:order.status==="PARTIALLY_REFUNDED"?refundedTotal<=0||refundedTotal>=order.totalCents:refundedTotal!==order.totalCents))refundInvalid();
  const refundedCents=refundedByLine.get(line.id)??0;
  return{paidCents:line.priceCents,refundedCents,availableCents:line.priceCents-refundedCents,
    sourceRefunds:sourceRefunds.sort((a,b)=>a.id.localeCompare(b.id))};
}

/** Pure cents calculation. Source proofs are supplied only by the server repository. */
export function completeDigitalAlbum(album: DigitalSelection, ownedTracks: Set<string>, sources: DigitalCompletionSource[]): DigitalSelection {
  if (album.scope !== "ALBUM") throw new DigitalError("INVALID_COMPLETION",409);
  const owned = album.tracks.filter(t=>ownedTracks.has(t.trackId));
  if (!owned.length) return album;
  const sourceIds = new Set<string>(), trackIds = new Set<string>();
  if (sources.length !== owned.length) throw new DigitalError("COMPLETION_SOURCE_REQUIRES_REVIEW",409);
  for (const s of sources) {
    const track = owned.find(t=>t.trackId===s.trackId);
    if (!track || track.masterId !== s.masterId || trackIds.has(s.trackId) || sourceIds.has(s.sourceLineId)
      || !/^[a-f0-9]{64}$/.test(s.proofHash)
      || ![s.paidCents,s.refundedCents,s.availableCents,s.creditCents].every(Number.isSafeInteger)
      || s.paidCents < 1 || s.refundedCents < 0 || s.availableCents !== s.paidCents-s.refundedCents
      || s.creditCents !== s.availableCents || s.creditCents < 0) throw new DigitalError("COMPLETION_SOURCE_REQUIRES_REVIEW",409);
    if(s.equivalence&&(![s.equivalence.reviewId,s.equivalence.sourceMasterId,s.equivalence.targetMasterId].every(digitalUuid)
      ||s.equivalence.sourceMasterId===s.masterId||s.equivalence.targetMasterId!==s.masterId||!/^[a-f0-9]{64}$/.test(s.equivalence.recordHash)))throw new DigitalError("COMPLETION_EQUIVALENCE_REQUIRES_REVIEW",409);
    sourceIds.add(s.sourceLineId); trackIds.add(s.trackId);
  }
  const basePriceCents = digitalPrice(album.priceCents), eligible = sources.reduce((n,s)=>n+s.creditCents,0);
  if (!Number.isSafeInteger(eligible)) throw new DigitalError("INVALID_COMPLETION",409);
  const creditCents = Math.min(basePriceCents,eligible), priceCents = Math.max(0,basePriceCents-creditCents);
  // v1 paid proofs remain identical. v2 explicitly records a free grant: the
  // applied credit is capped at the album price, without a reusable cash balance.
  const completion: DigitalCompletionSnapshot = {version:priceCents?1:2,basePriceCents,creditCents,
    ...(!priceCents?{eligibleCents:eligible}:{}),sources:[...sources].sort((a,b)=>a.trackId.localeCompare(b.trackId))};
  return {...album,priceCents,completion};
}
