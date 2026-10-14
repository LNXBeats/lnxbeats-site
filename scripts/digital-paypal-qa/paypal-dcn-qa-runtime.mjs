/** Future process-local guard. No globals change until explicitly installed. */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { AsyncLocalStorage } from "node:async_hooks";
import { syncBuiltinESMExports } from "node:module";
import { createBudgetedPaypalQaFetch, isExplicitLoopbackUrl, PAYPAL_QA_FETCH_ATTESTATION } from "./paypal-dcn-qa-fetch.mjs";

const ticketStore = new AsyncLocalStorage();
const INSTALLED = Symbol.for("lnx.dcn.paypal.qa.network-guard.v1");
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const LOOPBACK_PORTS = new Set([3140, 3142, 8443, 55473]);
function blocked() { throw new Error("QA_NETWORK_BLOCKED:UNINSTRUMENTED_OR_UNAPPROVED_DESTINATION"); }
function endpoint(args, tlsMode = false, socketMode = false) {
  const first = args[0];
  if (first instanceof URL || typeof first === "string" && /^https?:\/\//.test(first)) {
    const url = new URL(String(first));
    if (url.username || url.password) blocked();
    return { host: url.hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)) };
  }
  let value = first;
  // net.Socket.connect internally normalizes arguments to [options, callback].
  if (Array.isArray(value)) value = value[0];
  if (typeof value === "number") return { host: typeof args[1] === "string" ? args[1] : "localhost", port: value };
  if (!value || typeof value !== "object" || value.socketPath || socketMode && value.path) blocked();
  return { host: value.hostname ?? value.host ?? "localhost", port: Number(value.port ?? (tlsMode ? 443 : 80)) };
}
function requireAllowedEndpoint(args, tlsMode = false, socketMode = false) {
  const { host, port } = endpoint(args, tlsMode, socketMode);
  if (LOOPBACK_HOSTS.has(host) && LOOPBACK_PORTS.has(port)) return;
  const ticket = ticketStore.getStore();
  if (ticket?.kind !== "PAYPAL_SANDBOX" || host !== "api-m.sandbox.paypal.com" || port !== 443) blocked();
}

/**
 * Install before Next/application imports. Future Next fetch caching wrappers
 * remain supported, but every external invocation still enters the budgeted
 * dispatcher; direct http/https/net/tls bypasses have no reservation ticket.
 * This is a process-local QA control, not an OS firewall or a security sandbox.
 */
export function installPaypalQaNetworkGuard({ budget, binding, fetchTransport } = {}) {
  if (globalThis[INSTALLED]) throw new Error("QA_NETWORK_BLOCKED:GUARD_ALREADY_INSTALLED");
  const originalFetch = globalThis.fetch;
  const originals = { httpRequest: http.request, httpGet: http.get, httpsRequest: https.request,
    httpsGet: https.get, socketConnect: net.Socket.prototype.connect, tlsConnect: tls.connect };
  const runTransport = (operation, ticket) => ticketStore.run(ticket, operation);
  const localFetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (!LOOPBACK_PORTS.has(Number(url.port || (url.protocol === "https:" ? 443 : 80)))) blocked();
    // Local automatic redirects cannot escape: the underlying socket guard
    // permits only these loopback ports without a PayPal reservation ticket.
    return originalFetch(input, init);
  };
  const closedFetch = async (input, init) => {
    if (isExplicitLoopbackUrl(input)) return localFetch(input, init);
    throw new Error("QA_NETWORK_BLOCKED:EXACT_RECIPE_AUTHORIZATION_REQUIRED");
  };
  const budgeted = budget && binding ? createBudgetedPaypalQaFetch({ budget, binding,
    transport: fetchTransport, runTransport, loopbackFetch: localFetch }) : closedFetch;
  const attestation = budgeted[PAYPAL_QA_FETCH_ATTESTATION] ?? Object.freeze({
    closed: true, providerCallsAuthorized: false, durableReservationBeforeTransport: true,
  });
  for (const [module, name, original, secure] of [[http, "request", originals.httpRequest, false],
    [http, "get", originals.httpGet, false], [https, "request", originals.httpsRequest, true],
    [https, "get", originals.httpsGet, true]]) {
    module[name] = function (...args) { requireAllowedEndpoint(args, secure); return Reflect.apply(original, module, args); };
  }
  net.Socket.prototype.connect = function (...args) {
    requireAllowedEndpoint(args, false, true); return Reflect.apply(originals.socketConnect, this, args);
  };
  tls.connect = function (...args) { requireAllowedEndpoint(args, true, true); return Reflect.apply(originals.tlsConnect, tls, args); };
  syncBuiltinESMExports();
  let currentFetch = budgeted;
  if (!currentFetch[PAYPAL_QA_FETCH_ATTESTATION]) Object.defineProperty(currentFetch, PAYPAL_QA_FETCH_ATTESTATION, { value: attestation });
  Object.defineProperty(globalThis, "fetch", { configurable: false, enumerable: true,
    get: () => currentFetch,
    set: candidate => {
      if (candidate === currentFetch) return;
      if (typeof candidate !== "function") blocked();
      // Each wrapper captures the previous dispatcher, so local Next caching
      // does not recurse. Sandbox calls bypass caches, never the budget guard.
      const wrapped = new Proxy(candidate, { apply(target, thisArg, args) {
        if (isExplicitLoopbackUrl(args[0])) return Reflect.apply(target, thisArg, args);
        return Reflect.apply(budgeted, thisArg, args);
      } });
      Object.defineProperty(wrapped, PAYPAL_QA_FETCH_ATTESTATION, { value: attestation });
      currentFetch = wrapped;
    },
  });
  Object.defineProperty(globalThis, INSTALLED, { value: attestation, configurable: false });
  return attestation;
}
