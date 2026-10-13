import Stripe from "stripe";
import { boundedSupportText } from "@/lib/support/http";
import { prisma } from "@/lib/prisma";
import { digitalHttpError,digitalJson } from "@/lib/digital/http";
import { DigitalError,requireDigitalEnvironment } from "@/lib/digital/domain";
import { verifiedDigitalStripeEvent,stripeDigitalEvidence,verifyDigitalPaypalEvent } from "@/lib/digital/providers";
import { reconcileDigitalEvidence,reconcileDigitalOrder } from "@/lib/digital/commerce";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{provider:string}>}){try{requireDigitalEnvironment();const{provider}=await params;const raw=await boundedSupportText(request,65536);
  if(provider==="stripe"){const{event,merchantId}=await verifiedDigitalStripeEvent(raw,request.headers.get("stripe-signature")??"");
    if(!["checkout.session.completed","checkout.session.async_payment_succeeded","checkout.session.async_payment_failed","checkout.session.expired"].includes(event.type))return digitalJson({received:true});
    const s=event.data.object as Stripe.Checkout.Session;const attempt=await prisma.digitalPaymentAttempt.findUnique({where:{providerReference:s.id}});
    if(!attempt&&s.metadata?.paymentSource!=="DIGITAL_MUSIC")return digitalJson({received:true,processed:false});
    if(!attempt||attempt.id!==s.metadata?.digitalAttemptId||attempt.orderId!==s.metadata?.digitalOrderId)throw new DigitalError("INVALID_WEBHOOK");
    return digitalJson(await reconcileDigitalEvidence(stripeDigitalEvidence(s,event.id,merchantId,event.type),merchantId));}
  if(provider!=="paypal")throw new DigitalError("NOT_FOUND",404);
  const headers={transmissionId:request.headers.get("paypal-transmission-id")??"",transmissionTime:request.headers.get("paypal-transmission-time")??"",
    certUrl:request.headers.get("paypal-cert-url")??"",authAlgo:request.headers.get("paypal-auth-algo")??"",transmissionSignature:request.headers.get("paypal-transmission-sig")??""};
  if(!await verifyDigitalPaypalEvent(raw,headers))throw new DigitalError("INVALID_WEBHOOK");
  const event=JSON.parse(raw) as {event_type?:string;resource?:{supplementary_data?:{related_ids?:{order_id?:string}}}};
  if(!["PAYMENT.CAPTURE.COMPLETED","PAYMENT.CAPTURE.PENDING","PAYMENT.CAPTURE.DENIED"].includes(event.event_type??""))return digitalJson({received:true});
  const id=event.resource?.supplementary_data?.related_ids?.order_id;if(!id)throw new DigitalError("INVALID_WEBHOOK");
  const attempt=await prisma.digitalPaymentAttempt.findUnique({where:{providerReference:id}});if(!attempt)return digitalJson({received:true,processed:false});if(attempt.provider!=="PAYPAL")throw new DigitalError("INVALID_WEBHOOK");
  await reconcileDigitalOrder(attempt.orderId);return digitalJson({received:true});
}catch(e){return digitalHttpError(e);}}
