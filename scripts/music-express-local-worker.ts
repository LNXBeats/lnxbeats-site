/** Local synthetic Express audio queue. Never starts the financial worker. */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const cfg=JSON.parse(await readFile(".private/express-qa.json","utf8")) as Record<string,string>;
const target=new URL(cfg.DATABASE_URL);
assert.equal(target.hostname,"127.0.0.1");assert.equal(target.port,"55522");assert.equal(target.pathname,"/lnx_dcn_v12_express_test_20261017");assert.equal(target.username,"dcn_v12_express_runtime");
assert.equal(cfg.MEDIA_STORAGE_DRIVER,"local");assert.equal(cfg.DCN_MODE,"TEST");assert.equal(cfg.DCN_NEW_PAYMENTS_ENABLED,"false");
for(const key of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|AWS|R2|S3|RAILWAY|DATABASE_URL|AUTH_SECRET/.test(key))delete process.env[key];
Object.assign(process.env,cfg);
const realFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{assert.equal(new URL(typeof input==="string"||input instanceof URL?input:input.url).hostname,"127.0.0.1");return realFetch(input,init);};
const {prisma}=await import("@/lib/prisma");const {processDigitalMedia}=await import("@/lib/digital/media-worker");
const stop=new AbortController();for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>stop.abort());
console.log("[express-audio] QA synthetic 55522 only; audio pipeline, no PSP/documents/notifications");
try{while(!stop.signal.aborted){const result=await processDigitalMedia({signal:stop.signal});if(result.processed)console.log(JSON.stringify({processed:true,ready:result.ready,...("draftOnly" in result?{draftOnly:result.draftOnly}:{}),...("errorCode" in result?{errorCode:result.errorCode}:{})}));await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);stop.signal.removeEventListener("abort",done);resolve();};const timer=setTimeout(done,1000);stop.signal.addEventListener("abort",done,{once:true});if(stop.signal.aborted)done();});}}
finally{await prisma.$disconnect();}
