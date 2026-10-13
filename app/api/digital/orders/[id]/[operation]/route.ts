import { captureDigitalPaypal,getDigitalOrderStatus,reconcileDigitalOrder } from "@/lib/digital/commerce";
import { digitalJson,withDigitalApi } from "@/lib/digital/http";
import { DigitalError } from "@/lib/digital/domain";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{id:string;operation:string}>}){return withDigitalApi(request,async actor=>{const{id,operation}=await params;
  await getDigitalOrderStatus(actor.id,id);if(operation==="capture")return digitalJson(await captureDigitalPaypal(actor.id,id));
  if(operation==="reconcile")await reconcileDigitalOrder(id);else if(operation!=="status")throw new DigitalError("NOT_FOUND",404);
  return digitalJson(await getDigitalOrderStatus(actor.id,id));});}
