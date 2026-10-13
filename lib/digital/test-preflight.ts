import { digitalEnabled } from "./domain";
/** Pure, no network, no credentials in results. A PASS is configuration only, not authorization or a provider recipe. */
export function digitalTestPreflight(env: Record<string, string | undefined>) {
  let originValid = false, httpsWebhook = false;
  try {
    const u = new URL(env.AUTH_URL ?? "");
    originValid = !u.username && !u.password && !u.search && !u.hash && u.pathname === "/"
      && (u.protocol === "https:" || u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname));
    httpsWebhook = originValid && u.protocol === "https:" && !["www.lnxbeats.fr", "lnxbeats.fr"].includes(u.hostname);
  } catch { /* no unsafe values returned */ }
  const testOnly = digitalEnabled(env);
  const stripe = /^(sk|rk)_test_[A-Za-z0-9_-]{8,}$/.test(env.DCN_STRIPE_SECRET_KEY ?? "")
    && /^acct_[A-Za-z0-9]+$/.test(env.DCN_STRIPE_ACCOUNT_ID ?? "") && /^whsec_[A-Za-z0-9_-]{8,}$/.test(env.DCN_STRIPE_WEBHOOK_SECRET ?? "");
  const paypal = env.DCN_PAYPAL_ENVIRONMENT === "sandbox" && [env.DCN_PAYPAL_CLIENT_ID, env.DCN_PAYPAL_CLIENT_SECRET,
    env.DCN_PAYPAL_WEBHOOK_ID, env.DCN_PAYPAL_MERCHANT_ID].every(Boolean);
  const bucket = (scope: string) => {
    const words = (env[`MEDIA_${scope.toUpperCase()}_BUCKET`] ?? "").toLowerCase().split("-");
    return words.includes(scope) && words.includes("preview") && !words.includes("production") && !words.includes("staging");
  };
  const r2 = env.MEDIA_STORAGE_DRIVER === "s3" && env.MEDIA_STORAGE_PROVIDER === "r2" && env.MEDIA_DEPLOYMENT_ENV === "preview"
    && /^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/i.test(env.MEDIA_S3_ENDPOINT ?? "")
    && env.MEDIA_S3_REGION === "auto" && env.MEDIA_S3_FORCE_PATH_STYLE !== "true"
    && bucket("public") && bucket("private") && Boolean(env.MEDIA_S3_ACCESS_KEY_ID) && Boolean(env.MEDIA_S3_SECRET_ACCESS_KEY);
  return {
    testOnly, originValid, httpsWebhook, emailCaptureOnly: env.EMAIL_PROVIDER === "capture",
    externalAuthorizationFlag: env.DCN_EXTERNAL_TEST_AUTHORIZED === "true", newPaymentsEnabled: env.DCN_NEW_PAYMENTS_ENABLED === "true",
    stripeTestConfigured: stripe && testOnly, paypalSandboxConfigured: paypal && testOnly, isolatedR2PreviewConfigured: r2 && testOnly,
    providerCallsPerformed: 0, financialActionsPerformed: 0,
    stripeWebhookPath: "/api/digital/webhooks/stripe", paypalWebhookPath: "/api/digital/webhooks/paypal",
    humanAuthorizationStillRequired: true,
  };
}
