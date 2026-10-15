/** Real local PostgreSQL repository/ACL/concurrency; synthetic paid fixtures and finance doubles.
 * Not a PSP checkout, webhook, media publication, or tax/legal certification.
 */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile,stat,mkdir,writeFile} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import {syncBuiltinESMExports} from "node:module";
import {PrismaPg} from "@prisma/adapter-pg";
import {PrismaClient,type Prisma} from "@/generated/prisma/client";
import {assertSafeLocalPostgresUrl} from "@/lib/database/local-postgres-url";
import type {DigitalSelection} from "@/lib/digital/domain";
import type {DigitalFinanceGateway} from "@/lib/digital/finance-policy";

const blocked=()=>{throw Error("COMPLETION_COMPLEX_EXTERNAL_NETWORK_FORBIDDEN");};
http.request=blocked as typeof http.request;http.get=blocked as typeof http.get;
https.request=blocked as typeof https.request;https.get=blocked as typeof https.get;
globalThis.fetch=blocked as typeof fetch;tls.connect=blocked as typeof tls.connect;
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(this:net.Socket,...args:unknown[]){
  const arg=args[0],host=typeof arg==="object"&&arg!==null&&"host" in arg?arg.host:args[1];
  const port=typeof arg==="object"&&arg!==null&&"port" in arg?arg.port:arg;
  assert.equal(host,"127.0.0.1");assert.equal(Number(port),55473);return Reflect.apply(connect,this,args) as net.Socket;
} as typeof connect;syncBuiltinESMExports();
async function profile(path:string){assert.equal((await stat(path)).mode&0o077,0);return JSON.parse(await readFile(path,"utf8")) as Record<string,string>;}
const configuration=await profile(".private/dcn-consolidation-config.json"),ownerConfiguration=await profile(".private/dcn-consolidation-owner-config.json");
for(const config of[configuration,ownerConfiguration]){
  const u=assertSafeLocalPostgresUrl(config.DATABASE_URL);assert.equal(u.hostname,"127.0.0.1");assert.equal(u.port,"55473");assert.equal(u.pathname,"/lnx_dcn_consolidation_test");
}
assert.equal(new URL(configuration.DATABASE_URL).username,"dcn_runtime_a");assert.equal(new URL(ownerConfiguration.DATABASE_URL).username,"dcn_owner");
for(const key of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|RAILWAY|S3|R2|AWS|SMTP/i.test(key))delete process.env[key];
Object.assign(process.env,configuration,{NODE_ENV:"test",DCN_NEW_PAYMENTS_ENABLED:"false",DCN_EXTERNAL_TEST_AUTHORIZED:"false",ADS_ENABLED:"false"});
const owner=new PrismaClient({adapter:new PrismaPg({connectionString:ownerConfiguration.DATABASE_URL})});
const runtime=(await import("@/lib/prisma")).prisma;
const runId=randomUUID(),merchant="dcn-consolidation-launch-credit",createdOrderIds:string[]=[];
const results:Array<{name:string;status:"PASS"}>=[];
async function check(name:string,fn:()=>Promise<void>){await fn();results.push({name,status:"PASS"});console.log(`PASS ${name}`);}
const json=(v:unknown)=>v as Prisma.InputJsonValue;
try{
  const identity=await runtime.$queryRaw<Array<{role:string;superuser:boolean;owner:boolean}>>`SELECT current_user AS role,rolsuper AS superuser,(SELECT datdba=current_user::regrole FROM pg_database WHERE datname=current_database()) AS owner FROM pg_roles WHERE rolname=current_user`;
  assert.equal(identity[0].role,"dcn_runtime_a");assert.equal(identity[0].superuser,false);assert.equal(identity[0].owner,false);
  const {applyDigitalCompletions,reserveDigitalCompletion,verifyDigitalCompletions,consumeDigitalCompletions,releaseDigitalCompletions}=await import("@/lib/digital/completion");
  const {prepareDigitalDocuments}=await import("@/lib/digital/documents");
  const {requestDigitalRefund,processDigitalRefund}=await import("@/lib/digital/finance");
  const {digitalContractSnapshot}=await import("@/lib/digital/fulfillment-policy");
  const {DIGITAL_TERMS_VERSION}=await import("@/lib/digital/domain");
  const {DIGITAL_MUSIC_TERMS_DRAFT_TEXT}=await import("@/lib/digital/digital-legal");
  const fixture=JSON.parse(await readFile(".private/dcn-consolidation-fixture.json","utf8")) as {albumOfferId:string;singleOfferIds:string[]};
  const offer=await owner.digitalOffer.findUniqueOrThrow({where:{id:fixture.albumOfferId},include:{project:{include:{tracks:{where:{status:"RELEASED"},orderBy:{position:"asc"},include:{digitalMasters:{where:{status:"READY"},orderBy:{version:"desc"},take:1}}}}}}});
  assert.equal(offer.scope,"ALBUM");assert.equal(offer.priceCents,990);assert.equal(offer.project.tracks.length,12);
  const tracks:DigitalSelection["tracks"]=offer.project.tracks.map(t=>{const m=t.digitalMasters[0];assert.ok(m?.mp3AssetId);return{trackId:t.id,masterId:m.id,title:t.title,position:t.position,
    formats:["WAV","MP3"],wavAssetId:m.masterAssetId,mp3AssetId:m.mp3AssetId!};});
  const album:DigitalSelection={id:offer.id,scope:"ALBUM",title:"QA complex completion — fictitious prices",priceCents:990,version:offer.version,tracks};
  // Existing records are read only; the digest detects accidental mutations to
  // the referenced original catalogue and all pre-existing acquired documents.
  const historicalSelect={id:true,lines:{orderBy:{id:"asc" as const}},documents:{orderBy:{id:"asc" as const},select:{id:true,snapshotHash:true,snapshot:true}},contractSnapshot:true};
  const historicalCatalogue={tracks:{orderBy:{id:"asc" as const},include:{digitalMasters:{orderBy:{id:"asc" as const}}}},digitalOffers:{orderBy:{id:"asc" as const}}};
  const beforeOrders=await owner.digitalOrder.findMany({orderBy:{id:"asc"},select:historicalSelect});
  const beforeCatalogue=await owner.project.findUniqueOrThrow({where:{id:offer.projectId},include:historicalCatalogue});
  const stable=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const beforeHash=stable({beforeOrders,beforeCatalogue});
  const admin=await owner.user.create({data:{email:`completion-complex-admin-${runId}@example.invalid`,role:"ADMIN",status:"ACTIVE",emailVerified:true}});
  const buyer=await owner.user.create({data:{email:`completion-complex-buyer-${runId}@example.invalid`,status:"ACTIVE",emailVerified:true}});
  const actor={id:admin.id,email:admin.email,name:"Synthetic local admin",role:"ADMIN" as const,status:"ACTIVE" as const,emailVerified:true as const};
  const own=async()=>new Set((await runtime.digitalEntitlement.findMany({where:{userId:buyer.id,status:"ACTIVE",line:{order:{status:{in:["PAID","PARTIALLY_REFUNDED","REFUNDED"]}}}},select:{master:{select:{trackId:true}}}})).map(r=>r.master.trackId));
  const quote=async(a=album)=>(await applyDigitalCompletions(runtime,buyer.id,[a],await own()))[0];
  const finance:DigitalFinanceGateway={merchantId:merchant,async refund(r){return{provider:"STRIPE",mode:"TEST",authenticated:true,merchantId:merchant,orderId:r.orderId,paymentReference:r.paymentReference,
    reference:`re_local_complex_${r.id}`,amountCents:r.amountCents,currency:"EUR",status:"SUCCEEDED"};},async recoverRefund(){return null;},async readRefund(){throw Error("LOCAL_DOUBLE_ONLY");},async readDispute(){throw Error("LOCAL_DOUBLE_ONLY");}};
  async function paidTracks(entries:Array<{index:number;paidCents:number}>){
    const order=await owner.digitalOrder.create({data:{userId:buyer.id,idempotencyKey:randomUUID(),cartRevision:1,status:"PAID",totalCents:entries.reduce((n,e)=>n+e.paidCents,0),
      termsVersion:DIGITAL_TERMS_VERSION,termsHash:createHash("sha256").update(DIGITAL_MUSIC_TERMS_DRAFT_TEXT).digest("hex"),contractSnapshot:json(digitalContractSnapshot({email:buyer.email,name:"Synthetic fixture"},new Date())),
      lines:{create:entries.map(e=>({offerId:fixture.singleOfferIds[e.index],scope:"TRACK",title:tracks[e.index].title,offerVersion:1,priceCents:e.paidCents,trackSnapshot:json([tracks[e.index]]),taxSnapshot:{status:"LOCAL_REVIEW_ONLY"}}))},
      attempts:{create:{provider:"STRIPE",operation:"CHECKOUT",status:"PAID",idempotencyKey:`local-fixture-${randomUUID()}`,providerReference:`cs_local_fixture_${randomUUID()}`,paymentReference:`pi_local_fixture_${randomUUID()}`}}},include:{lines:true}});
    createdOrderIds.push(order.id);
    for(const l of order.lines)await owner.digitalEntitlement.create({data:{userId:buyer.id,lineId:l.id,masterId:(l.trackSnapshot as DigitalSelection["tracks"])[0].masterId}});
    await runtime.$transaction(tx=>prepareDigitalDocuments(tx,order.id));return order;
  }
  const basket=await paidTracks([{index:0,paidCents:137},{index:1,paidCents:49},{index:2,paidCents:201}]);
  const separate=await paidTracks([{index:3,paidCents:89}]);
  const line=(index:number)=>basket.lines.find(l=>(l.trackSnapshot as DigitalSelection["tracks"])[0].trackId===tracks[index].trackId)!;
  await check("actual PostgreSQL repository sums different frozen promotional/individual prices, never catalogue129",async()=>{
    const q=await quote();assert.equal(q.completion!.creditCents,476);assert.equal(q.priceCents,514);assert.equal(q.completion!.sources.length,4);
  });
  await check("exact allocated partial refund across two titles and unrelated full resolution retain correct per-line credit",async()=>{
    for(const [purpose,targets,amount]of[["PRICE_REDUCTION",[{lineId:line(0).id,amountCents:31},{lineId:line(2).id,amountCents:17}],48],
      ["RESOLUTION",[{lineId:line(1).id,amountCents:49}],49]] as const){
      const r=await requestDigitalRefund(actor,basket.id,{idempotencyKey:randomUUID(),purpose,targets,confirmedAmountCents:amount});await processDigitalRefund(r.id,finance);
    }
    const q=await quote();assert.equal(q.priceCents,611);assert.equal(q.completion!.creditCents,379);assert.equal(q.completion!.sources.length,3);
    assert.equal(await runtime.digitalEntitlement.count({where:{lineId:line(1).id,status:"REVOKED"}}),1);
    assert.equal(await runtime.digitalDocument.count({where:{orderId:basket.id,kind:"CREDIT_NOTE"}}),2);
  });
  await check("fully refunded PRICE_REDUCTION retains source rights as zero-credit evidence, not a positive reusable credit",async()=>{
    const r=await requestDigitalRefund(actor,separate.id,{idempotencyKey:randomUUID(),purpose:"PRICE_REDUCTION",targets:[{lineId:separate.lines[0].id,amountCents:89}],confirmedAmountCents:89});await processDigitalRefund(r.id,finance);
    const q=await quote();assert.equal(q.priceCents,700);assert.equal(q.completion!.creditCents,290);assert.equal(q.completion!.sources.find(s=>s.sourceLineId===separate.lines[0].id)!.creditCents,0);
    assert.equal((await runtime.digitalOrder.findUniqueOrThrow({where:{id:separate.id}})).status,"REFUNDED");assert.equal(await runtime.digitalEntitlement.count({where:{lineId:separate.lines[0].id,status:"ACTIVE"}}),1);
  });
  await check("album price/content changes re-quote exact current amounts while unrelated removed source cannot leak credit",async()=>{
    assert.equal((await quote({...album,priceCents:1240,version:album.version+1})).priceCents,950);
    assert.equal((await quote({...album,tracks:tracks.slice(1)})).completion!.creditCents,184);
    await assert.rejects(()=>quote({...album,priceCents:290}),{code:"COMPLETION_ZERO_REQUIRES_REVIEW"});
    await assert.rejects(()=>quote({...album,tracks:[{...tracks[0],masterId:randomUUID()},...tracks.slice(1)]}),{code:"COMPLETION_SOURCE_REQUIRES_REVIEW"});
  });
  const q=await quote();
  async function target(){const o=await owner.digitalOrder.create({data:{userId:buyer.id,idempotencyKey:randomUUID(),cartRevision:2,totalCents:q.priceCents,termsVersion:DIGITAL_TERMS_VERSION,termsHash:"a".repeat(64),
    lines:{create:{offerId:album.id,scope:"ALBUM",title:album.title,offerVersion:album.version,priceCents:q.priceCents,trackSnapshot:json(album.tracks),completionSnapshot:json(q.completion!),taxSnapshot:{status:"LOCAL_REVIEW_ONLY"}}}},include:{lines:true}});createdOrderIds.push(o.id);return o;}
  const contenders=await Promise.all([target(),target()]);let winner:(typeof contenders)[number]|undefined;
  await check("concurrent non-owner transactions commit only one reservation group, with durable atomic canonical-track uniqueness",async()=>{
    const settled=await Promise.allSettled(contenders.map(o=>runtime.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-user:${buyer.id}`})) IS NULL AS locked`;
      const current=(await applyDigitalCompletions(tx,buyer.id,[album],await own()))[0];await reserveDigitalCompletion(tx,buyer.id,o.lines[0].id,current.completion!);return o;
    })));
    assert.equal(settled.filter(s=>s.status==="fulfilled").length,1);const success=settled.find(s=>s.status==="fulfilled");assert.ok(success?.status==="fulfilled");winner=success.value;
    assert.equal(await runtime.digitalCompletionCredit.count({where:{userId:buyer.id,status:"RESERVED"}}),2);
    assert.equal(await runtime.digitalCompletionCredit.count({where:{sourceLineId:separate.lines[0].id}}),0);
    const loser=contenders.find(o=>o.id!==winner!.id)!;await owner.digitalOrder.update({where:{id:loser.id},data:{status:"FAILED"}});
    const positive=q.completion!.sources.find(s=>s.creditCents>0)!;
    await assert.rejects(()=>runtime.digitalCompletionCredit.create({data:{userId:buyer.id,trackId:positive.trackId,sourceLineId:positive.sourceLineId,targetLineId:loser.lines[0].id,amountCents:positive.creditCents,sourceNetCents:positive.availableCents}}));
  });
  await check("zero source stays verified; consumption is idempotent and terminal credit cannot release after completion refund",async()=>{
    assert.ok(winner);await runtime.$transaction(async tx=>{await verifyDigitalCompletions(tx,winner!.id,buyer.id);await consumeDigitalCompletions(tx,winner!.id);await consumeDigitalCompletions(tx,winner!.id);await releaseDigitalCompletions(tx,winner!.id);});
    assert.equal(await runtime.digitalCompletionCredit.count({where:{userId:buyer.id,status:"CONSUMED"}}),2);
    await owner.digitalOrder.update({where:{id:winner!.id},data:{status:"PAID"}});
    await owner.digitalEntitlement.createMany({data:tracks.map(t=>({userId:buyer.id,lineId:winner!.lines[0].id,masterId:t.masterId,status:"ACTIVE"}))});
    await runtime.$transaction(tx=>verifyDigitalCompletions(tx,winner!.id,buyer.id));
    await assert.rejects(()=>quote(),{code:"ALREADY_OWNED"});
  });
  await check("new completion target cannot rewrite frozen proof; pre-existing acquisitions/catalogue/documents remain byte-identical",async()=>{
    assert.ok(winner);await assert.rejects(()=>runtime.digitalOrderLine.update({where:{id:winner!.lines[0].id},data:{priceCents:1}}));
    const oldIds=beforeOrders.map(o=>o.id);const afterOrders=await owner.digitalOrder.findMany({where:{id:{in:oldIds}},orderBy:{id:"asc"},select:historicalSelect});
    const afterCatalogue=await owner.project.findUniqueOrThrow({where:{id:offer.projectId},include:historicalCatalogue});
    assert.equal(stable({beforeOrders:afterOrders,beforeCatalogue:afterCatalogue}),beforeHash);
  });
  await mkdir("output/dcn-launch",{recursive:true});
  await writeFile("output/dcn-launch/completion-complex-runtime.json",JSON.stringify({scope:"LOCAL_POSTGRES_NON_OWNER_REPOSITORY_FIXTURES_AND_FINANCE_DOUBLES",database:"lnx_dcn_consolidation_test",role:"dcn_runtime_a",runId,results,
    syntheticPaidFixture:true,providerCalls:0,externalRequests:0,mediaPublicationTest:false,newQaOrderIds:createdOrderIds,creditCents:290,payableCents:700,consumedPositiveCredits:2,zeroCreditSourceReservations:0,
    existingCatalogueAndAcquisitionsUnchanged:true,historicalProofHash:beforeHash,cleanup:"No acquisition/document/master deleted; test orders retained"},null,2));
  console.log(`COMPLETION_COMPLEX_RUNTIME_PASS=${results.length}`);
}finally{await runtime.$disconnect();await owner.$disconnect();}
