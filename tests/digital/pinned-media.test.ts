import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {assertDigitalPinnedMedia,type DigitalPinnedMasterProof} from "@/lib/digital/pinned-media-policy";
import type {DigitalSelection} from "@/lib/digital/domain";
function fixture(){const trackId=randomUUID(),masterId=randomUUID(),wavAssetId=randomUUID(),mp3AssetId=randomUUID();
  const track:DigitalSelection["tracks"][number]={trackId,masterId,wavAssetId,mp3AssetId,title:"QA",position:1,formats:["WAV","MP3"]};
  const master:DigitalPinnedMasterProof={id:masterId,trackId,status:"READY",masterAssetId:wavAssetId,mp3AssetId,
    masterAsset:{id:wavAssetId,visibility:"PRIVATE",rightsStatus:"CLEARED",mimeType:"audio/wav",checksumSha256:"a".repeat(64)},
    mp3Asset:{id:mp3AssetId,visibility:"PRIVATE",rightsStatus:"CLEARED",mimeType:"audio/mpeg",checksumSha256:"b".repeat(64)},
    track:{status:"RELEASED",project:{status:"PUBLISHED",publicVisible:true}}};return{track,master};}
test("pinned-media: ready dual formats are validated by their frozen asset/master IDs",()=>{const f=fixture();assert.doesNotThrow(()=>assertDigitalPinnedMedia([f.track],[f.master]));});
test("pinned-media: new master/version/asset may never silently replace a purchased snapshot",()=>{const f=fixture();for(const m of [{...f.master,id:randomUUID()},{...f.master,trackId:randomUUID()},{...f.master,mp3AssetId:randomUUID()},{...f.master,masterAssetId:randomUUID()}])assert.throws(()=>assertDigitalPinnedMedia([f.track],[m]));});
test("pinned-media: rights revoked or hidden/unpublished in flight prevents grant before delivery",()=>{for(const change of ["sourceRights","mp3Rights","track","project","visibility"]){const f=fixture();
  if(change==="sourceRights")f.master.masterAsset.rightsStatus="PENDING";if(change==="mp3Rights")f.master.mp3Asset!.rightsStatus="PENDING";
  if(change==="track")f.master.track.status="ANNOUNCED";if(change==="project")f.master.track.project.status="DRAFT";if(change==="visibility")f.master.track.project.publicVisible=false;
  assert.throws(()=>assertDigitalPinnedMedia([f.track],[f.master]));}});
test("pinned-media: missing or public MP3, invalid codec/checksum and malformed formats fail closed",()=>{for(const change of ["missing","public","codec","checksum","formats"]){const f=fixture();
  if(change==="missing")f.master.mp3Asset=null;if(change==="public")f.master.mp3Asset!.visibility="PUBLIC";if(change==="codec")f.master.masterAsset.mimeType="audio/mpeg";
  if(change==="checksum")f.master.mp3Asset!.checksumSha256="bad";if(change==="formats")f.track.formats=["MP3","WAV"] as unknown as ["WAV","MP3"];
  assert.throws(()=>assertDigitalPinnedMedia([f.track],[f.master]),{code:"ACQUIRED_FORMATS_REQUIRES_REVIEW"});}});
test("pinned-media: legacy WAV-only pending record has no invented derivative format or historical mutation",()=>{const f=fixture();delete f.track.formats;delete f.track.wavAssetId;delete f.track.mp3AssetId;f.master.mp3Asset=null;f.master.mp3AssetId=null;
  const before=JSON.stringify(f);assert.doesNotThrow(()=>assertDigitalPinnedMedia([f.track],[f.master]));assert.equal(JSON.stringify(f),before);});
