import "server-only";

import {
  RIGHTS_COMMERCE_OPEN_REQUESTED,
  rightsCommerceCapabilities,
} from "@/lib/rights/commerce";

export const RIGHTS_PRODUCTION_CONFIRMATION = "enable-production-rights-commerce";

export type RightsPaymentConfiguration = Readonly<{
  codeOpen: boolean;
  commerceEnabled: boolean;
  paymentsEnabled: boolean;
  productionConfirmed: boolean;
  open: boolean;
}>;

function enabled(value: string | undefined) {
  return value === "true";
}

export function rightsPaymentConfiguration(
  environment: Record<string, string | undefined> = process.env,
): RightsPaymentConfiguration {
  const commerceEnabled = enabled(environment.RIGHTS_COMMERCE_ENABLED);
  const paymentsEnabled = enabled(environment.RIGHTS_PAYMENTS_ENABLED);
  const codeOpen = rightsCommerceCapabilities.rendererBindingReady
    && rightsCommerceCapabilities.billingReady
    && rightsCommerceCapabilities.paymentReady
    && rightsCommerceCapabilities.activationReady;
  const production = environment.NODE_ENV === "production" || environment.DEPLOYMENT_ENVIRONMENT === "production";
  const productionConfirmed = !production
    || environment.RIGHTS_PRODUCTION_CONFIRM === RIGHTS_PRODUCTION_CONFIRMATION;
  return {
    codeOpen,
    commerceEnabled,
    paymentsEnabled,
    productionConfirmed,
    open: codeOpen && RIGHTS_COMMERCE_OPEN_REQUESTED && commerceEnabled && paymentsEnabled && productionConfirmed,
  };
}

export function assertRightsPaymentsOpen(
  environment: Record<string, string | undefined> = process.env,
) {
  const configuration = rightsPaymentConfiguration(environment);
  if (!configuration.open) throw new Error("RIGHTS_PAYMENTS_NOT_OPEN");
  return configuration;
}
