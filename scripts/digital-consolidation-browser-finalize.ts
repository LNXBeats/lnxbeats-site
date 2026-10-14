/** Bounded LOCAL review jobs and QA document export; no external provider work. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {assertSafeLocalPostgresUrl} from "@/lib/database/local-postgres-url";
const cfg=JSON.parse(await readFile(".private/dcn-consolidation-config.json","utf8")),credentials=JSON.parse(await readFile(".private/dcn-consolidation-browser-credentials.json","utf8"));
const url=assertSafeLocalPostgresUrl(cfg.DATABASE_URL);assert.equal(url.pathname,"/lnx_dcn_consolidation_test");assert.equal(url.port,"55473");assert.equal(cfg.EMAIL_PROVIDER,"capture");assert.equal(cfg.MEDIA_STORAGE_DRIVER,"local");
Object.assign(process.env,cfg,{DCN_LOCAL_REVIEW_AUTHORIZED:"true"});
const {prisma}=await import("@/lib/prisma"),{processDigitalDocuments}=await import("@/lib/digital/documents"),{processDigitalNotifications}=await import("@/lib/digital/notifications"),{ensureDigitalArchive,processDigitalArchives}=await import("@/lib/digital/archive-worker");
const orderId=process.argv[2];assert.ok(orderId);const o=await prisma.digitalOrder.findFirstOrThrow({where:{id:orderId,userId:credentials.memberId,mode:"TEST"},include:{lines:true,attempts:true,fulfillment:true}});
assert.equal(o.status,"PAID");assert.ok(o.attempts.every(a=>a.providerReference?.startsWith("dcn12-local-session-")),"Only the browser simulator's order may be finalized");
await processDigitalDocuments(2,undefined,orderId);await processDigitalNotifications(10,undefined,orderId);
if(credentials.singleOrderId){assert.ok(await prisma.digitalOrder.findFirst({where:{id:credentials.singleOrderId,userId:credentials.memberId,mode:"TEST"}}));await processDigitalNotifications(10,undefined,credentials.singleOrderId);}
if(o.fulfillment?.accessReadyAt){
  for(const l of o.lines){const masters=await prisma.digitalMaster.findMany({where:{id:{in:(l.trackSnapshot as Array<{masterId:string}>).map(t=>t.masterId)}},include:{masterAsset:true,mp3Asset:true}});assert.ok(masters.every(m=>m.masterAsset.storageBackend==="LOCAL"&&m.mp3Asset?.storageBackend==="LOCAL"));
    if(l.scope==="ALBUM")for(const format of["WAV","MP3"] as const)await ensureDigitalArchive(l.id,format);}
  for(let n=0;n<2;n++)await processDigitalArchives({lineIds:o.lines.map(l=>l.id)});
}
const exportRoot="/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/DCN_CONSOLIDATION_RESTITUTION/examples";await mkdir(exportRoot,{recursive:true});
const documents=await prisma.digitalDocument.findMany({where:{order:{userId:credentials.memberId}},orderBy:{createdAt:"asc"}});
for(const d of documents){assert.equal(d.status,"READY");assert.ok(d.pdf);const prefix=d.orderId===orderId?"album-complete":"titre-et-remboursement";await writeFile(`${exportRoot}/${prefix}-${d.kind.toLowerCase()}.pdf`,Buffer.from(d.pdf!));}
const emails=await prisma.digitalNotification.findMany({where:{order:{userId:credentials.memberId}}});for(const e of emails){assert.equal(e.status,"CAPTURED_QA");assert.equal(e.sentAt,null);assert.equal(e.deliveredAt,null);const t=e.template as {html:string;text:string};await writeFile(`${exportRoot}/${e.orderId===orderId?"album-complete":"titre"}-${e.kind.toLowerCase()}.html`,t.html);}
console.log(JSON.stringify({localOnly:true,providerCalls:0,orderId,documents:documents.length,capturedEmails:emails.length,initialDeliveryAcknowledged:!!o.fulfillment?.accessReadyAt,archiveCount:await prisma.digitalArchive.count({where:{line:{orderId},status:"READY"}})}));await prisma.$disconnect();
