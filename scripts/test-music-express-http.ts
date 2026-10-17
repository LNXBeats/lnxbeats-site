/** Real HTTP loopback checks against isolated Express QA, no PSP calls. */
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
const cfg=JSON.parse(await readFile(".private/express-qa.json","utf8"));
const target=new URL(cfg.DATABASE_URL);assert.equal(target.hostname,"127.0.0.1");assert.equal(target.port,"55522");assert.equal(target.pathname,"/lnx_dcn_v12_express_test_20261017");
for(const name of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|R2|S3|AWS|RAILWAY|DATABASE_URL|AUTH_SECRET/.test(name))delete process.env[name];Object.assign(process.env,cfg);
const {prisma}=await import("@/lib/prisma");const {auth}=await import("@/lib/auth");const {hashPassword}=await import("@/lib/auth/password");
const out="/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/DCN_V12_ADMIN_EXPRESS_20261017";
const access=JSON.parse(await readFile(".private/express-access.json","utf8"));
const fixture=JSON.parse(await readFile(out+"/proofs/RUNTIME_EXPRESS.json","utf8"));
const checks:Record<string,string>={};const sums:unknown[]=[];
async function cookie(email:string){const r=await auth.handler(new Request(cfg.AUTH_URL+"/api/auth/sign-in/email",{method:"POST",headers:{origin:cfg.AUTH_URL,"content-type":"application/json"},body:JSON.stringify({email,password:access.password})}));assert.equal(r.status,200);return r.headers.getSetCookie().map(s=>s.split(";")[0]).join("; ");}
async function request(path:string,credential?:string,method="GET",body?:unknown,origin=cfg.AUTH_URL){return fetch(cfg.AUTH_URL+path,{method,headers:{...(credential?{cookie:credential}:{}),origin,...(body?{"content-type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});}
try {
 const admin=await cookie(access.email),email=`member-express-${randomUUID()}@example.invalid`,member=await prisma.user.create({data:{email,displayName:"Membre synthétique sans accès Admin",role:"MEMBER",status:"ACTIVE",emailVerified:true,emailVerifiedAt:new Date()}});
 await prisma.account.create({data:{userId:member.id,accountId:member.id,providerId:"credential",password:await hashPassword(access.password)}});const nonAdmin=await cookie(email);
 assert.equal((await request("/api/admin/digital/express")).status,401);assert.equal((await request("/api/admin/digital/express",nonAdmin)).status,403);assert.equal((await request("/api/admin/digital/express",admin)).status,200);checks.API_ADMIN_ONLY="PASS";
 assert.equal((await request("/api/admin/digital/express",admin,"POST",{operation:"defaults",input:{}},"https://not-authorized.invalid")).status,403);checks.CROSS_ORIGIN_MUTATION_REFUSED="PASS";
 const manifest=await request(`/api/admin/digital/express?projectId=${fixture.single.id}&manifeste=1`,admin);assert.equal(manifest.status,200);const doc=await manifest.json();assert.equal(doc.manifest.kind,"TECHNICAL_INVENTORY_NOT_INDEPENDENT_IP_PROOF");assert.match(doc.sha256,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(doc),/storageKey|Authorization|password|secret|DATABASE_URL/);checks.PRIVATE_MANIFEST_NO_SECRET_NO_STORAGE_KEY="PASS";
 const master=await prisma.digitalMaster.findFirstOrThrow({where:{track:{projectId:fixture.single.id}},orderBy:{version:"desc"},include:{masterAsset:true,previewAsset:true,mp3Asset:true}});
 const path=`/api/admin/digital/masters/${master.id}`;assert.equal((await request(path)).status,401);assert.equal((await request(path,nonAdmin)).status,403);const wav=await request(path,admin);assert.equal(wav.status,200);const b=Buffer.from(await wav.arrayBuffer());assert.equal(createHash("sha256").update(b).digest("hex"),master.masterAsset.checksumSha256);assert.match(wav.headers.get("cache-control")??"",/private/);sums.push({masterId:master.id,sha256:master.masterAsset.checksumSha256,bytes:b.length});checks.PRIVATE_MASTER_ADMIN_BYTES_MATCH_AND_NONADMIN_DENIED="PASS";
 const preview=await request(`/api/admin/digital/previews/${master.previewAssetId}`,admin);assert.equal(preview.status,200);assert.equal(createHash("sha256").update(Buffer.from(await preview.arrayBuffer())).digest("hex"),master.previewAsset!.checksumSha256);assert.equal((await request(`/media/digital/previews/${master.previewAssetId}`)).status,404);checks.ADMIN_PREVIEW_WHILE_UNAPPROVED_PUBLIC_PREVIEW_REFUSED="PASS";
 const publicMaster=await request(`/media/digital/previews/${master.masterAssetId}`);assert.equal(publicMaster.status,404);checks.FULL_MASTER_NEVER_SERVED_AS_PUBLIC_PREVIEW="PASS";
 const head=await request(path,admin,"HEAD");assert.equal(head.status,200);assert.equal(Number(head.headers.get("content-length")),Number(master.masterAsset.sizeBytes));const range=await fetch(cfg.AUTH_URL+path,{headers:{cookie:admin,range:"bytes=0-43"}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,44);checks.ADMIN_MASTER_HEAD_AND_RANGE="PASS";
 const album=await request(`/api/admin/digital/express?projectId=${fixture.album.id}`,admin);assert.equal(album.status,200);const p=(await album.json()).project;assert.equal(p.tracks.length,3);assert.equal(p.albumOffer.priceCents,990);checks.ALBUM_DTO_FORMATS_PRICES_DURATIONS="PASS";
 const artist={operation:"artist",input:{projectId:fixture.single.id,name:"Artiste synthétique explicitement renseigné en QA"}};
 assert.equal((await request("/api/admin/digital/express",admin,"POST",artist)).status,200);assert.equal((await request("/api/admin/digital/express",admin,"POST",artist)).status,200);
 assert.equal(await prisma.credit.count({where:{projectId:fixture.single.id,role:"ARTIST",name:artist.input.name}}),1);checks.ARTIST_CREDIT_REUSES_CATALOGUE_NO_DUPLICATE_NO_RIGHTS_APPROVAL="PASS";
 const event=await prisma.digitalEvent.findFirstOrThrow({where:{kind:"MUSIC_EXPRESS_DRAFT"}});await assert.rejects(prisma.digitalEvent.update({where:{id:event.id},data:{kind:"SHOULD_NOT_BE_WRITABLE"}}));checks.AUDIT_EVENT_UPDATE_FORBIDDEN_FOR_RUNTIME="PASS";
 const published=await prisma.digitalEvent.findFirstOrThrow({where:{kind:"MUSIC_EXPRESS_PUBLISHED",details:{path:["projectId"],equals:fixture.album.id}}});
 const badReplay=await request("/api/admin/digital/express",admin,"POST",{operation:"publish",input:{projectId:fixture.single.id,reviewToken:(published.details as {reviewToken:string}).reviewToken,idempotencyKey:published.externalKey!.split(":").at(-1),confirmed:true}});
 assert.equal(badReplay.status,409);assert.equal((await badReplay.json()).code,"IDEMPOTENCY_CONFLICT");checks.PUBLISH_RETRY_IS_BOUND_TO_EXACT_PROJECT="PASS";
 const before=await prisma.project.findUniqueOrThrow({where:{id:fixture.single.id}});
 try {
  await prisma.project.update({where:{id:before.id},data:{status:"PUBLISHED",publicVisible:true}});
  const current=(await (await request(`/api/admin/digital/express?projectId=${before.id}`,admin)).json()).project;
  const badDraft=await request("/api/admin/digital/express",admin,"POST",{operation:"draft",input:{projectId:current.id,expectedUpdatedAt:current.updatedAt,title:"Modification publique refusée",type:"SINGLE",tracks:current.tracks.map((t:{id:string;title:string;offer:{priceCents:number;version:number}})=>({id:t.id,title:t.title,priceCents:t.offer.priceCents,expectedOfferVersion:t.offer.version})),albumPriceCents:990,expectedAlbumOfferVersion:0,idempotencyKey:randomUUID()}});
  assert.equal(badDraft.status,409);assert.equal((await badDraft.json()).code,"EXPRESS_PUBLIC_METADATA");assert.equal((await prisma.project.findUniqueOrThrow({where:{id:before.id}})).title,before.title);
  checks.PUBLIC_CATALOGUE_CANNOT_CHANGE_SILENTLY_VIA_DRAFT="PASS";
 } finally {await prisma.project.update({where:{id:before.id},data:{status:before.status,publicVisible:before.publicVisible}});}
 await writeFile(out+"/proofs/HTTP_EXPRESS.json",JSON.stringify({at:new Date().toISOString(),baseUrl:cfg.AUTH_URL,checks,sums,externalRequests:0,financialRequests:0},null,2)+"\n",{mode:0o600});console.log(JSON.stringify({checks,financialRequests:0},null,2));
}finally{await prisma.$disconnect()}
