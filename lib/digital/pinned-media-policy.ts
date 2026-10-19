import {DigitalError,type DigitalSelection} from "./domain";
import { acquiredDigitalFormats, isDigitalMp3OnlyTrack } from "./formats";
import { isAuthorizedMp3OnlySource } from "./mp3-only-policy";
type AssetProof={id:string;visibility:string;rightsStatus:string;mimeType:string|null;checksumSha256:string|null;sizeBytes?:bigint|number|null};
export type DigitalPinnedMasterProof={id:string;trackId:string;status:string;masterAssetId:string;mp3AssetId:string|null;
  codec?:string|null;
  masterAsset:AssetProof;mp3Asset:AssetProof|null;track:{status:string;project:{status:string;publicVisible:boolean}}};

/** Revalidate the exact frozen edition, never substitute a newly uploaded master or its price. */
export function assertDigitalPinnedMedia(tracks:DigitalSelection["tracks"],masters:DigitalPinnedMasterProof[]){
  if(!tracks.length||new Set(tracks.map(t=>t.masterId)).size!==tracks.length)throw new DigitalError("ACQUIRED_MEDIA_REQUIRES_REVIEW",409);
  for(const t of tracks){const m=masters.find(m=>m.id===t.masterId);
    if(!m||m.trackId!==t.trackId||m.status!=="READY"||m.masterAsset.visibility!=="PRIVATE"||m.masterAsset.rightsStatus!=="CLEARED"
      ||m.track.status!=="RELEASED"||m.track.project.status!=="PUBLISHED"||m.track.project.publicVisible!==true)
      throw new DigitalError("ACQUIRED_RIGHTS_REQUIRES_REVIEW",409);
    // Legacy pending records remain original-source only; no retroactive MP3 acquisition is inferred.
    if(t.formats===undefined){
      try{acquiredDigitalFormats(t);}catch{throw new DigitalError("ACQUIRED_FORMATS_REQUIRES_REVIEW",409);}
      if(m.codec==="mp3")throw new DigitalError("ACQUIRED_FORMATS_REQUIRES_REVIEW",409);
      continue;
    }
    if(isDigitalMp3OnlyTrack(t)){
      if(m.codec!=="mp3"||m.mp3AssetId!==null||m.mp3Asset!==null||t.mp3AssetId!==m.masterAssetId||m.masterAsset.id!==t.mp3AssetId
        ||m.masterAsset.mimeType!=="audio/mpeg"||m.masterAsset.checksumSha256!==t.sourceSha256
        ||!isAuthorizedMp3OnlySource(t.trackId,{checksumSha256:m.masterAsset.checksumSha256,sizeBytes:m.masterAsset.sizeBytes??null}))
        throw new DigitalError("ACQUIRED_FORMATS_REQUIRES_REVIEW",409);
      continue;
    }
    try{acquiredDigitalFormats(t);}catch{throw new DigitalError("ACQUIRED_FORMATS_REQUIRES_REVIEW",409);}
    if(t.formats.length!==2||t.formats[0]!=="WAV"||t.formats[1]!=="MP3"
      ||t.wavAssetId!==m.masterAssetId||t.mp3AssetId!==m.mp3AssetId||m.masterAsset.id!==t.wavAssetId
      ||m.masterAsset.mimeType!=="audio/wav"||!/^[a-f0-9]{64}$/.test(m.masterAsset.checksumSha256??"")
      ||!m.mp3Asset||m.mp3Asset.id!==t.mp3AssetId||m.mp3Asset.visibility!=="PRIVATE"||m.mp3Asset.rightsStatus!=="CLEARED"
      ||m.mp3Asset.mimeType!=="audio/mpeg"||!/^[a-f0-9]{64}$/.test(m.mp3Asset.checksumSha256??""))throw new DigitalError("ACQUIRED_FORMATS_REQUIRES_REVIEW",409);
  }
}
