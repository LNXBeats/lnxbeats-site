/** Pure mode boundary shared by server policies. It never reads or returns credentials.
 * New sales are a separate capability: closing them must not close acquired access.
 */
export type DigitalMode = "TEST" | "LIVE";
export type DigitalEnvironment = Readonly<Record<string, string | undefined>>;

export function digitalRuntimeMode(env: DigitalEnvironment = process.env): DigitalMode | null {
  if (env.DCN_ENABLED !== "true") return null;
  const production = /production/i.test(env.RAILWAY_ENVIRONMENT_NAME ?? "")
    || env.MEDIA_DEPLOYMENT_ENV === "production" || env.PAYMENT_DEPLOYMENT_ENV === "production";
  if (env.DCN_MODE === "TEST") return production ? null : "TEST";
  if (env.DCN_MODE !== "LIVE" || env.NODE_ENV !== "production" || env.RAILWAY_ENVIRONMENT_NAME !== "production"
    || /staging/i.test(env.RAILWAY_ENVIRONMENT ?? "") || env.MEDIA_DEPLOYMENT_ENV !== "production"
    || env.PAYMENT_DEPLOYMENT_ENV !== "production" || env.DCN_STORAGE_MODE !== "OBJECT"
    // Same non-secret confirmation as the existing payment configuration.
    || env.PAYMENT_PRODUCTION_CONFIRM !== "payments-production-live-approved"
    || env.DCN_EXTERNAL_TEST_AUTHORIZED === "true" || env.DCN_LOCAL_REVIEW_AUTHORIZED === "true"
    || env.DCN_RECOVERY_EXCERPTS_REVIEW_ONLY === "true"
    || Object.entries(env).some(([name, value]) => /^DCN_(?:R4_|LOCAL_QA_)/.test(name) && value === "true")) return null;
  return "LIVE";
}

export function digitalProviderRequestsAllowed(mode: DigitalMode, env: DigitalEnvironment = process.env) {
  return digitalRuntimeMode(env) === mode && (mode === "LIVE" || env.DCN_EXTERNAL_TEST_AUTHORIZED === "true");
}

export function digitalNewSalesAllowed(mode: DigitalMode, env: DigitalEnvironment = process.env) {
  return digitalRuntimeMode(env) === mode && env.DCN_NEW_PAYMENTS_ENABLED === "true"
    && (mode === "TEST" || env.PAYMENTS_ENABLED === "true");
}
