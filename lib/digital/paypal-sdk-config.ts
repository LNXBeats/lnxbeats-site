import { digitalNewSalesAllowed, digitalProviderRequestsAllowed, digitalRuntimeMode, type DigitalEnvironment, type DigitalMode } from "./runtime-policy";

export type DigitalPaypalSdkConfiguration = Readonly<{ clientId: string; mode: DigitalMode }>;

/** The Client ID is public SDK configuration, never the REST secret or OAuth token.
 * No network call and no enablement of a provider that the server has closed. */
export function digitalPaypalSdkConfiguration(env: DigitalEnvironment = process.env): DigitalPaypalSdkConfiguration | null {
  const mode = digitalRuntimeMode(env);
  const clientId = env.DCN_PAYPAL_CLIENT_ID;
  if (!mode || !digitalNewSalesAllowed(mode, env) || !digitalProviderRequestsAllowed(mode, env)
    || env.DCN_PAYPAL_ENVIRONMENT !== (mode === "LIVE" ? "live" : "sandbox")
    || !clientId || !/^[A-Za-z0-9_-]{20,256}$/.test(clientId)
    || !env.DCN_PAYPAL_CLIENT_SECRET || !env.DCN_PAYPAL_WEBHOOK_ID || !env.DCN_PAYPAL_MERCHANT_ID) return null;
  return { clientId, mode };
}

export const digitalPaypalCheckoutPath = (pathname: string) => pathname === "/musique/checkout";

/** Exact documented SDK/asset origins; no wildcard and no browser REST credentials. */
export function digitalPaypalSdkOrigins(mode: DigitalMode) {
  return { sdk: "https://www.paypal.com", assets: "https://www.paypalobjects.com",
    checkout: mode === "LIVE" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com" };
}
