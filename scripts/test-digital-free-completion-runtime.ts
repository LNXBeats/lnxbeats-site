/** New isolated QA copy only: actual non-owner transactions and local files.
 * Source paid orders are explicit synthetic fixtures. No PSP, mail or real rights approval.
 */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile,stat,mkdir,writeFile} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import {syncBuiltinESMExports} from "node:module";
import {execFileSync} from "node:child_process";
import {PrismaPg} from "@prisma/adapter-pg";
import {PrismaClient,type Prisma} from "@/generated/prisma/client";
import {assertSafeDigitalLocalPostgresUrl} from "@/lib/digital/local-review-database";
const blocked=()=>{throw Error("FREE_COMPLETION_EXTERNAL_NETWORK_FORBIDDEN");};
http.request=blocked as typeof http.request;http.get=blocked as typeof http.get;https.request=blocked as typeof https.request;https.get=blocked as typeof https.get;
globalThis.fetch=blocked as typeof fetch;tls.connect=blocked as typeof tls.connect;
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(this:net.Socket,...args:unknown[]){const arg=args[0],host=typeof arg==="object"&&arg!==null&&"host"in arg?arg.host:args[1],port=typeof arg==="object"&&arg!==null&&"port"in arg?arg.port:arg;
  assert.equal(host,"127.0.0.1");assert.equal(Number(port),55473);return Reflect.apply(connect,this,args) as net.Socket;} as typeof connect;syncBuiltinESMExports();
async function profile(name:string){assert.equal((await stat(name)).mode&0o077,0);return JSON.parse(await readFile(name,"utf8")) as Record<string,string>;}
const config=await profile(".private/dcn-france-commercial-config.json"),target=assertSafeDigitalLocalPostgresUrl(config.DATABASE_URL);
assert.equal(target.hostname,"127.0.0.1");assert.equal(target.port,"55473");assert.equal(target.pathname,"/lnx_dcn_france_commercial_test_20261015");assert.equal(target.username,"dcn_runtime_a");assert.equal(target.searchParams.get("options"),"-c timezone=UTC");
assert.equal(config.DCN_NEW_PAYMENTS_ENABLED,"false");assert.equal(config.EMAIL_PROVIDER,"capture");assert.equal(config.MEDIA_STORAGE_DRIVER,"local");
assert.ok(config.MEDIA_LOCAL_PRIVATE_ROOT.startsWith("/private/tmp/"));assert.ok(config.MEDIA_LOCAL_PUBLIC_ROOT.startsWith("/private/tmp/"));
const ownerConfig=await profile(".private/dcn-consolidation-owner-config.json"),ownerUrl=assertSafeDigitalLocalPostgresUrl(ownerConfig.DATABASE_URL);
assert.equal(ownerUrl.pathname,"/lnx_dcn_consolidation_test");assert.equal(ownerUrl.username,"dcn_owner");ownerUrl.pathname=target.pathname;ownerUrl.searchParams.set("options","-c timezone=UTC");
for(const key of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|RAILWAY|S3|R2|AWS|SMTP/i.test(key))delete process.env[key];
Object.assign(process.env,config,{NODE_ENV:"test",DCN_ENABLED:"true",DCN_LOCAL_REVIEW_AUTHORIZED:"true",DCN_NEW_PAYMENTS_ENABLED:"false",DCN_EXTERNAL_TEST_AUTHORIZED:"false",ADS_ENABLED:"false"});
const owner=new PrismaClient({adapter:new PrismaPg({connectionString:ownerUrl.toString()})}),runtime=(await import("@/lib/prisma")).prisma;
// Archives normally run in a separate worker. Do not carry the test harness's
// accumulated Prisma/PDF/audio buffers into the measured 512 MiB worker budget.
if(process.argv[2]==="--archive-only"){
  try{const {digitalUuid}=await import("@/lib/digital/domain"),{processDigitalArchives}=await import("@/lib/digital/archive-worker"),lineId=process.argv[3];assert.ok(digitalUuid(lineId));
    const line=await runtime.digitalOrderLine.findUniqueOrThrow({where:{id:lineId},include:{order:true,offer:{include:{project:true}}}});
    assert.ok(line.offer.project.slug.startsWith("free-completion-"));assert.equal(line.order.status,"GRANTED");
    const result=await processDigitalArchives({lineIds:[lineId]});console.log(JSON.stringify(result));
  }finally{await runtime.$disconnect();await owner.$disconnect();}process.exit(0);
}
const runId=randomUUID(),results:Array<{name:string;status:"PASS"}>=[],createdIds:{projectId:string;sourceOrderId:string;grantOrderId?:string}[]=[];
const json=(v:unknown)=>v as Prisma.InputJsonValue;
const stable=(v:unknown)=>createHash("sha256").update(JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x)).digest("hex");
async function check(name:string,run:()=>Promise<void>){await run();results.push({name,status:"PASS"});console.log(`PASS ${name}`);}
try{
  const identity=await runtime.$queryRaw<Array<{role:string;owner:boolean;superuser:boolean;zone:string}>>`SELECT current_user AS role,rolsuper AS superuser,(SELECT datdba=current_user::regrole FROM pg_database WHERE datname=current_database()) AS owner,current_setting('TimeZone') AS zone FROM pg_roles WHERE rolname=current_user`;
  assert.deepEqual(identity,[{role:"dcn_runtime_a",superuser:false,owner:false,zone:"UTC"}]);
  const {createDigitalFreeCompletion}=await import("@/lib/digital/free-completion"),{quote,syncCart}=await import("@/lib/digital/catalog"),
    {processDigitalDocuments,digitalDocumentResponse,acknowledgeDigitalContract}=await import("@/lib/digital/documents"),
    {createDigitalDownload,digitalDownloadResponse}=await import("@/lib/digital/library"),{ensureDigitalArchive}=await import("@/lib/digital/archive-worker"),
    {processDigitalNotifications}=await import("@/lib/digital/notifications"),
    {DIGITAL_FRANCE_TERMS_VERSION,DIGITAL_FRANCE_TERMS_TEXT_HASH}=await import("@/lib/digital/france-legal"),
    {recordDigitalRightsReviews}=await import("@/lib/digital/rights-review-service"),{getMediaObject,putMediaObject}=await import("@/lib/media/storage"),
    {billingSnapshotHash}=await import("@/lib/billing/domain");
  const buyer=await owner.user.findUniqueOrThrow({where:{email:"dcn12-review-member@example.invalid"}});assert.equal(buyer.status,"ACTIVE");assert.equal(buyer.emailVerified,true);
  assert.equal(await runtime.digitalOrder.count({where:{userId:buyer.id,status:{in:["PENDING","REQUIRES_REVIEW","DISPUTED"]}}}),0);
  const actor={id:buyer.id,email:buyer.email,name:buyer.displayName,role:buyer.role,status:"ACTIVE" as const,emailVerified:true as const};
  const history=await owner.digitalOrder.findMany({orderBy:{id:"asc"},include:{lines:{orderBy:{id:"asc"}},documents:{orderBy:{id:"asc"}},attempts:{orderBy:{id:"asc"}},fulfillment:true}});
  const historicalMasterRows=await owner.digitalMaster.findMany({orderBy:{id:"asc"}}),historicalEntitlements=await owner.digitalEntitlement.findMany({orderBy:{id:"asc"}}),historyHash=stable({history,historicalMasterRows,historicalEntitlements});
  const {digitalCommercialAudioReady,DIGITAL_MP3_ENCODER_VERSION}=await import("@/lib/digital/formats");
  const originals=await owner.digitalMaster.findMany({where:{status:"READY",encoderVersion:DIGITAL_MP3_ENCODER_VERSION,
    masterAsset:{storageBackend:"LOCAL",sizeBytes:{lt:32000000n}},mp3AssetId:{not:null},previewAssetId:{not:null}},
    orderBy:{createdAt:"desc"},take:2,include:{masterAsset:true,mp3Asset:true,previewAsset:true}});
  assert.equal(originals.length,2);assert.ok(originals.every(digitalCommercialAudioReady));
  const mediaBytes=await Promise.all(originals.map(async m=>{assert.ok(m.mp3Asset&&m.previewAsset);return Promise.all([m.masterAsset,m.mp3Asset,m.previewAsset].map(async a=>{
    assert.equal(a!.storageBackend,"LOCAL");assert.ok(a!.sizeBytes<32000000n);const o=await getMediaObject(a!);const bytes=Buffer.from(await new Response(o.body as BodyInit).arrayBuffer());
    assert.equal(bytes.length,Number(a!.sizeBytes));assert.equal(createHash("sha256").update(bytes).digest("hex"),a!.checksumSha256);return bytes;}));}));
  const admin=await owner.user.create({data:{email:`free-completion-admin-${runId}@example.invalid`,role:"ADMIN",status:"ACTIVE",emailVerified:true,displayName:"Synthetic local free-completion reviewer"}}),
    reviewer={id:admin.id,email:admin.email,name:admin.displayName,role:admin.role,status:"ACTIVE" as const,emailVerified:true as const};
  async function fixtureAlbum(index:number,priceCents:number){
    const max=await owner.project.aggregate({_max:{catalogPosition:true}}),project=await owner.project.create({data:{slug:`free-completion-${runId}-${index}`,title:`QA free completion ${index}`,type:"ALBUM",status:"PUBLISHED",publicVisible:true,
      catalogPosition:(max._max.catalogPosition??0)+1,shortDescription:"Synthetic local TEST fixture. Not a real album release or rights approval.",tracks:{create:[1,2].map(position=>({title:`QA free track ${index}.${position}`,position,status:"RELEASED"}))}},include:{tracks:{orderBy:{position:"asc"}}}});
    const pinned=[];
    for(const [i,t]of project.tracks.entries()){
      const m=originals[i],sourceAssets=[m.masterAsset,m.mp3Asset!,m.previewAsset!],assets=[];
      for(const [j,a]of sourceAssets.entries()){
        const storageKey=j===2?`catalog/audio-previews/${randomUUID()}.mp3`:`digital/masters/${t.id}/${randomUUID()}.${j===0?"wav":"mp3"}`;
        await putMediaObject({scope:j===2?"public":"private",key:storageKey,body:mediaBytes[i][j],contentLength:mediaBytes[i][j].length,contentType:a.mimeType,checksumSha256:a.checksumSha256!});
        assets.push(await owner.asset.create({data:{type:a.type,visibility:a.visibility,storageBackend:"LOCAL",storageProvider:"local",storageKey,filename:`qa-free-${index}-${i}-${j}.${j===0?"wav":"mp3"}`,
          sizeBytes:a.sizeBytes,durationMs:a.durationMs,mimeType:a.mimeType,checksumSha256:a.checksumSha256,rightsStatus:"CLEARED",rightsNote:"SYNTHETIC_QA_METADATA_AND_LOCAL_COPY_NOT_A_REAL_RIGHTS_APPROVAL"}}));
      }
      const master=await owner.digitalMaster.create({data:{trackId:t.id,version:1,status:"READY",codec:m.codec,masterAssetId:assets[0].id,mp3AssetId:assets[1].id,previewAssetId:assets[2].id,
        mp3BitrateKbps:m.mp3BitrateKbps,encoderVersion:m.encoderVersion,previewStartMs:m.previewStartMs,previewDurationMs:m.previewDurationMs}});
      pinned.push({trackId:t.id,masterId:master.id,title:t.title,position:t.position,formats:["WAV","MP3"] as ["WAV","MP3"],wavAssetId:assets[0].id,mp3AssetId:assets[1].id});
    }
    await recordDigitalRightsReviews(reviewer,{projectId:project.id,masterIds:pinned.map(t=>t.masterId),expectedReviews:pinned.map(t=>({masterId:t.masterId,reviewId:null})),status:"APPROVED",privateEvidenceReference:`private-evidence:synthetic/free-${runId}-${index}`,evidenceSha256:"a".repeat(64),attested:true,reason:"Synthetic local fixture only, no real rights approval.",idempotencyKey:randomUUID()});
    const single=await owner.digitalOffer.create({data:{scope:"TRACK",projectId:project.id,trackId:pinned[0].trackId,priceCents:149,active:true,rightsConfirmed:true}}),album=await owner.digitalOffer.create({data:{scope:"ALBUM",projectId:project.id,priceCents,active:true,rightsConfirmed:true}});
    const source=await owner.digitalOrder.create({data:{userId:buyer.id,idempotencyKey:randomUUID(),cartRevision:0,status:"PAID",totalCents:149,termsVersion:"SYNTHETIC_PAID_SOURCE_NO_PSP",termsHash:"b".repeat(64),
      lines:{create:{offerId:single.id,scope:"TRACK",title:pinned[0].title,priceCents:149,offerVersion:1,trackSnapshot:json([pinned[0]]),taxSnapshot:{status:"SYNTHETIC_QA_SOURCE_ONLY"}}},
      attempts:{create:{provider:"STRIPE",status:"PAID",idempotencyKey:`synthetic-source-${randomUUID()}`,providerReference:`synthetic-source-session-${randomUUID()}`,paymentReference:`synthetic-source-payment-${randomUUID()}`}}},include:{lines:true}});
    await owner.digitalEntitlement.create({data:{userId:buyer.id,lineId:source.lines[0].id,masterId:pinned[0].masterId}});
    createdIds.push({projectId:project.id,sourceOrderId:source.id});return{album,pinned,source};
  }
  await mkdir("output/dcn-france-commercial",{recursive:true});await mkdir("output/pdf",{recursive:true});
  for(const [index,sameKey,price]of[[1,true,100],[2,false,149]] as const){
    const f=await fixtureAlbum(index,price),cart=await runtime.digitalCart.findUnique({where:{userId:buyer.id}}),synced=await syncCart(buyer.id,[f.album.id],cart?.revision??0);
    const q=await quote([f.album.id],buyer.id);assert.equal(q.totalCents,0);assert.equal(q.lines[0].completion?.eligibleCents,149);
    const input={idempotencyKey:randomUUID(),revision:synced.revision,termsVersion:DIGITAL_FRANCE_TERMS_VERSION,termsAccepted:true,earlyDelivery:true,withdrawalAcknowledged:true,
      jurisdiction:{countryCode:"FR",residenceCountryCode:"FR",billingCountryCode:"FR",customerType:"B2C",residencePostalCode:"20000",billingPostalCode:"75001",residenceConfirmed:true}};
    let grantedId="";
    await check(`postgres_concurrent_${sameKey?"same":"different"}_keys_grant_exactly_one_free_acquisition`,async()=>{
      const contenders=await Promise.allSettled([createDigitalFreeCompletion(actor,input,{localQaFixture:true}),createDigitalFreeCompletion(actor,{...input,idempotencyKey:sameKey?input.idempotencyKey:randomUUID()},{localQaFixture:true})]);
      assert.equal(contenders.filter(c=>c.status==="fulfilled").length,sameKey?2:1);const winner=contenders.find(c=>c.status==="fulfilled");assert.ok(winner?.status==="fulfilled");grantedId=winner.value.orderId;
      if(sameKey)assert.ok(contenders.every(c=>c.status==="fulfilled"&&c.value.orderId===grantedId));
      assert.equal(await runtime.digitalOrder.count({where:{lines:{some:{offerId:f.album.id}},status:"GRANTED"}}),1);
      assert.equal(await runtime.digitalPaymentAttempt.count({where:{orderId:grantedId}}),0);assert.equal(await runtime.digitalDocument.count({where:{orderId:grantedId,kind:"INVOICE"}}),0);
      assert.equal(await runtime.digitalDocument.count({where:{orderId:grantedId,kind:"CONTRACT"}}),1);assert.equal(await runtime.digitalEntitlement.count({where:{line:{orderId:grantedId},status:"ACTIVE"}}),2);
      assert.equal(await runtime.digitalCompletionCredit.count({where:{targetLine:{orderId:grantedId},status:"CONSUMED"}}),1);createdIds[index-1].grantOrderId=grantedId;
    });
    await check(`free_${index}_proof_exact_france_draft_hash_surplus_and_unique_audit`,async()=>{
      const o=await runtime.digitalOrder.findUniqueOrThrow({where:{id:grantedId}}),d=await runtime.digitalDocument.findUniqueOrThrow({where:{businessKey:`contract:${grantedId}`}}),proof=d.snapshot as {contract:{terms:{status:string}};supply:{eligibleCents:number;appliedCreditCents:number;surplusCents:number;reusableBalanceCents:number;amountChargedCents:number}};
      assert.equal(o.status,"GRANTED");assert.equal(o.totalCents,0);assert.equal(o.termsVersion,DIGITAL_FRANCE_TERMS_VERSION);assert.equal(o.termsHash,DIGITAL_FRANCE_TERMS_TEXT_HASH);assert.equal(proof.contract.terms.status,"DRAFT");
      assert.equal(billingSnapshotHash(d.snapshot),d.snapshotHash);assert.equal(billingSnapshotHash(proof.contract),billingSnapshotHash(o.contractSnapshot));assert.deepEqual(proof.supply,{kind:"FREE_ALBUM_COMPLETION",amountChargedCents:0,eligibleCents:149,appliedCreditCents:price,surplusCents:149-price,reusableBalanceCents:0,paymentAttemptCreated:false,invoiceCreated:false,policy:"LOCAL_QA_FREE_COMPLETION_V1"});
      assert.equal(await runtime.digitalEvent.count({where:{orderId:grantedId,kind:"FREE_ALBUM_COMPLETION_GRANTED"}}),1);
    });
    await check(`free_${index}_document_download_receipt_and_local_email_without_claim_of_payment`,async()=>{
      assert.equal((await processDigitalDocuments(10,undefined,grantedId)).ready,1);const d=await runtime.digitalDocument.findUniqueOrThrow({where:{businessKey:`contract:${grantedId}`}});assert.equal(d.status,"READY");
      const bytes=Buffer.from(await(await digitalDocumentResponse(actor,d.id)).arrayBuffer());assert.ok(bytes.subarray(0,5).equals(Buffer.from("%PDF-")));
      await writeFile(`output/pdf/dcn-free-completion-${index}.pdf`,bytes);await acknowledgeDigitalContract(buyer.id,grantedId,d.id,d.snapshotHash);
      const delivered=await runtime.digitalFulfillment.findUniqueOrThrow({where:{orderId:grantedId}});assert.ok(delivered.accessReadyAt);
      const email=await processDigitalNotifications(10,undefined,grantedId);assert.equal(email.sent,0);assert.equal(email.captured,2);
      const mail=await runtime.digitalNotification.findUniqueOrThrow({where:{businessKey:`contract-mail:${grantedId}`}});assert.equal(mail.status,"CAPTURED_QA");assert.equal(mail.sentAt,null);
      const template=mail.template as {text:string};assert.match(template.text,/sans nouveau paiement/);assert.doesNotMatch(template.text,/Votre paiement est confirmé/);
      await writeFile(`output/dcn-france-commercial/free-completion-mail-${index}.txt`,template.text);
    });
    await check(`free_${index}_acquired_wav_mp3_and_both_zips_use_actual_local_bytes`,async()=>{
      const line=await runtime.digitalOrderLine.findFirstOrThrow({where:{orderId:grantedId}});
      for(const format of["WAV","MP3"] as const){
        const ticket=await createDigitalDownload(buyer.id,line.id,f.pinned[0].masterId,format),response=await digitalDownloadResponse(buyer.id,ticket.ticketId,ticket.token),bytes=Buffer.from(await response.arrayBuffer());
        assert.equal(response.status,200);assert.equal(createHash("sha256").update(bytes).digest("hex"),originals[0][format==="WAV"?"masterAsset":"mp3Asset"]!.checksumSha256);
        await ensureDigitalArchive(line.id,format);
        const worker=execFileSync(process.execPath,["--import","tsx",import.meta.filename,"--archive-only",line.id],{encoding:"utf8",env:process.env,maxBuffer:1048576,timeout:30000});
        const result=JSON.parse(worker.trim()) as {ready:boolean};assert.equal(result.ready,true);
        const zipTicket=await createDigitalDownload(buyer.id,line.id,null,format),zip=Buffer.from(await(await digitalDownloadResponse(buyer.id,zipTicket.ticketId,zipTicket.token)).arrayBuffer());assert.equal(zip.readUInt32LE(0),0x04034b50);
      }
      await assert.rejects(()=>quote([f.album.id],buyer.id),{code:"ALREADY_OWNED"});
    });
  }
  await check("historical_acquisitions_documents_masters_entitlements_are_unchanged",async()=>{
    const after=await owner.digitalOrder.findMany({where:{id:{in:history.map(o=>o.id)}},orderBy:{id:"asc"},include:{lines:{orderBy:{id:"asc"}},documents:{orderBy:{id:"asc"}},attempts:{orderBy:{id:"asc"}},fulfillment:true}}),
      masters=await owner.digitalMaster.findMany({where:{id:{in:historicalMasterRows.map(m=>m.id)}},orderBy:{id:"asc"}}),rights=await owner.digitalEntitlement.findMany({where:{id:{in:historicalEntitlements.map(e=>e.id)}},orderBy:{id:"asc"}});
    assert.equal(stable({history:after,historicalMasterRows:masters,historicalEntitlements:rights}),historyHash);
  });
  await writeFile("output/dcn-france-commercial/free-completion-runtime.json",JSON.stringify({scope:"REAL_POSTGRES_NON_OWNER_NEW_QA_COPY_AND_LOCAL_FILES_ONLY",database:target.pathname.slice(1),role:"dcn_runtime_a",runId,results,createdFixtures:createdIds,
    sourcePayments:"SYNTHETIC_OWNER_FIXTURES_NOT_PSP_RECEIPTS",residenceEvidence:"SERVER_AUTHORIZED_LOCAL_FIXTURE_NOT_RESIDENCE_APPROVAL",audio:"LOCAL_COPIES_OF_EXISTING_QA_BYTES_NEW_ASSETS_NO_PUBLICATION_RECIPE",
    externalProviderCalls:0,externalRequests:0,realEmailsSent:0,newFreePaymentAttempts:0,newFreeInvoices:0,historicalRowsUnchanged:true,historicalProofHash:historyHash,cleanup:"No acquisitions/documents/masters deleted; all fixtures retained"},null,2));
  console.log(`FREE_COMPLETION_RUNTIME_PASS=${results.length}`);
}finally{await runtime.$disconnect();await owner.$disconnect();}
