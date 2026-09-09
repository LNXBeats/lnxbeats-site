import "server-only";

import {
  rightsCommerceCapabilities,
} from "@/lib/rights/commerce";
import {
  rightsOpeningConfiguration,
  RIGHTS_PRODUCTION_CONFIRMATION,
} from "@/lib/rights/opening-config";

export { RIGHTS_PRODUCTION_CONFIRMATION };

export type RightsPaymentConfiguration = Readonly<{
  codeOpen: boolean;
  commerceEnabled: boolean;
  paymentsEnabled: boolean;
  productionConfirmed: boolean;
  open: boolean;
}>;

export function rightsPaymentConfiguration(
  environment: Record<string, string | undefined> = process.env,
): RightsPaymentConfiguration {
  const opening = rightsOpeningConfiguration(environment);
  const codeOpen = rightsCommerceCapabilities.rendererBindingReady
    && rightsCommerceCapabilities.billingReady
    && rightsCommerceCapabilities.paymentReady
    && rightsCommerceCapabilities.activationReady;
  return {
    codeOpen,
    commerceEnabled: opening.commerceEnabled,
    paymentsEnabled: opening.paymentsEnabled,
    productionConfirmed: opening.productionConfirmed,
    open: codeOpen && opening.complete,
  };
}

export function assertRightsPaymentsOpen(
  environment: Record<string, string | undefined> = process.env,
) {
  const configuration = rightsPaymentConfiguration(environment);
  if (!configuration.open) throw new Error("RIGHTS_PAYMENTS_NOT_OPEN");
  return configuration;
}
