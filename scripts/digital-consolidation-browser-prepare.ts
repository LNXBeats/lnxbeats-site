/** Creates only synthetic review actors/purchases in the disposable consolidation copy. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "@/lib/auth/password";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { CONSOLIDATION_REVIEW_BUYER } from "@/lib/digital/local-review-policy";
for(const key of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|RAILWAY|S3|R2|AWS|SMTP/i.test(key))delete process.env[key];
const cfg=JSON.parse(await readFile(".private/dcn-consolidation-config.json","utf8")),ownerCfg=JSON.parse(await readFile(".private/dcn-consolidation-owner-config.json","utf8")),fixture=JSON.parse(await readFile(".private/dcn-consolidation-fixture.json","utf8"));
for(const c of[cfg,ownerCfg]){const url=assertSafeLocalPostgresUrl(c.DATABASE_URL);assert.equal(url.port,"55473");assert.equal(url.pathname,"/lnx_dcn_consolidation_test");}
Object.assign(process.env,cfg,{DCN_NEW_PAYMENTS_ENABLED:"true",DCN_EXTERNAL_TEST_AUTHORIZED:"false",DCN_LOCAL_REVIEW_AUTHORIZED:"true"});
const owner=new PrismaClient({adapter:new PrismaPg({connectionString:ownerCfg.DATABASE_URL})});
const {prisma}=await import("@/lib/prisma"),{syncCart}=await import("@/lib/digital/catalog"),{createDigitalCheckout,reconcileDigitalEvidence}=await import("@/lib/digital/commerce"),{DIGITAL_TERMS_VERSION}=await import("@/lib/digital/domain"),{requestDigitalRefund,processDigitalRefund}=await import("@/lib/digital/finance"),{processDigitalDocuments,digitalDocumentResponse,acknowledgeDigitalContract}=await import("@/lib/digital/documents"),{processDigitalNotifications}=await import("@/lib/digital/notifications");
const credentialsPath=".private/dcn-consolidation-browser-credentials.json";
let credentials:{adminEmail:string;memberEmail:string;password:string;memberId:string;adminId:string;slug:string;albumOfferId:string;singleOrderId?:string};
try{assert.equal((await stat(credentialsPath)).mode&0o077,0);credentials=JSON.parse(await readFile(credentialsPath,"utf8"));}catch{
  const member=await owner.user.create({data:{email:CONSOLIDATION_REVIEW_BUYER,displayName:"Acquéreur QA consolidation",status:"ACTIVE",emailVerified:true,emailVerifiedAt:new Date()}}),admin=await owner.user.findUniqueOrThrow({where:{id:fixture.adminId}}),password=randomBytes(32).toString("base64url");
  for(const user of[member,admin])await owner.account.create({data:{userId:user.id,providerId:"credential",accountId:user.id,password:await hashPassword(password)}});
  credentials={memberId:member.id,adminId:admin.id,memberEmail:member.email,adminEmail:admin.email,password,slug:fixture.slug,albumOfferId:fixture.albumOfferId};
  await writeFile(credentialsPath,JSON.stringify(credentials),{mode:0o600,flag:"wx"});
}
const actor=(id:string,email:string,role:"ADMIN"|"MEMBER")=>({id,email,role,name:"Acteur QA",status:"ACTIVE" as const,emailVerified:true as const});
const member=actor(credentials.memberId,credentials.memberEmail,"MEMBER"),admin=actor(credentials.adminId,credentials.adminEmail,"ADMIN");
if(!credentials.singleOrderId){
  const c=await syncCart(member.id,[fixture.singleOfferIds[0]],0);
  const purchase=await createDigitalCheckout(member,{revision:c.revision,idempotencyKey:randomUUID(),provider:"STRIPE",termsVersion:DIGITAL_TERMS_VERSION,earlyDelivery:true,withdrawalAcknowledged:true,jurisdiction:{countryCode:"FR",residenceCountryCode:"FR",billingCountryCode:"FR",customerType:"B2C"}},
    {merchantId:"dcn-consolidation-browser",async create(_o,a){return{id:`local_browser_session_${a.id}`,url:"https://checkout.stripe.com/c/local_only"};},async recover(){return null;}},{localQaFixture:true});
  const a=await prisma.digitalPaymentAttempt.findFirstOrThrow({where:{orderId:purchase.orderId}});
  await reconcileDigitalEvidence({orderId:purchase.orderId,eventId:`local_browser_paid_${a.id}`,provider:"STRIPE",mode:"TEST",authenticated:true,merchantId:"dcn-consolidation-browser",providerReference:a.providerReference!,paymentReference:`pi_local_browser_${a.id}`,amountCents:129,currency:"EUR",status:"PAID"},"dcn-consolidation-browser");
  for(let n=0;n<8;n++)await processDigitalDocuments(2,undefined,purchase.orderId);const doc=await prisma.digitalDocument.findFirstOrThrow({where:{orderId:purchase.orderId,kind:"CONTRACT",status:"READY"}});
  await(await digitalDocumentResponse(member,doc.id)).arrayBuffer();await acknowledgeDigitalContract(member.id,purchase.orderId,doc.id,doc.snapshotHash);
  const line=await prisma.digitalOrderLine.findFirstOrThrow({where:{orderId:purchase.orderId}}),refund=await requestDigitalRefund(admin,purchase.orderId,{idempotencyKey:randomUUID(),confirmedAmountCents:29,purpose:"PRICE_REDUCTION",targets:[{lineId:line.id,amountCents:29}]});
  await processDigitalRefund(refund.id,{merchantId:"dcn-consolidation-browser",async refund(r){return{orderId:r.orderId,provider:"STRIPE",mode:"TEST",authenticated:true,merchantId:"dcn-consolidation-browser",paymentReference:r.paymentReference,reference:`re_local_browser_${r.id}`,amountCents:r.amountCents,currency:"EUR",status:"SUCCEEDED"};},async recoverRefund(){return null;},async readRefund(){throw Error("LOCAL_REVIEW_ONLY");},async readDispute(){throw Error("LOCAL_REVIEW_ONLY");}});
  for(let n=0;n<8;n++)await processDigitalDocuments(2,undefined,purchase.orderId);await processDigitalNotifications(10,undefined,purchase.orderId);credentials.singleOrderId=purchase.orderId;await writeFile(credentialsPath,JSON.stringify(credentials),{mode:0o600});
}
const cart=await prisma.digitalCart.findUniqueOrThrow({where:{userId:member.id}});await syncCart(member.id,[fixture.albumOfferId],cart.revision);
console.log(JSON.stringify({localOnly:true,providerCalls:0,syntheticBuyerReady:true,albumSlug:fixture.slug,cart:"ALBUM990_CREDIT100_PAYABLE890",privateCredentialsFile:credentialsPath}));await owner.$disconnect();await prisma.$disconnect();
