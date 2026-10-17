import { createDigitalCheckout } from "@/lib/digital/commerce";
import { digitalBody,digitalJson,withDigitalApi } from "@/lib/digital/http";
import { DigitalError } from "@/lib/digital/domain";
import { parseDigitalCustomerTerritory } from "@/lib/digital/checkout-jurisdiction";
import { parseDigitalCheckoutBillingAddress } from "@/lib/digital/billing-address-policy";
import { parseDigitalCheckoutConsentPresentation } from "@/lib/digital/checkout-consents";
export const dynamic="force-dynamic";
export async function POST(request:Request){return withDigitalApi(request,async actor=>{const b=await digitalBody(request,["idempotencyKey","revision","provider","termsVersion","termsAccepted","earlyDelivery","withdrawalAcknowledged","jurisdiction","billingAddressSameAsResidence","billingAddress","consentPresentation"]);
  if(typeof b.idempotencyKey!=="string"||typeof b.provider!=="string"||typeof b.termsVersion!=="string")throw new DigitalError("INVALID_CHECKOUT");
  return digitalJson(await createDigitalCheckout(actor,{idempotencyKey:b.idempotencyKey,revision:Number(b.revision),provider:b.provider,termsVersion:b.termsVersion,termsAccepted:b.termsAccepted===true,earlyDelivery:b.earlyDelivery===true,withdrawalAcknowledged:b.withdrawalAcknowledged===true,jurisdiction:parseDigitalCustomerTerritory(b.jurisdiction),billingAddressSameAsResidence:b.billingAddressSameAsResidence===true,billingAddress:parseDigitalCheckoutBillingAddress(b.billingAddress),consentPresentation:parseDigitalCheckoutConsentPresentation(b.consentPresentation)}));});}
