/** Durable QA budget journal. No credentials, SDK or network; creation requires exact prior authorization. */
import { constants } from "node:fs";
import { open, readFile, lstat, mkdir, rmdir, realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKTREE = fileURLToPath(new URL("../../", import.meta.url));
export const PAYPAL_QA_MAXIMUMS = Object.freeze({ REST_TOTAL: 120, OAUTH: 60, GET: 20, CREATE_ORDER: 3, CAPTURE: 3,
  REFUND: 2, SIGNATURE: 30, CREATE_WEBHOOK: 1, DELETE_WEBHOOK: 1, DELIVERY: 30 });
const LIMITS = PAYPAL_QA_MAXIMUMS;
const ORIGIN = "https://api-m.sandbox.paypal.com";
const ROUTE = "/api/digital/webhooks/paypal";
const MAXIMUM_WINDOW_MS = 2 * 60 * 60 * 1000;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function blocked(reason) { throw new Error(`QA_BUDGET_BLOCKED:${reason}`); }
/** Public REST Client ID only; journal keeps its identity fingerprint, never the raw value. */
export function paypalRestApplicationIdentity(publicClientId) {
  if (typeof publicClientId !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(publicClientId)) blocked("REAL_REST_APPLICATION_IDENTITY_REQUIRED");
  return `REST-CLIENT-SHA256:${createHash("sha256").update(publicClientId).digest("hex")}`;
}
function scopeValid(s) {
  const keys = ["environment", "applicationName", "applicationId", "merchantId", "approvedHost"];
  return s && Object.keys(s).length === keys.length && Object.keys(s).every(key => keys.includes(key))
    && s.environment === "SANDBOX" && s.applicationName === "LNX Studio DCN QA"
    && /^REST-CLIENT-SHA256:[a-f0-9]{64}$/.test(s.applicationId ?? "")
    && /^[A-Z0-9]{13}$/.test(s.merchantId ?? "")
    && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ngrok-free\.(?:app|dev)$/.test(s.approvedHost ?? "");
}
function authorizationValid(a) {
  const fields = ["approval", "scope", "runId", "startedAt", "deadline", "limits"];
  if (!a || Object.keys(a).length !== fields.length || Object.keys(a).some(key => !fields.includes(key))
    || a.approval !== "USER_APPROVED_EXACT_ROUTE_AND_RECIPE" || !scopeValid(a.scope)
    || !/^dcn-paypal-[A-Za-z0-9-]{8,80}$/.test(a.runId ?? "")
    || !Number.isSafeInteger(a.startedAt) || !Number.isSafeInteger(a.deadline)
    || a.deadline <= a.startedAt || a.deadline - a.startedAt > MAXIMUM_WINDOW_MS) return false;
  const keys = Object.keys(a.limits ?? {});
  return keys.length === Object.keys(LIMITS).length && keys.every(key => Object.hasOwn(LIMITS, key)
    && Number.isSafeInteger(a.limits[key]) && a.limits[key] >= 0 && a.limits[key] <= LIMITS[key])
    && (a.limits.DELETE_WEBHOOK === 0 || a.limits.REST_TOTAL >= 2 && a.limits.OAUTH >= 1);
}
async function safePath(file, { creating = false } = {}) {
  const absolute = path.resolve(file);
  const privateRoot = path.join(WORKTREE, ".private", "dcn-paypal-qa-budget");
  const isPrivate = absolute.startsWith(`${privateRoot}${path.sep}`);
  const isTest = /^\/private\/tmp\/lnx-dcn-paypal-budget-test-[A-Za-z0-9]+\/ledger\.jsonl$/.test(absolute);
  if ((!isPrivate && !isTest) || path.basename(absolute) !== "ledger.jsonl") blocked("UNSAFE_LOCAL_PATH");
  if (await realpath(path.dirname(absolute)) !== path.dirname(absolute)) blocked("SYMLINK_PARENT");
  const parent = await lstat(path.dirname(absolute));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077)
    || parent.uid !== process.getuid()) blocked("PRIVATE_PARENT_REQUIRED");
  if (!creating) {
    const s = await lstat(absolute);
    if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o777) !== 0o600 || s.uid !== process.getuid()
      || s.size > 256 * 1024) blocked("PRIVATE_REGULAR_LEDGER_REQUIRED");
  }
  return absolute;
}
async function lock(file, operation) {
  const directory = `${file}.lock`;
  for (let i = 0; i < 100; i++) {
    try { await mkdir(directory, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (i === 99) blocked("LOCK_BUSY_OR_STALE_REVIEW_REQUIRED");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  try { return await operation(); } finally { await rmdir(directory); }
}
async function readUnlocked(file) {
  const text = await readFile(file, "utf8");
  if (!text.endsWith("\n")) blocked("TORN_JOURNAL_REVIEW_REQUIRED");
  let rows;
  try { rows = text.trimEnd().split("\n").map(line => JSON.parse(line)); } catch { blocked("INVALID_JOURNAL"); }
  const header = rows[0];
  if (Object.keys(header ?? {}).length !== 4 || Object.keys(header ?? {}).some(key => !["kind", "version", "authorization", "hash"].includes(key))
    || header?.kind !== "AUTHORIZATION" || header.version !== 2 || !authorizationValid(header.authorization)
    || header.hash !== hash({ kind: header.kind, version: header.version, authorization: header.authorization })) blocked("INVALID_AUTHORIZATION_HEADER");
  let previousHash = header.hash;
  const used = Object.fromEntries(Object.keys(LIMITS).map(key => [key, 0]));
  let cleanupOauthUsed = 0;
  for (let i = 1; i < rows.length; i++) {
    const entry = rows[i], { hash: entryHash, ...content } = entry;
    if (Object.keys(content).length !== 8 || Object.keys(content).some(key => ![
      "kind", "sequence", "previousHash", "requestId", "timestamp", "type", "path", "purpose",
    ].includes(key)) || content.kind !== "RESERVED_BEFORE_CALL" || content.sequence !== i
      || content.previousHash !== previousHash || hash(content) !== entryHash
      || !Object.hasOwn(LIMITS, content.type) || content.type === "REST_TOTAL"
      || !Number.isSafeInteger(content.timestamp) || content.timestamp < header.authorization.startedAt
      || content.timestamp >= header.authorization.deadline || !/^[a-f0-9-]{36}$/.test(content.requestId ?? "")
      || !["RECIPE", "CLEANUP"].includes(content.purpose)
      || content.purpose === "CLEANUP" && !["OAUTH", "DELETE_WEBHOOK"].includes(content.type)
      || content.type === "DELETE_WEBHOOK" && content.purpose !== "CLEANUP") blocked("INVALID_JOURNAL_ENTRY");
    const classified = requestType({ method: content.type === "DELIVERY" ? "DELIVERY"
      : content.type === "GET" ? "GET" : content.type === "DELETE_WEBHOOK" ? "DELETE" : "POST",
    url: content.type === "DELIVERY" ? content.path : `${ORIGIN}${content.path}` });
    if (classified.type !== content.type) blocked("INVALID_JOURNAL_PATH");
    used[content.type]++; if (content.type !== "DELIVERY") used.REST_TOTAL++;
    if (content.purpose === "CLEANUP" && content.type === "OAUTH") cleanupOauthUsed++;
    previousHash = entryHash;
  }
  for (const key of Object.keys(used)) if (used[key] > header.authorization.limits[key]) blocked("JOURNAL_EXCEEDS_AUTHORIZATION");
  if (cleanupOauthUsed > 1) blocked("JOURNAL_EXCEEDS_CLEANUP_AUTHORIZATION");
  return { authorization: header.authorization, used, cleanupOauthUsed, sequence: rows.length - 1, previousHash };
}
export async function initializePaypalQaBudget(file, authorization, now = Date.now()) {
  if (!authorizationValid(authorization) || now < authorization.startedAt || now >= authorization.deadline) blocked("INVALID_OR_EXPIRED_AUTHORIZATION");
  const target = await safePath(file, { creating: true });
  const header = { kind: "AUTHORIZATION", version: 2, authorization };
  header.hash = hash(header);
  const handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(header)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  const directory = await open(path.dirname(target), constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
  return readPaypalQaBudget(target);
}
export async function readPaypalQaBudget(file) {
  const target = await safePath(file);
  return lock(target, () => readUnlocked(target));
}
function requestType(call) {
  if (!call || Object.keys(call).some(key => !["method", "url", "retry", "pagination", "cleanup"].includes(key))) blocked("NON_MINIMAL_CALL_METADATA");
  if (call.cleanup != null && call.cleanup !== true) blocked("INVALID_CLEANUP_PURPOSE");
  if (call?.retry === true || call?.pagination === true) blocked("RETRY_OR_PAGINATION_NOT_AUTHORIZED");
  if (call?.method === "DELIVERY" && call.url === ROUTE) return { type: "DELIVERY", requestPath: ROUTE };
  let url;
  try { url = new URL(call?.url); } catch { blocked("INVALID_DESTINATION"); }
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || url.port) blocked("SANDBOX_ONLY_NO_QUERY");
  const p = url.pathname, id = "[A-Za-z0-9_-]{1,100}";
  if (call.method === "GET" && [new RegExp(`^/v2/checkout/orders/${id}$`), new RegExp(`^/v2/payments/(?:captures|refunds)/${id}$`),
    new RegExp(`^/v1/notifications/webhooks(?:/${id})?$`),
    new RegExp(`^/v1/customer/disputes/${id}$`)].some(pattern => pattern.test(p))) return { type: "GET", requestPath: p };
  if (call.method === "POST") {
    if (p === "/v1/oauth2/token") return { type: "OAUTH", requestPath: p };
    if (p === "/v1/notifications/verify-webhook-signature") return { type: "SIGNATURE", requestPath: p };
    if (p === "/v2/checkout/orders") return { type: "CREATE_ORDER", requestPath: p };
    if (new RegExp(`^/v2/checkout/orders/${id}/capture$`).test(p)) return { type: "CAPTURE", requestPath: p };
    if (new RegExp(`^/v2/payments/captures/${id}/refund$`).test(p)) return { type: "REFUND", requestPath: p };
    if (p === "/v1/notifications/webhooks") return { type: "CREATE_WEBHOOK", requestPath: p };
  }
  if (call.method === "DELETE" && new RegExp(`^/v1/notifications/webhooks/${id}$`).test(p)) return { type: "DELETE_WEBHOOK", requestPath: p };
  blocked("METHOD_OR_PATH_NOT_AUTHORIZED");
}

const authorities = new WeakSet();
/** Existing authorization only: this never creates a ledger, changes caps, or extends its deadline. */
export async function createPaypalQaBudgetAuthority(file, expectedScope, now = Date.now) {
  const current = await readPaypalQaBudget(file), a = current.authorization;
  if (!scopeValid(expectedScope) || Object.keys(a.scope).some(key => expectedScope[key] !== a.scope[key])) blocked("APPLICATION_MERCHANT_OR_HOST_MISMATCH");
  if (now() < a.startedAt || now() >= a.deadline) blocked("AUTHORIZATION_EXPIRED");
  const scope = Object.freeze({ ...a.scope });
  const authority = Object.freeze({
    scope, runId: a.runId, startedAt: a.startedAt, deadline: a.deadline,
    limits: Object.freeze({ ...a.limits }),
    initialUsed: Object.freeze({ ...current.used }),
    snapshot: () => readPaypalQaBudget(file),
    reserve: call => reservePaypalQaCall(file, call, scope, now()),
  });
  authorities.add(authority);
  return authority;
}
export function isPaypalQaBudgetAuthority(value) { return authorities.has(value); }
/** Fsync reservation completes BEFORE a caller may issue its HTTP operation. */
export async function reservePaypalQaCall(file, call, scope, now = Date.now()) {
  const request = requestType(call), target = await safePath(file);
  return lock(target, async () => {
    const current = await readUnlocked(target), a = current.authorization;
    if (!scopeValid(scope) || Object.keys(a.scope).some(key => scope[key] !== a.scope[key])) blocked("APPLICATION_MERCHANT_OR_HOST_MISMATCH");
    if (now < a.startedAt || now >= a.deadline) blocked("AUTHORIZATION_EXPIRED");
    if (current.used[request.type] >= a.limits[request.type]
      || request.type !== "DELIVERY" && current.used.REST_TOTAL >= a.limits.REST_TOTAL) blocked("BUDGET_EXHAUSTED");
    const cleanup = call.cleanup === true;
    if (cleanup && !["OAUTH", "DELETE_WEBHOOK"].includes(request.type)
      || cleanup && a.limits.DELETE_WEBHOOK !== 1
      || request.type === "DELETE_WEBHOOK" && !cleanup) blocked("EXPLICIT_TARGETED_CLEANUP_REQUIRED");
    if (cleanup && request.type === "OAUTH" && current.cleanupOauthUsed >= 1) blocked("CLEANUP_OAUTH_ALREADY_SPENT");
    if (!cleanup && request.type !== "DELIVERY" && a.limits.DELETE_WEBHOOK > current.used.DELETE_WEBHOOK
      && (current.used.REST_TOTAL + 1 > a.limits.REST_TOTAL - 2 + current.cleanupOauthUsed
        || request.type === "OAUTH" && current.used.OAUTH + 1 > a.limits.OAUTH - 1 + current.cleanupOauthUsed)) blocked("TARGETED_CLEANUP_RESERVE_REQUIRED");
    const content = { kind: "RESERVED_BEFORE_CALL", sequence: current.sequence + 1, previousHash: current.previousHash,
      requestId: randomUUID(), timestamp: now, type: request.type, path: request.requestPath, purpose: cleanup ? "CLEANUP" : "RECIPE" };
    const entry = { ...content, hash: hash(content) };
    const handle = await open(target, constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW);
    try { await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    return { requestId: entry.requestId, sequence: entry.sequence, type: entry.type, reservedBeforeCall: true };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--plan") {
    process.stderr.write("OFFLINE_QA_BUDGET_PLAN_ONLY; no HTTP or initialization execution mode.\n"); process.exitCode = 1;
  } else process.stdout.write(`${JSON.stringify({
    proposedMaximums: LIMITS, publicRoute: ROUTE, sandboxOrigin: ORIGIN,
    maximumWindowMs: MAXIMUM_WINDOW_MS, defaultMode: "OFFLINE", ledgerInitialized: false,
    providerCalls: 0, financialRecipeAuthorized: false,
    relayWiringRequiredBeforeAnyPublicExposure: true,
    exactHostFromAuthorizationRequired: true,
  }, null, 2)}\n`);
}
