import {DIGITAL_ACTIVE_RIGHTS_ORDER_STATES} from "./library-policy";
import type {DigitalSelection} from "./domain";
type Acquisition={offerId:string;scope:string;trackSnapshot:unknown;order:{status:string};entitlements:Array<{masterId:string;status:string}>};
/** Owning twelve separate titles is not proof of an album purchase or its archive entitlement. */
export function digitalOwnsExactAlbum(album:DigitalSelection,acquisitions:Acquisition[]){
  return acquisitions.some(line=>{
    if(line.scope!=="ALBUM"||line.offerId!==album.id||!DIGITAL_ACTIVE_RIGHTS_ORDER_STATES.some(s=>s===line.order.status))return false;
    const tracks=line.trackSnapshot as DigitalSelection["tracks"];
    if(!Array.isArray(tracks)||tracks.length!==album.tracks.length||new Set(tracks.map(t=>t.trackId)).size!==tracks.length)return false;
    return album.tracks.every(t=>tracks.some(a=>a.trackId===t.trackId&&a.masterId===t.masterId)
      &&line.entitlements.some(e=>e.masterId===t.masterId&&e.status==="ACTIVE"));
  });
}
