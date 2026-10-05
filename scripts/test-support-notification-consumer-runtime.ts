import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { parseNotificationConfiguration } from "@/lib/notifications/config";

const runtimeUrl=new URL(process.env.DATABASE_URL??"");
const ownerUrl=new URL(process.env.MIGRATION_DATABASE_URL??"");
for(const url of [runtimeUrl,ownerUrl]) {
  assert.equal(url.hostname,"127.0.0.1"); assert.equal(url.port,"55497");
  assert.equal(url.pathname,"/lnx_admin_support_restore_test"); assert.equal(url.password,"");
}
assert.equal(process.env.NODE_ENV,"test"); assert.notEqual(runtimeUrl.username,ownerUrl.username);
const rt=new Client({connectionString:runtimeUrl.toString()});
const owner=new PrismaClient({adapter:new PrismaPg({connectionString:ownerUrl.toString()})});
const {prisma}=await import("@/lib/prisma");
const {enqueueSupportNotifications,dispatchSupportNotifications}=await import("@/lib/support/notifications");
const configuration=parseNotificationConfiguration({NODE_ENV:"test",NOTIFICATION_DEPLOYMENT_ENV:"development",
  NOTIFICATION_EMAIL_TRANSPORT:"capture",EMAIL_NOTIFICATIONS_ENABLED:"true",OWNER_EMAIL_NOTIFICATIONS_ENABLED:"true",
  CLIENT_EMAIL_NOTIFICATIONS_ENABLED:"true",EMAIL_OWNER_RECIPIENT:"owner@example.invalid",
  NOTIFICATION_WORKER_ENABLED:"true",NOTIFICATION_WORKER_SECRET:"local-synthetic-worker-secret-not-external"});
const ids:string[]=[];const checks:string[]=[];
try {
  await rt.connect();
  const identity=(await rt.query("SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,c.relowner=current_user::regrole AS owner FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname=current_user AND c.oid='support_notifications'::regclass")).rows[0];
  assert.deepEqual(identity,{rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:false,owner:false});
  assert.equal(await owner.supportNotification.count(),0);
  const fixture=async()=>{
    const id=randomUUID();ids.push(id);
    await owner.supportContribution.create({data:{id,ownerHash:"a".repeat(64),idempotencyKey:randomUUID(),
      amountCents:300,currency:"EUR",provider:"STRIPE",mode:"TEST",status:"SUCCEEDED",
      paymentReference:`pi_test_local_${id}`,supporterEmail:"qa@example.invalid",supporterMessage:"Merci QA"}});
    await Promise.all(Array.from({length:6},()=>owner.$transaction(tx=>enqueueSupportNotifications(tx,{id}))));
    assert.equal(await owner.supportNotification.count({where:{contributionId:id}}),2);
    return id;
  };
  const id=await fixture();
  assert.equal((await rt.query('SELECT id FROM support_contributions WHERE id=$1',[id])).rowCount,1);
  assert.equal((await rt.query('SELECT id FROM support_notifications WHERE "contributionId"=$1',[id])).rowCount,2);
  const accepted=new Map<string,string>();let calls=0;
  const success=async(m:{idempotencyKey:string;id:string;template:{html:string};recipient:string})=>{
    assert.match(m.recipient,/@example\.invalid$/);assert.match(m.template.html,/3,00/);
    calls++;const ref=accepted.get(m.idempotencyKey)??`local_mail_${m.id}`;accepted.set(m.idempotencyKey,ref);return ref;
  };
  await Promise.all(Array.from({length:6},()=>dispatchSupportNotifications(25,success,configuration)));
  assert.equal(calls,2);assert.equal(accepted.size,2);
  assert.equal(await owner.supportNotification.count({where:{contributionId:id,status:"SENT"}}),2);
  await dispatchSupportNotifications(25,success,configuration);assert.equal(calls,2);
  checks.push("actual non-owner consumer reads contribution/queue, locks and claims concurrently, builds payload and updates state; duplicate webhook and dispatch idempotent");
  const retry=await fixture();let fail=true;
  const timeout=async(m:Parameters<typeof success>[0])=>{const ref=await success(m);if(fail){fail=false;throw Error("simulated timeout after acceptance");}return ref;};
  await dispatchSupportNotifications(25,timeout,configuration);
  assert.equal(await owner.supportNotification.count({where:{contributionId:retry,status:"FAILED_RETRYABLE"}}),1);
  await owner.supportNotification.updateMany({where:{contributionId:retry},data:{availableAt:new Date(0)}});
  await dispatchSupportNotifications(25,timeout,configuration);
  assert.equal(accepted.size,4);assert.equal(await owner.supportNotification.count({where:{contributionId:retry,status:"SENT"}}),2);
  const stale=await fixture();
  await owner.supportNotification.updateMany({where:{contributionId:stale},data:{status:"PROCESSING",attempts:1,firstAttemptAt:new Date(Date.now()-25*3600000),leaseUntil:new Date(0)}});
  await dispatchSupportNotifications(25,async()=>{throw Error("must not send expired retry");},configuration);
  assert.equal(await owner.supportNotification.count({where:{contributionId:stale,status:"REQUIRES_REVIEW"}}),2);
  checks.push("safe timeout retry same provider key; expired window retained for review with no send");
  for(const sql of ['UPDATE support_contributions SET status=status','DELETE FROM support_contributions',
    'DELETE FROM support_notifications','INSERT INTO support_notifications (id) VALUES (gen_random_uuid())',
    'UPDATE support_notifications SET "idempotencyKey"=\'forbidden\'','SELECT id FROM products LIMIT 0',
    'ALTER TABLE support_notifications ADD COLUMN forbidden text']) {
    await assert.rejects(rt.query(sql),{code:"42501"});
  }
  checks.push("contribution UPDATE/DELETE, queue DELETE/INSERT/key UPDATE, unrelated products and DDL denied");
  console.log(JSON.stringify({status:"PASS",actualNotificationsRole:true,realEmailSent:false,checks}));
} finally {
  await owner.supportNotification.deleteMany({where:{contributionId:{in:ids}}});
  await owner.supportContribution.deleteMany({where:{id:{in:ids}}});
  await rt.end();await prisma.$disconnect();await owner.$disconnect();
}
