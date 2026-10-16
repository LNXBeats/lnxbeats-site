import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, mock, test } from "node:test";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "@/lib/payments/config";
import { constructStripeWebhookEvent, handleStripeWebhookPost, type StripeWebhookRouteDependencies } from "@/lib/payments/webhook-route-handler";
import { handlePaypalWebhookPost, type PaypalWebhookRouteDependencies } from "@/lib/payments/paypal-webhook-route-handler";
import type { PaypalGateway } from "@/lib/payments/paypal-client";
import type { VerifiedStripeWebhookEvent } from "@/lib/payments/webhook";
import type { VerifiedPaypalWebhookEvent } from "@/lib/payments/paypal-webhook";
import { handoffVerifiedDigitalStripeEvent, handoffVerifiedDigitalPaypalEvent,
  type DigitalWebhookOwner, type DigitalWebhookOwnershipRepository } from "@/lib/digital/shared-webhook-isolation";
import type { receiveDigitalEvent } from "@/lib/digital/inbox";
import { stripeRefundWebhookPayload } from "@/lib/digital/stripe-refunds";

// In-memory repositories and transports only. The Stripe HTTP test verifies a
// locally generated SDK signature, NOT a newly delivered provider webhook.
let networkAttempts = 0;
before(() => { const deny = () => { networkAttempts++; throw new Error("NETWORK_FORBIDDEN_IN_DIGITAL_WEBHOOK_ISOLATION_TEST"); };
  mock.method(globalThis,"fetch",deny);mock.method(http,"request",deny);mock.method(http,"get",deny);mock.method(https,"request",deny);
  mock.method(https,"get",deny);mock.method(net,"connect",deny);mock.method(net,"createConnection",deny); });
after(() => { mock.restoreAll(); assert.equal(networkAttempts,0); });
const orderId="44444444-4444-4444-8444-444444444444", attemptId="55555555-5555-4555-8555-555555555555";
const live={DCN_ENABLED:"true",DCN_MODE:"LIVE",NODE_ENV:"production",RAILWAY_ENVIRONMENT_NAME:"production",MEDIA_DEPLOYMENT_ENV:"production",PAYMENT_DEPLOYMENT_ENV:"production",
  DCN_STORAGE_MODE:"OBJECT",PAYMENT_PRODUCTION_CONFIRM:"payments-production-live-approved",DCN_NEW_PAYMENTS_ENABLED:"false",PAYMENTS_ENABLED:"false",
  DCN_STRIPE_ACCOUNT_ID:"acct_DcnSynthetic",DCN_STRIPE_WEBHOOK_SECRET:"synthetic-not-a-signing-key",DCN_PAYPAL_WEBHOOK_ID:"SYNTHETIC_WEBHOOK",DCN_PAYPAL_MERCHANT_ID:"SYNTHETIC_MERCHANT"};
function fixture(provider:"STRIPE"|"PAYPAL"="STRIPE"){
  const owner:DigitalWebhookOwner={id:attemptId,orderId,provider,providerReference:provider==="STRIPE"?"cs_DcnSynthetic":"SYNTHETIC_ORDER",
    paymentReference:provider==="STRIPE"?"pi_DcnSynthetic":"SYNTHETIC_CAPTURE",order:{id:orderId,mode:"LIVE",totalCents:990}};
  const rows=[owner],received:Array<Parameters<typeof receiveDigitalEvent>[0]>=[],read={attempts:0,legacy:0}, state={legacy:false,fail:false,ack:true};
  const repository:DigitalWebhookOwnershipRepository={async attempts(){read.attempts++;return rows;},async legacyConflict(){read.legacy++;return state.legacy;}};
  const saved=new Map<string,string>();
  const receive:typeof receiveDigitalEvent=async input=>{received.push(input);if(state.fail)throw new Error("Synthetic durable inbox failure");
    if(!state.ack)return{received:false,queued:false};
    const key=`${input.provider}:${input.eventId}`,content=JSON.stringify(input),previous=saved.get(key);
    if(previous){if(previous!==content)throw new Error("Synthetic EVENT_COLLISION");return{received:true,duplicate:true};}
    saved.set(key,content);return{received:true,queued:true};};
  return{owner,rows,read,state,received,saved,dependencies:{repository,receive,env:live}};
}
function stripeEvent(type="checkout.session.completed"):VerifiedStripeWebhookEvent{return{id:"evt_DcnSynthetic",type,livemode:true,created:1792170000,
  data:{object:{id:"cs_DcnSynthetic",object:"checkout.session",livemode:true,mode:"payment",status:"complete",payment_status:"paid",amount_total:990,currency:"eur",
    payment_intent:"pi_DcnSynthetic",metadata:{paymentSource:"DIGITAL_MUSIC",digitalOrderId:orderId,digitalAttemptId:attemptId,mode:"LIVE"}}}};}
function paypalEvent():VerifiedPaypalWebhookEvent{return{id:"WH-SYNTHETIC-DCN",event_type:"PAYMENT.CAPTURE.COMPLETED",create_time:"2026-10-16T17:00:00.000Z",
  resource:{id:"SYNTHETIC_CAPTURE",status:"COMPLETED",custom_id:attemptId,amount:{value:"9.90",currency_code:"EUR"},supplementary_data:{related_ids:{order_id:"SYNTHETIC_ORDER"}}}};}
const hash="a".repeat(64);

test("inactive/mismatched DCN or missing dedicated configuration never reads new tables or acknowledges DCN",async()=>{
  for(const env of [{...live,DCN_ENABLED:"false"},{...live,DCN_MODE:"TEST"},{...live,DCN_STRIPE_ACCOUNT_ID:""},{...live,DCN_STRIPE_WEBHOOK_SECRET:""}]){
    const f=fixture();assert.equal(await handoffVerifiedDigitalStripeEvent(stripeEvent(),hash,{...f.dependencies,env}),null);assert.equal(f.read.attempts,0);assert.equal(f.received.length,0);
  }
  const p=fixture("PAYPAL");assert.equal(await handoffVerifiedDigitalPaypalEvent(paypalEvent(),"sandbox",hash,p.dependencies),null);assert.equal(p.read.attempts,0);
});
test("metadata alone, ambiguous ownership, legacy conflict or inconsistent references never suppress the old pipeline",async()=>{
  const changes=[(f:ReturnType<typeof fixture>)=>{f.rows.length=0;},(f:ReturnType<typeof fixture>)=>{f.rows.push({...f.owner,id:orderId});},
    (f:ReturnType<typeof fixture>)=>{f.state.legacy=true;},(f:ReturnType<typeof fixture>)=>{f.owner.provider="PAYPAL";},
    (f:ReturnType<typeof fixture>)=>{f.owner.order.mode="TEST";},(f:ReturnType<typeof fixture>)=>{f.owner.providerReference="cs_Other";},
    (f:ReturnType<typeof fixture>)=>{f.owner.paymentReference="pi_Other";}];
  for(const change of changes){const f=fixture();change(f);assert.equal(await handoffVerifiedDigitalStripeEvent(stripeEvent(),hash,f.dependencies),null);assert.equal(f.received.length,0);}
  for(const metadata of [{paymentSource:"SHOP_ORDER"},{paymentSource:"DIGITAL_MUSIC",orderId},{paymentSource:"DIGITAL_MUSIC",purpose:"SUPPORT_LNX_BEATS"},
    {paymentSource:"DIGITAL_MUSIC",digitalAttemptId:orderId},{paymentSource:"DIGITAL_MUSIC",mode:"TEST"}]){
    const f=fixture(),event=stripeEvent();(event.data.object as {metadata:unknown}).metadata=metadata;
    assert.equal(await handoffVerifiedDigitalStripeEvent(event,hash,f.dependencies),null);assert.equal(f.received.length,0);
  }
});
test("proven Stripe checkout is durably queued with the dedicated payload/context before acknowledgement and duplicate receipt",async()=>{
  const f=fixture(),event=stripeEvent();assert.deepEqual(await handoffVerifiedDigitalStripeEvent(event,hash,f.dependencies),{outcome:"PROCESSED",duplicate:false});
  assert.deepEqual(f.received[0],{provider:"STRIPE",eventId:event.id,eventType:event.type,orderId,bodyHash:hash,
    payload:{providerReference:"cs_DcnSynthetic",attemptId},verifiedMode:"LIVE",merchantId:live.DCN_STRIPE_ACCOUNT_ID});
  assert.deepEqual(await handoffVerifiedDigitalStripeEvent(event,hash,f.dependencies),{outcome:"PROCESSED",duplicate:true});assert.equal(f.saved.size,1);
});
test("Stripe refunds without livemode or metadata and disputes bind known PaymentIntent, never a fabricated re_",async()=>{
  for(const type of ["refund.created","charge.refunded","charge.dispute.created"]){
    const f=fixture(),resource={id:type.startsWith("refund")?"re_DcnSynthetic":type==="charge.refunded"?"ch_DcnSynthetic":"dp_DcnSynthetic",
      object:type.startsWith("refund")?"refund":type==="charge.refunded"?"charge":"dispute",payment_intent:"pi_DcnSynthetic",amount:200,currency:"eur"};
    const event={...stripeEvent(type),data:{object:resource}};assert.ok(await handoffVerifiedDigitalStripeEvent(event,hash,f.dependencies));
    assert.deepEqual(f.received[0].payload,/refund/i.test(type)?stripeRefundWebhookPayload(type,resource):{paymentReference:"pi_DcnSynthetic",resourceReference:resource.id});
    const unknown=fixture();unknown.rows.length=0;assert.equal(await handoffVerifiedDigitalStripeEvent(event,hash,unknown.dependencies),null);
  }
});
test("a failed, false or conflicting durable receiver can never produce a successful handoff",async()=>{
  const f=fixture();f.state.fail=true;await assert.rejects(handoffVerifiedDigitalStripeEvent(stripeEvent(),hash,f.dependencies),/inbox failure/);
  f.state.fail=false;f.state.ack=false;await assert.rejects(handoffVerifiedDigitalStripeEvent(stripeEvent(),hash,f.dependencies),/DCN_DURABLE_HANDOFF_FAILED/);
  f.state.ack=true;await handoffVerifiedDigitalStripeEvent(stripeEvent(),hash,f.dependencies);
  await assert.rejects(handoffVerifiedDigitalStripeEvent(stripeEvent(),"b".repeat(64),f.dependencies),/EVENT_COLLISION/);
});
test("PayPal captures, refund links and disputes use known references and the exact dedicated inbox payload shape",async()=>{
  const f=fixture("PAYPAL"),event=paypalEvent();assert.ok(await handoffVerifiedDigitalPaypalEvent(event,"live",hash,f.dependencies));
  assert.deepEqual(f.received[0].payload,{providerReference:"SYNTHETIC_ORDER",attemptId,resourceReference:"SYNTHETIC_CAPTURE"});
  const refund=fixture("PAYPAL"),re={...event,event_type:"PAYMENT.CAPTURE.REFUNDED",resource:{id:"SYNTHETIC_REFUND",status:"COMPLETED",amount:{value:"2.00",currency_code:"EUR"},
    links:[{rel:"up",method:"GET",href:"https://api-m.paypal.com/v2/payments/captures/SYNTHETIC_CAPTURE"}]}};
  assert.ok(await handoffVerifiedDigitalPaypalEvent(re,"live",hash,refund.dependencies));assert.deepEqual(refund.received[0].payload,{attemptId,resourceReference:"SYNTHETIC_REFUND"});
  // Both authenticated entry points call this same durable mapper: no extra
  // capture/order field may drift between their receipts for the same event.
  assert.deepEqual(await handoffVerifiedDigitalPaypalEvent(re,"live",hash,refund.dependencies),{outcome:"PROCESSED",duplicate:true});assert.equal(refund.saved.size,1);
  const dispute=fixture("PAYPAL"),de={...event,event_type:"CUSTOMER.DISPUTE.CREATED",resource:{dispute_id:"SYNTHETIC_DISPUTE",dispute_amount:{value:"9.90",currency_code:"EUR"},disputed_transactions:[{seller_transaction_id:"SYNTHETIC_CAPTURE"}]}};
  assert.ok(await handoffVerifiedDigitalPaypalEvent(de,"live",hash,dispute.dependencies));assert.deepEqual(dispute.received[0].payload,{paymentReference:"SYNTHETIC_CAPTURE",attemptId,resourceReference:"SYNTHETIC_DISPUTE"});
});
test("PayPal foreign merchant, contradictory custom id, unknown reference, unsafe refund link and amount mismatch remain legacy",async()=>{
  for(const patch of [{custom_id:orderId},{payee:{merchant_id:"OTHER_MERCHANT"}},{amount:{value:"8.90",currency_code:"EUR"}},{amount:{value:"9.90",currency_code:"USD"}}]){
    const f=fixture("PAYPAL"),source=paypalEvent(),event={...source,resource:{...source.resource as object,...patch}};
    assert.equal(await handoffVerifiedDigitalPaypalEvent(event,"live",hash,f.dependencies),null);assert.equal(f.received.length,0);
  }
  const f=fixture("PAYPAL"),event=paypalEvent();f.rows.length=0;assert.equal(await handoffVerifiedDigitalPaypalEvent(event,"live",hash,f.dependencies),null);
  const unsafe={...event,event_type:"PAYMENT.CAPTURE.REFUNDED",resource:{id:"SYNTHETIC_REFUND",amount:{value:"2.00",currency_code:"EUR"},links:[{rel:"up",method:"GET",href:"https://evil.invalid/v2/payments/captures/SYNTHETIC_CAPTURE"}]}};
  const safeFixture=fixture("PAYPAL");assert.equal(await handoffVerifiedDigitalPaypalEvent(unsafe,"live",hash,safeFixture.dependencies),null);assert.equal(safeFixture.read.attempts,0);
});

const signingSecret="whsec_synthetic_local_signing_only",configuration={provider:"stripe",enabled:true,configured:true,mode:"live",apiVersion:STRIPE_API_VERSION,
  secretKey:["sk","live","synthetic_local_not_a_credential"].join("_"),webhookSecret:signingSecret}as const;
function signedRequest(event:VerifiedStripeWebhookEvent,bad=false){const raw=`\n${JSON.stringify({...event,api_version:STRIPE_API_VERSION})}\n`;
  const signature=Stripe.webhooks.generateTestHeaderString({payload:raw,secret:signingSecret});
  return{raw,request:new Request("https://www.lnxbeats.fr/api/payments/stripe/webhook",{method:"POST",body:raw,headers:{"content-type":"application/json","stripe-signature":bad?"invalid":signature}})};}
test("actual Stripe handler preserves signed original byte hash and returns 500 on durable handoff failure",async()=>{
  const f=fixture();let legacy=0;
  const dependencies:StripeWebhookRouteDependencies={assertQaRuntime:async()=>{},configuration:()=>configuration,constructEvent:constructStripeWebhookEvent,enrichEvent:async event=>event,
    processEvent:async(event,bodyHash)=>await handoffVerifiedDigitalStripeEvent(event,bodyHash!,f.dependencies)??(legacy++,{outcome:"REQUIRES_REVIEW",duplicate:false})};
  const first=signedRequest(stripeEvent());assert.equal((await handleStripeWebhookPost(first.request,dependencies)).status,200);
  assert.equal(f.received[0].bodyHash,createHash("sha256").update(first.raw).digest("hex"));assert.equal(legacy,0);
  f.state.fail=true;assert.equal((await handleStripeWebhookPost(signedRequest(stripeEvent()).request,dependencies)).status,500);assert.equal(legacy,0);
  const before=f.read.attempts;assert.equal((await handleStripeWebhookPost(signedRequest(stripeEvent(),true).request,dependencies)).status,400);assert.equal(f.read.attempts,before);
});
test("actual PayPal handler verifies its signature gateway first and propagates original body hash/failure without financial fallback",async()=>{
  const f=fixture("PAYPAL");let verified=0,legacy=0;
  const gateway={async verifyWebhook(){verified++;return true;}}as unknown as PaypalGateway;
  const deps:PaypalWebhookRouteDependencies={assertRuntime:async()=>({paypal:{enabled:true,environment:"live"}}as never),gateway:()=>gateway,
    processEvent:async(event,bodyHash)=>{assert.equal(verified>0,true);const handoff=await handoffVerifiedDigitalPaypalEvent(event,"live",bodyHash!,f.dependencies);
      return handoff?{...handoff,orderConfirmed:false}:(legacy++,{outcome:"REQUIRES_REVIEW",duplicate:false,orderConfirmed:false});}};
  const raw=`\n${JSON.stringify(paypalEvent())}\n`,request=()=>new Request("https://www.lnxbeats.fr/api/payments/paypal/webhook",{method:"POST",body:raw,headers:{"content-type":"application/json",
    "paypal-transmission-id":"synthetic","paypal-transmission-time":"2026-10-16T17:00:00.000Z","paypal-cert-url":"https://api-m.paypal.com/v1/notifications/certs/SYNTHETIC","paypal-auth-algo":"SHA256withRSA","paypal-transmission-sig":"synthetic"}});
  assert.equal((await handlePaypalWebhookPost(request(),deps)).status,200);assert.equal(f.received[0].bodyHash,createHash("sha256").update(raw).digest("hex"));assert.equal(legacy,0);
  f.state.fail=true;assert.equal((await handlePaypalWebhookPost(request(),deps)).status,500);assert.equal(legacy,0);
  const before=f.read.attempts;assert.equal((await handlePaypalWebhookPost(request(),{...deps,gateway:()=>({...gateway,verifyWebhook:async()=>false})})).status,400);assert.equal(f.read.attempts,before);
});
test("dedicated routes reuse durable shared ingestion only after their existing signature checks",()=>{
  const source=readFileSync("app/api/digital/webhooks/[provider]/route.ts","utf8");
  assert.ok(source.indexOf("verifiedDigitalStripeEvent(raw")<source.indexOf("await handoffVerifiedDigitalStripeEvent(event,bodyHash)"));
  assert.ok(source.indexOf("verifyDigitalPaypalEvent(raw,headers)")<source.indexOf("await handoffVerifiedDigitalPaypalEvent(event"));
  assert.match(source,/if\(handoff\)return digitalJson\(\{received:true,queued:!handoff\.duplicate,duplicate:handoff\.duplicate\}\)/);
});
