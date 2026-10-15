import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { createDigitalFreeCompletion, type DigitalFreeCompletionInput } from "@/lib/digital/free-completion";
import { applyDigitalCompletions } from "@/lib/digital/completion";
import { selectionFingerprint } from "@/lib/digital/catalog";
import { DIGITAL_FRANCE_TERMS_VERSION, DIGITAL_FRANCE_TERMS_TEXT_HASH } from "@/lib/digital/france-legal";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DIGITAL_RIGHTS_REVIEW_POLICY,DIGITAL_RIGHTS_REVIEW_EVENT,DIGITAL_RIGHTS_ATTESTATION,digitalRightsMasterBinding,digitalRightsReviewHash } from "@/lib/digital/rights-review-policy";
import { digitalCountsOwnedRights,digitalConfirmationMessage,digitalLibraryPaymentLabel } from "@/lib/digital/library-policy";
import { createDigitalDownload } from "@/lib/digital/library";

const env={DCN_ENABLED:"true",DCN_MODE:"TEST",DCN_NEW_PAYMENTS_ENABLED:"false",DCN_EXTERNAL_TEST_AUTHORIZED:"false",DCN_LOCAL_REVIEW_AUTHORIZED:"true",
  DATABASE_URL:"postgresql://dcn_runtime_a:synthetic_never_connect@127.0.0.1:55473/lnx_dcn_consolidation_test",AUTH_URL:"http://127.0.0.1:3140",MEDIA_STORAGE_DRIVER:"local",EMAIL_PROVIDER:"capture"};

/** Real application services, serialized repository doubles. No PostgreSQL or gateway is used. */
function fixture(albumPrice=100,paidCents=149){
  const userId=randomUUID(),reviewerId=randomUUID(),sourceLineId=randomUUID(),at=new Date(),email="dcn-consolidation-review-member@example.invalid";
  const actor={id:userId,email,status:"ACTIVE",emailVerified:true,role:"MEMBER"} as OrderActor;
  const masters=Array.from({length:2},()=>{const id=randomUUID(),trackId=randomUUID(),wavId=randomUUID(),mp3Id=randomUUID(),previewId=randomUUID();
    const asset={visibility:"PRIVATE",rightsStatus:"CLEARED",mimeType:"audio/wav",durationMs:3000,sizeBytes:100000n,checksumSha256:"a".repeat(64)};
    return{id,trackId,version:1,status:"READY",codec:"wav",encoderVersion:DIGITAL_MP3_ENCODER_VERSION,mp3BitrateKbps:320,previewDurationMs:3000,
      masterAssetId:wavId,mp3AssetId:mp3Id,previewAssetId:previewId,masterAsset:{...asset,id:wavId},mp3Asset:{...asset,id:mp3Id,mimeType:"audio/mpeg"},previewAsset:{...asset,id:previewId,mimeType:"audio/mpeg",visibility:"PUBLIC"}};});
  const tracks=masters.map((m,i)=>({trackId:m.trackId,masterId:m.id,title:`Synthetic ${i+1}`,position:i+1,formats:["WAV","MP3"] as ["WAV","MP3"],wavAssetId:m.masterAssetId,mp3AssetId:m.mp3AssetId}));
  const album={id:randomUUID(),scope:"ALBUM",title:"Synthetic — Album",version:1,priceCents:albumPrice,tracks};
  const source={id:sourceLineId,scope:"TRACK",priceCents:paidCents,trackSnapshot:[tracks[0]],completionSnapshot:null};
  const sourceOrder={id:randomUUID(),status:"PAID",mode:"TEST",currency:"EUR",totalCents:paidCents,lines:[source],attempts:[{status:"PAID",paymentReference:"synthetic-paid-only"}],refunds:[],disputes:[]};
  const acquisitions:Array<Record<string,unknown>>=[{status:"ACTIVE",lineId:sourceLineId,masterId:masters[0].id,master:masters[0],line:{...source,order:sourceOrder}}];
  type Row=Record<string,unknown>;
  const orders:Row[]=[],credits:Row[]=[],documents:Row[]=[],notifications:Row[]=[],events:Row[]=[],rights:Row[]=[];
  const cart={id:randomUUID(),revision:1,lines:[{offerId:album.id,offerVersion:1,priceCents:0,selectionHash:""}]};
  let currentStatus="ACTIVE",verified=true,activeSource=true,failure=false;
  const db={async $queryRaw(){return[];},user:{async findUnique({where}:{where:{id:string}}){return where.id===reviewerId?{id:reviewerId,role:"ADMIN",status:"ACTIVE",emailVerified:true}:{id:userId,email,displayName:"Synthetic buyer",status:currentStatus,emailVerified:verified};}},
    digitalOffer:{async findMany(){return[{...album,active:true,rightsConfirmed:true,project:{title:"Synthetic",status:"PUBLISHED",publicVisible:true,
      tracks:tracks.map((t,i)=>({id:t.trackId,title:t.title,position:t.position,digitalMasters:[masters[i]]}))}}];}},
    digitalMaster:{async findMany(){return masters;}},
    digitalCart:{async findUnique(){return cart;}},
    digitalOrder:{async findUnique({where}:{where:{idempotencyKey:string}}){return orders.find(o=>o.idempotencyKey===where.idempotencyKey)??null;},
      async findFirst(){return orders.find(o=>["PENDING","REQUIRES_REVIEW","DISPUTED"].includes(String(o.status)))??null;},
      async findUniqueOrThrow({where}:{where:{id:string}}){const o=orders.find(o=>o.id===where.id);assert.ok(o);return{...o,user:{email}};},
      async create({data}:{data:Row&{lines:{create:Row}}}){const id=randomUUID(),line={...data.lines.create,id:randomUUID(),orderId:id},o={...data,id,lines:[line],attempts:[]};orders.push(o);return o;}},
    digitalOrderLine:{async findMany({where}:{where:{orderId:string}}){return orders.find(o=>o.id===where.orderId)?.lines??[];}},
    digitalEntitlement:{async findMany({where}:{where:{lineId?:{not:string}}}){return acquisitions.filter(e=>(activeSource||e.lineId!==sourceLineId)&&(!where.lineId||e.lineId!==where.lineId.not));},
      async create({data}:{data:Row}){const order=orders.find(o=>(o.lines as Row[]).some(l=>l.id===data.lineId))!,line=(order.lines as Row[]).find(l=>l.id===data.lineId)!;
        rights.push(data);acquisitions.push({...data,status:"ACTIVE",master:masters.find(m=>m.id===data.masterId),line:{...line,order}});return data;}},
    digitalCompletionCredit:{async findFirst({where}:{where:{trackId:string;targetLineId?:{not:string}}}){return credits.find(c=>c.trackId===where.trackId&&c.status!=="RELEASED"&&(!where.targetLineId||c.targetLineId!==where.targetLineId.not))??null;},
      async create({data}:{data:Row}){const c={...data,status:"RESERVED"};credits.push(c);return c;},
      async findMany({where}:{where:{targetLineId:string}}){return credits.filter(c=>c.targetLineId===where.targetLineId&&c.status!=="RELEASED");},
      async updateMany(){for(const c of credits)if(c.status==="RESERVED")c.status="CONSUMED";return{count:credits.length};}},
    digitalDocument:{async findUnique({where}:{where:{businessKey:string}}){return documents.find(d=>d.businessKey===where.businessKey)??null;},
      async create({data}:{data:Row}){if(failure)throw Error("synthetic-document-failure");documents.push(data);return data;}},
    digitalFulfillment:{async upsert(){return{accessReadyAt:null};}},
    digitalNotification:{async upsert({create}:{create:Row}){if(!notifications.some(n=>n.businessKey===create.businessKey))notifications.push(create);return create;}},
    digitalEvent:{async create({data}:{data:Row}){events.push(data);return data;},async findFirst({where}:{where:{details:{equals:string}}}){
      const master=masters.find(m=>m.id===where.details.equals)!;const proof={policy:DIGITAL_RIGHTS_REVIEW_POLICY,binding:digitalRightsMasterBinding(master),status:"APPROVED",privateEvidenceReference:"private-evidence:synthetic/no-real-document",
        evidenceSha256:"b".repeat(64),attestation:DIGITAL_RIGHTS_ATTESTATION,reason:null,reviewedAt:at.toISOString(),requestHash:"c".repeat(64)};
      return{id:randomUUID(),actorId:reviewerId,kind:DIGITAL_RIGHTS_REVIEW_EVENT,createdAt:at,details:{...proof,recordHash:digitalRightsReviewHash({actorId:reviewerId,...proof})}};}},
  };
  const tx=db as unknown as Prisma.TransactionClient;
  const input:DigitalFreeCompletionInput={idempotencyKey:randomUUID(),revision:1,termsVersion:DIGITAL_FRANCE_TERMS_VERSION,termsAccepted:true,earlyDelivery:true,withdrawalAcknowledged:true,
    jurisdiction:{countryCode:"FR",residenceCountryCode:"FR",billingCountryCode:"FR",customerType:"B2C",residencePostalCode:"20000",billingPostalCode:"75001",residenceConfirmed:true}};
  return{actor,input,tx,orders,credits,documents,events,notifications,rights,sourceOrder,source,cart,album,acquisitions,
    async sync(){const q=(await applyDigitalCompletions(tx,userId,[album],new Set(activeSource?[tracks[0].trackId]:[])))[0];cart.lines[0].priceCents=q.priceCents;cart.lines[0].selectionHash=selectionFingerprint(q);},
    deactivate(){currentStatus="DISABLED";},unverify(){verified=false;},revoke(){activeSource=false;},failDocument(){failure=true;}};
}
async function local<T>(f:ReturnType<typeof fixture>,run:()=>Promise<T>){const saved={...process.env},original=prisma.$transaction;let queue=Promise.resolve();
  try{for(const key of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|RAILWAY|MEDIA_DEPLOYMENT_ENV|PAYMENT_DEPLOYMENT_ENV/.test(key))delete process.env[key];Object.assign(process.env,env);
    prisma.$transaction=(async(fn:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>{
      let release!:()=>void;const previous=queue;queue=new Promise<void>(r=>release=r);await previous;
      const lengths=[f.orders,f.credits,f.documents,f.events,f.notifications,f.rights,f.acquisitions].map(a=>a.length);
      try{return await fn(f.tx);}catch(error){[f.orders,f.credits,f.documents,f.events,f.notifications,f.rights,f.acquisitions].forEach((a,i)=>a.splice(lengths[i]));throw error;}finally{release();}
    }) as typeof prisma.$transaction;return await run();
  }finally{prisma.$transaction=original;for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}}

test("free completion: exact/surplus grant creates one proof, pinned rights and consumed credits, never payment/invoice or residual balance",async()=>{
  for(const price of[100,149]){const f=fixture(price);await f.sync();await local(f,async()=>{
    const before=billingSnapshotHash(f.sourceOrder),r=await createDigitalFreeCompletion(f.actor,f.input,{localQaFixture:true});assert.equal(r.status,"GRANTED");assert.equal(r.totalCents,0);assert.equal(r.checkoutUrl,null);
    assert.equal(f.orders.length,1);assert.deepEqual(f.orders[0].attempts,[]);assert.equal(f.orders[0].termsVersion,DIGITAL_FRANCE_TERMS_VERSION);assert.equal(f.orders[0].termsHash,DIGITAL_FRANCE_TERMS_TEXT_HASH);
    assert.equal(f.documents.length,1);assert.equal(f.documents[0].kind,"CONTRACT");assert.equal(f.documents[0].snapshotHash,billingSnapshotHash(f.documents[0].snapshot));
    const proof=f.documents[0].snapshot as {supply:{amountChargedCents:number;appliedCreditCents:number;eligibleCents:number;surplusCents:number;reusableBalanceCents:number;invoiceCreated:boolean};acquired:Array<{content:unknown}>};
    assert.equal(proof.supply.amountChargedCents,0);assert.equal(proof.supply.appliedCreditCents,price);assert.equal(proof.supply.eligibleCents,149);assert.equal(proof.supply.surplusCents,149-price);assert.equal(proof.supply.reusableBalanceCents,0);assert.equal(proof.supply.invoiceCreated,false);
    assert.deepEqual(proof.acquired[0].content,f.album.tracks);assert.equal(f.rights.length,2);assert.equal(f.credits.length,1);assert.equal(f.credits[0].status,"CONSUMED");assert.equal(f.notifications.length,1);assert.equal(f.events.length,1);
    assert.equal(billingSnapshotHash(f.sourceOrder),before);
  });}
});
test("free completion: concurrent same-key retries share the acquisition; different-key race grants once",async()=>{
  for(const same of[true,false]){const f=fixture();await f.sync();await local(f,async()=>{
    const result=await Promise.allSettled([createDigitalFreeCompletion(f.actor,f.input,{localQaFixture:true}),createDigitalFreeCompletion(f.actor,{...f.input,idempotencyKey:same?f.input.idempotencyKey:randomUUID()},{localQaFixture:true})]);
    assert.equal(result.filter(r=>r.status==="fulfilled").length,same?2:1);assert.equal(f.orders.length,1);assert.equal(f.documents.length,1);assert.equal(f.events.length,1);assert.equal(f.rights.length,2);assert.equal(f.credits.length,1);
    if(same)assert.deepEqual(result[0],result[1]);
  });}
});
test("free completion: transaction failure rolls back all new rows; source and cart remain unchanged",async()=>{
  const f=fixture();await f.sync();const before=billingSnapshotHash([f.sourceOrder,f.cart]);f.failDocument();await local(f,async()=>{
    await assert.rejects(()=>createDigitalFreeCompletion(f.actor,f.input,{localQaFixture:true}),/synthetic-document-failure/);
    for(const rows of[f.orders,f.credits,f.documents,f.events,f.notifications,f.rights])assert.equal(rows.length,0);
    assert.equal(f.acquisitions.length,1);assert.equal(billingSnapshotHash([f.sourceOrder,f.cart]),before);
  });
});
test("free completion: stale prices/proofs, inactive or unverified owner, absent consent and nonzero amount cannot grant",async()=>{
  for(const variant of["price","proof","inactive","unverified","consent","nonzero","source"]){const f=fixture(variant==="nonzero"?200:100);await f.sync();
    if(variant==="price")f.cart.lines[0].priceCents=1;if(variant==="proof")f.cart.lines[0].selectionHash="bad";if(variant==="inactive")f.deactivate();if(variant==="unverified")f.unverify();if(variant==="consent")f.input.termsAccepted=false;if(variant==="source")f.revoke();
    await local(f,async()=>{await assert.rejects(()=>createDigitalFreeCompletion(f.actor,f.input,{localQaFixture:true}));assert.equal(f.orders.length,0);assert.equal(f.documents.length,0);assert.equal(f.credits.length,0);});
  }
});
test("free completion: LIVE/foreign/provider configuration cannot enable a free grant; free labels never claim payment",async()=>{
  const f=fixture();await f.sync();await local(f,async()=>{process.env.DCN_MODE="LIVE";await assert.rejects(()=>createDigitalFreeCompletion(f.actor,f.input),{code:"DIGITAL_CLOSED"});process.env.DCN_MODE="TEST";
    process.env.STRIPE_SECRET_KEY="synthetic-forbidden-config";await assert.rejects(()=>createDigitalFreeCompletion(f.actor,f.input),{code:"FREE_COMPLETION_LOCAL_ONLY"});delete process.env.STRIPE_SECRET_KEY;
    await assert.rejects(()=>createDigitalFreeCompletion(f.actor,f.input),{code:"FRANCE_ADDRESS_DECLARATION_REQUIRED"});
    f.input.jurisdiction!.residencePostalCode="97100";await assert.rejects(()=>createDigitalFreeCompletion(f.actor,f.input,{localQaFixture:true}));assert.equal(f.orders.length,0);
  });
  assert.equal(digitalCountsOwnedRights("GRANTED","ACTIVE"),true);assert.match(digitalLibraryPaymentLabel("GRANTED",true),/aucun nouveau paiement/);assert.match(digitalConfirmationMessage("GRANTED",false),/sans nouveau paiement/);
});
test("free completion boundaries are explicit; download grants remain renewable rather than purchase-count limited",async()=>{
  const source=await readFile(new URL("../../lib/digital/free-completion.ts",import.meta.url),"utf8");assert.doesNotMatch(source,/digitalGateway|digitalPaymentAttempt|gateway\./);
  const originalUser=prisma.user.findFirst,originalLine=prisma.digitalOrderLine.findFirst,originalTicket=prisma.digitalDownloadTicket.create,saved={...process.env};
  const userId=randomUUID(),lineId=randomUUID(),masterId=randomUUID();let count=0,active=true;
  try{Object.assign(process.env,{DCN_ENABLED:"true",DCN_MODE:"TEST"});
    prisma.user.findFirst=(async()=>active?{id:userId}:null) as typeof originalUser;
    prisma.digitalOrderLine.findFirst=(async()=>({id:lineId,scope:"TRACK",order:{contractSnapshot:null},trackSnapshot:[{masterId,title:"Acquired earlier",trackId:randomUUID()}],entitlements:[{masterId,master:{masterAssetId:randomUUID(),mp3AssetId:null}}]})) as unknown as typeof originalLine;
    prisma.digitalDownloadTicket.create=(async()=>{count++;return{id:randomUUID(),usesLeft:32};}) as unknown as typeof originalTicket;
    for(let i=0;i<40;i++)await createDigitalDownload(userId,lineId,masterId,"WAV");assert.equal(count,40);
    active=false;await assert.rejects(()=>createDigitalDownload(userId,lineId,masterId,"WAV"),{code:"NOT_FOUND"});assert.equal(count,40);
  }finally{prisma.user.findFirst=originalUser;prisma.digitalOrderLine.findFirst=originalLine;prisma.digitalDownloadTicket.create=originalTicket;for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
