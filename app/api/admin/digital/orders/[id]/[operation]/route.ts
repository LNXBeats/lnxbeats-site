import { processDigitalRefund, requestDigitalRefund } from "@/lib/digital/finance";
import { digitalBody, digitalJson, withDigitalApi } from "@/lib/digital/http";
import { assertDigitalUuid, DigitalError } from "@/lib/digital/domain";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string; operation: string }> }) {
  return withDigitalApi(request, async actor => { const { id, operation } = await params; assertDigitalUuid(id);
    if (operation === "refund") { const b = await digitalBody(request, ["idempotencyKey", "targets", "purpose", "confirmedAmountCents"]);
      assertDigitalUuid(b.idempotencyKey); if (typeof b.purpose !== "string" || !Number.isSafeInteger(b.confirmedAmountCents)) throw new DigitalError("INVALID_REFUND");
      const r = await requestDigitalRefund(actor, id, { idempotencyKey: b.idempotencyKey, targets: b.targets, purpose: b.purpose, confirmedAmountCents: Number(b.confirmedAmountCents) });
      return digitalJson({ id: r.id, status: r.status, amountCents: r.amountCents }); }
    if (operation === "reconcile-refund") { const b = await digitalBody(request, ["refundId"]); assertDigitalUuid(b.refundId);
      // Only a previously reserved refund belonging to this exact order; no arbitrary provider action.
      const { prisma } = await import("@/lib/prisma");
      const r = await prisma.digitalRefund.findFirst({ where: { id: b.refundId, orderId: id } }); if (!r) throw new DigitalError("NOT_FOUND", 404);
      if (r.status === "REQUESTED") throw new DigitalError("EXTERNAL_QA_AUTHORIZATION_REQUIRED", 503);
      await processDigitalRefund(r.id); return digitalJson({ received: true }); }
    if(operation==="execute-refund") {
      const b=await digitalBody(request,["refundId","confirmedAmountCents"]);assertDigitalUuid(b.refundId);
      if(process.env.DCN_EXTERNAL_TEST_AUTHORIZED!=="true")throw new DigitalError("EXTERNAL_QA_AUTHORIZATION_REQUIRED",503);
      const {prisma}=await import("@/lib/prisma");const r=await prisma.digitalRefund.findFirst({where:{id:b.refundId,orderId:id}});
      if(!r||r.amountCents!==b.confirmedAmountCents)throw new DigitalError("REFUND_CONFIRMATION_REQUIRED",409);
      await processDigitalRefund(r.id);return digitalJson({received:true,status:(await prisma.digitalRefund.findUniqueOrThrow({where:{id:r.id}})).status});
    }
    throw new DigitalError("NOT_FOUND", 404);
  }, true);
}
