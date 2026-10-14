import { createDigitalCheckout,reconcileDigitalEvidence } from "@/lib/digital/commerce";
import { digitalBody,digitalJson,withDigitalApi } from "@/lib/digital/http";
import { DigitalError } from "@/lib/digital/domain";
import { localDigitalReviewCheckoutAllowed,localDigitalReviewAttemptAllowed,LOCAL_REVIEW_MERCHANT } from "@/lib/digital/local-review-policy";
import { prisma } from "@/lib/prisma";
import { parseDigitalCustomerTerritory } from "@/lib/digital/checkout-jurisdiction";
export const dynamic="force-dynamic";
export async function POST(request:Request){return withDigitalApi(request,async actor=>{
  if(!localDigitalReviewCheckoutAllowed(actor.email,LOCAL_REVIEW_MERCHANT,true))throw new DigitalError("NOT_FOUND",404);
  const b=await digitalBody(request,["idempotencyKey","revision","termsVersion","earlyDelivery","withdrawalAcknowledged","jurisdiction"]);
  if(typeof b.idempotencyKey!=="string"||typeof b.termsVersion!=="string")throw new DigitalError("INVALID_CHECKOUT");
  const order=await createDigitalCheckout(actor,{idempotencyKey:b.idempotencyKey,revision:Number(b.revision),provider:"STRIPE",termsVersion:b.termsVersion,earlyDelivery:b.earlyDelivery===true,withdrawalAcknowledged:b.withdrawalAcknowledged===true,jurisdiction:parseDigitalCustomerTerritory(b.jurisdiction)},
    {merchantId:LOCAL_REVIEW_MERCHANT,async create(_o,a){return{id:`dcn12-local-session-${a.id}`,url:"https://checkout.stripe.com/c/local_simulated_only"};},async recover(){return null;}},{localReview:true});
  const saved=await prisma.digitalOrder.findUniqueOrThrow({where:{id:order.orderId},include:{attempts:true}});
  const attempt=saved.attempts[0];
  if(!attempt?.providerReference||!localDigitalReviewAttemptAllowed(saved,actor.id))throw new DigitalError("PAYMENT_REQUIRES_REVIEW",409);
  await reconcileDigitalEvidence({authenticated:true,mode:"TEST",merchantId:LOCAL_REVIEW_MERCHANT,provider:"STRIPE",eventId:`dcn12-local-paid-${attempt.id}`,orderId:saved.id,
    providerReference:attempt.providerReference,paymentReference:`dcn12-local-payment-${attempt.id}`,amountCents:saved.totalCents,currency:"EUR",status:"PAID"},LOCAL_REVIEW_MERCHANT);
  return digitalJson({orderId:saved.id,simulated:true,externalProviderCalls:0});
});}
