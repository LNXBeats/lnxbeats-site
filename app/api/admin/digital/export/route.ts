import { prisma } from "@/lib/prisma";
import { digitalActor,digitalHttpError } from "@/lib/digital/http";
import { csvCell } from "@/lib/digital/domain";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{await digitalActor(request,true);const rows=await prisma.digitalOrder.findMany({where:{mode:"TEST"},orderBy:{createdAt:"asc"},take:10000,include:{attempts:true,events:{where:{kind:{in:["REFUND","DISPUTE"]}}}}});
  const header=["mode","commande numérique","date","état","montant brut centimes","devise","prestataire","référence","référence paiement","frais vérifiés","net vérifié","ajustements"];
  const csv=[header,...rows.flatMap(o=>o.attempts.map(a=>[o.mode,o.id,o.createdAt.toISOString(),o.status,o.totalCents,o.currency,a.provider,a.providerReference,a.paymentReference,"","",JSON.stringify(o.events.map(e=>({kind:e.kind,details:e.details})))]))].map(r=>r.map(csvCell).join(";")).join("\r\n");
  return new Response("\ufeff"+csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=\"dcn-test-registre.csv\"","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}catch(e){return digitalHttpError(e);}}
