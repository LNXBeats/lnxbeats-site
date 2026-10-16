import assert from "node:assert/strict";
import test from "node:test";
import {assertDigitalLiveObjectAssets} from "@/lib/digital/live-media-policy";
test("new LIVE sales reject local QA references, missing objects, another provider and unsafe keys before payment",()=>{
  const object={storageBackend:"OBJECT",storageProvider:"r2",storageKey:"digital/private/synthetic.wav"};
  assert.doesNotThrow(()=>assertDigitalLiveObjectAssets("LIVE",[object,{...object,storageKey:"digital/public/synthetic-preview.mp3"}]));
  for(const value of[null,{}, {...object,storageBackend:"LOCAL"},{...object,storageProvider:"unknown"},{...object,storageKey:""},{...object,storageKey:"../private.wav"}]){
    assert.throws(()=>assertDigitalLiveObjectAssets("LIVE",[object,value]),{code:"LIVE_MEDIA_STORAGE_NOT_READY"});
  }
  assert.throws(()=>assertDigitalLiveObjectAssets("LIVE",[]),{code:"LIVE_MEDIA_STORAGE_NOT_READY"});
  assert.doesNotThrow(()=>assertDigitalLiveObjectAssets("TEST",[{storageBackend:"LOCAL"}]));
});
