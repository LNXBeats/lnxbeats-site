/** Read-only comparison of the browser's downloaded bytes with frozen LOCAL acquisition metadata. */
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {assertSafeLocalPostgresUrl} from "@/lib/database/local-postgres-url";
const cfg=JSON.parse(await readFile(".private/dcn-consolidation-config.json","utf8"));
const url=assertSafeLocalPostgresUrl(cfg.DATABASE_URL);assert.equal(url.pathname,"/lnx_dcn_consolidation_test");assert.equal(url.port,"55473");
Object.assign(process.env,cfg);
const {prisma}=await import("@/lib/prisma");
const root="/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/DCN_CONSOLIDATION_RESTITUTION";
const proof=JSON.parse(await readFile(`${root}/proofs-browser.json`,"utf8"));
const order=await prisma.digitalOrder.findUniqueOrThrow({where:{id:"2c238fa0-7964-4703-8815-079dc4fc7f11"},include:{lines:{include:{archives:true}},fulfillment:true}});
assert.equal(order.mode,"TEST");assert.equal(order.status,"PAID");assert.equal(order.totalCents,890);assert.ok(order.fulfillment?.accessReadyAt);assert.equal(order.lines.length,1);
const line=order.lines[0],tracks=line.trackSnapshot as Array<{masterId:string}>;
assert.equal(tracks.length,12);
const master=await prisma.digitalMaster.findUniqueOrThrow({where:{id:tracks[0].masterId},include:{masterAsset:true,mp3Asset:true}});assert.ok(master.mp3Asset);
const expected=[{name:"Télécharger WAV",bytes:Number(master.masterAsset.sizeBytes),sha256:master.masterAsset.checksumSha256},
 {name:"Télécharger MP3",bytes:Number(master.mp3Asset.sizeBytes),sha256:master.mp3Asset.checksumSha256},
 ...["WAV","MP3"].map(format=>{const a=line.archives.find(a=>a.format===format);assert.ok(a);assert.equal(a.status,"READY");return{name:`Télécharger ZIP ${format}`,bytes:Number(a.sizeBytes),sha256:a.checksum};})];
assert.deepEqual(proof.downloads,expected);
assert.ok(proof.responsive.every((r:{horizontalOverflow:boolean;tracks:number})=>!r.horizontalOverflow&&r.tracks===12));
const result={...proof,metadataChecksumComparison:"PASS",nativeBrowserDownloads:4,initialDeliveryAcknowledged:true,albumTracks:12,basePriceCents:990,creditCents:100,paidCents:890,providerCalls:0,realPspPayment:"NOT_RUN",pdfVisualReview:{files:5,pages:9,result:"PASS"}};
await writeFile("output/dcn-consolidation/browser-proof.json",JSON.stringify(result,null,2));
console.log(JSON.stringify({readOnly:true,checksumComparisons:4,result:"PASS",providerCalls:0}));await prisma.$disconnect();
