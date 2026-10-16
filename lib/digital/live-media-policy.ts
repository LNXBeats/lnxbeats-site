import {DigitalError} from "./domain";
import type {DigitalMode} from "./runtime-policy";

/** Metadata gate before a new sale. A local recovery file is not proof that the
 * exact bytes exist in Production object storage. Re-downloads keep their own
 * frozen references; this does not rewrite historical acquisitions. */
export function assertDigitalLiveObjectAssets(mode:DigitalMode|null,assets:ReadonlyArray<{storageBackend?:string|null;storageProvider?:string|null;storageKey?:string|null}|null|undefined>){
  if(mode!=="LIVE")return;
  if(!assets.length||assets.some(a=>!a||a.storageBackend!=="OBJECT"||a.storageProvider!=="r2"||!a.storageKey
    ||a.storageKey.startsWith("/")||a.storageKey.split("/").includes("..")))throw new DigitalError("LIVE_MEDIA_STORAGE_NOT_READY",409);
}
