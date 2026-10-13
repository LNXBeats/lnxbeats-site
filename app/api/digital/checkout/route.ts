import { createDigitalCheckout } from "@/lib/digital/commerce";
import { digitalBody,digitalJson,withDigitalApi } from "@/lib/digital/http";
import { DigitalError } from "@/lib/digital/domain";
export const dynamic="force-dynamic";
export async function POST(request:Request){return withDigitalApi(request,async actor=>{const b=await digitalBody(request,["idempotencyKey","revision","provider","termsVersion","earlyDelivery","withdrawalAcknowledged"]);
  if(typeof b.idempotencyKey!=="string"||typeof b.provider!=="string"||typeof b.termsVersion!=="string")throw new DigitalError("INVALID_CHECKOUT");
  return digitalJson(await createDigitalCheckout(actor,{idempotencyKey:b.idempotencyKey,revision:Number(b.revision),provider:b.provider,termsVersion:b.termsVersion,earlyDelivery:b.earlyDelivery===true,withdrawalAcknowledged:b.withdrawalAcknowledged===true}));});}
