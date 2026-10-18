import test,{after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
const old=(globalThis as {prisma?:unknown}).prisma;
type Event={id:string;actorId:string;kind:string;externalKey:string;details:{eventId:string;snapshotHash:string;seen:boolean};createdAt:Date};
let admin=true,events:Event[]=[],receipt={id:randomUUID(),provider:"PAYPAL" as const,providerEventId:"synthetic-seen-only",type:"PAYMENT.CAPTURE.COMPLETED",livemode:false,outcome:"REQUIRES_REVIEW" as const,processedAt:new Date(),objectId:"SYNTHETIC_NO_PROVIDER",paymentId:null as string|null,refundAttemptId:null,incidentId:null,technicalReview:null};
const db={user:{async findFirst(){return admin?{id:actorId}:null;}},providerEvent:{async findUnique(){return structuredClone(receipt);}},digitalEvent:{
  async findMany(){return structuredClone([...events].reverse());},async findFirst(){return structuredClone(events.at(-1)??null);},async findUnique({where}:{where:{externalKey:string}}){return structuredClone(events.find(e=>e.externalKey===where.externalKey)??null);},
  async create({data}:{data:Omit<Event,"id">}){const row={...data,id:randomUUID()};events.push(structuredClone(row));return{id:row.id};}},async $queryRaw(){return[];},async $transaction<T>(cb:(tx:unknown)=>Promise<T>){return cb(db);}};
Object.assign(globalThis,{prisma:db});
const {setFinancialReceiptSeen,getFinancialReceiptVisibility,financialReceiptFingerprint}=await import("@/lib/admin/financial-event-seen");
const actorId=randomUUID();
after(()=>{if(old===undefined)delete(globalThis as {prisma?:unknown}).prisma;else Object.assign(globalThis,{prisma:old});});
function input(){return{eventId:receipt.id,actorId,seen:true,expectedHash:financialReceiptFingerprint(receipt),expectedRevision:events.at(-1)?.id??"",requestId:randomUUID()};}
test("reading acknowledgement is append-only, idempotent and never a financial resolution",async()=>{
  events=[];const before=structuredClone(receipt),i=input();const first=await setFinancialReceiptSeen(i);assert.equal(await setFinancialReceiptSeen(i),first);assert.equal(events.length,1);
  assert.equal((await getFinancialReceiptVisibility([receipt])).get(receipt.id)?.seen,true);assert.deepEqual(receipt,before);assert.equal(receipt.outcome,"REQUIRES_REVIEW");assert.equal(receipt.technicalReview,null);
});
test("read preference is reversible, stale writes are refused and new correlation resurfaces a receipt",async()=>{
  events=[];const first=input();await setFinancialReceiptSeen(first);await assert.rejects(()=>setFinancialReceiptSeen({...first,requestId:randomUUID()}));
  await setFinancialReceiptSeen({...input(),seen:false});assert.equal((await getFinancialReceiptVisibility([receipt])).get(receipt.id)?.seen,false);
  await setFinancialReceiptSeen(input());receipt={...receipt,paymentId:randomUUID()};assert.equal((await getFinancialReceiptVisibility([receipt])).get(receipt.id)?.seen,false);
  await assert.rejects(()=>setFinancialReceiptSeen({...input(),expectedHash:first.expectedHash}));
});
test("inactive/non-Admin, forged fingerprints and reused keys cannot acknowledge a different state",async()=>{
  events=[];admin=false;await assert.rejects(()=>setFinancialReceiptSeen(input()));admin=true;await assert.rejects(()=>setFinancialReceiptSeen({...input(),expectedHash:"0".repeat(64)}));assert.equal(events.length,0);
  const i=input();await setFinancialReceiptSeen(i);await assert.rejects(()=>setFinancialReceiptSeen({...i,seen:false}));assert.equal(events.length,1);
});
test("seen-only service has same-origin Admin action and no provider/payment/order mutation",async()=>{
  const source=await readFile(new URL("../../lib/admin/financial-event-seen.ts",import.meta.url),"utf8"),actions=await readFile(new URL("../../app/admin/evenements-financiers/actions.ts",import.meta.url),"utf8");
  assert.match(source,/READING_PREFERENCE_ONLY_NO_FINANCIAL_RESOLUTION/);assert.match(source,/digitalEvent.create/);assert.match(source,/FOR UPDATE/);
  assert.doesNotMatch(source,/(?:providerEvent|payment|order|providerEventTechnicalReview)\.(?:create|update|delete)/);
  assert.match(actions,/requireAdmin\(\)/);assert.match(actions,/isSameOriginMutation/);assert.match(actions,/expectedHash:/);
});
