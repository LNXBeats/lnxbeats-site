/** Supplemental REAL local PostgreSQL tests. Financial calls are injected doubles. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { DigitalGateway, DigitalProviderOrder, DigitalAttemptRef } from "@/lib/digital/providers";
import type { DigitalPaymentEvidence } from "@/lib/digital/domain";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
const config = JSON.parse(await readFile(".private/dcn-review-config.json", "utf8"));
const target = assertSafeLocalPostgresUrl(config.DATABASE_URL);
assert.equal(target.port, "55473"); assert.equal(target.pathname, "/lnx_dcn_runtime_test");
Object.assign(process.env, config, { DCN_NEW_PAYMENTS_ENABLED: "true" });
const ownerUrl = new URL(target); ownerUrl.username = "dcn_owner";
const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl.toString() }) });
const { prisma } = await import("@/lib/prisma");
const { syncCart, selections, publicDigitalProject } = await import("@/lib/digital/catalog");
const { createDigitalCheckout, reconcileDigitalEvidence, reconcileDigitalOrder, recordDigitalAdjustment } = await import("@/lib/digital/commerce");
const { createDigitalDownload, digitalDownloadResponse } = await import("@/lib/digital/library");
const project = await owner.project.findUniqueOrThrow({ where: { slug: "dcn-local-test" }, include: { tracks: { orderBy: { position: "asc" } }, digitalOffers: true } });
const admin = await owner.user.findUniqueOrThrow({ where: { email: "dcn-review-admin@example.invalid" } });
const actor = (u: typeof admin) => ({ id: u.id, email: u.email, name: u.displayName, role: u.role, status: "ACTIVE" as const, emailVerified: true as const });
let passed = 0;
const test = async (name: string, run: () => Promise<void>) => { await run(); passed++; console.log(`PASS ${name}`); };
const user = () => owner.user.create({ data: { email: `dcn-extra-${randomUUID()}@example.invalid`, displayName: "QA supplementary", status: "ACTIVE", emailVerified: true } });
const remote = new Map<string,{ order:DigitalProviderOrder;attempt:DigitalAttemptRef;paid:boolean;ref:string }>();
let posts = 0;
const proof = (entry: (typeof remote extends Map<string,infer V> ? V : never), status: "PAID"|"FAILED" = "PAID"): DigitalPaymentEvidence => ({
  authenticated: true, mode: "TEST", provider: "STRIPE", orderId: entry.order.id, eventId: randomUUID(), providerReference: entry.ref,
  paymentReference: `local-payment-${entry.attempt.id}`, merchantId: "local-merchant", amountCents: entry.order.totalCents, currency: "EUR", status,
});
const gateway: DigitalGateway = { merchantId: "local-merchant", async create(order, attempt) { posts++; const entry = { order, attempt, paid: false, ref: `local-session-${attempt.id}` }; remote.set(attempt.id, entry); return { id: entry.ref, url: "https://checkout.stripe.com/c/local_simulated_only" }; },
  async recover(_order,attempt) { const e = remote.get(attempt.id); return e ? { checkout: { id:e.ref, url:"https://checkout.stripe.com/c/local_simulated_only" }, ...(e.paid ? { evidence:proof(e) } : {}) } : null; } };
async function checkout(u:typeof admin, ids:string[], g=gateway) { const c=await syncCart(u.id,ids,0); return createDigitalCheckout(actor(u), { idempotencyKey:randomUUID(),revision:c.revision,provider:"STRIPE",termsVersion:"DCN-1.0-LOCAL-REVIEW",earlyDelivery:true,withdrawalAcknowledged:true }, g); }
try {
  await test("public excerpt rights fail closed, independently of price", async () => {
    const m=await owner.digitalMaster.findFirstOrThrow({where:{trackId:project.tracks[0].id},orderBy:{version:"desc"},include:{previewAsset:true}});
    await owner.asset.update({where:{id:m.previewAssetId!},data:{rightsStatus:"PENDING"}});
    try { const view=await publicDigitalProject(project.slug);assert.equal(view!.tracks[0].previewUrl,null);
      await assert.rejects(selections([project.digitalOffers.find(o=>o.scope==="ALBUM")!.id]),{code:"NO_READY_MASTER"});
    } finally { await owner.asset.update({where:{id:m.previewAssetId!},data:{rightsStatus:"CLEARED"}}); }
  });
  await test("true line-level partial refund revokes only its entitlement; duplicate collisions rejected",async()=>{
    const u=await user(),ids=project.digitalOffers.filter(o=>o.scope==="TRACK").map(o=>o.id); const result=await checkout(u,ids);
    const entry=[...remote.values()].find(e=>e.order.id===result.orderId)!;const e=proof(entry);await reconcileDigitalEvidence(e,"local-merchant");
    const lines=await prisma.digitalOrderLine.findMany({where:{orderId:result.orderId},include:{entitlements:true},orderBy:{priceCents:"asc"}});assert.equal(lines.length,2);
    const one=await createDigitalDownload(u.id,lines[0].id,lines[0].entitlements[0].masterId),two=await createDigitalDownload(u.id,lines[1].id,lines[1].entitlements[0].masterId);
    const adjustment={reference:randomUUID(),kind:"REFUND" as const,lineIds:[lines[0].id],amountCents:lines[0].priceCents,provider:"STRIPE",paymentReference:e.paymentReference,authenticated:true};
    await recordDigitalAdjustment(actor(admin),result.orderId,adjustment);await recordDigitalAdjustment(actor(admin),result.orderId,adjustment);
    await assert.rejects(recordDigitalAdjustment(actor(admin),result.orderId,{...adjustment,amountCents:adjustment.amountCents+1}),{code:"EVENT_COLLISION"});
    await assert.rejects(digitalDownloadResponse(u.id,one.ticketId,one.token),{code:"NOT_FOUND"});assert.equal((await digitalDownloadResponse(u.id,two.ticketId,two.token)).status,200);
    await reconcileDigitalEvidence({...e,eventId:randomUUID()},"local-merchant");assert.equal((await prisma.digitalOrder.findUniqueOrThrow({where:{id:result.orderId}})).status,"PARTIALLY_REFUNDED");
    assert.equal(await prisma.digitalEntitlement.count({where:{lineId:lines[0].id,status:"ACTIVE"}}),0);
  });
  await test("album membership changes without repricing require fresh cart approval",async()=>{
    const u=await user(),album=project.digitalOffers.find(o=>o.scope==="ALBUM")!;const cart=await syncCart(u.id,[album.id],0);const n=posts;
    await owner.track.update({where:{id:project.tracks[1].id},data:{status:"ANNOUNCED"}});
    try{const view=await publicDigitalProject(project.slug);assert.equal(view!.tracks[1].publication,"ANNOUNCED");assert.equal(view!.tracks[1].previewUrl,null);assert.equal(view!.album!.trackCount,1);
      await assert.rejects(createDigitalCheckout(actor(u),{revision:cart.revision,idempotencyKey:randomUUID(),provider:"STRIPE",termsVersion:"DCN-1.0-LOCAL-REVIEW",earlyDelivery:true,withdrawalAcknowledged:true},gateway),{code:"CATALOGUE_CHANGED"});assert.equal(posts,n);
    }finally{await owner.track.update({where:{id:project.tracks[1].id},data:{status:"RELEASED"}});}
    const legacy=await owner.project.create({data:{slug:`dcn-legacy-${randomUUID()}`,title:"QA legacy fallback",type:"ALBUM",catalogPosition:999,status:"PUBLISHED",publicVisible:true,tracks:{create:[{title:"Legacy released",position:1,status:"RELEASED"},{title:"Legacy announced",position:2,status:"ANNOUNCED"}]}}});
    try{assert.equal(await publicDigitalProject(legacy.slug),null);}finally{await owner.project.update({where:{id:legacy.id},data:{publicVisible:false}});}
  });
  await test("rotated non-owner runtime really inserts audit, but cannot update or delete it",async()=>{
    const url=new URL(target);url.username="dcn_runtime_b";const db=new Client({connectionString:url.toString()});await db.connect();const id=randomUUID();
    try{await db.query('INSERT INTO digital_events(id,kind,details) VALUES($1,$2,$3)',[id,"ACL_ROTATED_INSERT_PROOF",{}]);assert.equal((await db.query("SELECT kind FROM digital_events WHERE id=$1",[id])).rows[0].kind,"ACL_ROTATED_INSERT_PROOF");
      await assert.rejects(db.query("UPDATE digital_events SET details='{}' WHERE id=$1",[id]),{code:"42501"});await assert.rejects(db.query("DELETE FROM digital_events WHERE id=$1",[id]),{code:"42501"});
    }finally{await db.end();}
  });
  await test("paid event after confirmed terminal failure cannot resurrect a purchase",async()=>{
    const u=await user(),result=await checkout(u,[project.digitalOffers.find(o=>o.scope==="ALBUM")!.id]);const entry=[...remote.values()].find(e=>e.order.id===result.orderId)!;
    await reconcileDigitalEvidence(proof(entry,"FAILED"),"local-merchant");await reconcileDigitalEvidence(proof(entry),"local-merchant");
    assert.equal((await prisma.digitalOrder.findUniqueOrThrow({where:{id:result.orderId}})).status,"REQUIRES_REVIEW");assert.equal(await prisma.digitalEntitlement.count({where:{userId:u.id}}),0);
  });
  await test("timeout before remote creation stays ambiguous; no second creation after restart",async()=>{
    const u=await user(),n=posts;const fail:DigitalGateway={...gateway,async create(){posts++;throw Error("Local simulated pre-response timeout");},async recover(){return null;}};
    const result=await checkout(u,[project.digitalOffers.find(o=>o.scope==="ALBUM")!.id],fail);await reconcileDigitalOrder(result.orderId,fail);await reconcileDigitalOrder(result.orderId,fail);
    assert.equal(posts-n,1);assert.equal((await prisma.digitalOrder.findUniqueOrThrow({where:{id:result.orderId}})).status,"REQUIRES_REVIEW");
    await assert.rejects(syncCart(u.id,[],1),{code:"PAYMENT_ALREADY_ENGAGED"});
  });
  await test("expired durable lease recovers read-only after a simulated process stop",async()=>{
    const u=await user(),result=await checkout(u,[project.digitalOffers.find(o=>o.scope==="ALBUM")!.id]);const entry=[...remote.values()].find(e=>e.order.id===result.orderId)!;entry.paid=true;
    await owner.digitalPaymentAttempt.update({where:{id:entry.attempt.id},data:{status:"CREATING",leaseUntil:new Date(0)}});
    const n=posts;await reconcileDigitalOrder(result.orderId,gateway);assert.equal(posts,n);assert.equal((await prisma.digitalOrder.findUniqueOrThrow({where:{id:result.orderId}})).status,"PAID");
  });
  await test("expired tickets, deactivated owner and foreign session never download",async()=>{
    const member=await owner.user.findUniqueOrThrow({where:{email:"dcn-review-member@example.invalid"}}),line=await prisma.digitalOrderLine.findFirstOrThrow({where:{order:{userId:member.id,status:"PAID"}}});
    const ticket=await createDigitalDownload(member.id,line.id,null);await owner.digitalDownloadTicket.update({where:{id:ticket.ticketId},data:{expiresAt:new Date(0)}});
    await assert.rejects(digitalDownloadResponse(member.id,ticket.ticketId,ticket.token),{code:"NOT_FOUND"});
    const fresh=await createDigitalDownload(member.id,line.id,null),other=await user();await assert.rejects(digitalDownloadResponse(other.id,fresh.ticketId,fresh.token),{code:"NOT_FOUND"});
    await owner.user.update({where:{id:member.id},data:{status:"SUSPENDED"}});try{await assert.rejects(digitalDownloadResponse(member.id,fresh.ticketId,fresh.token),{code:"NOT_FOUND"});}finally{await owner.user.update({where:{id:member.id},data:{status:"ACTIVE"}});}
  });
  await test("album ZIP keeps purchased snapshot names after current catalogue edits",async()=>{
    const member=await owner.user.findUniqueOrThrow({where:{email:"dcn-review-member@example.invalid"}}),line=await prisma.digitalOrderLine.findFirstOrThrow({where:{order:{userId:member.id,status:"PAID"}}});
    const first=project.tracks[0];await owner.track.update({where:{id:first.id},data:{title:"Edited QA title, not the purchase"}});
    try{const ticket=await createDigitalDownload(member.id,line.id,null),response=await digitalDownloadResponse(member.id,ticket.ticketId,ticket.token);const root=await mkdtemp("/private/tmp/lnx-dcn-snapshot-"),file=`${root}/album.zip`;await writeFile(file,Buffer.from(await response.arrayBuffer()));
      execFileSync("unzip",["-t",file],{encoding:"utf8"});const bytes=await readFile(file);assert.ok(bytes.includes(Buffer.from(first.title,"utf8")));assert.ok(!bytes.includes(Buffer.from("Edited QA title")));
    }finally{await owner.track.update({where:{id:first.id},data:{title:first.title}});}
  });
  await test("suspended digital rights do not mutate historical commerce domains",async()=>{
    for(const count of await Promise.all([owner.order.count(),owner.shopOrder.count(),owner.supportContribution.count(),owner.invoice.count()]))assert.equal(count,0);
    assert.ok(await prisma.digitalEvent.count({where:{kind:"DOWNLOAD_AUTHORIZED"}})>0);
  });
  console.log(JSON.stringify({checks:passed,realPostgres:true,realProviderSandbox:false,financialMutation:false}));
}finally{await prisma.$disconnect();await owner.$disconnect();}
