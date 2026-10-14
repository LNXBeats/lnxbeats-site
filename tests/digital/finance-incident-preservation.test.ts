import assert from "node:assert/strict";
import {test} from "node:test";
import {DIGITAL_PERSISTENT_FINANCIAL_INCIDENTS} from "@/lib/digital/finance-policy";
const id="2cfdd150-080b-4a4a-bc0e-93c20cab7610",userId="887a5b13-579f-45ee-bc7d-eb94f8da19a2",lineId="3a961c30-46f0-41c1-ac48-7c43d0437555";
let incident:string="COMPLETION_SOURCE_FINANCIAL_INCIDENT",rights="SUSPENDED";
const dispute={status:"OPEN",providerReference:"dp_local_only",evidenceHash:"old",orderId:id,provider:"STRIPE",paymentReference:"pi_local_only",amountCents:100};
const order={id,userId,status:"REQUIRES_REVIEW",totalCents:990,user:{email:"qa@example.invalid"},contractSnapshot:null,lines:[{id:lineId,title:"QA album",entitlements:[{status:"SUSPENDED"}]}],
  refunds:[],disputes:[dispute],attempts:[{status:"PAID",provider:"STRIPE",paymentReference:"pi_local_only"}]};
const fake={digitalOrder:{async findUniqueOrThrow(){return order;},async update({data}:{data:{status:string}}){order.status=data.status;return order;}},
  digitalDispute:{async findUnique(){return dispute;},async upsert({update}:{update:Record<string,unknown>}){Object.assign(dispute,update);return dispute;}},
  digitalEvent:{async findFirst({where}:{where:{kind:{in:string[]}}}){return where.kind.in.includes(incident)?{kind:incident}:null;},async create(){return{};}},
  digitalEntitlement:{async updateMany({data}:{data:{status:string}}){rights=data.status;return{count:1};}},digitalNotification:{async upsert(){return{};}},
  async $queryRaw(){return[];},async $transaction<T>(run:(tx:unknown)=>Promise<T>):Promise<T>{return run(fake);}};
Object.assign(globalThis,{prisma:fake});
test("a later WON dispute cannot clear a persistent source/account/territory/media incident or revive suspended rights",async()=>{
  const names=["DCN_ENABLED","DCN_MODE","MEDIA_DEPLOYMENT_ENV","PAYMENT_DEPLOYMENT_ENV","RAILWAY_ENVIRONMENT_NAME"],old=new Map(names.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{DCN_ENABLED:"true",DCN_MODE:"TEST",MEDIA_DEPLOYMENT_ENV:"test",PAYMENT_DEPLOYMENT_ENV:"test"});delete process.env.RAILWAY_ENVIRONMENT_NAME;
  try{const {recordDigitalDisputeEvidence}=await import("@/lib/digital/finance");for(const kind of DIGITAL_PERSISTENT_FINANCIAL_INCIDENTS){incident=kind;rights="SUSPENDED";order.status="REQUIRES_REVIEW";dispute.status="OPEN";dispute.evidenceHash="old";
    await recordDigitalDisputeEvidence({orderId:id,mode:"TEST",authenticated:true,merchantId:"acct_local_only",provider:"STRIPE",paymentReference:"pi_local_only",reference:"dp_local_only",amountCents:100,currency:"EUR",status:"WON"},"acct_local_only");
    assert.equal(dispute.status,"WON");assert.equal(order.status,"REQUIRES_REVIEW");assert.equal(rights,"SUSPENDED");}}
  finally{for(const[k,v]of old){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
