import "server-only";

import Stripe from "stripe";

import { parsePaymentConfiguration, STRIPE_API_VERSION } from "@/lib/payments/config";

const STRIPE_DIAGNOSTIC_CONFIRMATION = "run-stripe-test-diagnostic";

async function run() {
  if (process.env.STRIPE_DIAGNOSTIC_CONFIRM !== STRIPE_DIAGNOSTIC_CONFIRMATION) {
    throw new Error("Stripe Test diagnostic requires its explicit local confirmation.");
  }
  if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production") {
    throw new Error("Stripe Test diagnostic refuses deployed environments.");
  }
  const configured = parsePaymentConfiguration({
    ...process.env,
    PAYMENTS_ENABLED: "true",
    STRIPE_PAYMENTS_ENABLED: "true",
  });
  if (!configured.enabled) throw new Error("Stripe Test diagnostic configuration is incomplete.");
  const configuration = configured;
  const stripe = new Stripe(configuration.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 1,
    timeout: 15_000,
    telemetry: false,
  });
  const sessions = await stripe.checkout.sessions.list({ limit: 1 });
  if (sessions.data.some((session) => session.livemode)) {
    throw new Error("Stripe diagnostic refused a live account response.");
  }
  console.info("Stripe Test diagnostic passed: sandbox account reachable; no provider data displayed.");
}

run().catch(() => {
  console.error("Stripe Test diagnostic failed without exposing provider details.");
  process.exitCode = 1;
});
