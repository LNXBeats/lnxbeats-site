import { createDigitalCheckout,reconcileDigitalEvidence } from "@/lib/digital/commerce";
import { digitalBody,digitalJson,withDigitalApi } from "@/lib/digital/http";
import { DigitalError } from "@/lib/digital/domain";
import { localDigitalReviewCheckoutAllowed,localDigitalReviewAttemptAllowed,LOCAL_REVIEW_MERCHANT } from "@/lib/digital/local-review-policy";
import { prisma } from "@/lib/prisma";
import { parseDigitalCustomerTerritory } from "@/lib/digital/checkout-jurisdiction";
import { parseDigitalCheckoutConsentPresentation } from "@/lib/digital/checkout-consents";
export const dynamic="force-dynamic";
export async function POST(request:Request){return withDigitalApi(request,async actor=>{
  if(!localDigitalReviewCheckoutAllowed(actor.email,LOCAL_REVIEW_MERCHANT,true))throw new DigitalError("NOT_FOUND",404);
  const b=await digitalBody(request,["idempotencyKey","revision","termsVersion","termsAccepted","earlyDelivery","withdrawalAcknowledged","jurisdiction","consentPresentation","formatSupplementHash"]);
  if(typeof b.idempotencyKey!=="string"||typeof b.termsVersion!=="string")throw new DigitalError("INVALID_CHECKOUT");
  if(b.formatSupplementHash!==undefined&&(typeof b.formatSupplementHash!=="string"||!/^[a-f0-9]{64}$/.test(b.formatSupplementHash)))throw new DigitalError("INVALID_CHECKOUT");
  const order=await createDigitalCheckout(actor,{idempotencyKey:b.idempotencyKey,revision:Number(b.revision),provider:"STRIPE",termsVersion:b.termsVersion,termsAccepted:b.termsAccepted===true,earlyDelivery:b.earlyDelivery===true,withdrawalAcknowledged:b.withdrawalAcknowledged===true,jurisdiction:parseDigitalCustomerTerritory(b.jurisdiction),consentPresentation:parseDigitalCheckoutConsentPresentation(b.consentPresentation),...(b.formatSupplementHash===undefined?{}:{formatSupplementHash:b.formatSupplementHash as string})},
    {merchantId:LOCAL_REVIEW_MERCHANT,async create(_o,a){return{id:`dcn12-local-session-${a.id}`,url:"https://checkout.stripe.com/c/local_simulated_only"};},async recover(){return null;}},{localReview:true});
  const saved=await prisma.digitalOrder.findUniqueOrThrow({where:{id:order.orderId},include:{attempts:true}});
  const attempt=saved.attempts[0];
  if(!attempt?.providerReference||!localDigitalReviewAttemptAllowed(saved,actor.id))throw new DigitalError("PAYMENT_REQUIRES_REVIEW",409);
  await reconcileDigitalEvidence({authenticated:true,mode:"TEST",merchantId:LOCAL_REVIEW_MERCHANT,provider:"STRIPE",eventId:`dcn12-local-paid-${attempt.id}`,orderId:saved.id,
    providerReference:attempt.providerReference,paymentReference:`dcn12-local-payment-${attempt.id}`,amountCents:saved.totalCents,currency:"EUR",status:"PAID"},LOCAL_REVIEW_MERCHANT);
  return digitalJson({orderId:saved.id,simulated:true,externalProviderCalls:0});
});}
