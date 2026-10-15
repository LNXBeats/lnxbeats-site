/** Actual services/routes with in-memory repository/session/provider doubles only.
 * No PostgreSQL, PSP, email transport, or legal approval is represented here.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {after,test} from "node:test";
import {billingSnapshotHash} from "@/lib/billing/domain";
import type {DigitalFinanceGateway,DigitalRefundEvidence} from "@/lib/digital/finance-policy";
import type {OrderActor} from "@/lib/orders/domain";

type Refund={id:string;orderId:string;actorId?:string;provider:string;paymentReference:string;providerReference:string|null;idempotencyKey:string;amountCents:number;
  currency:string;targets:Array<{lineId:string;amountCents:number}>;purpose:string;status:string;allocationStatus:string;leaseUntil:Date|null;confirmedAt:Date|null};
type Document={id:string;orderId:string;businessKey:string;kind:string;number:string;snapshot:unknown;snapshotHash:string;status:string};
type Event={orderId:string;actorId?:string;externalKey?:string;kind:string;details:unknown};
function fixture(){
  const orderId=randomUUID(),userId=randomUUID(),adminId=randomUUID(),lineId=randomUUID();
  const actor:OrderActor={id:adminId,email:"operator@example.invalid",name:"Synthetic operator",role:"ADMIN",status:"ACTIVE",emailVerified:true};
  const member:OrderActor={id:userId,email:"buyer@example.invalid",name:"Synthetic buyer",role:"MEMBER",status:"ACTIVE",emailVerified:true};
  const rights=Array.from({length:12},()=>({masterId:randomUUID(),status:"ACTIVE"}));
  const order={id:orderId,userId,totalCents:990,status:"PAID",mode:"TEST",currency:"EUR",user:{email:member.email},contractSnapshot:null,
    lines:[{id:lineId,scope:"ALBUM",title:"Synthetic album",priceCents:990,entitlements:rights}],attempts:[{id:randomUUID(),status:"PAID",provider:"STRIPE",paymentReference:"pi_local_only",providerReference:"cs_local_only"}],refunds:[] as Refund[],disputes:[] as Array<{status:string}>};
  const originalInvoice={id:randomUUID(),orderId,businessKey:`invoice:${orderId}`,kind:"INVOICE",number:"DCN-QA-EXISTING-INVOICE",snapshot:{invoiceNumber:"DCN-QA-EXISTING-INVOICE",totalCents:990},snapshotHash:"",status:"READY"};
  originalInvoice.snapshotHash=billingSnapshotHash(originalInvoice.snapshot);
  return{orderId,userId,adminId,lineId,actor,member,rights,order,originalInvoice,documents:[originalInvoice] as Document[],events:[] as Event[],
    notifications:new Map<string,unknown>(),adminEnabled:true,authActor:member,financialWrites:0,rateWrites:0,paymentWrites:0,refundCalls:0,recoverCalls:0,networkCalls:0,sequence:0};
}
let active=fixture();
const copy=<T>(v:T):T=>structuredClone(v);
const fake={
  user:{async findFirst({where}:{where:{id:string;role?:string;status?:string;emailVerified?:boolean}}){return active.adminEnabled&&where.id===active.adminId&&where.role==="ADMIN"&&where.status==="ACTIVE"&&where.emailVerified===true?{id:active.adminId}:null;}},
  digitalOrder:{async findUniqueOrThrow(){return copy(active.order);},async findFirst({where}:{where:{id:string;userId?:string}}){return where.id===active.orderId&&(!where.userId||where.userId===active.userId)?copy(active.order):null;},
    async update({data}:{data:{status:string}}){active.financialWrites++;active.order.status=data.status;return copy(active.order);},
    async create(){active.paymentWrites++;throw Error("No new payment/order may be created by a refund");}},
  digitalPaymentAttempt:{async create(){active.paymentWrites++;throw Error("No new capture/payment attempt may be created by a refund");},async update(){active.paymentWrites++;throw Error("Payment proof must stay unchanged");}},
  digitalRefund:{
    async findUnique({where}:{where:{id?:string;idempotencyKey?:string;providerReference?:string}}){return copy(active.order.refunds.find(r=>where.id?r.id===where.id:where.idempotencyKey?r.idempotencyKey===where.idempotencyKey:r.providerReference===where.providerReference)??null);},
    async findUniqueOrThrow({where}:{where:{id:string}}){const row=active.order.refunds.find(r=>r.id===where.id);assert.ok(row);return copy(row);},
    async findFirst({where}:{where:{id:string;orderId:string}}){return copy(active.order.refunds.find(r=>r.id===where.id&&r.orderId===where.orderId)??null);},
    async create({data}:{data:Partial<Refund>}){active.financialWrites++;const row={id:randomUUID(),providerReference:null,status:"REQUESTED",allocationStatus:"MATCHED",currency:"EUR",leaseUntil:null,confirmedAt:null,...copy(data)} as Refund;active.order.refunds.push(row);return copy(row);},
    async update({where,data}:{where:{id:string};data:Partial<Refund>}){const row=active.order.refunds.find(r=>r.id===where.id);assert.ok(row);active.financialWrites++;Object.assign(row,copy(data));return copy(row);},
    async updateMany({where,data}:{where:{id:string;status?:string};data:Partial<Refund>}){const row=active.order.refunds.find(r=>r.id===where.id&&(!where.status||r.status===where.status));if(!row)return{count:0};active.financialWrites++;Object.assign(row,copy(data));return{count:1};},
    async aggregate(){return{_sum:{amountCents:active.order.refunds.filter(r=>r.status==="SUCCEEDED").reduce((n,r)=>n+r.amountCents,0)}};}},
  digitalEvent:{async findUnique({where}:{where:{externalKey:string}}){return copy(active.events.find(e=>e.externalKey===where.externalKey)??null);},
    async findFirst(){return null;},async create({data}:{data:Event}){active.financialWrites++;active.events.push(copy(data));return copy(data);}},
  digitalCompletionCredit:{async findFirst(){return null;},async findMany(){return[];}},
  digitalDispute:{async findFirst(){return null;}},
  digitalEntitlement:{async updateMany({data}:{data:{status:string}}){let count=0;for(const right of active.rights)if(right.status!=="REVOKED"){right.status=data.status;count++;}active.financialWrites++;return{count};}},
  digitalDocument:{async findUnique({where}:{where:{businessKey:string}}){return copy(active.documents.find(d=>d.businessKey===where.businessKey)??null);},
    async create({data}:{data:Omit<Document,"id"|"status">}){assert.equal(active.documents.some(d=>d.businessKey===data.businessKey),false);active.financialWrites++;const row={id:randomUUID(),status:"PENDING",...copy(data)};active.documents.push(row);return copy(row);}},
  digitalNotification:{async upsert({where,create}:{where:{businessKey:string};create:unknown}){if(!active.notifications.has(where.businessKey)){active.financialWrites++;active.notifications.set(where.businessKey,copy(create));}return active.notifications.get(where.businessKey);}},
  rateLimit:{async findUnique(){return null;},async upsert(){active.rateWrites++;return{};}},
  async $queryRaw(){return[{n:BigInt(++active.sequence)}];},
  async $transaction<T>(fn:(tx:unknown)=>Promise<T>){return fn(fake);},
};
const previousEnvironment={...process.env},previousPrisma=(globalThis as {prisma?:unknown}).prisma,previousFetch=globalThis.fetch;
Object.assign(process.env,{DCN_ENABLED:"true",DCN_MODE:"TEST",DCN_EXTERNAL_TEST_AUTHORIZED:"false",AUTH_URL:"http://127.0.0.1:3140",EMAIL_PROVIDER:"capture",
  DATABASE_URL:"postgresql://unit:unit@127.0.0.1:1/unit",AUTH_SECRET:"commercial-refund-unit-test-secret-not-a-real-secret"});
delete process.env.RAILWAY_ENVIRONMENT_NAME;delete process.env.MEDIA_DEPLOYMENT_ENV;delete process.env.PAYMENT_DEPLOYMENT_ENV;
Object.assign(globalThis,{prisma:fake});
globalThis.fetch=(async()=>{active.networkCalls++;throw Error("External network is forbidden in commercial-refund unit tests");}) as typeof fetch;
const {requestDigitalRefund,processDigitalRefund,recordDigitalRefundEvidence}=await import("@/lib/digital/finance");
const {auth}=await import("@/lib/auth");
const previousGetSession=auth.api.getSession;
auth.api.getSession=(async()=>({session:{id:"local-session"},user:{...active.authActor,name:active.authActor.name}})) as unknown as typeof previousGetSession;
const {POST:adminPost}=await import("@/app/api/admin/digital/orders/[id]/[operation]/route");
const {POST:clientPost}=await import("@/app/api/digital/orders/[id]/[operation]/route");
after(()=>{auth.api.getSession=previousGetSession;globalThis.fetch=previousFetch;if(previousPrisma===undefined)delete (globalThis as {prisma?:unknown}).prisma;else Object.assign(globalThis,{prisma:previousPrisma});
  for(const key of Object.keys(process.env))if(!(key in previousEnvironment))delete process.env[key];Object.assign(process.env,previousEnvironment);});
const input=(amountCents=200,purpose="PRICE_REDUCTION",idempotencyKey=randomUUID())=>({idempotencyKey,purpose,confirmedAmountCents:amountCents,targets:[{lineId:active.lineId,amountCents}]});
function gateway(timeout=false):DigitalFinanceGateway{return{merchantId:"acct_local_commercial_refund",async refund(r){active.refundCalls++;if(timeout)throw Error("Synthetic provider timeout");return{orderId:r.orderId,provider:"STRIPE",mode:"TEST",authenticated:true,merchantId:"acct_local_commercial_refund",paymentReference:r.paymentReference,reference:`re_local_${r.id.replaceAll("-","")}`,amountCents:r.amountCents,currency:"EUR",status:"SUCCEEDED"};},
  async recoverRefund(){active.recoverCalls++;return null;},async readRefund(){throw Error("No provider read in this unit test");},async readDispute(){throw Error("No provider read in this unit test");}};}
const evidence=(r:Refund):DigitalRefundEvidence=>({orderId:r.orderId,provider:"STRIPE",mode:"TEST",authenticated:true,merchantId:"acct_local_commercial_refund",paymentReference:r.paymentReference,
  reference:r.providerReference!,amountCents:r.amountCents,currency:"EUR",status:"SUCCEEDED",localRefundId:r.id});
const request=(operation:string,body:unknown={})=>new Request(`http://127.0.0.1:3140/api/admin/digital/orders/${active.orderId}/${operation}`,{method:"POST",headers:{origin:"http://127.0.0.1:3140","content-type":"application/json"},body:JSON.stringify(body)});
const unchangedInvoice=()=>assert.deepEqual(active.documents.find(d=>d.kind==="INVOICE"),active.originalInvoice);

test("commercial refund: a non-Admin or forged stale Admin actor is refused before refund/audit/gateway writes",async()=>{
  for(const forged of[false,true]){active=fixture();active.adminEnabled=false;
    await assert.rejects(()=>requestDigitalRefund(forged?active.actor:active.member,active.orderId,input()),{code:"ADMIN_REQUIRED",status:403});
    assert.equal(active.financialWrites,0);assert.equal(active.refundCalls,0);assert.equal(active.order.refunds.length,0);assert.equal(active.events.length,0);assert.equal(active.paymentWrites,0);unchangedInvoice();}
});
test("commercial refund: an operator-reviewed request is only a reservation, never an automatic refund, payment or recapture",async()=>{
  active=fixture();const row=await requestDigitalRefund(active.actor,active.orderId,input());assert.equal(row.status,"REQUESTED");assert.equal(active.refundCalls,0);assert.equal(active.networkCalls,0);
  assert.equal(active.paymentWrites,0);assert.equal(active.documents.filter(d=>d.kind==="CREDIT_NOTE").length,0);assert.equal(active.notifications.size,0);assert.ok(active.rights.every(r=>r.status==="ACTIVE"));unchangedInvoice();
});
test("commercial refund: one request key returns the same reservation and rejects a conflicting amount without a second audit",async()=>{
  active=fixture();const value=input(),first=await requestDigitalRefund(active.actor,active.orderId,value),second=await requestDigitalRefund(active.actor,active.orderId,value);
  assert.equal(first.id,second.id);assert.equal(active.order.refunds.length,1);assert.equal(active.events.filter(e=>e.kind==="REFUND_REQUESTED").length,1);
  await assert.rejects(()=>requestDigitalRefund(active.actor,active.orderId,input(201,"PRICE_REDUCTION",value.idempotencyKey)),{code:"IDEMPOTENCY_CONFLICT"});assert.equal(active.refundCalls,0);
});
test("commercial refund: confirmed partial refund creates one credit note/notification, retains rights and original invoice across duplicates",async()=>{
  active=fixture();const row=await requestDigitalRefund(active.actor,active.orderId,input());await processDigitalRefund(row.id,gateway());await processDigitalRefund(row.id,gateway());
  const confirmed=active.order.refunds[0];assert.equal(confirmed.status,"SUCCEEDED");await recordDigitalRefundEvidence(evidence(confirmed),"acct_local_commercial_refund");
  assert.equal(active.refundCalls,1);assert.equal(active.documents.filter(d=>d.kind==="CREDIT_NOTE").length,1);assert.equal(active.notifications.size,1);assert.equal(active.order.status,"PARTIALLY_REFUNDED");
  assert.ok(active.rights.every(r=>r.status==="ACTIVE"));assert.equal(active.paymentWrites,0);unchangedInvoice();
});
test("commercial refund: confirmed balance resolution adds one unique note, revokes rights and keeps immutable financial history",async()=>{
  active=fixture();for(const[amount,purpose]of[[200,"PRICE_REDUCTION"],[790,"RESOLUTION"]] as const){const row=await requestDigitalRefund(active.actor,active.orderId,input(amount,purpose));await processDigitalRefund(row.id,gateway());await processDigitalRefund(row.id,gateway());}
  assert.equal(active.refundCalls,2);assert.equal(active.order.refunds.reduce((n,r)=>n+r.amountCents,0),990);assert.equal(active.order.status,"REFUNDED");assert.ok(active.rights.every(r=>r.status==="REVOKED"));
  assert.equal(active.documents.filter(d=>d.kind==="CREDIT_NOTE").length,2);assert.equal(active.notifications.size,2);assert.equal(active.events.filter(e=>e.kind==="REFUND_REQUESTED").length,2);assert.equal(active.events.filter(e=>e.kind==="REFUND_PROVIDER_EVIDENCE").length,2);
  assert.equal(active.paymentWrites,0);unchangedInvoice();
});
test("commercial refund: timeout leaves review state and later recovery cannot create a second refund blindly",async()=>{
  active=fixture();const row=await requestDigitalRefund(active.actor,active.orderId,input());await processDigitalRefund(row.id,gateway(true));assert.equal(active.order.refunds[0].status,"REQUIRES_REVIEW");
  await processDigitalRefund(row.id,gateway());assert.equal(active.refundCalls,1);assert.equal(active.recoverCalls,1);assert.equal(active.documents.filter(d=>d.kind==="CREDIT_NOTE").length,0);assert.equal(active.paymentWrites,0);unchangedInvoice();
});
test("commercial refund: authenticated client refund operation is unavailable and cannot write financial data",async()=>{
  active=fixture();const response=await clientPost(request("refund",input()),{params:Promise.resolve({id:active.orderId,operation:"refund"})});
  assert.equal(response.status,404);assert.equal((await response.json()).code,"NOT_FOUND");assert.equal(active.financialWrites,0);assert.equal(active.order.refunds.length,0);assert.equal(active.paymentWrites,0);assert.equal(active.networkCalls,0);
});
test("commercial refund: actual Admin HTTP route rejects member, saves only Admin reservation, and cannot execute without external TEST authorization",async()=>{
  active=fixture();let response=await adminPost(request("refund",input()),{params:Promise.resolve({id:active.orderId,operation:"refund"})});assert.equal(response.status,403);assert.equal(active.financialWrites,0);assert.equal(active.rateWrites,0);
  active.authActor=active.actor;response=await adminPost(request("refund",input()),{params:Promise.resolve({id:active.orderId,operation:"refund"})});assert.equal(response.status,200);const body=await response.json();assert.equal(body.status,"REQUESTED");
  const before=active.financialWrites;response=await adminPost(request("execute-refund",{refundId:body.id,confirmedAmountCents:200}),{params:Promise.resolve({id:active.orderId,operation:"execute-refund"})});
  assert.equal(response.status,503);assert.equal((await response.json()).code,"EXTERNAL_QA_AUTHORIZATION_REQUIRED");assert.equal(active.financialWrites,before);assert.equal(active.refundCalls,0);assert.equal(active.networkCalls,0);assert.equal(active.paymentWrites,0);
});
test("commercial refund: wrong-origin request cannot reserve or execute a refund",async()=>{
  active=fixture();active.authActor=active.actor;const req=new Request(`http://127.0.0.1:3140/api/admin/digital/orders/${active.orderId}/refund`,{method:"POST",headers:{origin:"https://outside.example.invalid","content-type":"application/json"},body:JSON.stringify(input())});
  const response=await adminPost(req,{params:Promise.resolve({id:active.orderId,operation:"refund"})});assert.equal(response.status,403);assert.equal((await response.json()).code,"ORIGIN_REFUSED");assert.equal(active.financialWrites,0);assert.equal(active.networkCalls,0);
});
