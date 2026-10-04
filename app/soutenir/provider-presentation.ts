import "server-only";

import { isSupportProviderEnabled, supportMode } from "@/lib/support/config";

/** Presentation only: never instantiates a provider or replaces checkout guards. */
export function supportProviderPresentation(env: Readonly<Record<string, string | undefined>> = process.env) {
  const mode = supportMode(env);
  const live = mode === "LIVE";
  return {
    stripeConfigured: isSupportProviderEnabled("STRIPE", env) && env.STRIPE_MODE === (live ? "live" : "test")
      && new RegExp(`^(sk|rk)_${live ? "live" : "test"}_[a-zA-Z0-9_-]{8,}$`).test(env.STRIPE_SECRET_KEY ?? "")
      && Boolean(env.SUPPORT_STRIPE_WEBHOOK_SECRET) && (!live || Boolean(env.SUPPORT_STRIPE_ACCOUNT_ID)),
    paypalConfigured: isSupportProviderEnabled("PAYPAL", env) && env.PAYPAL_ENVIRONMENT === (live ? "live" : "sandbox")
      && Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.SUPPORT_PAYPAL_WEBHOOK_ID)
      && (!live || Boolean(env.SUPPORT_PAYPAL_MERCHANT_ID)),
  };
}
