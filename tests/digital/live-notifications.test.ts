import test, { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Prisma } from "@/generated/prisma/client";
import type { ResendEmailSender } from "@/lib/email/resend-adapter";
import { prisma } from "@/lib/prisma";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { NOTIFICATION_PRODUCTION_CONFIRMATION } from "@/lib/notifications/config";
import { NOTIFICATION_PROVIDER_IDEMPOTENCY_SAFE_AGE_MS } from "@/lib/notifications/domain";
import { enqueueDigitalEmail } from "@/lib/digital/documents";
import { sendDigitalLiveEmail, captureDigitalEmail, processDigitalNotifications, type DigitalMail, type DigitalMailResult } from "@/lib/digital/notifications";

// Every transport is a double. Dummy key syntax below is neither a credential
// read nor authority to send. Any accidental network call makes this file fail.
let networkAttempts=0;
before(()=>{
  const deny=()=>{networkAttempts++;throw new Error("NETWORK_FORBIDDEN_IN_LOCAL_NOTIFICATION_TEST");};
  mock.method(globalThis,"fetch",deny);mock.method(http,"request",deny);mock.method(http,"get",deny);
  mock.method(https,"request",deny);mock.method(https,"get",deny);mock.method(net,"connect",deny);mock.method(net,"createConnection",deny);
});
after(()=>{mock.restoreAll();assert.equal(networkAttempts,0);});
const orderId="44444444-4444-4444-8444-444444444444",notificationId="55555555-5555-4555-8555-555555555555";
// example.com is reserved for examples. Its non-fictitious syntax is used only
// with injected doubles to exercise the LIVE policy, never as a real recipient.
const recipient="synthetic-buyer@example.com";
const template={mode:"LIVE",subject:"Confirmation de votre achat numérique",text:"Votre confirmation se trouve dans votre compte authentifié.",html:"<p>Votre confirmation se trouve dans votre compte authentifié.</p>"};
const message:DigitalMail={id:notificationId,businessKey:`contract-mail:${orderId}`,recipient,template};
const liveEnvironment:Record<string,string>={NODE_ENV:"production",RAILWAY_ENVIRONMENT_NAME:"production",MEDIA_DEPLOYMENT_ENV:"production",PAYMENT_DEPLOYMENT_ENV:"production",
  DCN_ENABLED:"true",DCN_MODE:"LIVE",DCN_STORAGE_MODE:"OBJECT",DCN_NEW_PAYMENTS_ENABLED:"false",PAYMENT_PRODUCTION_CONFIRM:"payments-production-live-approved",
  NOTIFICATION_DEPLOYMENT_ENV:"production",NOTIFICATION_EMAIL_TRANSPORT:"resend",NOTIFICATION_PRODUCTION_CONFIRM:NOTIFICATION_PRODUCTION_CONFIRMATION,
  EMAIL_NOTIFICATIONS_ENABLED:"true",CLIENT_EMAIL_NOTIFICATIONS_ENABLED:"true",OWNER_EMAIL_NOTIFICATIONS_ENABLED:"false",NOTIFICATION_WORKER_ENABLED:"false",SMS_TRANSPORT:"disabled",SMS_NOTIFICATIONS_ENABLED:"false",
  RESEND_API_KEY:"re_synthetic_fixture_never_send",RESEND_WEBHOOK_SECRET:"whsec_synthetic_fixture_never_use",EMAIL_FROM:"LNX Beats <notifications@lnxbeats.fr>",EMAIL_REPLY_TO:"contact@lnxbeats.fr",APP_CANONICAL_URL:"https://www.lnxbeats.fr",AUTH_URL:"https://www.lnxbeats.fr"};
async function isolated<T>(run:()=>Promise<T>,patch:Record<string,string|undefined>={}){
  const previous={...process.env};
  try{
    for(const name of Object.keys(process.env))if(/^(?:DCN_|NOTIFICATION_|EMAIL_|OWNER_EMAIL_|CLIENT_EMAIL_|SMS_|RESEND_|RAILWAY_|PAYMENT_|MEDIA_DEPLOYMENT_ENV$|AUTH_URL$|APP_CANONICAL_URL$)/.test(name))delete process.env[name];
    Object.assign(process.env,liveEnvironment);for(const[name,value]of Object.entries(patch)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
    return await run();
  }finally{for(const name of Object.keys(process.env))if(!(name in previous))delete process.env[name];Object.assign(process.env,previous);}
}
function providerDouble(){
  const calls:Array<{message:unknown;idempotencyKey:string;aborted:boolean}>=[],accepted=new Map<string,string>();
  const sender:ResendEmailSender=async(body,options)=>{calls.push({message:body,idempotencyKey:options.idempotencyKey,aborted:options.signal.aborted});
    let id=accepted.get(options.idempotencyKey);if(!id){id=`00000000-0000-4000-8000-${String(accepted.size+1).padStart(12,"0")}`;accepted.set(options.idempotencyKey,id);}
    return{data:{id},error:null,headers:null};};
  return{calls,accepted,sender};
}
type Row={id:string;orderId:string|null;withdrawalRequestId:string|null;kind:string;businessKey:string;recipient:string;template:unknown;status:string;attempts:number;
  availableAt:Date;firstAttemptAt:Date|null;leaseToken:string|null;leaseUntil:Date|null;transportId:string|null;sentAt:Date|null;capturedAt:Date|null;
  order:{mode:string;contractSnapshot:unknown}|null;withdrawalRequest:null};
function row():Row{return{id:notificationId,orderId,withdrawalRequestId:null,kind:"CONTRACT_AVAILABLE",businessKey:message.businessKey,recipient,template:structuredClone(template),status:"PENDING",attempts:0,
  availableAt:new Date(Date.now()-1000),firstAttemptAt:null,leaseToken:null,leaseUntil:null,transportId:null,sentAt:null,capturedAt:null,
  order:{mode:"LIVE",contractSnapshot:{customer:{email:recipient}}},withdrawalRequest:null};}
type Where={id?:string;attempts?:number;status?:string|{in:string[]};leaseToken?:string;leaseUntil?:{gt?:Date;lte?:Date};OR?:Where[]};
function matches(r:Row,w:Where):boolean{
  return(!w.id||r.id===w.id)&&(w.attempts===undefined||r.attempts===w.attempts)&&(!w.status||(typeof w.status==="string"?r.status===w.status:w.status.in.includes(r.status)))
    &&(!w.leaseToken||r.leaseToken===w.leaseToken)&&(!w.leaseUntil||!!r.leaseUntil&&(!w.leaseUntil.gt||r.leaseUntil>w.leaseUntil.gt)&&(!w.leaseUntil.lte||r.leaseUntil<=w.leaseUntil.lte))
    &&(!w.OR||w.OR.some(o=>matches(r,o)));
}
function repository(rows:Row[]){
  const selects:Array<{where:Record<string,unknown>;take:number}>=[],writes:Array<Record<string,unknown>>=[],ackWrites:Array<Record<string,unknown>>=[];
  let dropNextFinalWrite=false,returnWrongMode=false;
  return{rows,selects,writes,ackWrites,setDropFinal(){dropNextFinalWrite=true;},setReturnWrongMode(){returnWrongMode=true;},
    async use<T>(run:()=>Promise<T>){
      const original={find:prisma.digitalNotification.findMany,update:prisma.digitalNotification.updateMany,ack:prisma.consumerWithdrawalRequest.updateMany};
      prisma.digitalNotification.findMany=(async(args:{where:Record<string,unknown>;take:number})=>{selects.push(structuredClone(args));
        return rows.filter(r=>(returnWrongMode||r.order?.mode==="LIVE")&&(!args.where.orderId||r.orderId===args.where.orderId)&&r.availableAt<=new Date()&&["PENDING","RETRY","PROCESSING"].includes(r.status)
          &&(r.status!=="PROCESSING"||!!r.leaseUntil&&r.leaseUntil<=new Date())).slice(0,args.take).map(r=>structuredClone(r));}) as unknown as typeof original.find;
      prisma.digitalNotification.updateMany=(async(args:{where:Where;data:Record<string,unknown>})=>{writes.push(structuredClone(args.data));
        if(dropNextFinalWrite&&args.data.status==="SENT"){dropNextFinalWrite=false;return{count:0};}
        const found=rows.filter(r=>matches(r,args.where));for(const r of found){const{attempts,...rest}=args.data;Object.assign(r,rest);
          if(attempts!==undefined)r.attempts=typeof attempts==="number"?attempts:r.attempts+(attempts as {increment:number}).increment;}
        return{count:found.length};}) as unknown as typeof original.update;
      prisma.consumerWithdrawalRequest.updateMany=(async(args:Record<string,unknown>)=>{ackWrites.push(args);return{count:1};}) as unknown as typeof original.ack;
      try{return await run();}finally{prisma.digitalNotification.findMany=original.find;prisma.digitalNotification.updateMany=original.update;prisma.consumerWithdrawalRequest.updateMany=original.ack;}
    }};
}

test("LIVE mail reuses Resend adapter with stable scoped idempotency key and reports acceptance, not delivery",async()=>isolated(async()=>{
  const p=providerDouble(),first=await sendDigitalLiveEmail(message,p.sender),second=await sendDigitalLiveEmail(message,p.sender);
  assert.deepEqual(first,{id:first.id,evidence:"SENT"});assert.equal(first.id,second.id);assert.equal(p.accepted.size,1);assert.equal(p.calls.length,2);
  const key=`dcn-mail:${billingSnapshotHash({id:message.id,businessKey:message.businessKey})}`;
  assert.equal(p.calls[0].idempotencyKey,key);assert.equal(p.calls[1].idempotencyKey,key);assert.equal(p.calls[0].aborted,false);
  assert.deepEqual(p.calls[0].message,{from:liveEnvironment.EMAIL_FROM,to:[recipient],replyTo:liveEnvironment.EMAIL_REPLY_TO,subject:template.subject,text:template.text,html:template.html});
  assert.ok(!("deliveredAt"in first));
}));
test("LIVE mail refuses TEST payloads, QA recipients, header injection, missing content and malformed provider acceptance",async()=>isolated(async()=>{
  const p=providerDouble();
  for(const patch of [{recipient:"synthetic@example.invalid"},{recipient:"delivered@resend.dev"},{template:null},{template:{...template,mode:"TEST"}},
    {template:{...template,subject:"TEST — Confirmation"}},{template:{...template,subject:"Bad\r\nInjected"}},{template:{...template,text:""}},{template:{...template,html:""}}]){
    await assert.rejects(()=>sendDigitalLiveEmail({...message,...patch},p.sender));
  }
  assert.equal(p.calls.length,0);
  const malformedAcceptance=(async()=>({data:null,error:null,headers:null})) as unknown as ResendEmailSender;
  await assert.rejects(()=>sendDigitalLiveEmail(message,malformedAcceptance));
}));
test("LIVE capture and incomplete or unconfirmed production transport never call the sender",async()=>{
  const p=providerDouble();
  await isolated(()=>assert.rejects(()=>captureDigitalEmail(message),{code:"QA_MAIL_ONLY"}));
  for(const patch of [{RESEND_API_KEY:undefined},{NOTIFICATION_PRODUCTION_CONFIRM:undefined},{NOTIFICATION_EMAIL_TRANSPORT:"capture"},
    {APP_CANONICAL_URL:"https://apex.example.com"},{EMAIL_FROM:"Wrong <notifications@example.com>"}]){
    await isolated(()=>assert.rejects(()=>sendDigitalLiveEmail(message,p.sender)),patch);
  }
  assert.equal(p.calls.length,0);
});
test("paused LIVE client notifications leave the queue untouched and do not mark failure or SENT",async()=>{
  for(const patch of [{CLIENT_EMAIL_NOTIFICATIONS_ENABLED:"false"},{EMAIL_NOTIFICATIONS_ENABLED:"false",CLIENT_EMAIL_NOTIFICATIONS_ENABLED:"false"}]){
    await isolated(async()=>{const f=repository([row()]),p=providerDouble();await f.use(async()=>{
      assert.deepEqual(await processDigitalNotifications(10,m=>sendDigitalLiveEmail(m,p.sender)),{captured:0,sent:0,failed:0});
      assert.equal(f.selects.length,0);assert.equal(f.writes.length,0);assert.equal(p.calls.length,0);assert.equal(f.rows[0].status,"PENDING");
    });},patch);
  }
});
test("LIVE worker sends the acquired contract recipient once, scoped by order mode and active lease",async()=>isolated(async()=>{
  const f=repository([row()]),p=providerDouble();await f.use(async()=>{
    assert.deepEqual(await processDigitalNotifications(10,m=>sendDigitalLiveEmail(m,p.sender),orderId),{captured:0,sent:1,failed:0});
    assert.equal(f.rows[0].status,"SENT");assert.ok(f.rows[0].sentAt);assert.equal(f.rows[0].capturedAt,null);assert.equal(f.rows[0].leaseToken,null);
    assert.equal(p.calls.length,1);assert.equal(f.ackWrites.length,0);
    const where=JSON.stringify(f.selects[0].where);assert.match(where,/"order":\{"mode":"LIVE"\}/);assert.doesNotMatch(where,/"mode":"TEST"/);assert.equal(f.selects[0].where.orderId,orderId);
    assert.deepEqual(await processDigitalNotifications(10,m=>sendDigitalLiveEmail(m,p.sender),orderId),{captured:0,sent:0,failed:0});assert.equal(p.calls.length,1);
  });
}));
test("LIVE worker rejects recipient substitution, missing acquired identity, wrong-order mode and QA templates before transport",async()=>isolated(async()=>{
  for(const patch of [{recipient:"other@example.com"},{order:{mode:"LIVE",contractSnapshot:{customer:{email:""}}}},
    {order:{mode:"TEST",contractSnapshot:{customer:{email:recipient}}}},{template:null},{template:{...template,mode:"TEST"}}]){
    const f=repository([{...row(),...patch}]),p=providerDouble();f.setReturnWrongMode();await f.use(async()=>{
      assert.deepEqual(await processDigitalNotifications(10,m=>sendDigitalLiveEmail(m,p.sender)),{captured:0,sent:0,failed:1});
      assert.equal(p.calls.length,0);assert.equal(f.rows[0].status,"RETRY");assert.equal(f.rows[0].sentAt,null);assert.equal(f.rows[0].transportId,null);
    });
  }
}));
test("LIVE worker never marks capture or malformed transport results SENT",async()=>isolated(async()=>{
  const invalid:unknown[]=[{id:"synthetic-capture",evidence:"CAPTURED_QA"},{id:"",evidence:"SENT"},{evidence:"SENT"},null,{id:"synthetic",evidence:"DELIVERED"}];
  for(const value of invalid){const f=repository([row()]);await f.use(async()=>{
    const result=await processDigitalNotifications(10,async()=>value as DigitalMailResult);
    assert.deepEqual(result,{captured:0,sent:0,failed:1});assert.equal(f.rows[0].status,"RETRY");assert.equal(f.rows[0].sentAt,null);assert.equal(f.rows[0].capturedAt,null);
  });}
}));
test("interrupted final queue write retries with the same provider key and a single doubled acceptance",async()=>isolated(async()=>{
  const f=repository([row()]),p=providerDouble();f.setDropFinal();await f.use(async()=>{
    assert.deepEqual(await processDigitalNotifications(10,m=>sendDigitalLiveEmail(m,p.sender)),{captured:0,sent:0,failed:0});
    assert.equal(f.rows[0].status,"PROCESSING");assert.equal(p.accepted.size,1);
    // Simulated crash/lease expiry only in this in-memory repository.
    f.rows[0].leaseUntil=new Date(Date.now()-1);
    assert.deepEqual(await processDigitalNotifications(10,m=>sendDigitalLiveEmail(m,p.sender)),{captured:0,sent:1,failed:0});
    assert.equal(p.calls.length,2);assert.equal(p.accepted.size,1);assert.equal(p.calls[0].idempotencyKey,p.calls[1].idempotencyKey);
  });
}));
test("concurrent workers claim one queue row only; expired provider-idempotency horizon requires human review",async()=>isolated(async()=>{
  const f=repository([row()]),p=providerDouble();await f.use(async()=>{
    const results=await Promise.all([processDigitalNotifications(10,m=>sendDigitalLiveEmail(m,p.sender)),processDigitalNotifications(10,m=>sendDigitalLiveEmail(m,p.sender))]);
    assert.equal(results.reduce((n,r)=>n+r.sent,0),1);assert.equal(p.calls.length,1);
  });
  const stale=row();stale.firstAttemptAt=new Date(Date.now()-NOTIFICATION_PROVIDER_IDEMPOTENCY_SAFE_AGE_MS-1);const old=repository([stale]);await old.use(async()=>{
    await processDigitalNotifications(10,m=>sendDigitalLiveEmail(m,p.sender));assert.equal(old.rows[0].status,"REQUIRES_REVIEW");assert.equal(p.calls.length,1);
  });
}));
test("enqueue freezes the acquired order email and LIVE mode without reading a changed account address",async()=>isolated(async()=>{
  const captured:Array<Record<string,unknown>>=[];
  const tx={digitalOrder:{async findUniqueOrThrow(){return{id:orderId,mode:"LIVE",totalCents:990,lines:[{title:"Album synthétique"}],contractSnapshot:{customer:{email:recipient}},user:{email:"changed-account@example.com"}};}},
    digitalNotification:{async upsert(args:Record<string,unknown>){captured.push(args);return{};}}} as unknown as Prisma.TransactionClient;
  await enqueueDigitalEmail(tx,orderId,"CONTRACT_AVAILABLE",message.businessKey);
  const create=captured[0].create as {recipient:string;template:{mode:string;subject:string;text:string}};
  assert.equal(create.recipient,recipient);assert.equal(create.template.mode,"LIVE");assert.doesNotMatch(create.template.subject,/^TEST/);assert.doesNotMatch(create.template.text,/fourniture QA|sans valeur comptable/);
  assert.deepEqual(captured[0].update,{});assert.deepEqual(captured[0].where,{businessKey:message.businessKey});
}));
