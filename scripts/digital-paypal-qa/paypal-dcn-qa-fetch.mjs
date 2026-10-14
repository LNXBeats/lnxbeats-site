/** Future QA transport only. Importing it performs no credential read or network call. */
import https from "node:https";
import { timingSafeEqual } from "node:crypto";
import { isPaypalQaBudgetAuthority, paypalRestApplicationIdentity } from "./paypal-dcn-qa-budget.mjs";

export const PAYPAL_SANDBOX_ORIGIN = "https://api-m.sandbox.paypal.com";
export const PAYPAL_QA_FETCH_ATTESTATION = Symbol.for("lnx.dcn.paypal.qa.budgeted-fetch.v1");
const nativeHttpsRequest = https.request;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 65536;
export const PAYPAL_DCN_MINIMUM_WEBHOOK_EVENTS = Object.freeze(["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DECLINED", "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.REFUND.PENDING", "PAYMENT.REFUND.FAILED"]);
const ALLOWED_EVENTS = new Set([...PAYPAL_DCN_MINIMUM_WEBHOOK_EVENTS, "PAYMENT.CAPTURE.REVERSED",
  "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"]);
function blocked(reason) { throw new Error(`QA_FETCH_BLOCKED:${reason}`); }
function equalSecret(actual, expected) {
  const a = Buffer.from(actual ?? ""), b = Buffer.from(expected ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
function jsonBody(body) {
  if (typeof body !== "string" || Buffer.byteLength(body) > MAX_REQUEST_BYTES) blocked("BOUNDED_STRING_BODY_REQUIRED");
  try { return JSON.parse(body); } catch { blocked("INVALID_JSON_BODY"); }
}
export function isExplicitLoopbackUrl(value) {
  try {
    const url = new URL(value instanceof Request ? value.url : value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  } catch { return false; }
}

/** No automatic redirect, retry or pagination. Headers/body are never logged. */
function boundedHttpsTransport(url, init) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => { if (!settled) { settled = true; reject(new Error("QA_FETCH_BLOCKED:BOUNDED_TRANSPORT_FAILED")); } };
    const request = nativeHttpsRequest(url, { method: init.method,
      headers: Object.fromEntries(new Headers(init.headers)), timeout: 15000,
      signal: init.signal, agent: false }, response => {
      const chunks = []; let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) { response.destroy(); request.destroy(); fail(); return; }
        chunks.push(chunk);
      });
      response.once("error", fail); response.once("aborted", fail);
      response.once("end", () => {
        if (settled) return;
        try {
          const status = response.statusCode;
          if (!Number.isInteger(status) || status < 200 || status > 599) { fail(); return; }
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value != null) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          const bytes = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks, size);
          const result = new Response(bytes, { status, headers });
          settled = true; resolve(result);
        } catch { fail(); }
      });
    });
    request.once("error", fail);
    request.once("timeout", () => { request.destroy(); fail(); });
    request.end(init.body);
  });
}

/**
 * Binding is supplied ephemerally by a future authorized launcher, not read here.
 * Its expectedClientId comes from the actual dedicated application's UI proof.
 * OAuth app_id is optional corroboration, never an invented bootstrap gate.
 */
export function createBudgetedPaypalQaFetch({ budget, binding, transport = boundedHttpsTransport,
  runTransport = operation => operation(), loopbackFetch }) {
  if (!isPaypalQaBudgetAuthority(budget)) blocked("EXISTING_DURABLE_BUDGET_REQUIRED");
  if (!binding || binding.environment !== "SANDBOX" || binding.applicationId !== budget.scope.applicationId
    || binding.merchantId !== budget.scope.merchantId || binding.approvedHost !== budget.scope.approvedHost
    || typeof binding.clientId !== "string" || !equalSecret(binding.clientId, binding.expectedClientId)
    || paypalRestApplicationIdentity(binding.expectedClientId) !== budget.scope.applicationId
    || typeof binding.clientSecret !== "string" || !binding.clientSecret
    || !Array.isArray(binding.requiredScopes) || binding.requiredScopes.length === 0
    || binding.requiredScopes.some(s => typeof s !== "string" || !/^https:\/\/[A-Za-z0-9./_-]{1,200}$/.test(s))) blocked("EXACT_PRIVATE_BINDING_REQUIRED");
  if (binding.webhookId != null && !/^[A-Za-z0-9_-]{1,100}$/.test(binding.webhookId)) blocked("INVALID_WEBHOOK_BINDING");
  if (binding.expectedOAuthAppId != null && !/^APP-[A-Za-z0-9]{8,40}$/.test(binding.expectedOAuthAppId)) blocked("INVALID_OPTIONAL_OAUTH_APP_ID");
  const eventNames = binding.webhookEvents ?? [];
  if (!Array.isArray(eventNames) || new Set(eventNames).size !== eventNames.length
    || eventNames.some(name => !ALLOWED_EVENTS.has(name))
    || !PAYPAL_DCN_MINIMUM_WEBHOOK_EVENTS.every(name => eventNames.includes(name))) blocked("INVALID_WEBHOOK_EVENTS");
  const basic = `Basic ${Buffer.from(`${binding.clientId}:${binding.clientSecret}`).toString("base64")}`;
  const bearerTokens = new Set(); let webhookId = binding.webhookId, cleanup = false;
  const fetch = async (input, init = {}) => {
    if (isExplicitLoopbackUrl(input)) {
      if (typeof loopbackFetch !== "function") blocked("LOOPBACK_TRANSPORT_NOT_INSTALLED");
      return runTransport(() => loopbackFetch(input, init), { kind: "LOOPBACK" });
    }
    // Request objects can carry uninspected bodies/redirect policies: callers use
    // the project's existing string-URL interface instead.
    if (typeof input !== "string" && !(input instanceof URL)) blocked("EXPLICIT_URL_REQUIRED");
    let url;
    try { url = new URL(String(input)); } catch { blocked("INVALID_URL"); }
    if (url.origin !== PAYPAL_SANDBOX_ORIGIN || url.username || url.password || url.search || url.hash || url.port) blocked("SANDBOX_ONLY_NO_QUERY");
    if (init.redirect && !["manual", "error"].includes(init.redirect)) blocked("REDIRECT_NOT_AUTHORIZED");
    if (init.retry != null || init.pagination != null) blocked("RETRY_OR_PAGINATION_NOT_AUTHORIZED");
    const method = (init.method ?? "GET").toUpperCase(), headers = new Headers(init.headers);
    const body = init.body;
    if (body != null && (typeof body !== "string" || Buffer.byteLength(body) > MAX_REQUEST_BYTES)) blocked("BOUNDED_STRING_BODY_REQUIRED");
    if (["GET", "DELETE"].includes(method) && body != null) blocked("BODY_NOT_AUTHORIZED");
    if (headers.has("stripe-account") || headers.has("paypal-auth-assertion") || headers.has("cookie")) blocked("FOREIGN_ACCOUNT_CONTEXT");
    const oauth = method === "POST" && url.pathname === "/v1/oauth2/token";
    if (cleanup && !oauth && method !== "DELETE") blocked("TARGETED_CLEANUP_ONLY");
    if (oauth) {
      if (!equalSecret(headers.get("authorization"), basic) || body !== "grant_type=client_credentials"
        || !headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) blocked("EXACT_OAUTH_APPLICATION_REQUIRED");
    } else if (![...bearerTokens].some(token => equalSecret(headers.get("authorization"), `Bearer ${token}`))) blocked("TOKEN_NOT_ISSUED_FOR_BOUND_APPLICATION");
    if (method === "POST" && url.pathname === "/v2/checkout/orders") {
      const payload = jsonBody(body);
      if (payload.intent !== "CAPTURE" || !Array.isArray(payload.purchase_units) || payload.purchase_units.length !== 1
        || payload.purchase_units[0]?.payee?.merchant_id !== binding.merchantId) blocked("EXACT_MERCHANT_REQUIRED");
    }
    if (method === "POST" && url.pathname === "/v1/notifications/verify-webhook-signature") {
      const payload = jsonBody(body);
      if (!webhookId || payload.webhook_id !== webhookId) blocked("EXACT_WEBHOOK_REQUIRED");
    }
    if (method === "POST" && url.pathname === "/v1/notifications/webhooks") {
      const payload = jsonBody(body);
      if (payload.url !== `https://${binding.approvedHost}/api/digital/webhooks/paypal`
        || eventNames.length === 0 || !Array.isArray(payload.event_types)
        || payload.event_types.length !== eventNames.length
        || payload.event_types.some(event => !event || Object.keys(event).length !== 1 || !eventNames.includes(event.name))
        || new Set(payload.event_types.map(event => event.name)).size !== eventNames.length) blocked("EXACT_WEBHOOK_URL_AND_EVENTS_REQUIRED");
    }
    if (method === "DELETE" && url.pathname !== `/v1/notifications/webhooks/${webhookId}`) blocked("EXACT_WEBHOOK_DELETE_REQUIRED");
    // Write+fsync completes BEFORE the injected or native transport starts.
    await budget.reserve({ method, url: String(url), ...(cleanup ? { cleanup: true } : {}) });
    const response = await runTransport(() => transport(String(url), { ...init, method, headers,
      body, redirect: "manual" }), { kind: "PAYPAL_SANDBOX" });
    if (!(response instanceof Response) || response.redirected || (response.url && new URL(response.url).origin !== PAYPAL_SANDBOX_ORIGIN)
      || response.status >= 300 && response.status < 400) blocked("REDIRECT_RESPONSE_REFUSED");
    if (oauth && response.ok) {
      let result;
      try { result = await response.clone().json(); } catch { blocked("INVALID_OAUTH_RESPONSE"); }
      if (!/^APP-[A-Za-z0-9]{8,40}$/.test(result.app_id ?? "")
        || binding.expectedOAuthAppId != null && result.app_id !== binding.expectedOAuthAppId || result.token_type !== "Bearer"
        || typeof result.access_token !== "string" || !result.access_token || result.access_token.length > 8192
        || !Number.isFinite(result.expires_in) || result.expires_in <= 0
        || typeof result.scope !== "string" || !binding.requiredScopes.every(scope => result.scope.split(/\s+/).includes(scope))) blocked("OAUTH_APP_OR_SCOPES_MISMATCH");
      bearerTokens.add(result.access_token);
    }
    if (method === "POST" && url.pathname === "/v1/notifications/webhooks" && response.ok) {
      let result;
      try { result = await response.clone().json(); } catch { blocked("INVALID_WEBHOOK_RESPONSE"); }
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(result.id ?? "")) blocked("INVALID_WEBHOOK_RESPONSE");
      webhookId = result.id;
    }
    return response;
  };
  Object.defineProperty(fetch, "beginWebhookCleanup", { value: () => {
    if (!webhookId || budget.limits.DELETE_WEBHOOK !== 1) blocked("BOUND_QA_WEBHOOK_CLEANUP_REQUIRED");
    cleanup = true;
  } });
  Object.defineProperty(fetch, PAYPAL_QA_FETCH_ATTESTATION, { value: Object.freeze({
    runId: budget.runId, applicationId: budget.scope.applicationId, merchantId: budget.scope.merchantId,
    approvedHost: budget.scope.approvedHost, deadline: budget.deadline, durableReservationBeforeTransport: true,
    automaticRedirects: false, automaticRetries: false,
  }) });
  return Object.freeze(fetch);
}
