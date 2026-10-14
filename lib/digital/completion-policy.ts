import { DigitalError, digitalPrice, type DigitalCompletionSnapshot, type DigitalCompletionSource, type DigitalSelection } from "./domain";

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
      || s.creditCents !== s.availableCents || s.creditCents < 1) throw new DigitalError("COMPLETION_SOURCE_REQUIRES_REVIEW",409);
    sourceIds.add(s.sourceLineId); trackIds.add(s.trackId);
  }
  const basePriceCents = digitalPrice(album.priceCents), eligible = sources.reduce((n,s)=>n+s.creditCents,0);
  if (!Number.isSafeInteger(eligible)) throw new DigitalError("INVALID_COMPLETION",409);
  const creditCents = Math.min(basePriceCents,eligible), priceCents = Math.max(0,basePriceCents-creditCents);
  // No financial session at zero, no silent free-delivery policy.
  if (!priceCents) throw new DigitalError("COMPLETION_ZERO_REQUIRES_REVIEW",409);
  const completion: DigitalCompletionSnapshot = {version:1,basePriceCents,creditCents,sources:[...sources].sort((a,b)=>a.trackId.localeCompare(b.trackId))};
  return {...album,priceCents,completion};
}
