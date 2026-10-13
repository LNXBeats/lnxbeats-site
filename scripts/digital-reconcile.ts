import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { reconcileDigitalOrder } from "@/lib/digital/commerce";
requireDigitalEnvironment();
const rows=await prisma.digitalOrder.findMany({where:{status:{in:["PENDING","REQUIRES_REVIEW"]}},orderBy:{updatedAt:"asc"},take:50,select:{id:true}});
let checked=0;for(const r of rows){try{await reconcileDigitalOrder(r.id);checked++;}catch{/* Durable review remains; no private payload logged. */}}
console.log(JSON.stringify({checked,paymentPostRequests:0}));await prisma.$disconnect();
