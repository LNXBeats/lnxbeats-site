/** Targeted R2 checks: existing synthetic cluster only, no PSP or Recovery write. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import ffmpeg from "ffmpeg-static";
const cfg=JSON.parse(await readFile(".private/express-qa.json","utf8"));
const db=new URL(cfg.DATABASE_URL);assert.equal(db.hostname,"127.0.0.1");assert.equal(db.port,"55522");assert.equal(db.pathname,"/lnx_dcn_v12_express_test_20261017");assert.equal(cfg.AUTH_URL,"http://127.0.0.1:3162");
for(const key of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|AWS|R2|S3|RAILWAY|DATABASE_URL|AUTH_SECRET/.test(key))delete process.env[key];Object.assign(process.env,cfg);
const realFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{assert.equal(new URL(typeof input==="string"||input instanceof URL?input:input.url).hostname,"127.0.0.1");return realFetch(input,init);};
const {prisma}=await import("@/lib/prisma");const {auth}=await import("@/lib/auth");
const out="/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/DCN_V12_R2_EXPRESS_20261017";
const sum=(v:unknown)=>createHash("sha256").update(JSON.stringify(v,(_k,v)=>typeof v==="bigint"?v.toString():v)).digest("hex");
async function snapshot(){return {projects:await prisma.project.findMany({orderBy:{id:"asc"}}),tracks:await prisma.track.findMany({orderBy:{id:"asc"}}),offers:await prisma.digitalOffer.findMany({orderBy:{id:"asc"}}),masters:await prisma.digitalMaster.findMany({orderBy:{id:"asc"}}),assets:await prisma.asset.findMany({orderBy:{id:"asc"}}),events:await prisma.digitalEvent.findMany({orderBy:{id:"asc"}}),orders:await prisma.digitalOrder.findMany({orderBy:{id:"asc"}}),entitlements:await prisma.digitalEntitlement.findMany({orderBy:{id:"asc"}})};}
try{
 if(process.argv[2]==="prepare"){
  await mkdir(out+"/fixtures",{recursive:true});const snap=await snapshot();
  const hashes=Object.fromEntries(Object.entries(snap).map(([key,rows])=>[key,rows.map(r=>({id:r.id,sha256:sum(r)}))]));
  await writeFile(out+"/proofs/QA_BEFORE.json",JSON.stringify(hashes,null,2)+"\n");
  assert.ok(ffmpeg);const files=[];
  for(const [name,frequency,codec,duration] of [["QA R2 — Single guidé 1710.wav",7439,"pcm_s24le",3.473],["QA R2 — Brouillon MP3.mp3",8179,"libmp3lame",4.137]] as const){
   const target=out+"/fixtures/"+name;await promisify(execFile)(ffmpeg,["-hide_banner","-loglevel","error","-n","-f","lavfi","-i",`sine=frequency=${frequency}:sample_rate=44100:duration=${duration}`,"-ac","2","-c:a",codec,...(codec==="libmp3lame"?["-b:a","320k"]:[]),target]);
   files.push({name,bytes:(await readFile(target)).length});
  }
  console.log(JSON.stringify({environment:"synthetic QA 55522 only",snapshotRows:Object.fromEntries(Object.entries(hashes).map(([k,v])=>[k,v.length])),files}));
 }else if(process.argv[2]==="final-readonly"){
  const {loadExpressProject}=await import("@/lib/digital/express-service");
  const proof=JSON.parse(await readFile(out+"/proofs/RUNTIME_R2.json","utf8"));
  const projects=await Promise.all([proof.single.id,proof.album.id].map(id=>loadExpressProject(id)));
  for(const p of projects){assert.equal(p.publicVisible,false);assert.ok(p.tracks.every(t=>!t.offer?.active&&t.artisticStatus!=="VALIDATED"&&t.review?.status!=="APPROVED"));if(p.albumOffer)assert.equal(p.albumOffer.active,false);}
  const before=JSON.parse(await readFile(out+"/proofs/QA_BEFORE.json","utf8")) as Record<string,Array<{id:string;sha256:string}>>;const after=await snapshot();let verified=0;
  for(const [key,old] of Object.entries(before)){const current=new Map((after[key as keyof typeof after] as Array<{id:string}>).map(r=>[r.id,sum(r)]));for(const r of old){assert.equal(current.get(r.id),r.sha256);verified++;}}
  await writeFile(out+"/proofs/QA_FINAL_READONLY.json",JSON.stringify({at:new Date().toISOString(),preexistingRowsVerified:verified,preexistingRowsUnchanged:true,newProjects:projects.map(p=>({id:p.id,title:p.title,publicVisible:p.publicVisible,tracks:p.tracks.map(t=>({id:t.id,formats:t.formats,durationMs:t.durationMs,artisticStatus:t.artisticStatus,rightsStatus:t.review?.status??"PENDING",offerActive:t.offer?.active})),blockers:p.blockers})),orders:after.orders.length,entitlements:after.entitlements.length},null,2)+"\n");
  console.log(JSON.stringify({preexistingRowsVerified:verified,unchanged:true,newApprovals:0,newActiveOffers:0,orders:after.orders.length,entitlements:after.entitlements.length}));
 }else{
  const access=JSON.parse(await readFile(".private/express-access.json","utf8"));const sign=await auth.handler(new Request(cfg.AUTH_URL+"/api/auth/sign-in/email",{method:"POST",headers:{origin:cfg.AUTH_URL,"content-type":"application/json"},body:JSON.stringify({email:access.email,password:access.password})}));assert.equal(sign.status,200);const cookie=sign.headers.getSetCookie().map(x=>x.split(";")[0]).join("; ");
  async function post(operation:string,input:unknown){return fetch(cfg.AUTH_URL+"/api/admin/digital/express",{method:"POST",headers:{cookie,origin:cfg.AUTH_URL,"content-type":"application/json"},body:JSON.stringify({operation,input})});}
  const checks:Record<string,string>={};
  const payload={projectId:null,expectedUpdatedAt:null,title:`QA R2 — Reprise HTTP ${randomUUID().slice(0,8)}`,type:"SINGLE",tracks:[{id:null,title:"Titre explicite",priceCents:129,expectedOfferVersion:0}],albumPriceCents:990,expectedAlbumOfferVersion:0,idempotencyKey:randomUUID()};
  const first=await post("draft",payload);assert.equal(first.status,200);const saved=await first.json();
  // Discarding an already committed response is the local transport-ambiguity model, not a provider test.
  const results=await Promise.all([post("draft",payload),post("draft",payload)]);const values=await Promise.all(results.map(async r=>{assert.equal(r.status,200);return r.json();}));
  assert.ok(values.every(v=>v.project.id===saved.project.id&&v.duplicate===true));assert.equal(await prisma.project.count({where:{title:payload.title}}),1);checks.IDEMPOTENT_LOST_RESPONSE_AND_TWO_CONCURRENT_REPLAYS="PASS";
  assert.equal((await post("draft",{...payload,idempotencyKey:randomUUID()})).status,409);checks.SLUG_TITLE_COLLISION_REFUSED="PASS";
  const p=saved.project;const publish=await post("publish",{projectId:p.id,reviewToken:p.reviewToken,confirmed:true,idempotencyKey:randomUUID()});assert.equal(publish.status,409);assert.equal((await publish.json()).code,"SALE_REQUIREMENTS");assert.equal(await prisma.digitalOffer.count({where:{projectId:p.id,active:true}}),0);checks.DRAFT_PRICE_DOES_NOT_OPEN_SALES_PUBLICATION_REFUSED="PASS";
  const single=await prisma.project.findFirstOrThrow({where:{title:"QA R2 — Single guidé 1710"},include:{tracks:{include:{digitalMasters:{include:{masterAsset:true,mp3Asset:true,previewAsset:true}}}},digitalOffers:true}});
  assert.equal(single.tracks.length,1);assert.equal(single.title,single.tracks[0].title);assert.equal(single.digitalOffers.length,1);assert.equal(single.digitalOffers[0].priceCents,129);assert.equal(single.digitalOffers[0].active,false);assert.equal(single.tracks[0].digitalMasters.length,1);assert.equal(single.tracks[0].digitalMasters[0].status,"READY");checks.BROWSER_SINGLE_TITLE_PRICE_AND_ONE_READY_MASTER="PASS";
  const mp=await prisma.project.findFirstOrThrow({where:{title:"QA R2 — Album guidé 1710"},include:{tracks:{orderBy:{position:"asc"},include:{digitalMasters:true}},digitalOffers:true}});
  assert.deepEqual(mp.tracks.map(t=>t.title),["Lueur du soir","Matin doré","Brouillon MP3"]);assert.equal(mp.digitalOffers.find(o=>o.scope==="ALBUM")!.priceCents,990);assert.equal(mp.digitalOffers.find(o=>o.trackId===mp.tracks[0].id)!.priceCents,149);assert.ok(mp.digitalOffers.every(o=>!o.active));const mpMaster=mp.tracks[2].digitalMasters[0];assert.equal(mpMaster.codec,"mp3");assert.equal(mpMaster.status,"QUARANTINED");assert.equal(mpMaster.mp3AssetId,null);assert.equal(mpMaster.previewAssetId,null);checks.BROWSER_ALBUM_ORDER_PRICES_AND_MP3_ONLY_PRIVATE_DRAFT="PASS";
  const singleMaster=single.tracks[0].digitalMasters[0];for(const asset of [singleMaster.masterAsset,singleMaster.mp3Asset!,singleMaster.previewAsset!])assert.ok(asset.checksumSha256);
  const masterUrl=cfg.AUTH_URL+`/api/admin/digital/masters/${singleMaster.id}`;assert.equal((await fetch(masterUrl)).status,401);assert.equal((await fetch(cfg.AUTH_URL+`/media/digital/previews/${singleMaster.masterAssetId}`)).status,404);assert.equal((await fetch(cfg.AUTH_URL+`/media/digital/previews/${singleMaster.previewAssetId}`)).status,404);checks.NEW_MASTER_PRIVATE_AND_UNAPPROVED_PREVIEW_NOT_PUBLIC="PASS";
  const before=JSON.parse(await readFile(out+"/proofs/QA_BEFORE.json","utf8")) as Record<string,Array<{id:string;sha256:string}>>;const after=await snapshot();
  for(const [key,old] of Object.entries(before)){const current=new Map((after[key as keyof typeof after] as Array<{id:string}>).map(r=>[r.id,sum(r)]));for(const r of old)assert.equal(current.get(r.id),r.sha256,`${key} ${r.id} changed`);}
  assert.equal(after.orders.length,0);assert.equal(after.entitlements.length,0);checks.PREEXISTING_QA_ROWS_UNCHANGED_NO_ACQUISITION_NO_PAYMENT="PASS";
  await writeFile(out+"/proofs/RUNTIME_R2.json",JSON.stringify({at:new Date().toISOString(),environment:"isolated synthetic QA 127.0.0.1:55522",checks,single:{id:single.id,slug:single.slug,masterId:singleMaster.id},album:{id:mp.id,slug:mp.slug,mp3MasterId:mpMaster.id},localReplayFixture:saved.project.id,providerCalls:0,recoveryWrites:0,productionWrites:0},null,2)+"\n");console.log(JSON.stringify({checks,providerCalls:0},null,2));
 }
}finally{await prisma.$disconnect()}
