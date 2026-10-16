import type Stripe from "stripe";
import { createHash } from "node:crypto";
import { boundedSupportText } from "@/lib/support/http";
import { prisma } from "@/lib/prisma";
import { digitalHttpError,digitalJson } from "@/lib/digital/http";
import { DigitalError,requireDigitalEnvironment } from "@/lib/digital/domain";
import { verifiedDigitalStripeEvent,verifyDigitalPaypalEvent,digitalPaypalClient } from "@/lib/digital/providers";
import { receiveDigitalEvent,DIGITAL_STRIPE_EVENTS,DIGITAL_PAYPAL_EVENTS,type DigitalInboxPayload } from "@/lib/digital/inbox";
import { stripeRefundWebhookPayload } from "@/lib/digital/stripe-refunds";
import { handoffVerifiedDigitalStripeEvent,handoffVerifiedDigitalPaypalEvent } from "@/lib/digital/shared-webhook-isolation";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{provider:string}>}){try{const mode=requireDigitalEnvironment();const{provider}=await params;const raw=await boundedSupportText(request,65536);const bodyHash=createHash("sha256").update(raw).digest("hex");
  if(provider==="stripe"){const{event,merchantId}=await verifiedDigitalStripeEvent(raw,request.headers.get("stripe-signature")??"");
    if(!DIGITAL_STRIPE_EVENTS.includes(event.type))return digitalJson({received:true});
    const handoff=await handoffVerifiedDigitalStripeEvent(event,bodyHash);if(handoff)return digitalJson({received:true,queued:!handoff.duplicate,duplicate:handoff.duplicate});
    const s=event.data.object as Stripe.Checkout.Session & {refunds?:{data:Array<{id:string}>}};
    if(!event.type.startsWith("checkout.session.")) {
      const pi=typeof s.payment_intent==="string"?s.payment_intent:s.payment_intent?.id;
      const attempt=pi?await prisma.digitalPaymentAttempt.findUnique({where:{paymentReference:pi}}):null;
      if(!attempt)return digitalJson({received:true,processed:false});
      if(attempt.provider!=="STRIPE")throw new DigitalError("INVALID_WEBHOOK");
      const payload:DigitalInboxPayload=/refund/i.test(event.type)?stripeRefundWebhookPayload(event.type,s):{paymentReference:pi,resourceReference:s.id};
      return digitalJson(await receiveDigitalEvent({provider:"STRIPE",eventId:event.id,eventType:event.type,orderId:attempt.orderId,bodyHash,payload,verifiedMode:mode,merchantId}));
    }
    const attempt=s.metadata?.digitalAttemptId?await prisma.digitalPaymentAttempt.findUnique({where:{id:s.metadata.digitalAttemptId}}):null;
    if(!attempt&&s.metadata?.paymentSource!=="DIGITAL_MUSIC")return digitalJson({received:true,processed:false});
    if(!attempt||attempt.provider!=="STRIPE"||attempt.id!==s.metadata?.digitalAttemptId||attempt.orderId!==s.metadata?.digitalOrderId)throw new DigitalError("INVALID_WEBHOOK");
    return digitalJson(await receiveDigitalEvent({provider:"STRIPE",eventId:event.id,eventType:event.type,orderId:attempt.orderId,bodyHash,payload:{providerReference:s.id,attemptId:attempt.id},verifiedMode:mode,merchantId}));}
  if(provider!=="paypal")throw new DigitalError("NOT_FOUND",404);
  const headers={transmissionId:request.headers.get("paypal-transmission-id")??"",transmissionTime:request.headers.get("paypal-transmission-time")??"",
    certUrl:request.headers.get("paypal-cert-url")??"",authAlgo:request.headers.get("paypal-auth-algo")??"",transmissionSignature:request.headers.get("paypal-transmission-sig")??""};
  if(!await verifyDigitalPaypalEvent(raw,headers))throw new DigitalError("INVALID_WEBHOOK");
  const event=JSON.parse(raw) as {id?:string;event_type?:string;resource?:{id?:string;dispute_id?:string;custom_id?:string;supplementary_data?:{related_ids?:{order_id?:string;capture_id?:string}};disputed_transactions?:Array<{seller_transaction_id?:string}>}};
  if(!event.id||!event.event_type)throw new DigitalError("INVALID_WEBHOOK");
  if(!DIGITAL_PAYPAL_EVENTS.includes(event.event_type))return digitalJson({received:true});
  const handoff=await handoffVerifiedDigitalPaypalEvent(event as {id:string;event_type:string;resource:unknown},mode==="LIVE"?"live":"sandbox",bodyHash);if(handoff)return digitalJson({received:true,queued:!handoff.duplicate,duplicate:handoff.duplicate});
  const r=event.resource??{},related=r.supplementary_data?.related_ids;
  const captureId=related?.capture_id??r.disputed_transactions?.[0]?.seller_transaction_id??(event.event_type.endsWith("REVERSED")?r.id:undefined);
  const attempt=related?.order_id?await prisma.digitalPaymentAttempt.findUnique({where:{providerReference:related.order_id}}):captureId?await prisma.digitalPaymentAttempt.findUnique({where:{paymentReference:captureId}}):r.custom_id?await prisma.digitalPaymentAttempt.findUnique({where:{id:r.custom_id}}):null;
  if(!attempt)return digitalJson({received:true,processed:false});if(attempt.provider!=="PAYPAL")throw new DigitalError("INVALID_WEBHOOK");
  const payload:DigitalInboxPayload={...(related?.order_id?{providerReference:related.order_id}:{}),...(captureId?{paymentReference:captureId}:{}),attemptId:attempt.id,...(r.id||r.dispute_id?{resourceReference:event.event_type.endsWith("REVERSED")?`reversal:${r.id}`:r.dispute_id??r.id}:{})};
  return digitalJson(await receiveDigitalEvent({provider:"PAYPAL",eventId:event.id,eventType:event.event_type,orderId:attempt.orderId,bodyHash,payload,verifiedMode:mode,merchantId:digitalPaypalClient(mode).merchantId}));
}catch(e){return digitalHttpError(e);}}
