import assert from "node:assert/strict";
import {test} from "node:test";
import {randomUUID} from "node:crypto";
import {prisma} from "@/lib/prisma";
import {processDigitalDocuments} from "@/lib/digital/documents";
import {processDigitalNotifications} from "@/lib/digital/notifications";
import {processDigitalArchives} from "@/lib/digital/archive-worker";
test("DCN targeted QA jobs retain the normal worker default and scope only selected orders/lines",async()=>{
 const previous={...process.env};Object.assign(process.env,{DCN_ENABLED:"true",DCN_MODE:"TEST"});delete process.env.RAILWAY_ENVIRONMENT_NAME;delete process.env.MEDIA_DEPLOYMENT_ENV;delete process.env.PAYMENT_DEPLOYMENT_ENV;
 const id=randomUUID(),docs=prisma.digitalDocument.findMany,mail=prisma.digitalNotification.findMany,archive=prisma.digitalArchive.findFirst;
 const received:Array<Record<string,unknown>>=[];
 try{
   prisma.digitalDocument.findMany=(async (args: {where:Record<string,unknown>})=>{received.push(args.where);return[];}) as unknown as typeof docs;
   prisma.digitalNotification.findMany=(async (args: {where:Record<string,unknown>})=>{received.push(args.where);return[];}) as unknown as typeof mail;
   prisma.digitalArchive.findFirst=(async (args: {where:Record<string,unknown>})=>{received.push(args.where);return null;}) as unknown as typeof archive;
   await processDigitalDocuments(2,undefined,id);await processDigitalNotifications(2,undefined,id);await processDigitalArchives({lineIds:[id]});
   assert.equal(received[0].orderId,id);assert.equal(received[1].orderId,id);assert.deepEqual(received[2].lineId,{in:[id]});
   await processDigitalDocuments();await processDigitalNotifications();await processDigitalArchives();
   assert.equal(received[3].orderId,undefined);assert.equal(received[4].orderId,undefined);assert.equal(received[5].lineId,undefined);
   await assert.rejects(processDigitalDocuments(2,undefined,"../other"),{code:"INVALID_ID"});await assert.rejects(processDigitalNotifications(2,undefined,"../other"),{code:"INVALID_ID"});await assert.rejects(processDigitalArchives({lineIds:[]}),{code:"INVALID_ARCHIVE_SCOPE"});assert.equal(received.length,6);
 }finally{prisma.digitalDocument.findMany=docs;prisma.digitalNotification.findMany=mail;prisma.digitalArchive.findFirst=archive;for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});
