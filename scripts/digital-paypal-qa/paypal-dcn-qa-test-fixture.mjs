/** Synthetic fixture only. No imported application/profile and no network. */
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { initializePaypalQaBudget, createPaypalQaBudgetAuthority, PAYPAL_QA_MAXIMUMS, paypalRestApplicationIdentity } from "./paypal-dcn-qa-budget.mjs";
import { PAYPAL_DCN_MINIMUM_WEBHOOK_EVENTS } from "./paypal-dcn-qa-fetch.mjs";
export const OFFLINE_TIME = 1800000000000;
export const OFFLINE_SCOPE = Object.freeze({ environment: "SANDBOX", applicationName: "LNX Studio DCN QA",
  applicationId: paypalRestApplicationIdentity("synthetic-client-not-a-credential"), merchantId: "QA12345678901", approvedHost: "offline-example.ngrok-free.dev" });
export const OFFLINE_BINDING = Object.freeze({ ...OFFLINE_SCOPE, clientId: "synthetic-client-not-a-credential",
  expectedClientId: "synthetic-client-not-a-credential", expectedOAuthAppId: null,
  clientSecret: "synthetic-secret-not-a-credential", requiredScopes: ["https://uri.paypal.com/services/payments/payment"],
  webhookId: "OFFLINEWEBHOOK", webhookEvents: PAYPAL_DCN_MINIMUM_WEBHOOK_EVENTS });
export async function withOfflineBudget(run, limits = {}) {
  const directory = await mkdtemp("/private/tmp/lnx-dcn-paypal-budget-test-"), file = path.join(directory, "ledger.jsonl");
  let clock = OFFLINE_TIME + 1;
  try {
    await initializePaypalQaBudget(file, { approval: "USER_APPROVED_EXACT_ROUTE_AND_RECIPE", scope: OFFLINE_SCOPE,
      runId: "dcn-paypal-synthetic-offline-test", startedAt: OFFLINE_TIME, deadline: OFFLINE_TIME + 7200000,
      limits: { ...PAYPAL_QA_MAXIMUMS, ...limits } }, OFFLINE_TIME);
    const budget = await createPaypalQaBudgetAuthority(file, OFFLINE_SCOPE, () => clock);
    await run({ file, budget, setTime: value => { clock = value; }, now: () => clock });
  } finally {
    try { await unlink(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    await rmdir(directory);
  }
}
export function offlineOauthResponse(changes = {}) {
  return Response.json({ access_token: "synthetic-token-not-a-credential", token_type: "Bearer",
    app_id: "APP-OFFLINEQA123", scope: OFFLINE_BINDING.requiredScopes.join(" "), expires_in: 300, ...changes });
}
export function offlineOauthInput() {
  return ["https://api-m.sandbox.paypal.com/v1/oauth2/token", { method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${OFFLINE_BINDING.clientId}:${OFFLINE_BINDING.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" }];
}
export const offlineBearer = { authorization: "Bearer synthetic-token-not-a-credential", "content-type": "application/json" };
