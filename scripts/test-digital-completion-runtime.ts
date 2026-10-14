/** Isolated local PostgreSQL + provider doubles. Never a Stripe/PayPal/R2 recipe. */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile,stat,writeFile,mkdir} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import {syncBuiltinESMExports} from "node:module";
import {PrismaPg} from "@prisma/adapter-pg";
import {PrismaClient} from "@/generated/prisma/client";
import {assertSafeLocalPostgresUrl} from "@/lib/database/local-postgres-url";
import type {DigitalGateway} from "@/lib/digital/providers";
import type {DigitalPaymentEvidence} from "@/lib/digital/domain";
import type {DigitalFinanceGateway,DigitalRefundRequest} from "@/lib/digital/finance-policy";

const blocked=()=>{throw Error("COMPLETION_RUNTIME_EXTERNAL_NETWORK_FORBIDDEN");};
http.request=blocked as typeof http.request;http.get=blocked as typeof http.get;
https.request=blocked as typeof https.request;https.get=blocked as typeof https.get;globalThis.fetch=blocked as typeof fetch;tls.connect=blocked as typeof tls.connect;
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(this:net.Socket,...args:unknown[]){const options=args[0];
  const host=typeof options==="object"&&options!==null&&"host"in options?options.host:args[1];
  const port=typeof options==="object"&&options!==null&&"port"in options?options.port:options;
  assert.equal(host,"127.0.0.1");assert.equal(Number(port),55473);return Reflect.apply(connect,this,args) as net.Socket;
} as typeof connect;syncBuiltinESMExports();
async function profile(path:string){assert.equal((await stat(path)).mode&0o077,0);return JSON.parse(await readFile(path,"utf8")) as Record<string,string>;}
const configuration=await profile(".private/dcn-consolidation-config.json"),ownerConfiguration=await profile(".private/dcn-consolidation-owner-config.json");
for(const p of [configuration,ownerConfiguration]){const url=assertSafeLocalPostgresUrl(p.DATABASE_URL);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"55473");assert.equal(url.pathname,"/lnx_dcn_consolidation_test");}
assert.equal(new URL(configuration.DATABASE_URL).username,"dcn_runtime_a");assert.equal(new URL(ownerConfiguration.DATABASE_URL).username,"dcn_owner");
for(const key of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|RAILWAY|S3|R2|AWS|SMTP/i.test(key))delete process.env[key];
Object.assign(process.env,configuration,{NODE_ENV:"test",DCN_NEW_PAYMENTS_ENABLED:"true",DCN_EXTERNAL_TEST_AUTHORIZED:"false",PAYMENT_DEPLOYMENT_ENV:"test",ADS_ENABLED:"false"});
const owner=new PrismaClient({adapter:new PrismaPg({connectionString:ownerConfiguration.DATABASE_URL})});
const runtime=(await import("@/lib/prisma")).prisma;
const results:Array<{name:string;status:"PASS"}>=[];
async function check(name:string,run:()=>Promise<void>){await run();results.push({name,status:"PASS"});console.log(`PASS ${name}`);}
const runId=randomUUID();let providerCreates=0;
const merchant="dcn-consolidation-completion";
const gateway:DigitalGateway={merchantId:merchant,async create(order){providerCreates++;return{id:`cs_test_local_${order.id}`,url:"https://checkout.stripe.com/c/local-double-only"};},async recover(){throw Error("No provider recovery in this local test");}};
const finance:DigitalFinanceGateway={merchantId:merchant,async refund(r){return refundProof(r);},async recoverRefund(){throw Error("No provider request");},async readRefund(){throw Error("No provider request");},async readDispute(){throw Error("No provider request");}};
function refundProof(r:DigitalRefundRequest){return{orderId:r.orderId,reference:`re_local_${r.id}`,provider:"STRIPE" as const,paymentReference:r.paymentReference,amountCents:r.amountCents,
  currency:"EUR",status:"SUCCEEDED" as const,mode:"TEST" as const,authenticated:true,merchantId:merchant};}
try{
  const identity=await runtime.$queryRaw<Array<{role:string;superuser:boolean;owner:boolean}>>`SELECT current_user AS role,rolsuper AS superuser,(SELECT datdba=current_user::regrole FROM pg_database WHERE datname=current_database()) AS owner FROM pg_roles WHERE rolname=current_user`;
  assert.equal(identity[0].role,"dcn_runtime_a");assert.equal(identity[0].superuser,false);assert.equal(identity[0].owner,false);
  const [{createDigitalCheckout,reconcileDigitalEvidence},{syncCart,quote},{requestDigitalRefund,processDigitalRefund,recordDigitalRefundEvidence},{DIGITAL_TERMS_VERSION}]=await Promise.all([
    import("@/lib/digital/commerce"),import("@/lib/digital/catalog"),import("@/lib/digital/finance"),import("@/lib/digital/domain")]);
  const {processDigitalDocuments,digitalDocumentResponse,acknowledgeDigitalContract}=await import("@/lib/digital/documents");
  const {createDigitalDownload}=await import("@/lib/digital/library");
  const {verifyDigitalCompletions}=await import("@/lib/digital/completion");
  const admin=await owner.user.create({data:{email:`completion-admin-${runId}@example.invalid`,role:"ADMIN",emailVerified:true,status:"ACTIVE",displayName:"Local completion QA"}});
  const buyer=await owner.user.create({data:{email:`completion-buyer-${runId}@example.invalid`,role:"MEMBER",emailVerified:true,status:"ACTIVE",displayName:"Local completion buyer"}});
  const actor=(u:typeof admin)=>({id:u.id,email:u.email,name:u.displayName,role:u.role,status:"ACTIVE" as const,emailVerified:true as const});
  const max=await owner.project.aggregate({_max:{catalogPosition:true}});
  const project=await owner.project.create({data:{slug:`completion-${runId}`,title:"QA completion — fictitious prices",type:"ALBUM",status:"PUBLISHED",publicVisible:true,catalogPosition:(max._max.catalogPosition??0)+1,
    tracks:{create:Array.from({length:12},(_,i)=>({title:`Completion QA ${i+1}`,position:i+1,status:"RELEASED" as const}))}},include:{tracks:{orderBy:{position:"asc"}}}});
  for(const t of project.tracks){const common={storageBackend:"LOCAL" as const,storageProvider:"local",sizeBytes:12n,checksumSha256:"a".repeat(64),durationMs:1000,rightsStatus:"CLEARED" as const};
    const wav=await owner.asset.create({data:{...common,type:"AUDIO",visibility:"PRIVATE",mimeType:"audio/wav",filename:"local-completion.wav",storageKey:`digital/masters/${t.id}/${randomUUID()}.wav`}});
    const mp3=await owner.asset.create({data:{...common,type:"AUDIO",visibility:"PRIVATE",mimeType:"audio/mpeg",filename:"local-completion.mp3",storageKey:`digital/masters/${t.id}/${randomUUID()}.mp3`}});
    const preview=await owner.asset.create({data:{...common,type:"AUDIO_PREVIEW",visibility:"PUBLIC",mimeType:"audio/mpeg",filename:"local-preview.mp3",storageKey:`digital/previews/${t.id}/${randomUUID()}.mp3`}});
    await owner.digitalMaster.create({data:{trackId:t.id,version:1,status:"READY",codec:"wav",masterAssetId:wav.id,mp3AssetId:mp3.id,mp3BitrateKbps:256,encoderVersion:"LOCAL-TEST-METADATA-NOT-AUDIO",previewAssetId:preview.id,previewDurationMs:1000}});
  }
  const single=await owner.digitalOffer.create({data:{scope:"TRACK",projectId:project.id,trackId:project.tracks[0].id,priceCents:129,active:true,rightsConfirmed:true}});
  const album=await owner.digitalOffer.create({data:{scope:"ALBUM",projectId:project.id,priceCents:990,active:true,rightsConfirmed:true}});
  const input=(revision:number)=>({revision,idempotencyKey:randomUUID(),provider:"STRIPE",termsVersion:DIGITAL_TERMS_VERSION,earlyDelivery:true,withdrawalAcknowledged:true,
    jurisdiction:{countryCode:"FR",residenceCountryCode:"FR",billingCountryCode:"FR",customerType:"B2C" as const}});
  const checkout=(revision:number)=>createDigitalCheckout(actor(buyer),input(revision),gateway,{localQaFixture:true});
  const paidProof=async(orderId:string,eventId:string):Promise<DigitalPaymentEvidence>=>{const o=await owner.digitalOrder.findUniqueOrThrow({where:{id:orderId},include:{attempts:true}});
    return{eventId:`${eventId}:${runId}`,orderId,provider:"STRIPE",providerReference:o.attempts[0].providerReference!,paymentReference:`pi_local_${o.id}`,amountCents:o.totalCents,currency:"EUR",mode:"TEST",merchantId:merchant,status:"PAID",authenticated:true};};
  let sourceOrderId="",sourceLineId="",completionOrderId="",completionLineId="",invoiceHash="",sourceInvoiceHash="";
  await check("non-owner runtime normal single purchase stays paid and grants one pinned acquisition",async()=>{const c=await syncCart(buyer.id,[single.id],0);
    const o=await checkout(c.revision);sourceOrderId=o.orderId;await reconcileDigitalEvidence(await paidProof(o.orderId,"local-completion-single-paid"),merchant);
    const data=await owner.digitalOrder.findUniqueOrThrow({where:{id:o.orderId},include:{lines:true,documents:true}});assert.equal(data.status,"PAID");sourceLineId=data.lines[0].id;
    sourceInvoiceHash=data.documents.find(d=>d.kind==="INVOICE")!.snapshotHash;assert.equal(await owner.digitalEntitlement.count({where:{lineId:sourceLineId,status:"ACTIVE"}}),1);});
  await check("partial single refund gives immutable credit note and net eligible cents 100",async()=>{const r=await requestDigitalRefund(actor(admin),sourceOrderId,{idempotencyKey:randomUUID(),targets:[{lineId:sourceLineId,amountCents:29}],purpose:"PRICE_REDUCTION",confirmedAmountCents:29});
    await processDigitalRefund(r.id,finance);const q=await quote([album.id],buyer.id);assert.equal(q.totalCents,890);assert.equal(q.lines[0].completion!.creditCents,100);
    assert.equal((await owner.digitalDocument.findUniqueOrThrow({where:{businessKey:`invoice:${sourceOrderId}`}})).snapshotHash,sourceInvoiceHash);
    assert.equal(await owner.digitalDocument.count({where:{orderId:sourceOrderId,kind:"CREDIT_NOTE"}}),1);});
  await check("concurrent album checkout has one winner and one durable source reservation",async()=>{const c=await syncCart(buyer.id,[album.id],1),before=providerCreates;
    const result=await Promise.allSettled([checkout(c.revision),checkout(c.revision)]);
    const winner=result.find(r=>r.status==="fulfilled");assert.ok(winner?.status==="fulfilled");completionOrderId=winner.value.orderId;
    assert.equal(result.filter(r=>r.status==="fulfilled").length,1);assert.equal(result.filter(r=>r.status==="rejected").length,1);assert.equal(providerCreates,before+1);
    const line=await owner.digitalOrderLine.findFirstOrThrow({where:{orderId:completionOrderId}});completionLineId=line.id;assert.equal(line.priceCents,890);
    const credit=await owner.digitalCompletionCredit.findFirstOrThrow({where:{targetLineId:line.id}});assert.equal(credit.status,"RESERVED");assert.equal(credit.amountCents,100);
    await assert.rejects(()=>requestDigitalRefund(actor(admin),sourceOrderId,{idempotencyKey:randomUUID(),targets:[{lineId:sourceLineId,amountCents:1}],purpose:"PRICE_REDUCTION",confirmedAmountCents:1}),{code:"COMPLETION_SOURCE_REFUND_REQUIRES_REVIEW"});});
  await check("confirmed completion consumes credit and grants exact 12-track snapshot with truthful new invoice only",async()=>{
    await reconcileDigitalEvidence(await paidProof(completionOrderId,"local-completion-album-paid"),merchant);
    assert.equal((await owner.digitalOrder.findUniqueOrThrow({where:{id:completionOrderId}})).status,"PAID");
    assert.equal(await owner.digitalEntitlement.count({where:{lineId:completionLineId,status:"ACTIVE"}}),12);assert.equal((await owner.digitalCompletionCredit.findFirstOrThrow({where:{targetLineId:completionLineId}})).status,"CONSUMED");
    const invoice=await owner.digitalDocument.findUniqueOrThrow({where:{businessKey:`invoice:${completionOrderId}`}});invoiceHash=invoice.snapshotHash;
    const data=invoice.snapshot as {totalCents:number;acquired:Array<{completion:{basePriceCents:number;creditCents:number}}>};assert.equal(data.totalCents,890);assert.equal(data.acquired[0].completion.basePriceCents,990);assert.equal(data.acquired[0].completion.creditCents,100);
    await runtime.$transaction(tx=>verifyDigitalCompletions(tx,completionOrderId,buyer.id)); // 12 new album entitlements must not become false source duplicates.
    assert.equal((await owner.digitalDocument.findUniqueOrThrow({where:{businessKey:`invoice:${sourceOrderId}`}})).snapshotHash,sourceInvoiceHash);
  });
  await check("different-event same capture is idempotent after credit consumption",async()=>{const before={documents:await owner.digitalDocument.count({where:{orderId:completionOrderId}}),rights:await owner.digitalEntitlement.count({where:{lineId:completionLineId}})};
    await reconcileDigitalEvidence(await paidProof(completionOrderId,"local-completion-album-paid-second"),merchant);
    assert.equal(await owner.digitalDocument.count({where:{orderId:completionOrderId}}),before.documents);assert.equal(await owner.digitalEntitlement.count({where:{lineId:completionLineId}}),before.rights);assert.equal((await owner.digitalOrder.findUniqueOrThrow({where:{id:completionOrderId}})).status,"PAID");});
  await check("completion contractual confirmation is generated, transferred and acknowledged before track download authorization",async()=>{
    await processDigitalDocuments(10);const doc=await owner.digitalDocument.findUniqueOrThrow({where:{businessKey:`contract:${completionOrderId}`}});assert.equal(doc.status,"READY");
    const response=await digitalDocumentResponse(actor(buyer),doc.id);const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.subarray(0,5).equals(Buffer.from("%PDF-")));
    await acknowledgeDigitalContract(buyer.id,completionOrderId,doc.id,doc.snapshotHash);
    const line=await owner.digitalOrderLine.findUniqueOrThrow({where:{id:completionLineId}}),track=(line.trackSnapshot as Array<{masterId:string}>)[0];
    const wav=await createDigitalDownload(buyer.id,completionLineId,track.masterId,"WAV"),mp3=await createDigitalDownload(buyer.id,completionLineId,track.masterId,"MP3");
    assert.notEqual(wav.ticketId,mp3.ticketId); // Authorization only: format byte streaming is covered by the real audio fixture recipe.
  });
  await check("partial and balance album refunds create two notes without releasing previously consumed credit",async()=>{
    for(const [amountCents,purpose]of [[200,"PRICE_REDUCTION"],[690,"RESOLUTION"]] as const){const r=await requestDigitalRefund(actor(admin),completionOrderId,{idempotencyKey:randomUUID(),targets:[{lineId:completionLineId,amountCents}],purpose,confirmedAmountCents:amountCents});await processDigitalRefund(r.id,finance);
      assert.equal(await owner.digitalEntitlement.count({where:{lineId:completionLineId,status:purpose==="PRICE_REDUCTION"?"ACTIVE":"REVOKED"}}),12);}
    assert.equal(await owner.digitalDocument.count({where:{orderId:completionOrderId,kind:"CREDIT_NOTE"}}),2);assert.equal((await owner.digitalDocument.findUniqueOrThrow({where:{businessKey:`invoice:${completionOrderId}`}})).snapshotHash,invoiceHash);
    assert.equal((await owner.digitalCompletionCredit.findFirstOrThrow({where:{targetLineId:completionLineId}})).status,"CONSUMED");});
  await check("after full completion refund a new track/album download request is denied without creating tickets",async()=>{
    const before=await owner.digitalDownloadTicket.count({where:{lineId:completionLineId}}),line=await owner.digitalOrderLine.findUniqueOrThrow({where:{id:completionLineId}}),track=(line.trackSnapshot as Array<{masterId:string}>)[0];
    for(const format of ["WAV","MP3"] as const){await assert.rejects(()=>createDigitalDownload(buyer.id,completionLineId,track.masterId,format),{code:"NOT_FOUND"});await assert.rejects(()=>createDigitalDownload(buyer.id,completionLineId,null,format),{code:"NOT_FOUND"});}
    assert.equal(await owner.digitalDownloadTicket.count({where:{lineId:completionLineId}}),before);});
  await check("real-world shape pending then confirmed source refund is recorded once, dependent album reviews immediately, no financial movement",async()=>{
    const source=await owner.digitalOrder.findUniqueOrThrow({where:{id:sourceOrderId},include:{attempts:true}});const before=providerCreates;
    const e={orderId:sourceOrderId,reference:`re_local_source_incident_${runId}`,provider:"STRIPE" as const,paymentReference:source.attempts[0].paymentReference!,amountCents:1,currency:"EUR",status:"SUCCEEDED" as const,mode:"TEST" as const,authenticated:true,merchantId:merchant};
    await recordDigitalRefundEvidence({...e,status:"PENDING"},merchant);
    assert.equal((await owner.digitalOrder.findUniqueOrThrow({where:{id:completionOrderId}})).status,"REQUIRES_REVIEW");
    assert.equal((await owner.digitalRefund.findFirstOrThrow({where:{orderId:sourceOrderId,providerReference:e.reference}})).status,"PENDING");
    await recordDigitalRefundEvidence(e,merchant);await recordDigitalRefundEvidence(e,merchant);assert.equal(providerCreates,before);
    assert.equal((await owner.digitalOrder.findUniqueOrThrow({where:{id:completionOrderId}})).status,"REQUIRES_REVIEW");assert.equal(await owner.digitalEvent.count({where:{orderId:completionOrderId,kind:"COMPLETION_SOURCE_FINANCIAL_INCIDENT"}}),1);
    assert.equal(await owner.digitalRefund.count({where:{orderId:sourceOrderId,providerReference:e.reference}}),1);assert.equal((await owner.digitalDocument.findUniqueOrThrow({where:{businessKey:`invoice:${completionOrderId}`}})).snapshotHash,invoiceHash);});
  await check("runtime cannot rewrite credit proof, delete a credit or rewrite immutable source invoice",async()=>{
    const credit=await owner.digitalCompletionCredit.findFirstOrThrow({where:{targetLineId:completionLineId}});
    await assert.rejects(()=>runtime.digitalCompletionCredit.update({where:{id:credit.id},data:{amountCents:99}}));await assert.rejects(()=>runtime.digitalCompletionCredit.delete({where:{id:credit.id}}));
    await assert.rejects(()=>runtime.digitalDocument.update({where:{businessKey:`invoice:${sourceOrderId}`},data:{snapshotHash:"b".repeat(64)}}));});
  await check("database rejects direct second use of the same canonical credited track and changing a completion snapshot",async()=>{
    const target=await owner.digitalOrder.create({data:{userId:buyer.id,idempotencyKey:randomUUID(),cartRevision:999,totalCents:890,termsVersion:DIGITAL_TERMS_VERSION,termsHash:"a".repeat(64),
      lines:{create:{offerId:album.id,scope:"ALBUM",title:"QA forbidden reuse target",priceCents:890,offerVersion:1,trackSnapshot:(await owner.digitalOrderLine.findUniqueOrThrow({where:{id:completionLineId}})).trackSnapshot as never,taxSnapshot:{status:"LOCAL_REVIEW_ONLY"}}}},include:{lines:true}});
    await assert.rejects(()=>runtime.digitalCompletionCredit.create({data:{userId:buyer.id,trackId:project.tracks[0].id,sourceLineId,targetLineId:target.lines[0].id,amountCents:100,sourceNetCents:100}}));
    await assert.rejects(()=>owner.digitalOrderLine.update({where:{id:completionLineId},data:{completionSnapshot:{version:1,basePriceCents:999,creditCents:100,sources:[]}}}));
    assert.equal(await owner.digitalCompletionCredit.count({where:{userId:buyer.id,status:"CONSUMED"}}),1);});
  await mkdir("output/dcn-consolidation",{recursive:true});await writeFile("output/dcn-consolidation/completion-runtime-proof.json",JSON.stringify({scope:"LOCAL_POSTGRES_NON_OWNER_AND_PROVIDER_DOUBLES",database:"lnx_dcn_consolidation_test",role:"dcn_runtime_a",runId,results,
    ids:{projectId:project.id,sourceOrderId,sourceLineId,completionOrderId,completionLineId},providerDoubleCreates:providerCreates,externalRequests:0,priorAcquisitionsMutated:false,invoiceHashes:{sourceInvoiceHash,invoiceHash},proofHash:createHash("sha256").update(JSON.stringify(results)).digest("hex")},null,2));
  console.log(`COMPLETION_RUNTIME_PASS=${results.length}`);
}finally{await runtime.$disconnect();await owner.$disconnect();}
