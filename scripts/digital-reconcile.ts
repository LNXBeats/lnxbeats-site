import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { reconcileDigitalOrder } from "@/lib/digital/commerce";
import { processDigitalInbox } from "@/lib/digital/inbox";
import { processDigitalRefund } from "@/lib/digital/finance";
requireDigitalEnvironment();
if(process.env.DCN_EXTERNAL_TEST_AUTHORIZED!=="true")throw Error("DCN external TEST authorization is missing; no provider call executed.");
const rows=await prisma.digitalOrder.findMany({where:{status:{in:["PENDING","REQUIRES_REVIEW"]}},orderBy:{updatedAt:"asc"},take:50,select:{id:true}});
let checked=0;for(const r of rows){try{await reconcileDigitalOrder(r.id);checked++;}catch{/* Durable review remains; no private payload logged. */}}
const inbox=await processDigitalInbox();
const refunds=await prisma.digitalRefund.findMany({where:{status:{in:["PENDING","REQUIRES_REVIEW"]}},take:25,select:{id:true}});
for(const r of refunds){try{await processDigitalRefund(r.id);}catch{/* Unknown remains durable, no refund POST. */}}
console.log(JSON.stringify({checked,inbox,refundsChecked:refunds.length,paymentPostRequests:0,refundPostRequests:0}));await prisma.$disconnect();
