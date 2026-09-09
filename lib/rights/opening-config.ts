import "server-only";

export const RIGHTS_PRODUCTION_CONFIRMATION = "enable-production-rights-commerce";

export type RightsOpeningConfiguration = Readonly<{
  openingRequested: boolean;
  commerceEnabled: boolean;
  paymentsEnabled: boolean;
  productionConfirmed: boolean;
  complete: boolean;
}>;

function enabled(value: string | undefined) {
  return value === "true";
}

export function rightsOpeningConfiguration(
  environment: Record<string, string | undefined> = process.env,
): RightsOpeningConfiguration {
  const commerceEnabled = enabled(environment.RIGHTS_COMMERCE_ENABLED);
  const paymentsEnabled = enabled(environment.RIGHTS_PAYMENTS_ENABLED);
  const production = environment.NODE_ENV === "production"
    || environment.DEPLOYMENT_ENVIRONMENT === "production";
  const confirmationSupplied = typeof environment.RIGHTS_PRODUCTION_CONFIRM === "string"
    && environment.RIGHTS_PRODUCTION_CONFIRM.length > 0;
  const productionConfirmed = !production
    || environment.RIGHTS_PRODUCTION_CONFIRM === RIGHTS_PRODUCTION_CONFIRMATION;
  const openingRequested = commerceEnabled || paymentsEnabled || confirmationSupplied;

  return {
    openingRequested,
    commerceEnabled,
    paymentsEnabled,
    productionConfirmed,
    complete: commerceEnabled && paymentsEnabled && productionConfirmed,
  };
}
