import { prisma } from "@/lib/prisma";
import { digitalActor,digitalHttpError } from "@/lib/digital/http";
import { csvCell,DigitalError } from "@/lib/digital/domain";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{await digitalActor(request,true);const rows=await prisma.digitalOrder.findMany({where:{mode:"TEST"},orderBy:{createdAt:"asc"},take:10001,include:{attempts:true,refunds:true,disputes:true,documents:{select:{kind:true,number:true,status:true}},events:{where:{kind:{in:["REFUND","DISPUTE","REFUND_PROVIDER_EVIDENCE","DISPUTE_PROVIDER_EVIDENCE","PAYMENT_CONTRADICTION","UNMATCHED_CAPTURE_INCIDENT"]}}}}});
  if(rows.length>10000)throw new DigitalError("EXPORT_TOO_LARGE_REQUIRES_PAGINATION",409);
  const header=["mode","commande numérique","date","état","montant brut centimes","devise","prestataire","référence","référence paiement","frais vérifiés","net vérifié","remboursements confirmés centimes","remboursements et litiges","documents QA","audit"];
  const csv=[header,...rows.flatMap(o=>o.attempts.map(a=>[o.mode,o.id,o.createdAt.toISOString(),o.status,o.totalCents,o.currency,a.provider,a.providerReference,a.paymentReference,"","",o.refunds.filter(r=>r.status==="SUCCEEDED").reduce((n,r)=>n+r.amountCents,0),JSON.stringify({refunds:o.refunds.map(r=>({amountCents:r.amountCents,status:r.status,reference:r.providerReference,purpose:r.purpose,allocation:r.allocationStatus})),disputes:o.disputes.map(d=>({reference:d.providerReference,status:d.status}))}),JSON.stringify(o.documents),JSON.stringify(o.events.map(e=>({kind:e.kind,details:e.details})))]))].map(r=>r.map(csvCell).join(";")).join("\r\n");
  return new Response("\ufeff"+csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=\"dcn-test-registre.csv\"","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}catch(e){return digitalHttpError(e);}}
