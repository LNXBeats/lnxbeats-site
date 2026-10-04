import "server-only";

import { isSupportEnabled } from "@/lib/support/config";

/** Presentation only: never instantiates a provider or replaces checkout guards. */
export function supportProviderPresentation(env: Readonly<Record<string, string | undefined>> = process.env) {
  const enabled = isSupportEnabled(env);
  return {
    stripeConfigured: enabled && env.STRIPE_MODE === "test"
      && /^(sk|rk)_test_[a-zA-Z0-9_-]{8,}$/.test(env.STRIPE_SECRET_KEY ?? "")
      && Boolean(env.SUPPORT_STRIPE_WEBHOOK_SECRET),
    paypalConfigured: enabled && env.PAYPAL_ENVIRONMENT === "sandbox"
      && Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.SUPPORT_PAYPAL_WEBHOOK_ID),
  };
}
